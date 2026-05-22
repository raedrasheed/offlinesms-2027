import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { sendOtp, OtpError, isPlausiblePhone } from '../lib/auth';
import { colors, radius } from '../theme';

function otpErrorCopy(code: OtpError['code']): string {
  switch (code) {
    case 'invalid-phone-number':
    case 'missing-phone-number':   return 'Enter a phone number in international format, like +14155550100.';
    case 'too-many-attempts':      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'network-error':          return 'Network error. Check your connection and try again.';
    case 'quota-exceeded':         return 'OfflineSMS is at capacity right now. Please try again shortly.';
    case 'recaptcha-unavailable':  return 'Phone verification isn’t available in this build yet. Please go back and use “Use email instead”.';
    default:                       return 'We couldn’t send the code. Please try again.';
  }
}

export default function PhoneEntry({ navigation }: any) {
  const [phone, setPhone] = useState('+1');
  const [busy, setBusy] = useState(false);
  const canSubmit = isPlausiblePhone(phone) && !busy;

  async function next() {
    setBusy(true);
    try {
      await sendOtp(phone);
      navigation.navigate('Otp');
    } catch (e: any) {
      const code = e instanceof OtpError ? e.code : 'unknown';
      Alert.alert('Could not send code', otpErrorCopy(code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.root}>
      <Text style={s.h1}>Your phone number</Text>
      <Text style={s.sub}>We’ll text you a 6-digit code.</Text>
      <TextInput
        style={s.input}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoFocus
        autoComplete="tel"
        textContentType="telephoneNumber"
      />
      <Pressable style={[s.btn, !canSubmit && { opacity: 0.5 }]} onPress={next} disabled={!canSubmit}>
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
