import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';
import KeyboardAwareScreen from '../components/KeyboardAwareScreen';
import { requestEmailOtp, isValidEmail, emailOtpErrorCopy } from '../lib/auth';
import { useOffline } from '../context/OfflineContext';

export default function EmailEntry({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { isOffline } = useOffline();
  const [email, setEmail] = useState('');
  const [busy, setBusy]   = useState(false);
  const canSubmit = isValidEmail(email) && !busy;

  async function next() {
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) { Alert.alert('Check your email', 'Enter a valid email address.'); return; }
    if (isOffline) { Alert.alert('No connection', 'You need an internet connection to receive a code.'); return; }
    setBusy(true);
    try {
      await requestEmailOtp(trimmed);
      navigation.navigate('EmailOtp', { email: trimmed });
    } catch (e: any) {
      Alert.alert('Couldn’t send code', emailOtpErrorCopy(e?.message ?? e?.code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAwareScreen style={s.screen} contentStyle={[s.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <Pressable style={s.back} onPress={() => navigation.goBack()} hitSlop={12}>
        <Ionicons name="chevron-back" size={24} color={colors.ink} />
      </Pressable>

      <Text style={s.h1}>Your email address</Text>
      <Text style={s.sub}>We’ll email you a 6-digit code to sign in.</Text>

      <TextInput
        style={s.input}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        placeholder="you@example.com"
        placeholderTextColor={colors.ink400}
        autoFocus
        onSubmitEditing={() => { if (canSubmit) next(); }}
        returnKeyType="go"
      />

      {isOffline ? (
        <View style={s.hintRow}>
          <Ionicons name="cloud-offline" size={12} color={colors.ink500} />
          <Text style={s.hint}>You’re offline — connect to receive a code.</Text>
        </View>
      ) : (
        <View style={s.hintRow}>
          <Ionicons name="lock-closed" size={12} color={colors.ink500} />
          <Text style={s.hint}>We’ll only use this to sign you in.</Text>
        </View>
      )}

      <Pressable style={[s.btn, !canSubmit && { opacity: 0.5 }]} onPress={next} disabled={!canSubmit}>
        <Text style={s.btnText}>{busy ? 'Sending…' : 'Send code'}</Text>
      </Pressable>

      <Pressable style={s.passwordLink} onPress={() => navigation.navigate('EmailLogin')} hitSlop={8}>
        <Text style={s.passwordLinkText}>Sign in with a password instead</Text>
      </Pressable>
    </KeyboardAwareScreen>
  );
}

const s = StyleSheet.create({
  screen: { backgroundColor: '#fff' },
  root:  { backgroundColor: '#fff', paddingHorizontal: 24 },
  back:  { marginTop: 8, marginBottom: 24, alignSelf: 'flex-start' },
  h1:    { fontSize: 26, fontWeight: '800', color: colors.ink, letterSpacing: -0.4 },
  sub:   { fontSize: 13, color: colors.ink500, marginTop: 8, lineHeight: 20 },

  input: { marginTop: 28, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 2, borderColor: colors.primary, borderRadius: radius.md, fontSize: 16, fontWeight: '600', color: colors.ink, backgroundColor: '#fff' },

  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  hint:    { fontSize: 12, color: colors.ink500 },

  btn:     { padding: 16, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', marginTop: 28 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  passwordLink: { alignItems: 'center', marginTop: 18 },
  passwordLinkText: { fontSize: 13, fontWeight: '600', color: colors.primary },
});
