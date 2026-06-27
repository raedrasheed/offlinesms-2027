import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, TextInput, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';
import { verifyPhoneOtpAndSignIn, requestPhoneOtp, otpErrorCopy } from '../lib/auth';
import { useOtpAutoRead } from '../hooks/useOtpAutoRead';

const LENGTH = 6;
const RESEND_SECONDS = 42;

export default function Otp({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const phone: string = route?.params?.phone ?? '';
  const [code, setCode] = useState('');
  const [remaining, setRemaining] = useState(RESEND_SECONDS);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (remaining <= 0) return;
    const t = setInterval(() => setRemaining(r => r - 1), 1000);
    return () => clearInterval(t);
  }, [remaining]);

  // Accept only digits, clamp to LENGTH. Used by both the keyboard input and the
  // Android SMS-Retriever auto-read so the two paths can't diverge.
  const acceptCode = useCallback((raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, LENGTH);
    setErr(null);
    setCode(digits);
  }, []);

  // Zero-tap autofill on Android (no-op on iOS / before the native rebuild).
  useOtpAutoRead(acceptCode, LENGTH);

  // Auto-verify once all digits are entered.
  useEffect(() => {
    if (code.length !== LENGTH || busy) return;
    setBusy(true); setErr(null);
    verifyPhoneOtpAndSignIn(phone, code)
      // On success the app's auth listener routes onward — nothing to do here.
      .catch((e: any) => {
        setErr(otpErrorCopy(e?.message ?? e?.code));
        setCode('');
        // Re-focus so the next attempt can type / autofill again.
        requestAnimationFrame(() => inputRef.current?.focus());
      })
      .finally(() => setBusy(false));
  }, [code, busy, phone]);

  async function resend() {
    if (remaining > 0 || busy) return;
    setErr(null); setCode('');
    try { await requestPhoneOtp(phone); setRemaining(RESEND_SECONDS); inputRef.current?.focus(); }
    catch (e: any) { setErr(otpErrorCopy(e?.message ?? e?.code)); }
  }

  const mm = Math.floor(remaining / 60).toString().padStart(1, '0');
  const ss = (remaining % 60).toString().padStart(2, '0');

  return (
    <View style={[s.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <Pressable style={s.back} onPress={() => navigation.goBack()} hitSlop={12}>
        <Ionicons name="chevron-back" size={24} color={colors.ink} />
      </Pressable>

      <Text style={s.h1}>Verify your number</Text>
      <Text style={s.sub}>Code sent to <Text style={{ fontWeight: '700', color: colors.ink }}>{phone}</Text></Text>

      {/* The boxes are purely visual; a single invisible TextInput laid over them
          is the real field. It drives the system keyboard, which lets iOS offer
          the code from Messages (textContentType=oneTimeCode) and Android offer
          its SMS autofill (autoComplete=sms-otp) as a one-tap suggestion. */}
      <Pressable style={s.boxes} onPress={() => inputRef.current?.focus()}>
        {Array.from({ length: LENGTH }).map((_, i) => {
          const ch = code[i];
          const active = i === code.length;
          return (
            <View key={i} style={[s.box, active && s.boxActive, !!ch && s.boxFilled]}>
              <Text style={s.boxText}>{ch ?? ''}</Text>
            </View>
          );
        })}
        <TextInput
          ref={inputRef}
          style={s.hiddenInput}
          value={code}
          onChangeText={acceptCode}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          importantForAutofill="yes"
          maxLength={LENGTH}
          autoFocus
          caretHidden
          editable={!busy}
        />
      </Pressable>

      {busy ? <ActivityIndicator style={{ marginTop: 16 }} color={colors.primary} /> : null}
      {err ? <Text style={s.err}>{err}</Text> : null}

      <View style={s.resendRow}>
        <Text style={s.didnt}>Didn’t receive?</Text>
        <Pressable onPress={resend} disabled={remaining > 0}>
          <Text style={[s.resend, remaining > 0 && { color: colors.ink400 }]}>
            {remaining > 0 ? `Resend ${mm}:${ss}` : 'Resend code'}
          </Text>
        </Pressable>
      </View>

      <View style={{ flex: 1 }} />
    </View>
  );
}

const s = StyleSheet.create({
  root:  { flex: 1, backgroundColor: '#fff', paddingHorizontal: 24 },
  back:  { marginTop: 8, marginBottom: 24, alignSelf: 'flex-start' },
  h1:    { fontSize: 26, fontWeight: '800', color: colors.ink, letterSpacing: -0.4 },
  sub:   { fontSize: 13, color: colors.ink500, marginTop: 8 },

  boxes: { flexDirection: 'row', gap: 10, marginTop: 28, justifyContent: 'space-between', position: 'relative' },
  box:   { flex: 1, aspectRatio: 1, borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink200, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  boxFilled: { borderColor: colors.ink300 },
  boxActive: { borderColor: colors.primary, borderWidth: 2 },
  boxText:   { fontSize: 24, fontWeight: '800', color: colors.ink },
  // Invisible but focusable + autofill-eligible; covers the boxes to catch taps.
  hiddenInput: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0 },
  err:       { marginTop: 14, fontSize: 13, color: '#B91C1C', fontWeight: '600' },

  resendRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18 },
  didnt:  { fontSize: 13, color: colors.ink500 },
  resend: { fontSize: 13, fontWeight: '700', color: colors.primary },
});
