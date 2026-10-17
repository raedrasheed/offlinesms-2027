// MessageInfo — Phase 7 receipt details, restyled to the design guide.
//
// Senders see a teal preview card, a 2×2 stats grid, filter tabs with counts,
// a recipient search, and per-recipient rows with colored status pills.
// Non-senders see aggregates only plus a PermissionState notice.

import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  collection, limit, onSnapshot, orderBy, query, where,
} from 'firebase/firestore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth, db } from '../lib/firebase';
import {
  getMessageInfo,
  MessageInfo as MessageInfoData,
  ReceiptDetail,
  ReceiptStatus,
} from '../lib/conversations';
import { colors, radius } from '../theme';
import { avatarColor, initials } from '../lib/avatar';
import { useDisplayNames } from '../lib/userProfiles';
import { LoadingState, ErrorState, PermissionState } from '../components/state';
import {MessageStatusIcon,RECEIPT_MUTED,RECEIPT_READ,type MessageCheckState} from '../components/CheckmarkIcon';

type TabKey = 'all' | 'read' | 'delivered' | 'pending' | 'failed';

function fmt(ts: any): string {
  const d: Date | null = ts?.toDate?.() ?? (
    typeof ts === 'object' && ts?._seconds ? new Date(ts._seconds * 1000) : null
  );
  if (!d) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const PILL: Record<string, { bg: string; fg: string; label: string }> = {
  read:      { bg: '#DCFCE7', fg: '#166534', label: 'Read' },
  viewed:    { bg: '#DCFCE7', fg: '#166534', label: 'Read' },
  played:    { bg: '#EDE9FE', fg: '#6D28D9', label: 'Played' },
  delivered: { bg: '#DBEAFE', fg: '#1D4ED8', label: 'Delivered' },
  pending:   { bg: '#FEF3C7', fg: '#92400E', label: 'Pending' },
  failed:    { bg: '#FEE2E2', fg: '#991B1B', label: 'Failed' },
};

function StatusPill({ status }: { status: ReceiptStatus }) {
  const tone = PILL[status] ?? { bg: colors.ink100, fg: colors.ink700, label: status };
  return (
    <View style={[s.pill, { backgroundColor: tone.bg }]}>
      {['delivered','read','viewed','played'].includes(status)?<MessageStatusIcon state={status==='delivered'?'delivered':'read'}/>:null}
      <Text style={[s.pillText, { color: tone.fg }]}>{tone.label}</Text>
    </View>
  );
}

function statusMatches(filter: TabKey, status: ReceiptStatus): boolean {
  if (filter === 'all') return true;
  if (filter === 'read') return status === 'read' || status === 'viewed' || status === 'played';
  return status === filter;
}

export default function MessageInfo({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const { id, messageId, messageText, createdAtMs, groupName, memberCount, mediaUploadError } = route.params as {
    id: string; messageId: string;
    messageText?: string; createdAtMs?: number | null;
    groupName?: string | null; memberCount?: number | null;
    mediaUploadError?: { code?: string | null; message?: string | null } | null;
  };
  const [info, setInfo] = useState<MessageInfoData | null>(null);
  const [err, setErr]   = useState<string | null>(null);
  const [tab, setTab]   = useState<TabKey>('all');
  const [search, setSearch] = useState('');
  // Recipient names from the shared resolver (live; the server snapshot is
  // only a fallback and never a uid).
  const recipientUids = useMemo(() => (info?.recipients ?? []).map(r => r.uid), [info?.recipients]);
  const nameFor = useDisplayNames(recipientUids);

  useEffect(() => {
    let cancelled = false;
    setInfo(null); setErr(null);
    getMessageInfo(id, messageId)
      .then(data => { if (!cancelled) setInfo(data); })
      .catch(e => { if (!cancelled) setErr(e?.message ?? 'failed'); });
    return () => { cancelled = true; };
  }, [id, messageId]);

  const a = info?.aggregates ?? { deliveredCount: 0, readCount: 0, viewedCount: 0, playedCount: 0, failedCount: 0, pendingCount: 0 };
  // The server's viewedCount already includes read receipts. Played receipts
  // are separate, so these two counts cover each read/viewed/played recipient once.
  const readTotal = a.viewedCount + a.playedCount;

  const counts = useMemo(() => {
    const recs = info?.recipients ?? [];
    return {
      all:       recs.length,
      read:      recs.filter(r => statusMatches('read', r.status)).length,
      delivered: recs.filter(r => r.status === 'delivered').length,
      pending:   recs.filter(r => r.status === 'pending').length,
      failed:    recs.filter(r => r.status === 'failed').length,
    };
  }, [info?.recipients]);

  const filtered = useMemo<ReceiptDetail[]>(() => {
    if (!info?.recipients) return [];
    const q = search.trim().toLowerCase();
    return info.recipients.filter(r =>
      statusMatches(tab, r.status) &&
      (!q || nameFor(r.uid, { snapshot: r.displayName }).toLowerCase().includes(q)),
    );
  }, [info?.recipients, tab, search, nameFor]);

  if (err)  return <ErrorState fullPage title="Couldn’t load" description={err} />;
  if (!info) return <LoadingState fullPage title="Loading info…" />;

  const subtitle = [groupName, memberCount ? `${memberCount} members` : null].filter(Boolean).join(' · ');

  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Message info</Text>
          {subtitle ? <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        <Ionicons name="ellipsis-horizontal" size={20} color={colors.ink500} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View style={s.preview}>
          <Text style={s.previewText}>
            {messageText || (info.deletedForEveryone ? 'This message was deleted.' : '—')}
          </Text>
          <Text style={s.previewTime}>{fmt(info.createdAt) || (createdAtMs ? new Date(createdAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')}</Text>
        </View>

        {mediaUploadError ? (
          <View style={s.uploadErrCard}>
            <View style={s.uploadErrHead}>
              <Ionicons name="cloud-offline-outline" size={16} color="#991B1B" />
              <Text style={s.uploadErrTitle}>Media upload failed</Text>
            </View>
            <Text style={s.uploadErrCode}>{mediaUploadError.code ?? 'unknown error'}</Text>
            {mediaUploadError.message ? (
              <Text style={s.uploadErrMsg}>{mediaUploadError.message}</Text>
            ) : null}
            <Text style={s.uploadErrHint}>Tap the retry icon on the message to try sending again.</Text>
          </View>
        ) : null}

        <View style={s.statsGrid}>
          <Stat receipt="delivered" tint={RECEIPT_MUTED} value={a.deliveredCount} label="Delivered" />
          <Stat receipt="read" tint={RECEIPT_READ} value={readTotal} label="Read" />
          <Stat icon="time-outline"   tint="#92400E" value={a.pendingCount}   label="Pending" />
          <Stat icon="alert-circle-outline" tint="#991B1B" value={a.failedCount} label="Failed" />
        </View>

        {info.isSender && !info.deletedForEveryone
          && (a.pendingCount > 0 || a.failedCount > 0 || a.deliveredCount > readTotal) ? (
          <Pressable
            style={s.escalateBtn}
            onPress={() => navigation.navigate('SmsEscalation', { conversationId: id, messageId, messageText })}
          >
            <Text style={s.escalateText}>Send via OfflineSMS</Text>
            <Text style={s.escalateSub}>Reach recipients who haven’t read or received this message.</Text>
          </Pressable>
        ) : null}

        {info.isSender ? (
          <LatestBatchLink
            conversationId={id}
            messageId={messageId}
            onOpen={batchId => navigation.navigate('SmsBatchReport', { batchId })}
          />
        ) : null}

        {info.isSender && info.recipients ? (
          <>
            <View style={s.tabs}>
              {(['all', 'read', 'delivered', 'pending', 'failed'] as TabKey[]).map(t => (
                <Pressable key={t} style={[s.tab, tab === t && s.tabOn]} onPress={() => setTab(t)}>
                  <Text style={[s.tabText, tab === t && s.tabTextOn]}>
                    {t === 'all' ? 'All' : `${t[0].toUpperCase()}${t.slice(1)} ${counts[t]}`}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={s.searchWrap}>
              <Ionicons name="search" size={16} color={colors.ink400} />
              <TextInput
                style={s.search}
                placeholder="Search recipients"
                placeholderTextColor={colors.ink400}
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
              />
            </View>

            {filtered.length === 0 ? (
              <Text style={s.empty}>No recipients in this state.</Text>
            ) : (
              filtered.map(item => (
                <View key={item.uid} style={s.recipientRow}>
                  <View style={[s.avatar, { backgroundColor: avatarColor(item.uid) }]}>
                    <Text style={s.avatarText}>{initials(nameFor(item.uid, { snapshot: item.displayName }))}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={s.nameRow}>
                      <Text style={s.recipientName} numberOfLines={1}>{nameFor(item.uid, { snapshot: item.displayName })}</Text>
                      {item.role && item.role !== 'member' ? (
                        <Text style={s.roleBadge}>{item.role.toUpperCase()}</Text>
                      ) : null}
                    </View>
                    <Text style={s.recipientMeta} numberOfLines={1}>
                      {[
                        item.deliveredAt ? `Delivered ${fmt(item.deliveredAt)}` : null,
                        item.readAt ? `Read ${fmt(item.readAt)}` : null,
                        item.playedAt ? `Played ${fmt(item.playedAt)}` : null,
                      ].filter(Boolean).join(' · ') || '—'}
                    </Text>
                    {item.failureReason ? <Text style={s.recipientFail}>{item.failureReason}</Text> : null}
                  </View>
                  <StatusPill status={item.status} />
                </View>
              ))
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

function Stat({ icon, receipt, tint, value, label }: { icon?: keyof typeof Ionicons.glyphMap; receipt?:MessageCheckState;tint: string; value: number; label: string }) {
  return (
    <View style={s.statCard}>
      <View style={s.statTop}>
        {receipt?<MessageStatusIcon state={receipt}/>:<Ionicons name={icon} size={15} color={tint}/>}
        <Text style={[s.statValue, { color: tint }]}>{value}</Text>
      </View>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function LatestBatchLink({
  conversationId, messageId, onOpen,
}: {
  conversationId: string; messageId: string; onOpen: (batchId: string) => void;
}) {
  const me = auth.currentUser?.uid;
  const [batch, setBatch] = useState<{ id: string; status?: string } | null>(null);

  useEffect(() => {
    if (!me || !messageId) return;
    const q = query(
      collection(db, 'smsBatches'),
      where('senderId', '==', me),
      where('messageId', '==', messageId),
      orderBy('createdAt', 'desc'),
      limit(1),
    );
    return onSnapshot(q, snap => {
      if (snap.empty) { setBatch(null); return; }
      const d = snap.docs[0];
      setBatch({ id: d.id, ...(d.data() as { status?: string }) });
    });
  }, [me, messageId, conversationId]);

  if (!batch) return null;
  return (
    <Pressable style={s.batchLinkCard} onPress={() => onOpen(batch.id)}>
      <View style={{ flex: 1 }}>
        <Text style={s.batchLinkTitle}>OfflineSMS reminders</Text>
        <Text style={s.batchLinkSub}>Latest batch · status {batch.status ?? '—'}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.ink400} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bgCanvas },
  header:  { paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 12 },
  title:   { fontSize: 17, fontWeight: '800', color: colors.ink },
  subtitle:{ fontSize: 12, color: colors.ink500, marginTop: 1 },
  preview: { backgroundColor: '#1D6E92', borderRadius: 16, padding: 14 },
  previewText: { fontSize: 15, color: '#fff', lineHeight: 21 },
  previewTime: { fontSize: 11, color: 'rgba(255,255,255,.75)', alignSelf: 'flex-end', marginTop: 6 },
  uploadErrCard:  { marginTop: 14, padding: 14, borderRadius: radius.md, backgroundColor: '#FEE2E2', borderWidth: 1, borderColor: '#FCA5A5' },
  uploadErrHead:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  uploadErrTitle: { fontSize: 13, fontWeight: '800', color: '#991B1B' },
  uploadErrCode:  { fontSize: 13, fontWeight: '700', color: '#7F1D1D', marginTop: 6, fontFamily: 'monospace' },
  uploadErrMsg:   { fontSize: 12, color: '#991B1B', marginTop: 4, lineHeight: 17 },
  uploadErrHint:  { fontSize: 11, color: '#B91C1C', marginTop: 8 },
  statsGrid:{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  statCard: { width: '47%', flexGrow: 1, backgroundColor: '#fff', borderRadius: radius.md, padding: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  statTop:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statValue:{ fontSize: 20, fontWeight: '800' },
  statLabel:{ fontSize: 11, fontWeight: '700', color: colors.ink500, marginTop: 4, letterSpacing: 0.4 },
  escalateBtn:  { marginTop: 14, padding: 14, borderRadius: radius.md, backgroundColor: colors.primary },
  escalateText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  escalateSub:  { color: 'rgba(255,255,255,.85)', fontSize: 11, marginTop: 4 },
  batchLinkCard: { flexDirection: 'row', alignItems: 'center', marginTop: 10, padding: 14, borderRadius: radius.md, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.ink100 },
  batchLinkTitle: { fontSize: 13, fontWeight: '800', color: colors.ink },
  batchLinkSub:   { fontSize: 11, color: colors.ink500, marginTop: 2 },
  tabs:    { flexDirection: 'row', gap: 6, marginTop: 18, flexWrap: 'wrap' },
  tab:     { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.ink300 },
  tabOn:   { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontSize: 12, color: colors.ink700, fontWeight: '700' },
  tabTextOn: { color: '#fff' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingHorizontal: 12, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100 },
  search:  { flex: 1, paddingVertical: 10, fontSize: 14, color: colors.ink },
  empty:   { fontSize: 12, color: colors.ink500, textAlign: 'center', padding: 20 },
  recipientRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.ink100 },
  avatar:  { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recipientName: { fontSize: 14, color: colors.ink, fontWeight: '700', flexShrink: 1 },
  roleBadge: { fontSize: 9, fontWeight: '800', color: colors.primaryDark, letterSpacing: 0.6 },
  recipientMeta: { fontSize: 11, color: colors.ink500, marginTop: 3 },
  recipientFail: { fontSize: 11, color: colors.err, marginTop: 2 },
  pill:    { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,flexDirection:'row',alignItems:'center',gap:4 },
  pillText: { fontSize: 11, fontWeight: '700' },
});
