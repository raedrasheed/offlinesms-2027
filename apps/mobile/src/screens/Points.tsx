import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { colors } from '../theme';
import { LoadingState } from '../components/state';

export default function Points() {
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    return onSnapshot(doc(db, 'wallets', uid), snap => setBalance(snap.data()?.balance ?? 0));
  }, []);
  if (balance === null) {
    return (
      <View style={s.root}>
        <LoadingState compact title="Loading wallet…" />
      </View>
    );
  }
  return (
    <View style={s.root}>
      <View style={s.card}>
        <Text style={s.label}>BALANCE</Text>
        <Text style={s.amount}>{balance.toLocaleString()} <Text style={s.unit}>pts</Text></Text>
        <View style={s.actions}>
          <Pressable style={s.actionLight}><Text style={s.actionLightText}>Buy points</Text></Pressable>
          <Pressable style={s.actionDark}><Text style={s.actionDarkText}>Transfer</Text></Pressable>
        </View>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, padding: 14, backgroundColor: colors.bgCanvas },
  card: { backgroundColor: colors.primary, borderRadius: 18, padding: 18 },
  label: { fontSize: 11, color: 'rgba(255,255,255,.85)', letterSpacing: 1.2 },
  amount: { fontSize: 36, color: '#fff', fontWeight: '800', marginTop: 6 },
  unit: { fontSize: 14, fontWeight: '600', opacity: .85 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  actionLight: { flex:1, padding: 10, backgroundColor: '#fff', borderRadius: 11, alignItems: 'center' },
  actionLightText: { color: colors.primary, fontWeight: '700' },
  actionDark: { flex:1, padding: 10, backgroundColor: 'rgba(255,255,255,.18)', borderRadius: 11, alignItems: 'center' },
  actionDarkText: { color: '#fff', fontWeight: '700' },
});
