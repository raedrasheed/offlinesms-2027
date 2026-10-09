// "Add email" / "Change email" for the signed-in account (Settings). Steps:
//   status → (confirm it's you) → new address → code sent to the NEW address → done
// plus a "finish" recovery step after an interruption. The current address
// keeps working until the new one is verified; afterwards only the new one
// signs in. All checks are enforced server-side.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { isRTL } from '../i18n';
import { radius } from '../theme';
import ReauthPanel from '../components/ReauthPanel';
import {
  getSignInMethods, requestEmailChangeCode, verifyEmailChangeCode, resumeEmailChange, type SignInMethods,
} from '../lib/signInMethods';
import { emailChangeErrorInfo, isPlausibleEmail } from '../lib/signInMethods.helpers';
import { formatCountdown, secondsLeft } from '../lib/phoneLink.helpers';

type Step = 'loading' | 'unavailable' | 'recover' | 'reauth' | 'email' | 'code' | 'done';
const CODE_LEN = 6;

export default function ChangeEmail({ navigation }: any) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => buildStyles(colors, isRTL), [colors]);

  const [methods, setMethods] = useState<SignInMethods | null>(null);
  const [step, setStep] = useState<Step>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [masked, setMasked] = useState('');
  const [code, setCode] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const codeRef = useRef<TextInput>(null);

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  const showError = useCallback((e: unknown) => {
    const info = emailChangeErrorInfo(e);
    if (info.needsReauth) {
      // A revoked session (e.g. the change landed but its reply was lost) must
      // sign in again; confirm with the address the account carries NOW.
      setStep('reauth');
      void getSignInMethods().then(setMethods).catch(() => {});
    }
    if (info.canResume) setStep('recover');
    if (info.retryAfterSec) setResendAt(Date.now() + info.retryAfterSec * 1000);
    setError(t(info.key, { time: info.retryAfterSec ? formatCountdown(info.retryAfterSec) : '', count: info.attemptsLeft ?? 0 }));
  }, [t]);

  const load = useCallback(async () => {
    setStep('loading'); setError(null);
    try {
      const m = await getSignInMethods();
      setMethods(m);
      if (m.emailChange.pendingChallengeId) setChallengeId(m.emailChange.pendingChallengeId);
      // A change is mid-way. Without its id this session was revoked (the change
      // itself signs every session out): sign in again first, then finish.
      if (m.emailChange.pendingRecovery && !m.emailChange.pendingChallengeId) {
        setStep('reauth'); setError(t('emailChange.errors.reauthRequired'));
      } else if (m.emailChange.pendingRecovery) setStep('recover');
      else if (!m.emailChange.available) setStep('unavailable');
      else setStep(m.emailChange.reauthRequired ? 'reauth' : 'email');
    } catch (e) {
      setStep('unavailable'); showError(e);
    }
  }, [showError, t]);

  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { showError(e); } finally { setBusy(false); }
  }

  const sendCode = () => run(async () => {
    const r = await requestEmailChangeCode(email);
    setChallengeId(r.challengeId);
    setMasked(r.maskedEmail);
    setResendAt(Date.now() + r.resendAfterSec * 1000);
    setExpiresAt(r.expiresAtMs);
    setCode('');
    setStep('code');
    requestAnimationFrame(() => codeRef.current?.focus());
  });

  const submitCode = (value: string) => run(async () => {
    if (!challengeId) return;
    try {
      const r = await verifyEmailChangeCode(challengeId, value);
      setMasked(r.email || r.maskedEmail);
      setStep('done');
    } finally {
      setCode('');
    }
  });

  const finish = () => run(async () => {
    const id = challengeId ?? (await getSignInMethods()).emailChange.pendingChallengeId;
    if (!id) throw new Error('challenge-not-found');
    const r = await resumeEmailChange(id);
    setMasked(r.email || r.maskedEmail);
    setStep('done');
  });

  const adding = !methods?.email;
  const resendLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const expiresLeft = secondsLeft(expiresAt, now);
  const canSend = isPlausibleEmail(email) && !busy && resendLeft === 0;

  function primary(label: string, onPress: () => void, enabled = true) {
    return (
      <Pressable style={[s.btn, !enabled && s.btnDisabled]} onPress={onPress} disabled={!enabled || busy} accessibilityRole="button" accessibilityLabel={label}>
        {busy ? <ActivityIndicator color={colors.action.primaryFg} /> : <Text style={s.btnText}>{label}</Text>}
      </Pressable>
    );
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Pressable style={s.back} onPress={() => navigation.goBack()} hitSlop={12} accessibilityLabel={t('common.back')}>
        <Ionicons name={isRTL ? 'chevron-forward' : 'chevron-back'} size={24} color={colors.text.primary} />
      </Pressable>
      <Text style={s.h1}>{t(adding ? 'emailChange.titleAdd' : 'emailChange.titleChange')}</Text>

      {step === 'loading' ? <ActivityIndicator style={{ marginTop: 24 }} color={colors.action.primary} /> : null}
      {step === 'unavailable' ? <Text style={s.body}>{t('emailChange.errors.unavailable')}</Text> : null}

      {step === 'recover' ? (
        <>
          <Text style={s.body}>{t('emailChange.recoverBody')}</Text>
          {primary(t('emailChange.recoverButton'), finish)}
        </>
      ) : null}

      {/* After signing in again, reload: a change that was mid-way resumes from the "finish" step. */}
      {step === 'reauth' ? <ReauthPanel email={methods?.email} onDone={load} /> : null}

      {step === 'email' ? (
        <>
          {methods?.email ? <Text style={s.body}>{t('emailChange.current', { email: methods.email })}</Text> : null}
          <Text style={s.body}>{t(adding ? 'emailChange.bodyAdd' : 'emailChange.bodyChange')}</Text>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            placeholder={t('emailChange.placeholder')}
            placeholderTextColor={colors.text.disabled}
            accessibilityLabel={t('emailChange.label')}
          />
          <Text style={s.fine}>{t('emailChange.noAccountChange')}</Text>
          {primary(resendLeft > 0 ? t('phoneLink.resendIn', { time: formatCountdown(resendLeft) }) : t('emailChange.sendCode'), sendCode, canSend)}
        </>
      ) : null}

      {step === 'code' ? (
        <>
          <Text style={s.body}>{t('emailChange.codeBody', { email: masked })}</Text>
          <TextInput
            ref={codeRef}
            style={s.input}
            value={code}
            onChangeText={v => {
              const d = v.replace(/\D/g, '').slice(0, CODE_LEN);
              setCode(d);
              if (d.length === CODE_LEN) void submitCode(d);
            }}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={CODE_LEN}
            editable={!busy}
            placeholder={t('phoneLink.codePlaceholder')}
            placeholderTextColor={colors.text.disabled}
            accessibilityLabel={t('emailChange.codeLabel')}
          />
          <Text style={s.fine} accessibilityLiveRegion="polite">
            {expiresLeft > 0 ? t('phoneLink.codeExpiresIn', { time: formatCountdown(expiresLeft) }) : t('emailChange.errors.codeExpired')}
          </Text>
          <Pressable onPress={() => { void sendCode(); }} disabled={resendLeft > 0 || busy} accessibilityRole="button">
            <Text style={[s.link, (resendLeft > 0 || busy) && { color: colors.text.disabled }]}>
              {resendLeft > 0 ? t('phoneLink.resendIn', { time: formatCountdown(resendLeft) }) : t('phoneLink.resend')}
            </Text>
          </Pressable>
          <Pressable onPress={() => { setStep('email'); setError(null); setCode(''); }} disabled={busy} accessibilityRole="button">
            <Text style={s.link}>{t('emailChange.useDifferent')}</Text>
          </Pressable>
        </>
      ) : null}

      {step === 'done' ? (
        <>
          <Text style={s.body}>{t(adding ? 'emailChange.doneAdd' : 'emailChange.doneChange', { email: masked })}</Text>
          <Text style={s.fine}>{t('emailChange.passwordNote')}</Text>
          {primary(t('phoneLink.doneButton'), () => navigation.goBack())}
        </>
      ) : null}

      {error ? <Text style={s.err} accessibilityLiveRegion="polite">{error}</Text> : null}
    </ScrollView>
  );
}

function buildStyles(colors: any, rtl: boolean) {
  const align = rtl ? 'right' : 'left';
  return StyleSheet.create({
    root:    { flex: 1, backgroundColor: colors.background.app },
    content: { padding: 20, paddingTop: 48, gap: 14 },
    back:    { alignSelf: rtl ? 'flex-end' : 'flex-start' },
    h1:      { fontSize: 24, fontWeight: '800', color: colors.text.primary, textAlign: align },
    body:    { fontSize: 14, lineHeight: 21, color: colors.text.secondary, textAlign: align },
    fine:    { fontSize: 12, lineHeight: 18, color: colors.text.muted, textAlign: align },
    input:   {
      borderWidth: 1, borderColor: colors.border.subtle, borderRadius: radius.md, paddingHorizontal: 14,
      paddingVertical: 12, fontSize: 17, color: colors.text.primary, backgroundColor: colors.background.surface,
      textAlign: 'left', writingDirection: 'ltr',
    },
    btn:     { backgroundColor: colors.action.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: colors.action.primaryFg, fontWeight: '700', fontSize: 15 },
    link:    { fontSize: 14, fontWeight: '700', color: colors.action.primary, textAlign: align },
    err:     { fontSize: 13, fontWeight: '600', color: colors.state.error, textAlign: align },
  });
}
