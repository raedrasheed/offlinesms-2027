// SmsBatchReport — Phase 11 dedicated OfflineSMS Delivery Report.
//
// Subscribes to smsBatches/{batchId} and its recipients sub-collection;
// surfaces aggregate counts, per-recipient rows, filter chips, and a
// Retry-failed action that calls the Phase 8/11 callable.

import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, FlatList, StyleSheet, Alert,
} from 'react-native';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { retryFailedSmsRecipients, smsErrorCopy, smsErrorReason } from '../lib/sms';
import { colors, radius } from '../theme';
import { useDisplayNames } from '../lib/userProfiles';
import { LoadingState, EmptyState, ErrorState } from '../components/state';

type Status = 'queued' | 'sent' | 'delivered' | 'undelivered' | 'failed' | 'skipped';
type FilterKey = 'all' | 'delivered' | 'pending' | 'failed' | 'skipped';

type Batch = {
  id:                  string;
  status?:             'sending' | 'accepted' | 'partial' | 'completed' | 'failed';
  audience?:           string;
  audienceCanonical?:  string;
  recipientCount?:     number;
  eligibleCount?:      number;
  excludedCount?:      number;
  pointsCost?:         number;
  pointsReserved?:     number;
  pointsDeducted?:     number | null;
  pointsRefunded?:     number | null;
  offlineSmsBatchId?:  string | null;
  gatewayBatchId?:     string | null;
  attemptNumber?:      number;
  createdAt?:          any;
  updatedAt?:          any;
  lastDeliveryReportAt?: any;
  queuedCount?:        number;
  sentCount?:          number;
  deliveredCount?:     number;
  failedCount?:        number;
  skippedCount?:       number;
};

type Recipient = {
  uid:                  string;
  maskedPhone?:         string | null;
  smsStatus?:           Status;
  appReceiptStatus?:    string | null;
  skipReason?:          string | null;
  reason?:              string | null;
  gatewayErrorMessage?: string | null;
  sentAt?:              any;
  deliveredAt?:         any;
  failedAt?:            any;
  updatedAt?:           any;
};

function fmt(ts: any): string {
  const d: Date | null = ts?.toDate?.() ?? null;
  if (!d) return '—';
  return d.toLocaleString();
}
function matches(filter: FilterKey, r: Recipient): boolean {
  if (filter === 'all') return true;
  if (filter === 'delivered') return r.smsStatus === 'delivered';
  if (filter === 'pending')   return r.smsStatus === 'queued' || r.smsStatus === 'sent';
  if (filter === 'failed')    return r.smsStatus === 'failed' || r.smsStatus === 'undelivered';
  if (filter === 'skipped')   return r.smsStatus === 'skipped';
  return true;
}
function statusPillTone(s: Status | undefined) {
  switch (s) {
    case 'delivered':           return { backgroundColor: '#DCFCE7', color: '#166534' };
    case 'sent':                return { backgroundColor: '#E0F2FE', color: '#075985' };
    case 'queued':              return { backgroundColor: '#FEF3C7', color: '#A16207' };
    case 'failed':
    case 'undelivered':         return { backgroundColor: '#FEE2E2', color: '#991B1B' };
    case 'skipped':             return { backgroundColor: '#E5E7EB', color: '#374151' };
    default:                    return { backgroundColor: '#E5E7EB', color: '#374151' };
  }
}

export default function SmsBatchReport({ route, navigation }: any) {
  const { batchId } = route.params as { batchId: string };

  const [batch, setBatch]           = useState<Batch | null | undefined>(undefined);
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  // Recipient rows are keyed by uid (or `ext:<phone>` for phone-only
  // contacts); names come from the shared resolver, never the raw id.
  const nameFor = useDisplayNames(useMemo(() => (recipients ?? []).map(r => r.uid), [recipients]));
  const [filter, setFilter]         = useState<FilterKey>('all');
  const [busy, setBusy]             = useState(false);

  useEffect(() => {
    if (!batchId) return;
    return onSnapshot(doc(db, 'smsBatches', batchId), snap => {
      setBatch(snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<Batch, 'id'>) }) : null);
    });
  }, [batchId]);

  useEffect(() => {
    if (!batchId) return;
    return onSnapshot(collection(db, 'smsBatches', batchId, 'recipients'), snap => {
      setRecipients(snap.docs.map(d => ({ uid: d.id, ...(d.data() as Omit<Recipient, 'uid'>) })));
    });
  }, [batchId]);

  const filtered = useMemo(
    () => (recipients ?? []).filter(r => matches(filter, r)),
    [recipients, filter],
  );

  const counts = useMemo(() => {
    const rs = recipients ?? [];
    return {
      total:     rs.length,
      delivered: rs.filter(r => r.smsStatus === 'delivered').length,
      sent:      rs.filter(r => r.smsStatus === 'sent').length,
      queued:    rs.filter(r => r.smsStatus === 'queued').length,
      failed:    rs.filter(r => r.smsStatus === 'failed' || r.smsStatus === 'undelivered').length,
      skipped:   rs.filter(r => r.smsStatus === 'skipped').length,
    };
  }, [recipients]);

  async function retry() {
    if (busy || !batch) return;
    setBusy(true);
    try {
      const r = await retryFailedSmsRecipients(batch.id);
      Alert.alert('Retry created', `Sent ${r.sent}, failed ${r.failed}.`);
    } catch (e: any) {
      Alert.alert('Couldn’t retry', smsErrorReason(e) ?? smsErrorCopy(e?.code ?? 'internal'));
    } finally { setBusy(false); }
  }

  if (batch === undefined || recipients === null) {
    return (
      <View style={s.root}>
        <Header onBack={() => navigation.goBack()} />
        <LoadingState fullPage title="Loading report…" />
      </View>
    );
  }
  if (batch === null) {
    return (
      <View style={s.root}>
        <Header onBack={() => navigation.goBack()} />
        <ErrorState fullPage title="Couldn’t load" description="Batch not found or you don’t have access." />
      </View>
    );
  }

  const canRetry = counts.failed > 0;

  return (
    <View style={s.root}>
      <Header onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 32 }}>
        <Text style={s.h1}>OfflineSMS Delivery Report</Text>
        <Text style={s.sub}>Batch {batch.offlineSmsBatchId ?? batch.gatewayBatchId ?? batch.id} · status {batch.status ?? '—'}</Text>

        <View style={s.statsGrid}>
          <Stat label="Total"     value={counts.total} />
          <Stat label="Delivered" value={counts.delivered} />
          <Stat label="Pending"   value={counts.queued + counts.sent} />
          <Stat label="Failed"    value={counts.failed} />
        </View>
        <View style={s.statsGrid}>
          <Stat label="Skipped"   value={counts.skipped} />
          <Stat label="Spent"     value={batch.pointsDeducted ?? 0} />
          <Stat label="Refunded"  value={batch.pointsRefunded ?? 0} />
          <Stat label="Reserved"  value={batch.pointsReserved  ?? 0} />
        </View>

        <View style={s.card}>
          <Row label="OfflineSMS batch ID" value={batch.offlineSmsBatchId ?? batch.gatewayBatchId ?? batch.id} />
          <Row label="Audience"            value={batch.audienceCanonical ?? batch.audience ?? '—'} />
          <Row label="Attempt"             value={String(batch.attemptNumber ?? 1)} />
          <Row label="Created"             value={fmt(batch.createdAt)} />
          <Row label="Updated"             value={fmt(batch.updatedAt)} />
          <Row label="Last delivery report" value={fmt(batch.lastDeliveryReportAt)} />
        </View>

        <View style={s.chips}>
          {(['all','delivered','pending','failed','skipped'] as FilterKey[]).map(f => (
            <Pressable key={f} style={[s.chip, filter === f && s.chipOn]} onPress={() => setFilter(f)}>
              <Text style={[s.chipText, filter === f && s.chipTextOn]}>
                {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        {filtered.length === 0 ? (
          <EmptyState compact title="No recipients in this state." />
        ) : (
          <FlatList
            scrollEnabled={false}
            data={filtered}
            keyExtractor={r => r.uid}
            renderItem={({ item }) => (
              <View style={s.recipientRow}>
                <View style={s.avatar}><Text style={s.avatarText}>{nameFor(item.uid).replace(/^@/, '').slice(0, 1).toUpperCase()}</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.recipientName} numberOfLines={1}>{nameFor(item.uid)}</Text>
                  <Text style={s.recipientPhone}>{item.maskedPhone ?? '—'}</Text>
                  {item.skipReason ? <Text style={s.recipientNote}>{prettifyReason(item.skipReason)}</Text> : null}
                  {item.gatewayErrorMessage ? <Text style={s.recipientNote}>{item.gatewayErrorMessage}</Text> : null}
                </View>
                <View style={[s.pill, statusPillTone(item.smsStatus)]}>
                  <Text style={[s.pillText, { color: statusPillTone(item.smsStatus).color }]}>
                    {item.smsStatus ?? 'pending'}
                  </Text>
                </View>
              </View>
            )}
          />
        )}

        <View style={s.row}>
          {canRetry ? (
            <Pressable style={[s.secondaryBtn, { flex: 1 }]} onPress={retry} disabled={busy}>
              <Text style={s.secondaryBtnText}>{busy ? '…' : 'Retry failed'}</Text>
            </Pressable>
          ) : null}
          <Pressable style={[s.primaryBtn, { flex: 1 }]} onPress={() => navigation.goBack()}>
            <Text style={s.primaryBtnText}>Back</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={s.header}>
      <Pressable onPress={onBack}><Text style={s.back}>‹</Text></Pressable>
      <Text style={s.title}>SMS batch</Text>
    </View>
  );
}
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={s.statCard}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.kv}>
      <Text style={s.kvK}>{label}</Text>
      <Text style={s.kvV} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function prettifyReason(reason: string): string {
  switch (reason) {
    case 'no-phone':                 return 'No phone number';
    case 'unverified-phone':         return 'Phone not verified';
    case 'opt-out':                  return 'SMS opted out';
    case 'duplicate-phone':          return 'Duplicate phone';
    case 'already-sent-for-message': return 'This member already received an SMS for this message';
    case 'rate-limited':              return 'Rate limit reached';
    case 'policy-blocked':            return 'Blocked by policy';
    default:                          return reason;
  }
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bgCanvas },
  header:  { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back:    { fontSize: 24, color: colors.primary },
  title:   { fontSize: 14, fontWeight: '700', color: colors.ink },
  h1:      { fontSize: 18, fontWeight: '800', color: colors.ink, marginBottom: 4 },
  sub:     { fontSize: 12, color: colors.ink500, marginBottom: 12 },
  statsGrid: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  statCard:  { flex: 1, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100, padding: 10, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '800', color: colors.ink },
  statLabel: { fontSize: 10, fontWeight: '700', color: colors.ink500, marginTop: 2, letterSpacing: 0.4 },
  card:    { backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100, padding: 12, marginTop: 12, marginBottom: 12 },
  kv:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  kvK:     { fontSize: 12, color: colors.ink500, fontWeight: '600' },
  kvV:     { fontSize: 12, color: colors.ink, fontWeight: '600', maxWidth: '60%', textAlign: 'right' },
  chips:   { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 10 },
  chip:    { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.ink200 },
  chipOn:  { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText:{ fontSize: 12, color: colors.ink700, fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  recipientRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, marginBottom: 6, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100 },
  avatar:  { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primaryDark, fontWeight: '700' },
  recipientName: { fontSize: 13, color: colors.ink, fontWeight: '700' },
  recipientPhone:{ fontSize: 11, color: colors.ink500, marginTop: 2 },
  recipientNote: { fontSize: 11, color: colors.ink500, marginTop: 2 },
  pill:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText:{ fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  row:     { flexDirection: 'row', gap: 8, marginTop: 14 },
  primaryBtn: { padding: 14, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '800' },
  secondaryBtn: { padding: 14, borderRadius: radius.md, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.ink200, alignItems: 'center' },
  secondaryBtnText: { color: colors.ink, fontWeight: '700' },
});
