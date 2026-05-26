// OfflineSMS Points wallet — Phase 9.
//
// Read-only screen. Shows balance / reserved / available, recent
// transactions with type filter chips, and disabled "Buy points" /
// "Transfer" affordances (Phase 10).

import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { auth } from '../lib/firebase';
import {
  subscribeWallet, subscribeTransactions,
  formatPointsAmount, getTransactionLabel, getTransactionIcon,
  Transaction, Wallet,
} from '../lib/points';
import { useTheme } from '../context/ThemeContext';
import { isRTL } from '../i18n';
import { radius } from '../theme';
import { LoadingState, EmptyState } from '../components/state';

type FilterKey = 'all' | 'sms_spend' | 'refund' | 'purchase' | 'transfer' | 'admin';

const BUY_ENABLED = true;       // Phase 10 — webhook-driven purchase flow wired.
const TRANSFER_ENABLED = true;  // Phase 10 — hardened transfer flow wired.

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
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Points({ navigation }: any) {
  const { t } = useTranslation();
  const { colors } = useTheme();
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
    () => (txs ?? []).filter(tx => filterMatches(filter, tx)),
    [txs, filter],
  );

  const s = buildStyles(colors, isRTL);

  const FILTER_LABELS: Record<FilterKey, string> = {
    all:       t('points.filterAll'),
    sms_spend: t('points.filterSms'),
    refund:    t('points.filterRefunds'),
    purchase:  t('points.filterPurchases'),
    transfer:  t('points.filterTransfers'),
    admin:     t('points.filterAdmin'),
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={s.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Text style={s.back}>{isRTL ? '›' : '‹'}</Text>
        </Pressable>
        <Text style={s.title}>{t('points.title')}</Text>
      </View>

      {wallet === null ? (
        <View style={s.padded}><LoadingState compact title={t('points.loadingWallet')} /></View>
      ) : (
        <View style={s.padded}>
          <View style={s.balanceCard}>
            <Text style={s.balanceLabel}>{t('points.balance').toUpperCase()}</Text>
            <Text style={s.balanceAmount}>{wallet.balance.toLocaleString()} <Text style={s.balanceUnit}>pts</Text></Text>

            <View style={s.metaRow}>
              <View style={s.metaCell}>
                <Text style={s.metaLabel}>{t('points.reserved').toUpperCase()}</Text>
                <Text style={s.metaValue}>{wallet.reserved.toLocaleString()}</Text>
              </View>
              <View style={s.metaCell}>
                <Text style={s.metaLabel}>{t('points.available').toUpperCase()}</Text>
                <Text style={s.metaValue}>{wallet.available.toLocaleString()}</Text>
              </View>
            </View>

            <Text style={s.reservedHelp}>{t('points.reservedHelp')}</Text>

            <View style={s.actions}>
              <Pressable
                style={[s.action, !BUY_ENABLED && { opacity: 0.45 }]}
                disabled={!BUY_ENABLED}
                onPress={() => navigation.navigate('BuyPoints')}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={t('points.buy')}
                accessibilityState={{ disabled: !BUY_ENABLED }}
              >
                <Text style={s.actionTitle}>{t('points.buy')}</Text>
                <Text style={s.actionSub}>{BUY_ENABLED ? t('points.buySubtitle') : t('points.comingSoon')}</Text>
              </Pressable>
              <Pressable
                style={[s.action, !TRANSFER_ENABLED && { opacity: 0.45 }]}
                disabled={!TRANSFER_ENABLED}
                onPress={() => navigation.navigate('TransferPoints')}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={t('points.transfer')}
                accessibilityState={{ disabled: !TRANSFER_ENABLED }}
              >
                <Text style={s.actionTitle}>{t('points.transfer')}</Text>
                <Text style={s.actionSub}>{TRANSFER_ENABLED ? t('points.transferSubtitle') : t('points.comingSoon')}</Text>
              </Pressable>
            </View>
          </View>

          <View style={s.helpCard}>
            <Text style={s.helpText}>{t('points.allowSmsReminders')}</Text>
          </View>

          <Text style={s.sectionLabel}>{t('points.history')}</Text>

          <View style={s.chips}>
            {(['all','sms_spend','refund','purchase','transfer','admin'] as FilterKey[]).map(f => (
              <Pressable
                key={f}
                style={[s.chip, filter === f && s.chipOn]}
                onPress={() => setFilter(f)}
                accessibilityRole="radio"
                accessibilityLabel={FILTER_LABELS[f]}
                accessibilityState={{ selected: filter === f }}
              >
                <Text style={[s.chipText, filter === f && s.chipTextOn]}>
                  {FILTER_LABELS[f]}
                </Text>
              </Pressable>
            ))}
          </View>

          {txs === null ? (
            <LoadingState compact title={t('points.loadingTransactions')} />
          ) : filtered.length === 0 ? (
            <EmptyState
              compact
              title={t('points.empty')}
              description={t('points.emptyDescription')}
            />
          ) : (
            <View>
              {filtered.map(tx => (
                <TxRow
                  key={tx.id}
                  t={tx}
                  colors={colors}
                  smsBatchLabel={t('points.smsBatch')}
                  onOpen={() => navigation.navigate('TransactionDetail', { id: tx.id })}
                />
              ))}
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

function TxRow({ t, colors, smsBatchLabel, onOpen }: { t: Transaction; colors: any; smsBatchLabel: string; onOpen: () => void }) {
  const credit = t.direction === 'credit';
  return (
    <Pressable
      style={txRowStyle(colors)}
      onPress={onOpen}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={`${getTransactionLabel(t.type)}, ${formatPointsAmount(t.amount, t.direction)}`}
    >
      <View style={[txIconStyle(colors), credit && { backgroundColor: '#DCFCE7' }]}>
        <Text style={[{ color: colors.action.primaryPressed, fontWeight: '800' }, credit && { color: '#166534' }]}>
          {getTransactionIcon(t.type)}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, color: colors.text.primary, fontWeight: '700' }}>{getTransactionLabel(t.type)}</Text>
        <Text style={{ fontSize: 11, color: colors.text.muted, marginTop: 2 }}>
          {fmtDate(t.createdAt)}{t.relatedSmsBatchId ? `  ·  ${smsBatchLabel}` : ''}
        </Text>
      </View>
      <Text style={{ fontSize: 14, fontWeight: '800', color: credit ? '#15803D' : colors.text.primary }}>
        {formatPointsAmount(t.amount, t.direction)}
      </Text>
    </Pressable>
  );
}

function txRowStyle(colors: any) {
  return {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    padding: 12,
    marginBottom: 6,
    backgroundColor: colors.background.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  };
}

function txIconStyle(colors: any) {
  return {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.action.subtle,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };
}

function buildStyles(colors: any, rtl: boolean) {
  return StyleSheet.create({
    root:         { flex: 1, backgroundColor: colors.background.app },
    header:       { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.background.surface, flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
    back:         { fontSize: 24, color: colors.action.primary },
    title:        { fontSize: 14, fontWeight: '700', color: colors.text.primary },
    padded:       { padding: 14 },
    balanceCard:  { backgroundColor: colors.action.primary, borderRadius: radius.lg, padding: 18 },
    balanceLabel: { fontSize: 11, color: 'rgba(255,255,255,.85)', letterSpacing: 1.2, fontWeight: '700', textAlign: rtl ? 'right' : 'left' },
    balanceAmount:{ fontSize: 36, color: '#fff', fontWeight: '800', marginTop: 4, textAlign: rtl ? 'right' : 'left' },
    balanceUnit:  { fontSize: 14, fontWeight: '600', opacity: 0.85 },
    metaRow:      { flexDirection: rtl ? 'row-reverse' : 'row', marginTop: 14, backgroundColor: 'rgba(255,255,255,.12)', borderRadius: radius.md, padding: 10 },
    metaCell:     { flex: 1 },
    metaLabel:    { fontSize: 10, color: 'rgba(255,255,255,.8)', letterSpacing: 0.6, fontWeight: '700', textAlign: rtl ? 'right' : 'left' },
    metaValue:    { fontSize: 18, color: '#fff', fontWeight: '800', marginTop: 2, textAlign: rtl ? 'right' : 'left', writingDirection: 'ltr' },
    reservedHelp: { fontSize: 11, color: 'rgba(255,255,255,.85)', marginTop: 10, lineHeight: 16, textAlign: rtl ? 'right' : 'left' },
    actions:      { flexDirection: rtl ? 'row-reverse' : 'row', gap: 8, marginTop: 14 },
    action:       { flex: 1, padding: 12, backgroundColor: '#fff', borderRadius: radius.md, alignItems: 'center' },
    actionTitle:  { fontSize: 13, color: colors.action.primary, fontWeight: '800' },
    actionSub:    { fontSize: 11, color: colors.text.muted, marginTop: 2, textAlign: 'center' },
    helpCard:     { marginTop: 14, padding: 12, backgroundColor: colors.background.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.subtle },
    helpText:     { fontSize: 12, color: colors.text.secondary, lineHeight: 18, textAlign: rtl ? 'right' : 'left' },
    sectionLabel: { fontSize: 11, fontWeight: '700', color: colors.text.muted, letterSpacing: 0.6, marginTop: 18, marginBottom: 8, textAlign: rtl ? 'right' : 'left' },
    chips:        { flexDirection: rtl ? 'row-reverse' : 'row', gap: 6, flexWrap: 'wrap', marginBottom: 12 },
    chip:         { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.background.surface, borderWidth: 1, borderColor: colors.border.default },
    chipOn:       { backgroundColor: colors.action.primary, borderColor: colors.action.primary },
    chipText:     { fontSize: 12, color: colors.text.secondary, fontWeight: '600' },
    chipTextOn:   { color: '#fff' },
  });
}
