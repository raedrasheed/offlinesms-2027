// OfflineSMS Points wallet — Phase 9.
//
// Read-only screen. Shows balance / reserved / available, recent
// transactions with type filter chips, and disabled "Buy points" /
// "Transfer" affordances (Phase 10).

import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet,
} from 'react-native';
import { auth } from '../lib/firebase';
import {
  subscribeWallet, subscribeTransactions,
  formatPointsAmount, getTransactionLabel, getTransactionIcon,
  Transaction, Wallet,
} from '../lib/points';
import { colors, radius } from '../theme';
import { LoadingState, EmptyState } from '../components/state';

type FilterKey = 'all' | 'sms_spend' | 'refund' | 'purchase' | 'transfer' | 'admin';

const BUY_ENABLED = false;
const TRANSFER_ENABLED = false;

function filterMatches(filter: FilterKey, t: Transaction): boolean {
  if (filter === 'all') return true;
  if (filter === 'sms_spend') return t.type === 'sms_spend';
  if (filter === 'refund')    return t.type === 'refund' || t.type === 'reservation_release';
  if (filter === 'purchase')  return t.type === 'purchase';
  if (filter === 'transfer')  return t.type === 'transfer_in' || t.type === 'transfer_out';
  if (filter === 'admin')     return t.type === 'admin_adjustment';
  return true;
}

function fmtDate(ts: any): string {
  const d: Date | null = ts?.toDate?.() ?? null;
  if (!d) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Points({ navigation }: any) {
  const me = auth.currentUser?.uid;
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [txs, setTxs] = useState<Transaction[] | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');

  useEffect(() => {
    if (!me) return;
    return subscribeWallet(me, setWallet);
  }, [me]);

  useEffect(() => {
    if (!me) return;
    return subscribeTransactions(me, setTxs, { limit: 25 });
  }, [me]);

  const filtered = useMemo(
    () => (txs ?? []).filter(t => filterMatches(filter, t)),
    [txs, filter],
  );

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()}><Text style={s.back}>‹</Text></Pressable>
        <Text style={s.title}>OfflineSMS Points</Text>
      </View>

      {wallet === null ? (
        <View style={s.padded}><LoadingState compact title="Loading wallet…" /></View>
      ) : (
        <View style={s.padded}>
          <View style={s.balanceCard}>
            <Text style={s.balanceLabel}>BALANCE</Text>
            <Text style={s.balanceAmount}>{wallet.balance.toLocaleString()} <Text style={s.balanceUnit}>pts</Text></Text>

            <View style={s.metaRow}>
              <View style={s.metaCell}>
                <Text style={s.metaLabel}>Reserved</Text>
                <Text style={s.metaValue}>{wallet.reserved.toLocaleString()}</Text>
              </View>
              <View style={s.metaCell}>
                <Text style={s.metaLabel}>Available</Text>
                <Text style={s.metaValue}>{wallet.available.toLocaleString()}</Text>
              </View>
            </View>

            <Text style={s.reservedHelp}>
              Reserved points are temporarily held for SMS batches that are still processing.
            </Text>

            <View style={s.actions}>
              <Pressable style={[s.action, !BUY_ENABLED && { opacity: 0.45 }]} disabled={!BUY_ENABLED}>
                <Text style={s.actionTitle}>Buy points</Text>
                <Text style={s.actionSub}>{BUY_ENABLED ? '' : 'Coming soon'}</Text>
              </Pressable>
              <Pressable style={[s.action, !TRANSFER_ENABLED && { opacity: 0.45 }]} disabled={!TRANSFER_ENABLED}>
                <Text style={s.actionTitle}>Transfer</Text>
                <Text style={s.actionSub}>{TRANSFER_ENABLED ? '' : 'Coming soon'}</Text>
              </Pressable>
            </View>
          </View>

          <View style={s.helpCard}>
            <Text style={s.helpText}>
              OfflineSMS Points are used to send SMS reminders through OfflineSMS.
            </Text>
          </View>

          <Text style={s.sectionLabel}>Transaction history</Text>

          <View style={s.chips}>
            {(['all','sms_spend','refund','purchase','transfer','admin'] as FilterKey[]).map(f => (
              <Pressable key={f} style={[s.chip, filter === f && s.chipOn]} onPress={() => setFilter(f)}>
                <Text style={[s.chipText, filter === f && s.chipTextOn]}>
                  {f === 'all'       ? 'All' :
                   f === 'sms_spend' ? 'SMS' :
                   f === 'refund'    ? 'Refunds' :
                   f === 'purchase'  ? 'Purchases' :
                   f === 'transfer'  ? 'Transfers' : 'Admin'}
                </Text>
              </Pressable>
            ))}
          </View>

          {txs === null ? (
            <LoadingState compact title="Loading transactions…" />
          ) : filtered.length === 0 ? (
            <EmptyState
              compact
              title="No transactions yet"
              description="When you spend or earn OfflineSMS Points, they’ll appear here."
            />
          ) : (
            <View>
              {filtered.map(t => (
                <TxRow
                  key={t.id}
                  t={t}
                  onOpen={() => navigation.navigate('TransactionDetail', { id: t.id })}
                />
              ))}
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

function TxRow({ t, onOpen }: { t: Transaction; onOpen: () => void }) {
  const credit = t.direction === 'credit';
  return (
    <Pressable style={s.txRow} onPress={onOpen}>
      <View style={[s.txIcon, credit && s.txIconCredit]}>
        <Text style={[s.txIconText, credit && { color: '#166534' }]}>{getTransactionIcon(t.type)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.txTitle}>{getTransactionLabel(t.type)}</Text>
        <Text style={s.txSub}>{fmtDate(t.createdAt)}{t.relatedSmsBatchId ? '  ·  OfflineSMS batch' : ''}</Text>
      </View>
      <Text style={[s.txAmount, credit ? s.txAmountCredit : s.txAmountDebit]}>
        {formatPointsAmount(t.amount, t.direction)}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bgCanvas },
  header:  { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back:    { fontSize: 24, color: colors.primary },
  title:   { fontSize: 14, fontWeight: '700', color: colors.ink },
  padded:  { padding: 14 },
  balanceCard: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: 18 },
  balanceLabel:{ fontSize: 11, color: 'rgba(255,255,255,.85)', letterSpacing: 1.2, fontWeight: '700' },
  balanceAmount:{ fontSize: 36, color: '#fff', fontWeight: '800', marginTop: 4 },
  balanceUnit: { fontSize: 14, fontWeight: '600', opacity: 0.85 },
  metaRow:     { flexDirection: 'row', marginTop: 14, backgroundColor: 'rgba(255,255,255,.12)', borderRadius: radius.md, padding: 10 },
  metaCell:    { flex: 1 },
  metaLabel:   { fontSize: 10, color: 'rgba(255,255,255,.8)', letterSpacing: 0.6, fontWeight: '700' },
  metaValue:   { fontSize: 18, color: '#fff', fontWeight: '800', marginTop: 2 },
  reservedHelp:{ fontSize: 11, color: 'rgba(255,255,255,.85)', marginTop: 10, lineHeight: 16 },
  actions:     { flexDirection: 'row', gap: 8, marginTop: 14 },
  action:      { flex: 1, padding: 12, backgroundColor: '#fff', borderRadius: radius.md, alignItems: 'center' },
  actionTitle: { fontSize: 13, color: colors.primary, fontWeight: '800' },
  actionSub:   { fontSize: 11, color: colors.ink500, marginTop: 2 },
  helpCard:    { marginTop: 14, padding: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100 },
  helpText:    { fontSize: 12, color: colors.ink700, lineHeight: 18 },
  sectionLabel:{ fontSize: 11, fontWeight: '700', color: colors.ink500, letterSpacing: 0.6, marginTop: 18, marginBottom: 8 },
  chips:       { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 12 },
  chip:        { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.ink200 },
  chipOn:      { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText:    { fontSize: 12, color: colors.ink700, fontWeight: '600' },
  chipTextOn:  { color: '#fff' },
  txRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 6, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100 },
  txIcon:      { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  txIconCredit:{ backgroundColor: '#DCFCE7' },
  txIconText:  { color: colors.primaryDark, fontWeight: '800' },
  txTitle:     { fontSize: 13, color: colors.ink, fontWeight: '700' },
  txSub:       { fontSize: 11, color: colors.ink500, marginTop: 2 },
  txAmount:    { fontSize: 14, fontWeight: '800' },
  txAmountCredit: { color: '#15803D' },
  txAmountDebit:  { color: colors.ink },
});
