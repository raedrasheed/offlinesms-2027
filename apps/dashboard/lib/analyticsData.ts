import { AggregateField, Timestamp, type Firestore, type Query } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { canDo, type AdminCapability } from './adminPermissions';
import { getAdminScope, isPlatformAdmin } from './adminScope';
import type { SessionResult } from './session';
import { getGeography } from './analyticsGeography';
import { AnalyticsCache, PRESENCE_WINDOW_MS, analyticsBuckets, finiteAggregate,
  type AnalyticsLive, type AnalyticsRange, type AnalyticsReport, type AnalyticsSection, type Breakdown } from './analytics';

type Authorized = SessionResult & { state: 'authorized' };
const reports = new AnalyticsCache<AnalyticsReport>(60_000);
const live = new AnalyticsCache<AnalyticsLive>(3_000);
function access(session: Authorized) {
  if (!canDo(session.role, 'view:reports')) throw new Error('Reports access required');
  const claims = session.user.claims;
  const explicit = typeof claims.role === 'string' ? claims.role : null;
  if (session.role === 'legacy_admin' && ((explicit && !['super_admin', 'legacy_admin'].includes(explicit))
    || (!explicit && Array.isArray(claims.roles) && claims.roles.length && !claims.roles.some(r => r === 'super_admin' || r === 'legacy_admin'))))
    throw new Error('Ambiguous administrator claims');
  return getAdminScope(session);
}
function key(session: Authorized) { const scope = access(session); return JSON.stringify([session.role, scope.organizationId ?? null]); }
export function getAnalyticsReport(session: Authorized, range: AnalyticsRange): Promise<AnalyticsReport> {
  const id = `${key(session)}:${range}`;
  return reports.get(id, async () => {
    const result = await loadAnalyticsReport(adminDb, session, range, new Date());
    // Incomplete data gets a short retry window, not a false zero or a minute cache.
    if (result.issues.length) setTimeout(() => reports.delete(id), 5_000).unref?.();
    return result;
  });
}
export function getAnalyticsLive(session: Authorized): Promise<AnalyticsLive> {
  const id = key(session);
  return live.get(id, () => loadAnalyticsLive(adminDb, session, new Date()));
}

/** Eight concurrent aggregate RPCs per report, with an explicit result deadline.
 * The SDK may finish an outstanding RPC later, but late results are discarded.
 * Sections contain null on failures. Never send raw Firestore errors to clients. */
function reader() {
  const issues = new Set<string>();
  let active = 0;
  const queue: (() => void)[] = [];
  const deadline = Date.now() + 18_000;
  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    if (active >= 8) await new Promise<void>(resolve => queue.push(resolve));
    active++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (Date.now() >= deadline) throw new Error('Report deadline');
      return await Promise.race([fn(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Report deadline')), deadline - Date.now());
      })]);
    } catch { issues.add(label); return null; }
    finally { if (timer) clearTimeout(timer); active--; queue.shift()?.(); }
  };
  const count = (label: string, q: Query) => safe(label, async () => finiteAggregate((await q.count().get()).data().count));
  const sum = (label: string, q: Query, field: string) => safe(label, async () => finiteAggregate((await q.aggregate({ total: AggregateField.sum(field) }).get()).data().total));
  return { issues, safe, count, sum };
}
function between(q: Query, start: Date, end: Date, field = 'createdAt') {
  return q.where(field, '>=', Timestamp.fromDate(start)).where(field, '<=', Timestamp.fromDate(end));
}
// Adjacent chart buckets use exclusive upper boundaries; the final point includes
// the snapshot instant. No double-counted midnight or omitted current day.
function bucketQuery(q: Query, a: Date, b: Date, final: boolean, field: string) {
  return q.where(field, '>=', Timestamp.fromDate(a)).where(field, final ? '<=' : '<', Timestamp.fromDate(b));
}
const COLORS = ['#1f7ba8', '#22c55e', '#f59e0b', '#ef4444', '#a78bfa', '#64748b', '#06b6d4', '#ec4899'];

export async function loadAnalyticsReport(db: Firestore, session: Authorized, range: AnalyticsRange, now: Date): Promise<AnalyticsReport> {
  const scope = access(session), { count, sum, issues } = reader();
  const org = scope.organizationId;
  const buckets = analyticsBuckets(range, now), start = buckets[0].start;
  const out: AnalyticsReport = { range, scope: org ? 'Organization' : 'Platform', updatedAt: now.toISOString(), sections: [], issues: [],
    limitations: ['Activity is reported by the app. Last-seen windows are not historical DAU or unique sessions.',
      'Messages and stories count retained documents; purged/deleted content is not reconstructed.',
      'Map countries come from private registration phone numbers, not GPS or current physical locations.',
      'Report aggregates refresh every 60 seconds; presence every 5 seconds. Counts are not a transactional snapshot.'] };
  const scoped = (name: string, field = 'organizationId'): Query => org ? db.collection(name).where(field, '==', org) : db.collection(name);
  const jobs: Promise<unknown>[] = [];
  const section = (key: string, title: string, note: string): AnalyticsSection => {
    const s: AnalyticsSection = { key, title, note, metrics: [] }; out.sections.push(s); return s;
  };
  const metric = (s: AnalyticsSection, key: string, label: string, note: string, q: Query, field?: string) => {
    const m = { key, label, note, value: null as number | null }; s.metrics.push(m);
    jobs.push((async () => { m.value = await (field ? sum(label, q, field) : count(label, q)); })());
  };
  const trend = (s: AnalyticsSection, title: string, q: Query, field = 'createdAt', sumField?: string) => {
    s.trend = { title, unit: sumField ? 'Points' : 'Count', points: buckets.map(b => ({ date: b.date, label: b.label, value: null })) };
    jobs.push(Promise.all(buckets.map(async (b, i) => {
      const query = bucketQuery(q, b.start, b.end, i === buckets.length - 1, field);
      s.trend!.points[i].value = await (sumField ? sum(title, query, sumField) : count(title, query));
    })));
  };
  const breakdown = (s: AnalyticsSection, title: string, q: Query, field: string, groups: { name: string; values: string[] }[]) => {
    s.breakdown = { title, rows: groups.map((g, i) => ({ name: g.name, value: null, color: COLORS[i % COLORS.length] })) };
    jobs.push((async () => {
      const [total, values] = await Promise.all([count(title, q), Promise.all(groups.map(g => count(title,
        q.where(field, g.values.length === 1 ? '==' : 'in', g.values.length === 1 ? g.values[0] : g.values))))]);
      const rows: Breakdown[] = s.breakdown!.rows;
      values.forEach((v, i) => { rows[i].value = v; });
      rows.push({ name: 'Other / missing', color: '#94a3b8', value: total === null || values.some(v => v === null) ? null
        : Math.max(0, total - values.reduce<number>((a, b) => a + (b ?? 0), 0)) });
    })());
  };
  const allowed = (cap: AdminCapability) => canDo(session.role, cap);
  if (allowed('view:users')) {
    const users = org ? db.collection('organizations').doc(org).collection('members') : db.collection('users');
    const date = org ? 'joinedAt' : 'createdAt';
    const s = section('users', org ? 'Organization membership' : 'Users & growth', org ? 'Verified organization members; activity is unavailable without an organization-scoped presence source.' : 'Registered accounts and registration growth. Active counts use current last-seen windows.');
    metric(s, 'users', org ? 'Organization members' : 'Registered users', 'Current total', users);
    metric(s, 'newUsers', org ? 'New memberships' : 'New registrations', `Selected period · ${date}`, between(users, start, now, date));
    trend(s, org ? 'Membership growth' : 'New registrations', users, date);
    if (!org) {
      metric(s, 'profiles', 'Completed profiles', 'Explicit profileCompleted=true', users.where('profileCompleted', '==', true));
      metric(s, 'disabled', 'Disabled accounts', 'Explicit disabled=true', users.where('disabled', '==', true));
    }
  }
  if (allowed('view:groups')) {
    const s = section('groups', 'Conversations & groups', 'Current stored groups, including legacy groups without a status field.');
    metric(s, 'groups', 'Groups', 'Current total', scoped('conversations').where('type', '==', 'group'));
    metric(s, 'newGroups', 'New groups', 'Selected period', between(scoped('conversations').where('type', '==', 'group'), start, now));
    metric(s, 'conversations', 'Conversations', 'All stored conversation types', scoped('conversations'));
  }
  if (allowed('view:communities')) {
    // The legacy community schema has no canonical organization owner field.
    if (!org) {
      const s = section('communities', 'Organizations & communities', 'Current platform inventory.');
      metric(s, 'communities', 'Communities', 'Current total', db.collection('communities'));
      if (allowed('view:organizations')) metric(s, 'organizations', 'Organizations', 'Current total', db.collection('organizations'));
    } else out.limitations.push('Organization community/support totals are unavailable: legacy records have no canonical organization field.');
  }
  if (isPlatformAdmin(session) && allowed('view:groups')) {
    const messages = db.collectionGroup('messages');
    const period = between(messages, start, now);
    const s = section('messages', 'Chat activity', 'Retained chat-message documents only. No message content or sender identity is read.');
    metric(s, 'messages', 'Messages', 'Retained documents created in selected period', period);
    trend(s, 'Retained messages', messages);
    breakdown(s, 'Message types · selected period', period, 'type', [
      { name: 'Text', values: ['text'] }, { name: 'Images', values: ['image'] }, { name: 'Video', values: ['video'] },
      { name: 'Audio', values: ['audio', 'voice'] }, { name: 'Stickers', values: ['sticker'] }, { name: 'Polls', values: ['poll'] }, { name: 'Files', values: ['file'] },
    ]);
  }
  if (allowed('view:sms')) {
    const batches = scoped('smsBatches'), period = between(batches, start, now);
    const s = section('sms', 'OfflineSMS delivery', 'Batch statuses describe submission progress; they are not an SMS recipient delivery rate.');
    metric(s, 'batches', 'SMS batches', 'Selected period', period);
    metric(s, 'failed', 'Failed batches', 'Selected period · status=failed', period.where('status', '==', 'failed'));
    trend(s, 'SMS batches', batches);
    breakdown(s, 'SMS batch status · selected period', period, 'status', [
      { name: 'Completed / accepted', values: ['completed', 'accepted'] }, { name: 'In progress', values: ['queued', 'pending', 'sending', 'processing'] },
      { name: 'Partial', values: ['partial'] }, { name: 'Failed', values: ['failed'] },
    ]);
  }
  if (allowed('view:points') && !org) {
    const spend = db.collection('transactions').where('type', '==', 'sms_spend').where('status', '==', 'completed');
    const s = section('points', 'Points & billing', 'Settled SMS charges after refunds. Reservations and transfers are not counted as SMS spending.');
    metric(s, 'points', 'SMS points spent', 'Selected period · settled charges', between(spend, start, now), 'amount');
    metric(s, 'balance', 'Wallet balances', 'Current sum of stored balances · points', db.collection('wallets'), 'balance');
    metric(s, 'reserved', 'Reserved points', 'Current sum · not settled spending', db.collection('wallets'), 'reserved');
    metric(s, 'payments', 'Payment records', 'Selected period · all statuses; not revenue', between(db.collection('payments'), start, now));
    trend(s, 'SMS points spent', spend, 'createdAt', 'amount');
  }
  if (isPlatformAdmin(session) && allowed('view:clips')) {
    const clips = db.collection('clips');
    const s = section('clips', 'Clips & engagement', 'Cumulative counters describe stored published clips; views are not unique viewers.');
    metric(s, 'published', 'Published clips', 'Current status=published', clips.where('status', '==', 'published'));
    metric(s, 'pending', 'Awaiting review', 'Current status=pending_review', clips.where('status', '==', 'pending_review'));
    metric(s, 'failed', 'Processing failures', 'Current status=failed', clips.where('status', '==', 'failed'));
    for (const [field, label] of [['viewCount', 'Clip views'], ['likeCount', 'Clip likes'], ['commentCount', 'Clip comments']])
      metric(s, field, label, 'Lifetime counter · currently published clips', clips.where('status', '==', 'published'), field);
    trend(s, 'Clip uploads', clips);
    breakdown(s, 'Current clip status', clips, 'status', [
      { name: 'Published', values: ['published'] }, { name: 'Review', values: ['pending_review'] }, { name: 'Processing', values: ['processing', 'uploading'] },
      { name: 'Failed', values: ['failed'] }, { name: 'Removed / rejected', values: ['removed', 'rejected'] },
    ]);
    const stories = db.collection('statuses');
    const t = section('stories', 'Stories', 'Retained story records, including expired stories until cleanup.');
    metric(t, 'created', 'Stories created', 'Selected period · retained records', between(stories, start, now));
    metric(t, 'unexpired', 'Unexpired stories', 'Stored expiry after report time; not an audience-access check', stories.where('expiresAt', '>', Timestamp.fromDate(now)));
    trend(t, 'Stories created', stories);
  }
  if (allowed('view:support') && !org) {
    const s = section('support', 'Support', 'Current ticket status, across all creation dates.');
    metric(s, 'open', 'Open tickets', 'Open and pending', db.collection('tickets').where('status', 'in', ['open', 'pending']));
    breakdown(s, 'Support ticket status', db.collection('tickets'), 'status', ['open', 'pending', 'resolved', 'closed'].map(name => ({ name, values: [name] })));
  }
  if (isPlatformAdmin(session) && allowed('view:moderation')) {
    const s = section('moderation', 'Moderation & notifications', 'Operational queues and recorded broadcast jobs.');
    metric(s, 'clipReports', 'Open clip reports', 'Current status=open', db.collection('clipReports').where('status', '==', 'open'));
    if (allowed('view:broadcast_notifications')) metric(s, 'broadcasts', 'Notification broadcasts', 'Selected period · job records, not delivered devices', between(db.collection('notificationBroadcasts'), start, now));
  }
  if (allowed('view:relay')) {
    const s = section('relay', 'SMS relay', 'Devices and relay job states. Online uses a fresh heartbeat within 90 seconds.');
    metric(s, 'devices', 'Relay devices', 'Current total', scoped('relayDevices', 'businessId'));
    metric(s, 'failedJobs', 'Failed relay jobs', 'Current status=failed · all creation dates', scoped('relayJobs', 'businessId').where('status', '==', 'failed'));
    breakdown(s, 'Current relay job states', scoped('relayJobs', 'businessId'), 'status', [
      { name: 'Queued', values: ['queued'] }, { name: 'In flight', values: ['claimed', 'sending'] },
      { name: 'Sent', values: ['sent'] }, { name: 'Delivered', values: ['delivered'] }, { name: 'Failed / expired', values: ['failed', 'expired'] },
    ]);
  }
  await Promise.all(jobs);
  out.issues = [...issues].sort();
  return out;
}

export async function loadAnalyticsLive(db: Firestore, session: Authorized, now: Date): Promise<AnalyticsLive> {
  const scope = access(session), { safe, count, issues } = reader();
  const showUsers = canDo(session.role, 'view:users') && !scope.organizationId;
  const showRelay = canDo(session.role, 'view:relay');
  const out: AnalyticsLive = { updatedAt: now.toISOString(), online: null, active24h: null, active7d: null, active30d: null,
    presenceCoverage: null, relayOnline: null, relayQueued: null, relayInFlight: null, showUsers, showRelay, geography: null, issues: [] };
  const jobs: Promise<unknown>[] = [];
  if (showUsers) {
    const users = db.collection('users');
    jobs.push((async () => {
      const snapshot = await safe('Online users', () => between(users.where('online', '==', true), new Date(now.getTime() - PRESENCE_WINDOW_MS), now, 'lastSeen').select('lastSeen').get());
      out.online = snapshot?.size ?? null;
      if (isPlatformAdmin(session)) out.geography = await safe('Country distribution', () => getGeography(db, now, snapshot ? snapshot.docs.map(d => d.id) : null));
    })());
    for (const [field, duration] of [['active24h', 1], ['active7d', 7], ['active30d', 30]] as const) {
      jobs.push((async () => { out[field] = await count('Last-seen activity', between(users, new Date(now.getTime() - duration * 86_400_000), now, 'lastSeen')); })());
    }
    jobs.push((async () => { out.presenceCoverage = await count('Presence coverage', between(users, new Date(0), now, 'lastSeen')); })());
  }
  if (showRelay) {
    const q = (collection: string) => scope.organizationId ? db.collection(collection).where('businessId', '==', scope.organizationId) : db.collection(collection);
    const devices = q('relayDevices').where('status', '==', 'active');
    jobs.push((async () => { out.relayOnline = await count('Online relays', between(devices, new Date(now.getTime() - 90_000), now, 'lastHeartbeatAt')); })());
    jobs.push((async () => { out.relayQueued = await count('Relay queue', q('relayJobs').where('status', '==', 'queued')); })());
    jobs.push((async () => { out.relayInFlight = await count('Relay in flight', q('relayJobs').where('status', 'in', ['claimed', 'sending'])); })());
  }
  await Promise.all(jobs); out.issues = [...issues].sort(); return out;
}
