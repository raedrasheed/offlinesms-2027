// BuyPoints — Phase 10 purchase flow.
//
// Lists active packages, runs createPurchase (which never credits), then
// watches the resulting payments/{id} doc for status transitions. The wallet
// is credited only after an admin confirms the payment from the dashboard,
// which flips the status to 'completed'; this screen just waits.

import { useEffect, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet,
} from 'react-native';
import { auth } from '../lib/firebase';
import {
  PointsPackage, Payment, PurchaseResult,
  subscribePackages, subscribePayment,
  createPurchase,
  pointsErrorCopy, pointsErrorReason,
  subscribeWallet, Wallet,
} from '../lib/points';
import { colors, radius } from '../theme';
import { LoadingState, EmptyState, ErrorState } from '../components/state';

type Step = 'pick' | 'pending' | 'success' | 'failed';

function currency(amount: number, code: string): string {
  // Render as "EUR 10.00" rather than locale-formatted so we never imply
  // a specific provider's checkout. 'amount' is smallest currency unit.
  return `${code} ${(amount / 100).toFixed(2)}`;
}

export default function BuyPoints({ navigation }: any) {
  const me = auth.currentUser?.uid;
  const [packages, setPackages] = useState<PointsPackage[] | null>(null);
  const [wallet, setWallet]     = useState<Wallet | null>(null);
  const [step, setStep]         = useState<Step>('pick');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  const [purchase, setPurchase] = useState<PurchaseResult | null>(null);
  const [payment, setPayment]   = useState<Payment | null>(null);

  useEffect(() => subscribePackages(setPackages), []);
  useEffect(() => { if (me) return subscribeWallet(me, setWallet); }, [me]);

  // Watch the in-flight payment doc for status changes.
  useEffect(() => {
    if (!purchase) return;
    return subscribePayment(purchase.paymentId, p => {
      setPayment(p);
      if (p?.status === 'completed') setStep('success');
      else if (p?.status === 'failed') setStep('failed');
    });
  }, [purchase]);

  async function start(pkg: PointsPackage) {
    setBusy(true); setErr(null);
    try {
      const result = await createPurchase(pkg.id);
      setPurchase(result);
      setStep('pending');
    } catch (e: any) {
      setErr(pointsErrorCopy(e?.code ?? 'internal', pointsErrorReason(e)));
    } finally { setBusy(false); }
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()}><Text style={s.back}>‹</Text></Pressable>
        <Text style={s.title}>Buy points</Text>
      </View>

      <View style={s.padded}>
        {wallet ? (
          <View style={s.balanceLine}>
            <Text style={s.balanceLineLabel}>Current balance</Text>
            <Text style={s.balanceLineValue}>{wallet.balance.toLocaleString()} pts</Text>
          </View>
        ) : null}

        {step === 'pick' ? (
          <>
            <Text style={s.sectionLabel}>Choose package</Text>
            {packages === null ? (
              <LoadingState compact title="Loading packages…" />
            ) : packages.length === 0 ? (
              <EmptyState
                compact
                title="No packages available"
                description="OfflineSMS Points packages aren’t configured yet. Check back later."
              />
            ) : (
              packages.map(p => (
                <Pressable key={p.id} style={s.packageCard} onPress={() => start(p)} disabled={busy}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.pkgName}>{p.name}</Text>
                    <Text style={s.pkgPoints}>{p.points.toLocaleString()} pts{p.bonusPoints > 0 ? `  +  ${p.bonusPoints.toLocaleString()} bonus` : ''}</Text>
                  </View>
                  <View style={s.pkgPriceCol}>
                    <Text style={s.pkgPrice}>{currency(p.price, p.currency)}</Text>
                  </View>
                </Pressable>
              ))
            )}
            <Text style={s.foot}>
              Payment confirmation is handled securely by OfflineSMS. Your points will be added after confirmation.
            </Text>
          </>
        ) : null}

        {step === 'pending' && purchase ? (
          <View>
            <Text style={s.sectionLabel}>Payment pending</Text>
            <View style={s.card}>
              <Text style={s.cardLabel}>OfflineSMS Points</Text>
              <Text style={s.cardBig}>{purchase.totalPoints.toLocaleString()} pts</Text>
              <Text style={s.cardSub}>{currency(purchase.amount, purchase.currency)} · paymentId {purchase.paymentId}</Text>
            </View>
            <LoadingState compact title="Waiting for confirmation…" description="Your points will be added once OfflineSMS confirms the payment." />
          </View>
        ) : null}

        {step === 'success' && purchase ? (
          <View>
            <Text style={s.sectionLabel}>Payment completed</Text>
            <View style={s.card}>
              <Text style={s.cardLabel}>Credited</Text>
              <Text style={s.cardBig}>+ {purchase.totalPoints.toLocaleString()} pts</Text>
              <Text style={s.cardSub}>paymentId {purchase.paymentId}</Text>
            </View>
            <Pressable style={s.primaryBtn} onPress={() => navigation.popToTop()}>
              <Text style={s.primaryBtnText}>Done</Text>
            </Pressable>
          </View>
        ) : null}

        {step === 'failed' ? (
          <View>
            <Text style={s.sectionLabel}>Payment failed</Text>
            <ErrorState
              compact
              title="Payment failed"
              description={payment?.failureReason ?? 'No points were charged. You can try a different package.'}
            />
            <Pressable style={s.primaryBtn} onPress={() => { setStep('pick'); setPurchase(null); setPayment(null); }}>
              <Text style={s.primaryBtnText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {err && step === 'pick' ? <ErrorState compact title="Couldn’t start purchase" description={err} /> : null}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bgCanvas },
  header:  { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back:    { fontSize: 24, color: colors.primary },
  title:   { fontSize: 14, fontWeight: '700', color: colors.ink },
  padded:  { padding: 14 },
  balanceLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100, marginBottom: 12 },
  balanceLineLabel: { fontSize: 12, color: colors.ink500, fontWeight: '600' },
  balanceLineValue: { fontSize: 14, color: colors.ink, fontWeight: '800' },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: colors.ink500, letterSpacing: 0.6, marginBottom: 8 },
  packageCard:  { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink200, marginBottom: 8 },
  pkgName:   { fontSize: 14, color: colors.ink, fontWeight: '700' },
  pkgPoints: { fontSize: 12, color: colors.ink500, marginTop: 2 },
  pkgPriceCol: { alignItems: 'flex-end' },
  pkgPrice:    { fontSize: 14, color: colors.primary, fontWeight: '800' },
  foot:     { fontSize: 11, color: colors.ink500, marginTop: 12, lineHeight: 16 },
  card:     { backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100, padding: 14, marginBottom: 12 },
  cardLabel:{ fontSize: 11, color: colors.ink500, fontWeight: '700', letterSpacing: 0.5 },
  cardBig:  { fontSize: 24, color: colors.ink, fontWeight: '800', marginTop: 4 },
  cardSub:  { fontSize: 11, color: colors.ink500, marginTop: 4 },
  row:      { flexDirection: 'row', gap: 8, marginTop: 14 },
  primaryBtn: { padding: 14, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', marginTop: 14 },
  primaryBtnText: { color: '#fff', fontWeight: '800' },
  secondaryBtn: { padding: 14, borderRadius: radius.md, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.ink200, alignItems: 'center', marginTop: 14 },
  secondaryBtnText: { color: colors.ink, fontWeight: '700' },
});
