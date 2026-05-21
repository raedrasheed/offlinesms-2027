import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { sendOtp } from '../lib/auth';
import { colors, radius } from '../theme';

export default function PhoneEntry({ navigation }: any) {
  const [phone, setPhone] = useState('+1');
  const [busy, setBusy] = useState(false);
  async function next() {
    setBusy(true);
    try {
      await sendOtp(phone);
      navigation.navigate('Otp');
    } catch (e: any) { Alert.alert('Could not send code', e.message); } finally { setBusy(false); }
  }
  return (
    <View style={s.root}>
      <Text style={s.h1}>Your phone number</Text>
      <Text style={s.sub}>We'll text you a 6-digit code.</Text>
      <TextInput style={s.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoFocus />
      <Pressable style={[s.btn, busy && { opacity: 0.5 }]} onPress={next} disabled={busy}>
        <Text style={s.btnText}>{busy ? 'Sending…' : 'Send code'}</Text>
      </Pressable>
      <View nativeID="recaptcha-container" />
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, padding: 28, paddingTop: 80, backgroundColor: colors.bgCanvas },
  h1: { fontSize: 24, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 13, color: colors.ink500, marginTop: 8 },
  input: { marginTop: 24, padding: 14, backgroundColor: '#fff', borderRadius: radius.md, fontSize: 16, fontWeight: '600', borderWidth: 2, borderColor: colors.primary },
  btn: { marginTop: 'auto', padding: 14, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
});
