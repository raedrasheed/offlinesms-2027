// Mobile Settings — Phase 9 adds the OfflineSMS Points entry and the
// 'Allow important SMS reminders' toggle that feeds Phase 8's
// escalation eligibility (skipReason='opt-out' when off).

import { useEffect, useState } from 'react';
import { View, Text, Pressable, Switch, StyleSheet, Alert } from 'react-native';
import { signOut } from '../lib/auth';
import { auth } from '../lib/firebase';
import { subscribeMe, setSmsOptOut } from '../lib/user';
import { subscribeWallet, Wallet } from '../lib/points';
import { colors, radius } from '../theme';

export default function Settings({ navigation }: any) {
  const me = auth.currentUser?.uid;
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [optOut, setOptOut] = useState<boolean | null>(null);
  const [busy, setBusy]     = useState(false);

  useEffect(() => {
    if (!me) return;
    return subscribeWallet(me, setWallet);
  }, [me]);
  useEffect(() => {
    if (!me) return;
    return subscribeMe(me, m => setOptOut(m?.smsOptOut === true));
  }, [me]);

  async function toggleOptOut(next: boolean) {
    if (!me || busy) return;
    setBusy(true);
    try {
      await setSmsOptOut(me, next);
    } catch (e: any) {
      Alert.alert('Couldn’t update', e?.message ?? 'try-again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.root}>
      <Pressable style={s.row} onPress={() => navigation.navigate('Points')}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>OfflineSMS Points</Text>
          <Text style={s.sub}>
            {wallet
              ? `${wallet.balance.toLocaleString()} pts  ·  ${wallet.reserved.toLocaleString()} reserved`
              : 'Balance, reservations, and transaction history'}
          </Text>
        </View>
        <Text style={s.chev}>›</Text>
      </Pressable>

      <View style={s.toggleRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Allow important SMS reminders</Text>
          <Text style={s.sub}>
            {optOut === true
              ? 'You won’t receive SMS reminders from OfflineSMS.'
              : 'OfflineSMS may send you SMS reminders for important messages.'}
          </Text>
        </View>
        <Switch
          value={optOut !== true}
          onValueChange={v => toggleOptOut(!v)}
          disabled={optOut === null || busy}
        />
      </View>

      <Pressable style={s.row} onPress={() => navigation.navigate('Privacy')}>
        <Text style={s.title}>Privacy</Text>
        <Text style={s.chev}>›</Text>
      </Pressable>
      <Pressable style={s.row} onPress={() => navigation.navigate('Devices')}>
        <Text style={s.title}>Linked devices</Text>
        <Text style={s.chev}>›</Text>
      </Pressable>

      <Pressable style={[s.row, s.signOut]} onPress={() => signOut()}>
        <Text style={[s.title, { color: colors.err }]}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root:     { flex: 1, padding: 14, backgroundColor: colors.bgCanvas, gap: 8 },
  row:      { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: '#fff', borderRadius: radius.md, gap: 10 },
  toggleRow:{ flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: '#fff', borderRadius: radius.md, gap: 12 },
  title:    { fontSize: 14, fontWeight: '700', color: colors.ink, flex: 1 },
  sub:      { fontSize: 12, color: colors.ink500, marginTop: 2 },
  chev:     { fontSize: 18, color: colors.ink400, fontWeight: '700' },
  signOut:  { marginTop: 'auto' },
});
