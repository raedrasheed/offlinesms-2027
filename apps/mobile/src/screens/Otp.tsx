import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { verifyOtp } from '../lib/auth';
import { colors, radius } from '../theme';

export default function Otp() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  async function verify() {
    setBusy(true);
    try { await verifyOtp(code); } catch (e: any) { Alert.alert('Wrong code', e.message); } finally { setBusy(false); }
  }
  return (
    <View style={s.root}>
      <Text style={s.h1}>Verify your number</Text>
      <Text style={s.sub}>Enter the 6-digit code we sent you.</Text>
      <TextInput style={s.input} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoFocus />
      <Pressable style={[s.btn, busy && { opacity: 0.5 }]} onPress={verify} disabled={busy || code.length !== 6}>
        <Text style={s.btnText}>{busy ? 'Verifying…' : 'Verify and continue'}</Text>
      </Pressable>
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, padding: 28, paddingTop: 80, backgroundColor: colors.bgCanvas },
  h1: { fontSize: 24, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 13, color: colors.ink500, marginTop: 8 },
  input: { marginTop: 24, padding: 14, backgroundColor: '#fff', borderRadius: radius.md, fontSize: 22, fontWeight: '700', letterSpacing: 8, textAlign: 'center', borderWidth: 2, borderColor: colors.primary },
  btn: { marginTop: 'auto', padding: 14, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
});
