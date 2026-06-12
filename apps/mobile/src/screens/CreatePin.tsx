import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';
import NumberPad from '../components/NumberPad';
import { setPin } from '../lib/pin';

const LENGTH = 6;

export default function CreatePin({ navigation }: any) {
  const [phase, setPhase]   = useState<'create' | 'confirm'>('create');
  const [first, setFirst]   = useState('');
  const [second, setSecond] = useState('');
  const [busy, setBusy]     = useState(false);

  const active = phase === 'create' ? first : second;

  function pressDigit(d: string) {
    if (active.length >= LENGTH) return;
    if (phase === 'create') {
      const next = first + d;
      setFirst(next);
      if (next.length === LENGTH) setPhase('confirm');
    } else {
      const next = second + d;
      setSecond(next);
      if (next.length === LENGTH) handleConfirm(next);
    }
  }
  function pressDelete() {
    if (phase === 'create') setFirst(s => s.slice(0, -1));
    else                    setSecond(s => s.slice(0, -1));
  }

  async function handleConfirm(value: string) {
    if (value !== first) {
      Alert.alert('PINs don’t match', 'Try entering the PIN again.', [
        { text: 'OK', onPress: () => { setFirst(''); setSecond(''); setPhase('create'); } },
      ]);
      return;
    }
    setBusy(true);
    try {
      await setPin(value);
      Alert.alert('PIN saved', 'Your 6-digit PIN is now active.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      Alert.alert('Couldn’t save PIN', e?.message ?? 'Please try again.');
      setFirst(''); setSecond(''); setPhase('create');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.root}>
      <Pressable style={s.back} onPress={() => navigation.goBack()} hitSlop={12}>
        <Ionicons name="chevron-back" size={24} color={colors.ink} />
      </Pressable>

      <View style={s.header}>
        <View style={s.shield}>
          <Ionicons name="shield-checkmark" size={28} color={colors.primary} />
        </View>
        <Text style={s.h1}>{phase === 'create' ? 'Create a 6-digit PIN' : 'Confirm your PIN'}</Text>
        <Text style={s.sub}>
          {phase === 'create'
            ? 'Adds a second layer when you re-register on a new device.'
            : 'Enter the same 6 digits again.'}
        </Text>
      </View>

      <View style={s.dots}>
        {Array.from({ length: LENGTH }).map((_, i) => (
          <View key={i} style={[s.dot, active.length > i && s.dotFilled]} />
        ))}
      </View>

      <View style={{ flex: 1 }} />

      <NumberPad onDigit={pressDigit} onDelete={pressDelete} />
      {busy ? <Text style={s.busy}>Saving…</Text> : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#fff', paddingHorizontal: 24, paddingBottom: 24 },
  back:   { marginTop: 8, alignSelf: 'flex-start' },
  header: { alignItems: 'center', marginTop: 24, gap: 12 },
  shield: { width: 56, height: 56, borderRadius: 18, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  h1:     { fontSize: 22, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  sub:    { fontSize: 13, color: colors.ink500, textAlign: 'center', lineHeight: 20, paddingHorizontal: 24 },

  dots:      { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 36 },
  dot:       { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: colors.ink300, backgroundColor: '#fff' },
  dotFilled: { backgroundColor: colors.primary, borderColor: colors.primary },

  busy: { textAlign: 'center', color: colors.ink500, marginTop: 12 },
});
