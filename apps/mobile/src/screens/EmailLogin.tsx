import { useRef, useState } from 'react';
import { Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { emailOtpErrorCopy } from '../lib/auth';
import { colors, radius } from '../theme';
import KeyboardAwareScreen from '../components/KeyboardAwareScreen';

type Mode = 'signIn' | 'signUp';

function copyForFirebaseError(e: { code?: string; message?: string } | null): string {
  // A blocking-function refusal arrives as auth/internal-error carrying the
  // server's reason (guardEmailSignIn / guardEmailSent).
  if (String(e?.message ?? '').includes('address-replaced')) return emailOtpErrorCopy('address-replaced');
  switch (e?.code ?? '') {
    case 'auth/invalid-email':            return 'That email address doesn’t look right.';
    case 'auth/user-disabled':            return 'This account has been disabled.';
    case 'auth/user-not-found':           return 'No account with that email. Try creating one.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':       return 'Email or password is incorrect.';
    case 'auth/email-already-in-use':     return 'An account with that email already exists.';
    case 'auth/weak-password':            return 'Pick a stronger password (at least 6 characters).';
    case 'auth/too-many-requests':        return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/network-request-failed':   return 'Network error. Check your connection and try again.';
    default:                              return 'We couldn’t sign you in. Please try again.';
  }
}

export default function EmailLogin() {
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const canSubmit = email.includes('@') && password.length >= 6 && !busy;

  async function submit() {
    setBusy(true);
    try {
      if (mode === 'signIn') {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (e: any) {
      Alert.alert(
        mode === 'signIn' ? 'Could not sign in' : 'Could not create account',
        copyForFirebaseError(e),
      );
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!email.includes('@')) {
      Alert.alert('Enter your email', 'Type your email above and tap “Forgot password?” again.');
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      Alert.alert('Check your email', 'We sent a password reset link to ' + email.trim());
    } catch (e: any) {
      Alert.alert('Could not send reset email', copyForFirebaseError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAwareScreen style={s.root} contentStyle={s.content}>
      <Text style={s.h1}>{mode === 'signIn' ? 'Sign in with email' : 'Create your account'}</Text>
      <Text style={s.sub}>
        {mode === 'signIn'
          ? 'Use your OfflineSMS email and password.'
          : 'Use an email address and a password of at least 6 characters.'}
      </Text>

      <Text style={s.label}>Email</Text>
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
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        submitBehavior="submit"
      />

      <Text style={s.label}>Password</Text>
      <TextInput
        ref={passwordRef}
        style={s.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
        textContentType={mode === 'signIn' ? 'password' : 'newPassword'}
        placeholder="••••••••"
        placeholderTextColor={colors.ink400}
        returnKeyType="go"
        onSubmitEditing={() => { if (canSubmit) submit(); }}
      />

      <Pressable
        style={[s.primaryBtn, !canSubmit && { opacity: 0.5 }]}
        onPress={submit}
        disabled={!canSubmit}
      >
        <Text style={s.primaryBtnText}>
          {busy ? 'Please wait…' : mode === 'signIn' ? 'Sign in' : 'Create account'}
        </Text>
      </Pressable>

      {mode === 'signIn' && (
        <Pressable onPress={resetPassword} disabled={busy} style={s.linkBtn}>
          <Text style={s.linkText}>Forgot password?</Text>
        </Pressable>
      )}

      <Pressable
        onPress={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}
        disabled={busy}
        style={s.linkBtn}
      >
        <Text style={s.linkText}>
          {mode === 'signIn' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </Text>
      </Pressable>
    </KeyboardAwareScreen>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bgCanvas },
  content: { padding: 28, paddingTop: 80, paddingBottom: 40 },
  h1:      { fontSize: 24, fontWeight: '800', color: colors.ink },
  sub:     { fontSize: 13, color: colors.ink500, marginTop: 8, lineHeight: 20 },
  label:   { fontSize: 12, fontWeight: '700', color: colors.ink700, marginTop: 20, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input:   { padding: 14, backgroundColor: '#fff', borderRadius: radius.md, fontSize: 16, fontWeight: '500', color: colors.ink, borderWidth: 1, borderColor: colors.ink200 },
  primaryBtn:     { marginTop: 28, padding: 14, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  linkBtn:  { marginTop: 16, alignItems: 'center' },
  linkText: { color: colors.primary, fontWeight: '600', fontSize: 14 },
});
