// MessageInfo — Phase 7 receipt details.
//
// Senders see aggregate counts + a tabbed per-recipient list (All /
// Delivered / Read / Pending / Failed). Non-senders see aggregates only
// plus a PermissionState notice explaining why detail is hidden.

import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, FlatList } from 'react-native';
import {
  getMessageInfo,
  MessageInfo as MessageInfoData,
  ReceiptDetail,
  ReceiptStatus,
} from '../lib/conversations';
import { colors, radius } from '../theme';
import { LoadingState, ErrorState, PermissionState } from '../components/state';

type TabKey = 'all' | 'delivered' | 'read' | 'pending' | 'failed';

function fmt(ts: any): string {
  const d: Date | null = ts?.toDate?.() ?? (
    typeof ts === 'object' && ts?._seconds
      ? new Date(ts._seconds * 1000) : null
  );
  if (!d) return '—';
  return d.toLocaleString();
}

function StatusPill({ status }: { status: ReceiptStatus }) {
  const tone = (() => {
    switch (status) {
      case 'delivered': return { bg: '#E0F2FE', fg: '#075985' };
      case 'read':      return { bg: '#DCFCE7', fg: '#166534' };
      case 'viewed':    return { bg: '#DCFCE7', fg: '#166534' };
      case 'played':    return { bg: '#DDD6FE', fg: '#5B21B6' };
      case 'failed':    return { bg: '#FEE2E2', fg: '#991B1B' };
      default:          return { bg: '#E5E7EB', fg: '#374151' };
    }
  })();
  return (
    <View style={[s.pill, { backgroundColor: tone.bg }]}>
      <Text style={[s.pillText, { color: tone.fg }]}>{status}</Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}

function recipientTime(r: ReceiptDetail): any {
  return r.readAt ?? r.viewedAt ?? r.playedAt ?? r.deliveredAt ?? r.failedAt ?? null;
}

function statusMatches(filter: TabKey, status: ReceiptStatus): boolean {
  if (filter === 'all') return true;
  if (filter === 'read') return status === 'read' || status === 'viewed' || status === 'played';
  if (filter === 'delivered') return status === 'delivered';
  if (filter === 'pending') return status === 'pending';
  if (filter === 'failed') return status === 'failed';
  return true;
}

export default function MessageInfo({ route, navigation }: any) {
  const { id, messageId } = route.params as { id: string; messageId: string };
  const [info, setInfo] = useState<MessageInfoData | null>(null);
  const [err, setErr]   = useState<string | null>(null);
  const [tab, setTab]   = useState<TabKey>('all');

  useEffect(() => {
    let cancelled = false;
    setInfo(null); setErr(null);
    getMessageInfo(id, messageId)
      .then(data => { if (!cancelled) setInfo(data); })
      .catch(e => { if (!cancelled) setErr(e?.message ?? 'failed'); });
    return () => { cancelled = true; };
  }, [id, messageId]);

  const filtered = useMemo<ReceiptDetail[]>(() => {
    if (!info?.recipients) return [];
    return info.recipients.filter(r => statusMatches(tab, r.status));
  }, [info?.recipients, tab]);

  if (err) return <ErrorState fullPage title="Couldn’t load" description={err} />;
  if (!info) return <LoadingState fullPage title="Loading info…" />;

  const a = info.aggregates ?? {
    deliveredCount: 0, readCount: 0, viewedCount: 0,
    playedCount: 0, failedCount: 0, pendingCount: 0,
  };

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()}><Text style={s.back}>‹</Text></Pressable>
        <Text style={s.title}>Message info</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 32 }}>
        <View style={s.card}>
          <Text style={s.cardLabel}>{info.senderDisplayName ?? info.senderUid ?? 'Message'}</Text>
          <Text style={s.cardBody}>
            {info.deletedForEveryone ? 'This message was deleted.' : '—'}
          </Text>
        </View>

        <Row label="Sent"      value={fmt(info.createdAt)} />
        <Row label="Edited"    value={info.editedAt ? fmt(info.editedAt) : '—'} />
        <Row label="Deleted"   value={info.deletedForEveryone ? fmt(info.deletedAt) : '—'} />
        <Row label="Pinned"    value={info.pinnedAt ? fmt(info.pinnedAt) : '—'} />
        <Row label="Forwarded" value={info.forwarded ? 'Yes' : '—'} />
        <Row label="Reply to"  value={info.replyTo ? (info.replyTo.senderDisplayName + ': ' + info.replyTo.preview) : '—'} />

        <Text style={s.sectionLabel}>Delivery</Text>
        <View style={s.statsGrid}>
          <Stat label="Delivered" value={a.deliveredCount} />
          <Stat label="Read"      value={a.readCount + a.viewedCount + a.playedCount} />
          <Stat label="Pending"   value={a.pendingCount} />
          <Stat label="Failed"    value={a.failedCount} />
        </View>

        {info.isSender && info.recipients ? (
          <>
            <View style={s.tabs}>
              {(['all','delivered','read','pending','failed'] as TabKey[]).map(t => (
                <Pressable key={t} style={[s.tab, tab === t && s.tabOn]} onPress={() => setTab(t)}>
                  <Text style={[s.tabText, tab === t && s.tabTextOn]}>
                    {t === 'all' ? 'All' : t[0].toUpperCase() + t.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>

            {filtered.length === 0 ? (
              <Text style={s.empty}>No recipients in this state.</Text>
            ) : (
              <FlatList
                scrollEnabled={false}
                data={filtered}
                keyExtractor={r => r.uid}
                renderItem={({ item }) => (
                  <View style={s.recipientRow}>
                    <View style={s.avatar}><Text style={s.avatarText}>{(item.displayName ?? item.uid).slice(0, 1).toUpperCase()}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.recipientName}>
                        {item.displayName ?? item.uid.slice(0, 6)}
                        {item.role && item.role !== 'member' ? `  · ${item.role}` : ''}
                      </Text>
                      <Text style={s.recipientTime}>{fmt(recipientTime(item))}</Text>
                      {item.failureReason ? <Text style={s.recipientFail}>{item.failureReason}</Text> : null}
                    </View>
                    <StatusPill status={item.status} />
                  </View>
                )}
              />
            )}
          </>
        ) : (
          <View style={{ marginTop: 18 }}>
            <PermissionState
              compact
              title="Receipt details unavailable"
              description="You can only view receipt details for messages you sent."
            />
          </View>
        )}
      </ScrollView>
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

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bgCanvas },
  header:  { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back:    { fontSize: 24, color: colors.primary },
  title:   { fontSize: 14, fontWeight: '700', color: colors.ink },
  card:    { backgroundColor: '#fff', padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100, marginBottom: 12 },
  cardLabel: { fontSize: 11, fontWeight: '700', color: colors.ink500, marginBottom: 4 },
  cardBody:  { fontSize: 14, color: colors.ink },
  row:     { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.ink100 },
  label:   { fontSize: 12, color: colors.ink500, fontWeight: '600' },
  value:   { fontSize: 12, color: colors.ink, fontWeight: '600', maxWidth: '60%', textAlign: 'right' },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: colors.ink500, letterSpacing: 0.6, marginTop: 12, marginBottom: 6 },
  statsGrid:{ flexDirection: 'row', gap: 8 },
  statCard: { flex: 1, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100, padding: 10, alignItems: 'center' },
  statValue:{ fontSize: 22, fontWeight: '800', color: colors.ink },
  statLabel:{ fontSize: 10, fontWeight: '700', color: colors.ink500, marginTop: 2, letterSpacing: 0.4 },
  tabs:    { flexDirection: 'row', gap: 6, marginTop: 14, flexWrap: 'wrap' },
  tab:     { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.ink200 },
  tabOn:   { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontSize: 12, color: colors.ink700, fontWeight: '600' },
  tabTextOn: { color: '#fff' },
  empty:   { fontSize: 12, color: colors.ink500, textAlign: 'center', padding: 16 },
  recipientRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, marginTop: 6, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100 },
  avatar:  { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primaryDark, fontWeight: '700' },
  recipientName: { fontSize: 13, color: colors.ink, fontWeight: '700' },
  recipientTime: { fontSize: 11, color: colors.ink500, marginTop: 2 },
  recipientFail: { fontSize: 11, color: colors.err, marginTop: 2 },
  pill:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
});
