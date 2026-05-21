// MessageInfo — Phase 6 read-only screen showing message metadata
// (sent / edited / deleted / pinned / starred / reactions / receipts).
// Full delivery analytics land in Phase 7.

import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { getMessageInfo, MessageInfo as MessageInfoData } from '../lib/conversations';
import { colors, radius } from '../theme';
import { LoadingState, ErrorState } from '../components/state';

function fmt(ts: any): string {
  const d: Date | null = ts?.toDate?.() ?? (typeof ts === 'object' && ts?._seconds
    ? new Date(ts._seconds * 1000) : null);
  if (!d) return '—';
  return d.toLocaleString();
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}

export default function MessageInfo({ route, navigation }: any) {
  const { id, messageId } = route.params as { id: string; messageId: string };
  const [info, setInfo] = useState<MessageInfoData | null>(null);
  const [err, setErr]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMessageInfo(id, messageId)
      .then(data => { if (!cancelled) setInfo(data); })
      .catch(e => { if (!cancelled) setErr(e?.message ?? 'failed'); });
    return () => { cancelled = true; };
  }, [id, messageId]);

  if (err) return <ErrorState fullPage title="Couldn’t load" description={err} />;
  if (!info) return <LoadingState fullPage title="Loading info…" />;

  const reactionLine = Object.keys(info.reactions).length === 0
    ? '—'
    : Object.entries(info.reactions).map(([e, n]) => `${e} ${n}`).join('  ');

  const receiptLine =
    Object.keys(info.receiptCounts).length === 0
      ? 'Detailed delivery information will be available in a later update.'
      : Object.entries(info.receiptCounts).map(([k, v]) => `${k}: ${v}`).join('  ·  ');

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
            {info.deletedForEveryone
              ? 'This message was deleted.'
              : '—' /* getMessageInfo doesn't return text body; that's the bubble's job. */}
          </Text>
        </View>

        <Row label="Sent"     value={fmt(info.createdAt)} />
        <Row label="Edited"   value={info.editedAt ? fmt(info.editedAt) : '—'} />
        <Row label="Deleted"  value={info.deletedForEveryone ? fmt(info.deletedAt) : '—'} />
        <Row label="Pinned"   value={info.pinnedAt ? fmt(info.pinnedAt) : '—'} />
        <Row label="Forwarded" value={info.forwarded ? 'Yes' : '—'} />
        <Row label="Reply to"  value={info.replyTo ? (info.replyTo.senderDisplayName + ': ' + info.replyTo.preview) : '—'} />

        <Text style={s.sectionLabel}>Reactions</Text>
        <View style={s.card}>
          <Text style={s.cardBody}>{reactionLine}</Text>
        </View>

        <Text style={s.sectionLabel}>Delivery</Text>
        <View style={s.card}>
          <Text style={s.cardBody}>{receiptLine}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: colors.bgCanvas },
  header: { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back:   { fontSize: 24, color: colors.primary },
  title:  { fontSize: 14, fontWeight: '700', color: colors.ink },
  card:   { backgroundColor: '#fff', padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100, marginBottom: 12 },
  cardLabel: { fontSize: 11, fontWeight: '700', color: colors.ink500, marginBottom: 4 },
  cardBody:  { fontSize: 14, color: colors.ink },
  row:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.ink100 },
  label:  { fontSize: 12, color: colors.ink500, fontWeight: '600' },
  value:  { fontSize: 12, color: colors.ink, fontWeight: '600', maxWidth: '60%', textAlign: 'right' },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: colors.ink500, letterSpacing: 0.6, marginTop: 12, marginBottom: 6 },
});
