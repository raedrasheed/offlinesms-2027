// OfflineSMS Points transaction detail — Phase 9.
//
// Shows everything we know about a single transaction. For SMS-spend
// transactions, links straight into the Phase 8 OfflineSMS Delivery
// Report by routing into SmsEscalation with the related batch context.

import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import {
  formatPointsAmount, getTransaction, getTransactionLabel,
  Transaction,
} from '../lib/points';
import { colors, radius } from '../theme';
import { LoadingState, ErrorState } from '../components/state';

function fmt(ts: any): string {
  const d: Date | null = ts?.toDate?.() ?? null;
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

export default function TransactionDetail({ route, navigation }: any) {
  const { id } = route.params as { id: string };
  const [tx, setTx] = useState<Transaction | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTx(null); setErr(null);
    getTransaction(id)
      .then(t => { if (!cancelled) {
        if (!t) setErr('Transaction not found.');
        else setTx(t);
      } })
      .catch(e => { if (!cancelled) setErr(e?.message ?? 'failed'); });
    return () => { cancelled = true; };
  }, [id]);

  if (err) return (
    <View style={s.root}>
      <Header onBack={() => navigation.goBack()} />
      <ErrorState fullPage title="Couldn’t load" description={err} />
    </View>
  );
  if (!tx) return (
    <View style={s.root}>
      <Header onBack={() => navigation.goBack()} />
      <LoadingState fullPage title="Loading transaction…" />
    </View>
  );

  const credit = tx.direction === 'credit';
  const statusLabel = tx.status.charAt(0).toUpperCase() + tx.status.slice(1);

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 32 }}>
      <Header onBack={() => navigation.goBack()} />

      <View style={s.padded}>
        <View style={s.hero}>
          <Text style={s.heroLabel}>{getTransactionLabel(tx.type)}</Text>
          <Text style={[s.heroAmount, credit ? s.heroAmountCredit : s.heroAmountDebit]}>
            {formatPointsAmount(tx.amount, tx.direction)}
          </Text>
          <View style={[s.statusPill, statusTone(tx.status)]}>
            <Text style={[s.statusPillText, statusToneText(tx.status)]}>{statusLabel}</Text>
          </View>
        </View>

        <View style={s.card}>
          <Row label="Transaction ID" value={tx.id} />
          <Row label="Type"           value={getTransactionLabel(tx.type)} />
          <Row label="Direction"      value={credit ? 'Credit' : 'Debit'} />
          <Row label="Status"         value={statusLabel} />
          <Row label="Created"        value={fmt(tx.createdAt)} />
          <Row label="Completed"      value={tx.completedAt ? fmt(tx.completedAt) : '—'} />
        </View>

        {(tx.refund != null || tx.sent != null || tx.failed != null) ? (
          <View style={s.card}>
            <Text style={s.sectionLabel}>SMS settlement</Text>
            {tx.sent   != null ? <Row label="Sent"    value={String(tx.sent)} /> : null}
            {tx.failed != null ? <Row label="Failed"  value={String(tx.failed)} /> : null}
            {tx.refund != null ? <Row label="Refund"  value={`${tx.refund} pts`} /> : null}
          </View>
        ) : null}

        {tx.package ? (
          <View style={s.card}>
            <Row label="Package" value={tx.package} />
            {tx.priceCents != null ? <Row label="Price" value={`${(tx.priceCents / 100).toFixed(2)}`} /> : null}
          </View>
        ) : null}

        {tx.relatedSmsBatchId ? (
          <Pressable
            style={s.linkCard}
            onPress={() => navigation.navigate('SmsEscalation', {
              conversationId: tx.relatedConversationId ?? '',
              messageId:      tx.relatedMessageId ?? '',
            })}
          >
            <Text style={s.linkTitle}>OfflineSMS Delivery Report</Text>
            <Text style={s.linkSub}>OfflineSMS batch · {tx.relatedSmsBatchId}</Text>
          </Pressable>
        ) : null}

        {tx.relatedUserId ? (
          <View style={s.card}>
            <Row label="Counterparty" value={tx.relatedUserId} />
          </View>
        ) : null}

        {tx.note ? (
          <View style={s.card}>
            <Text style={s.sectionLabel}>Notes</Text>
            <Text style={s.noteText}>{tx.note}</Text>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={s.header}>
      <Pressable onPress={onBack}><Text style={s.back}>‹</Text></Pressable>
      <Text style={s.title}>Transaction</Text>
    </View>
  );
}

function statusTone(status: Transaction['status']) {
  switch (status) {
    case 'completed': return { backgroundColor: '#DCFCE7' };
    case 'pending':   return { backgroundColor: '#FEF3C7' };
    case 'failed':    return { backgroundColor: '#FEE2E2' };
    case 'reversed':  return { backgroundColor: '#E0E7FF' };
    case 'refunded':  return { backgroundColor: '#DDD6FE' };
  }
}
function statusToneText(status: Transaction['status']) {
  switch (status) {
    case 'completed': return { color: '#166534' };
    case 'pending':   return { color: '#A16207' };
    case 'failed':    return { color: '#991B1B' };
    case 'reversed':  return { color: '#3730A3' };
    case 'refunded':  return { color: '#5B21B6' };
  }
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bgCanvas },
  header:  { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back:    { fontSize: 24, color: colors.primary },
  title:   { fontSize: 14, fontWeight: '700', color: colors.ink },
  padded:  { padding: 14 },
  hero:    { alignItems: 'center', padding: 18, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100, marginBottom: 12 },
  heroLabel: { fontSize: 11, color: colors.ink500, letterSpacing: 0.6, fontWeight: '700' },
  heroAmount: { fontSize: 30, fontWeight: '800', marginTop: 6 },
  heroAmountCredit: { color: '#15803D' },
  heroAmountDebit:  { color: colors.ink },
  statusPill:     { marginTop: 8, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  statusPillText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  card:    { backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100, padding: 14, marginBottom: 12 },
  row:     { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  label:   { fontSize: 12, color: colors.ink500, fontWeight: '600' },
  value:   { fontSize: 12, color: colors.ink, fontWeight: '600', maxWidth: '60%', textAlign: 'right' },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: colors.ink500, letterSpacing: 0.6, marginBottom: 8 },
  linkCard: { backgroundColor: colors.primary, padding: 14, borderRadius: radius.md, marginBottom: 12 },
  linkTitle: { color: '#fff', fontSize: 14, fontWeight: '800' },
  linkSub:   { color: 'rgba(255,255,255,.85)', fontSize: 11, marginTop: 4 },
  noteText:  { fontSize: 13, color: colors.ink, lineHeight: 18 },
});
