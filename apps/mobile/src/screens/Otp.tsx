import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { verifyOtp, OtpError, cancelOtp } from '../lib/auth';
import { colors, radius } from '../theme';

function otpErrorCopy(code: OtpError['code']): string {
  switch (code) {
    case 'invalid-verification-code': return 'That code didn’t match. Double-check and try again.';
    case 'code-expired':              return 'That code expired. Tap “Resend code” to get a new one.';
    case 'too-many-attempts':         return 'Too many attempts. Please wait a few minutes and try again.';
    case 'network-error':             return 'Network error. Check your connection and try again.';
    case 'no-confirmation-in-flight': return 'No code in flight. Go back and request a new one.';
    default:                          return 'We couldn’t verify the code. Please try again.';
  }
}

export default function Otp({ navigation }: any) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const canSubmit = code.length === 6 && !busy;

  async function verify() {
    setBusy(true);
    try {
      await verifyOtp(code);
      // onAuthStateChanged in App.tsx swaps the navigator stack.
    } catch (e: any) {
      const ec = e instanceof OtpError ? e.code : 'unknown';
      Alert.alert('Wrong code', otpErrorCopy(ec));
    } finally {
      setBusy(false);
    }
  }

  function back() {
    cancelOtp();
    navigation.goBack();
  }

  return (
    <View style={s.root}>
      <Text style={s.h1}>Verify your number</Text>
      <Text style={s.sub}>Enter the 6-digit code we sent you.</Text>
      <TextInput
        style={s.input}
        value={code}
        onChangeText={t => setCode(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        autoFocus
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
      />
      <Pressable style={[s.btn, !canSubmit && { opacity: 0.5 }]} onPress={verify} disabled={!canSubmit}>
        <Text style={s.btnText}>{busy ? 'Verifying…' : 'Verify and continue'}</Text>
      </Pressable>
      <Pressable style={s.linkBtn} onPress={back}>
        <Text style={s.link}>Use a different number</Text>
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
  linkBtn: { paddingVertical: 12, alignItems: 'center' },
  link: { color: colors.primary, fontWeight: '600', fontSize: 13 },
});
