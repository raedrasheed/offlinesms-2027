// TransferPoints — Phase 10 transfer flow.
//
// Reuses the Phase 4 username search to pick a recipient, then amount,
// then confirm. The callable enforces self-transfer / frozen-wallet /
// daily-cap / insufficient-balance / recipient-existence — the UI just
// surfaces the resulting error code.

import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, StyleSheet, Alert,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import {
  collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import {
  subscribeWallet, transferPoints,
  pointsErrorCopy, pointsErrorReason, Wallet,
} from '../lib/points';
import { normalizeUsername } from '../lib/username';
import { colors, radius } from '../theme';
import { LoadingState, EmptyState, ErrorState } from '../components/state';

type Step = 'recipient' | 'amount' | 'confirm' | 'sending' | 'result';

type Candidate = {
  uid:         string;
  displayName?: string;
  username?:    string;
};

export default function TransferPoints({ navigation }: any) {
  const me = auth.currentUser?.uid;

  const [wallet, setWallet] = useState<Wallet | null>(null);
  useEffect(() => { if (me) return subscribeWallet(me, setWallet); }, [me]);

  const [step, setStep]       = useState<Step>('recipient');
  const [term, setTerm]       = useState('');
  const [rows, setRows]       = useState<Candidate[] | null>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [picked, setPicked]   = useState<Candidate | null>(null);
  const [amount, setAmount]   = useState('');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState<string | null>(null);
  const [result, setResult]   = useState<{ transferId: string; amount: number; flagged: boolean } | null>(null);

  const amountInt = useMemo(() => {
    const n = parseInt(amount, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amount]);
  const available = useMemo(() => Math.max(0, (wallet?.balance ?? 0) - (wallet?.reserved ?? 0)), [wallet]);
  const remaining = available - amountInt;
  const enough    = amountInt > 0 && amountInt <= available;

  useEffect(() => {
    const t = normalizeUsername(term);
    if (!t) { setRows([]); return; }
    setSearchBusy(true);
    const handle = setTimeout(async () => {
      try {
        const q = query(
          collection(db, 'users'),
          orderBy('usernameLower'),
          where('usernameLower', '>=', t),
          where('usernameLower', '<=', t + ''),
          limit(20),
        );
        const snap = await getDocs(q);
        const list: Candidate[] = [];
        for (const d of snap.docs) {
          if (d.id === me) continue;
          const data = d.data() as Candidate;
          list.push({ uid: d.id, displayName: data.displayName, username: data.username });
        }
        setRows(list);
      } catch {
        setRows([]);
      } finally { setSearchBusy(false); }
    }, 200);
    return () => clearTimeout(handle);
  }, [term, me]);

  async function submit() {
    if (!picked || !enough || busy) return;
    setBusy(true); setErr(null); setStep('sending');
    try {
      const r = await transferPoints({ recipientUid: picked.uid, amount: amountInt });
      setResult(r);
      setStep('result');
    } catch (e: any) {
      const code = e?.code ?? 'internal';
      const reason = pointsErrorReason(e);
      setErr(pointsErrorCopy(code, reason));
      setStep('confirm');
    } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()}><Text style={s.back}>‹</Text></Pressable>
        <Text style={s.title}>Transfer points</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        {wallet ? (
          <View style={s.balanceLine}>
            <Text style={s.balanceLineLabel}>Available</Text>
            <Text style={s.balanceLineValue}>{available.toLocaleString()} pts</Text>
          </View>
        ) : null}

        {step === 'recipient' ? (
          <>
            <Text style={s.sectionLabel}>Recipient</Text>
            <TextInput
              style={s.input}
              value={term}
              onChangeText={setTerm}
              placeholder="Search by username"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            {searchBusy && term ? (
              <LoadingState compact title="Searching…" />
            ) : term && (rows ?? []).length === 0 ? (
              <EmptyState compact title="No matches" description={`No user with username starting with "${term}".`} />
            ) : null}
            {(rows ?? []).length > 0 ? (
              <FlatList
                scrollEnabled={false}
                data={rows ?? []}
                keyExtractor={u => u.uid}
                renderItem={({ item }) => (
                  <Pressable
                    style={s.row}
                    onPress={() => { setPicked(item); setStep('amount'); }}
                  >
                    <View style={s.avatar}><Text style={s.avatarText}>{(item.displayName ?? item.username ?? '?').slice(0, 1).toUpperCase()}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.recipName}>{item.displayName ?? '—'}</Text>
                      <Text style={s.recipHandle}>@{item.username ?? item.uid.slice(0, 6)}</Text>
                    </View>
                  </Pressable>
                )}
              />
            ) : null}
          </>
        ) : null}

        {step === 'amount' && picked ? (
          <>
            <Text style={s.sectionLabel}>Recipient</Text>
            <View style={s.row}>
              <View style={s.avatar}><Text style={s.avatarText}>{(picked.displayName ?? picked.username ?? '?').slice(0, 1).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.recipName}>{picked.displayName ?? '—'}</Text>
                <Text style={s.recipHandle}>@{picked.username ?? picked.uid.slice(0, 6)}</Text>
              </View>
              <Pressable onPress={() => { setPicked(null); setStep('recipient'); }}>
                <Text style={s.linkText}>Change</Text>
              </Pressable>
            </View>

            <Text style={s.sectionLabel}>Amount</Text>
            <TextInput
              style={s.input}
              value={amount}
              onChangeText={t => setAmount(t.replace(/\D/g, '').slice(0, 6))}
              placeholder="Points to transfer"
              keyboardType="number-pad"
              autoFocus
            />
            <Text style={s.foot}>
              Available: {available.toLocaleString()} pts  ·  Remaining after transfer: {Math.max(0, remaining).toLocaleString()} pts
            </Text>
            {amountInt > 0 && !enough ? (
              <Text style={[s.foot, { color: colors.err }]}>Insufficient balance.</Text>
            ) : null}

            <View style={s.row}>
              <Pressable style={s.secondaryBtn} onPress={() => setStep('recipient')}>
                <Text style={s.secondaryBtnText}>Back</Text>
              </Pressable>
              <Pressable
                style={[s.primaryBtn, { flex: 1 }, !enough && { opacity: 0.4 }]}
                onPress={() => enough && setStep('confirm')}
                disabled={!enough}
              >
                <Text style={s.primaryBtnText}>Continue</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {step === 'confirm' && picked ? (
          <>
            <Text style={s.sectionLabel}>Confirm transfer</Text>
            <View style={s.card}>
              <Text style={s.cardLabel}>You’ll transfer</Text>
              <Text style={s.cardBig}>{amountInt.toLocaleString()} pts</Text>
              <Text style={s.cardSub}>to {picked.displayName ?? picked.username ?? picked.uid}</Text>
            </View>
            <View style={s.card}>
              <View style={s.kv}><Text style={s.kvK}>Balance</Text><Text style={s.kvV}>{(wallet?.balance ?? 0).toLocaleString()}</Text></View>
              <View style={s.kv}><Text style={s.kvK}>Reserved</Text><Text style={s.kvV}>{(wallet?.reserved ?? 0).toLocaleString()}</Text></View>
              <View style={s.kv}><Text style={s.kvK}>Available</Text><Text style={s.kvV}>{available.toLocaleString()}</Text></View>
              <View style={s.kv}><Text style={s.kvK}>Remaining</Text><Text style={s.kvV}>{Math.max(0, remaining).toLocaleString()}</Text></View>
            </View>

            {err ? <ErrorState compact title="Couldn’t complete" description={err} /> : null}

            <View style={s.row}>
              <Pressable style={s.secondaryBtn} onPress={() => setStep('amount')}>
                <Text style={s.secondaryBtnText}>Back</Text>
              </Pressable>
              <Pressable
                style={[s.primaryBtn, { flex: 1 }, (!enough || busy) && { opacity: 0.4 }]}
                onPress={submit}
                disabled={!enough || busy}
              >
                <Text style={s.primaryBtnText}>Confirm transfer</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {step === 'sending' ? (
          <LoadingState fullPage title="Sending…" />
        ) : null}

        {step === 'result' && result ? (
          <>
            <Text style={s.sectionLabel}>Transfer completed</Text>
            <View style={s.card}>
              <Text style={s.cardLabel}>Transferred</Text>
              <Text style={s.cardBig}>{result.amount.toLocaleString()} pts</Text>
              <Text style={s.cardSub}>transferId {result.transferId}</Text>
              {result.flagged ? (
                <Text style={[s.cardSub, { color: '#A16207', marginTop: 6 }]}>
                  This transfer was flagged for review. The recipient still received the points.
                </Text>
              ) : null}
            </View>
            <Pressable style={s.primaryBtn} onPress={() => navigation.popToTop()}>
              <Text style={s.primaryBtnText}>Done</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bgCanvas },
  header:  { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back:    { fontSize: 24, color: colors.primary },
  title:   { fontSize: 14, fontWeight: '700', color: colors.ink },
  balanceLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100, marginBottom: 12 },
  balanceLineLabel: { fontSize: 12, color: colors.ink500, fontWeight: '600' },
  balanceLineValue: { fontSize: 14, color: colors.ink, fontWeight: '800' },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: colors.ink500, letterSpacing: 0.6, marginBottom: 8, marginTop: 8 },
  input:   { padding: 12, backgroundColor: '#fff', borderRadius: radius.md, fontSize: 15, borderWidth: 1, borderColor: colors.ink200, marginBottom: 8 },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100, marginBottom: 8 },
  avatar:  { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText:{ color: colors.primaryDark, fontWeight: '700' },
  recipName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  recipHandle: { fontSize: 12, color: colors.ink500, marginTop: 2 },
  linkText:  { color: colors.primary, fontWeight: '700', fontSize: 12 },
  foot:    { fontSize: 11, color: colors.ink500, marginBottom: 8 },
  card:    { backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100, padding: 14, marginBottom: 12 },
  cardLabel:{ fontSize: 11, color: colors.ink500, fontWeight: '700', letterSpacing: 0.5 },
  cardBig: { fontSize: 24, color: colors.ink, fontWeight: '800', marginTop: 4 },
  cardSub: { fontSize: 11, color: colors.ink500, marginTop: 4 },
  kv:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  kvK:     { fontSize: 12, color: colors.ink500, fontWeight: '600' },
  kvV:     { fontSize: 12, color: colors.ink,    fontWeight: '800' },
  primaryBtn: { padding: 14, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', marginTop: 8 },
  primaryBtnText: { color: '#fff', fontWeight: '800' },
  secondaryBtn: { padding: 14, borderRadius: radius.md, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.ink200, alignItems: 'center', marginTop: 8 },
  secondaryBtnText: { color: colors.ink, fontWeight: '700' },
});
