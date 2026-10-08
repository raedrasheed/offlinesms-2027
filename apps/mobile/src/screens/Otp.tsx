import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, TextInput, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';
import { useTranslation } from 'react-i18next';
import { phoneAuthFlow, verifyPhoneCodeAndSignIn } from '../lib/phoneAuth';
import { phoneAuthErrorInfo } from '../lib/phoneAuth.flow';
import { formatCountdown } from '../lib/phoneLink.helpers';
import { useOtpAutoRead, getAndroidAppHash } from '../hooks/useOtpAutoRead';

const LENGTH = 6;
// The resend wait comes from the server (resendAfterSec / retryAfterSec);
// this is only the fallback if a response omits it.
const FALLBACK_RESEND_SECONDS = 60;

export default function Otp({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const phone: string = route?.params?.phone ?? '';
  const [challengeId, setChallengeId] = useState<string>(route?.params?.challengeId ?? '');
  const [code, setCode] = useState('');
  const [remaining, setRemaining] = useState<number>(route?.params?.resendAfterSec ?? FALLBACK_RESEND_SECONDS);
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
    verifyPhoneCodeAndSignIn(challengeId, code)
      // On success the app's auth listener routes onward — nothing to do here.
      .catch((e: unknown) => {
        const info = phoneAuthErrorInfo(e);
        setErr(t(info.key, { time: formatCountdown(info.retryAfterSec ?? 0), count: info.attemptsLeft ?? 0 }));
        setCode('');
        // Re-focus so the next attempt can type / autofill again.
        requestAnimationFrame(() => inputRef.current?.focus());
      })
      .finally(() => setBusy(false));
  }, [code, busy, challengeId, t]);

  async function resend() {
    if (remaining > 0 || busy) return;
    setErr(null); setCode('');
    setBusy(true);
    try {
      const r = await (await phoneAuthFlow()).sendCode(phone);
      setChallengeId(r.challengeId);
      setRemaining(r.resendAfterSec || FALLBACK_RESEND_SECONDS);
      inputRef.current?.focus();
    } catch (e: unknown) {
      const info = phoneAuthErrorInfo(e);
      if (info.retryAfterSec) setRemaining(info.retryAfterSec);
      setErr(t(info.key, { time: formatCountdown(info.retryAfterSec ?? 0), count: info.attemptsLeft ?? 0 }));
    } finally {
      setBusy(false);
    }
  }

  // Dev-only: surface this build's SMS Retriever hash so it can be copied into
  // Firestore (smsConfig/otp.androidAppHash) to enable zero-tap Android.
  async function showHash() {
    const hashes = await getAndroidAppHash();
    const text = hashes?.length ? hashes.join('\n') : 'unavailable (iOS, or native module not linked)';
    // eslint-disable-next-line no-console
    console.log('[OTP] SMS Retriever app hash:', text);
    Alert.alert('SMS Retriever app hash', `${text}\n\nSet smsConfig/otp.androidAppHash to this value.`);
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

      {__DEV__ ? (
        <Pressable onPress={showHash} style={s.devBtn}>
          <Text style={s.devText}>Dev: show SMS Retriever hash</Text>
        </Pressable>
      ) : null}
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
  devBtn:  { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12, marginBottom: 8, borderRadius: radius.md, backgroundColor: colors.ink100 },
  devText: { fontSize: 12, fontWeight: '700', color: colors.ink500 },
});
