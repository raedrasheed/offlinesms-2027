// "Add phone number" — attach a verified phone number to the signed-in,
// email-verified account. Reached only from Settings, and only when the server
// reports the feature available. Steps:
//   status → (reauth: emailed code) → number + ownership/SMS consent → code → done
// plus a "finish adding your number" recovery step after an interruption.
// All checks are enforced server-side; this screen just walks the user through.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { isRTL } from '../i18n';
import { radius } from '../theme';
import { auth } from '../lib/firebase';
import { availableCountries, flagEmoji, type Country } from '../lib/countries';
import {
  getPhoneLinkStatus, requestPhoneLinkCode, verifyPhoneLinkCode, resumePhoneLink,
  sendReauthEmailCode, reauthenticateWithEmailCode, type PhoneLinkStatus,
} from '../lib/phoneLink';
import { phoneLinkErrorInfo, toE164, formatCountdown } from '../lib/phoneLink.helpers';

type Step = 'loading' | 'unavailable' | 'linked' | 'recover' | 'reauth' | 'number' | 'code' | 'done';
const CODE_LEN = 6;

export default function LinkPhone({ navigation }: any) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => buildStyles(colors, isRTL), [colors]);

  const [status, setStatus] = useState<PhoneLinkStatus | null>(null);
  const [step, setStep] = useState<Step>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reauthSent, setReauthSent] = useState(false);
  const [reauthCode, setReauthCode] = useState('');

  const [country, setCountry] = useState<Country | null>(null);
  const [local, setLocal] = useState('');
  const [owns, setOwns] = useState(false);
  const [consents, setConsents] = useState(false);

  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [masked, setMasked] = useState('');
  const [code, setCode] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const codeRef = useRef<TextInput>(null);

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  const showError = useCallback((e: unknown) => {
    const info = phoneLinkErrorInfo(e);
    if (info.needsReauth) { setReauthSent(false); setReauthCode(''); setStep('reauth'); }
    if (info.canResume) setStep('recover');
    if (info.retryAfterSec) setResendAt(Date.now() + info.retryAfterSec * 1000);
    setError(t(info.key, {
      time: info.retryAfterSec ? formatCountdown(info.retryAfterSec) : '',
      count: info.attemptsLeft ?? 0,
    }));
  }, [t]);

  const load = useCallback(async () => {
    setStep('loading'); setError(null);
    try {
      const st = await getPhoneLinkStatus();
      setStatus(st);
      if (!st.available) { setStep('unavailable'); return; }
      if (st.pendingRecovery) { setStep('recover'); return; }
      if (st.linked) { setMasked(st.maskedPhone ?? ''); setStep('linked'); return; }
      if (!st.eligible || st.sendingPaused) { setStep('unavailable'); return; }
      setStep(st.reauthRequired ? 'reauth' : 'number');
    } catch (e) {
      setStep('unavailable'); showError(e);
    }
  }, [showError]);

  useEffect(() => { void load(); }, [load]);

  const countries = useMemo(
    () => (status && status.available ? availableCountries(status.countries) : []),
    [status],
  );
  useEffect(() => {
    if (!country && countries.length > 0) setCountry(countries[0]);
  }, [countries, country]);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { showError(e); } finally { setBusy(false); }
  }

  const sendReauth = () => run(async () => { await sendReauthEmailCode(); setReauthSent(true); });
  const confirmReauth = () => run(async () => {
    await reauthenticateWithEmailCode(reauthCode);
    setReauthCode('');
    setStep('number');
  });

  const sendCode = () => run(async () => {
    if (!country) return;
    const r = await requestPhoneLinkCode(toE164(country.dial, local));
    setChallengeId(r.challengeId);
    setMasked(r.maskedPhone);
    setResendAt(Date.now() + r.resendAfterSec * 1000);
    setCode('');
    setStep('code');
    requestAnimationFrame(() => codeRef.current?.focus());
  });

  const submitCode = (value: string) => run(async () => {
    if (!challengeId) return;
    try {
      const r = await verifyPhoneLinkCode(challengeId, value);
      setMasked(r.maskedPhone);
      setStep('done');
    } finally {
      setCode('');
    }
  });

  const finish = () => run(async () => {
    const r = await resumePhoneLink();
    setMasked(r.maskedPhone);
    setStep('done');
  });

  const resendLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const canSend = !!country && local.replace(/\D/g, '').length >= 6 && owns && consents && !busy && resendLeft === 0;

  function checkbox(value: boolean, set: (v: boolean) => void, label: string) {
    return (
      <Pressable
        style={s.checkRow}
        onPress={() => set(!value)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: value }}
        accessibilityLabel={label}
      >
        <Ionicons name={value ? 'checkbox' : 'square-outline'} size={22} color={value ? colors.action.primary : colors.text.muted} />
        <Text style={s.checkText}>{label}</Text>
      </Pressable>
    );
  }

  function primary(label: string, onPress: () => void, enabled = true) {
    return (
      <Pressable
        style={[s.btn, !enabled && s.btnDisabled]}
        onPress={onPress}
        disabled={!enabled || busy}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {busy ? <ActivityIndicator color={colors.action.primaryFg} /> : <Text style={s.btnText}>{label}</Text>}
      </Pressable>
    );
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Pressable style={s.back} onPress={() => navigation.goBack()} hitSlop={12} accessibilityLabel={t('common.back')}>
        <Ionicons name={isRTL ? 'chevron-forward' : 'chevron-back'} size={24} color={colors.text.primary} />
      </Pressable>
      <Text style={s.h1}>{t('phoneLink.title')}</Text>

      {step === 'loading' ? <ActivityIndicator style={{ marginTop: 24 }} color={colors.action.primary} /> : null}

      {step === 'unavailable' ? (
        <Text style={s.body}>{
          status && status.available && !status.eligible ? t('phoneLink.notEligible')
            : status && status.available && status.sendingPaused ? t('phoneLink.errors.servicePaused')
              : t('phoneLink.errors.unavailable')
        }</Text>
      ) : null}

      {step === 'linked' ? <Text style={s.body}>{t('phoneLink.alreadyLinked', { phone: masked })}</Text> : null}

      {step === 'recover' ? (
        <>
          <Text style={s.body}>{t('phoneLink.recoverBody')}</Text>
          {primary(t('phoneLink.recoverButton'), finish)}
        </>
      ) : null}

      {step === 'reauth' ? (
        <>
          <Text style={s.body}>{t('phoneLink.reauthBody', { email: auth.currentUser?.email ?? '' })}</Text>
          {!reauthSent ? primary(t('phoneLink.reauthSend'), sendReauth) : (
            <>
              <TextInput
                style={s.input}
                value={reauthCode}
                onChangeText={v => setReauthCode(v.replace(/\D/g, '').slice(0, CODE_LEN))}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={CODE_LEN}
                placeholder={t('phoneLink.codePlaceholder')}
                placeholderTextColor={colors.text.disabled}
                accessibilityLabel={t('phoneLink.reauthCodeLabel')}
              />
              {primary(t('phoneLink.reauthConfirm'), confirmReauth, reauthCode.length === CODE_LEN)}
            </>
          )}
        </>
      ) : null}

      {step === 'number' ? (
        <>
          <Text style={s.body}>{t('phoneLink.numberBody')}</Text>
          {countries.length === 0 ? <Text style={s.body}>{t('phoneLink.errors.countryUnavailable')}</Text> : (
            <View style={s.chipRow}>
              {countries.map(c => (
                <Pressable
                  key={c.code}
                  style={[s.chip, country?.code === c.code && s.chipActive]}
                  onPress={() => setCountry(c)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: country?.code === c.code }}
                  accessibilityLabel={`${c.name} ${c.dial}`}
                >
                  <Text style={[s.chipText, country?.code === c.code && s.chipTextActive]}>{flagEmoji(c.code)} {c.dial}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <TextInput
            style={s.input}
            value={local}
            onChangeText={v => setLocal(v.replace(/[^\d\s]/g, '').slice(0, 16))}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            placeholder={t('phoneLink.numberPlaceholder')}
            placeholderTextColor={colors.text.disabled}
            accessibilityLabel={t('phoneLink.numberLabel')}
          />
          {checkbox(owns, setOwns, t('phoneLink.ownershipConfirm'))}
          {checkbox(consents, setConsents, t('phoneLink.smsConsent'))}
          <Text style={s.fine}>{t('phoneLink.noAccountChange')}</Text>
          {primary(resendLeft > 0 ? t('phoneLink.resendIn', { time: formatCountdown(resendLeft) }) : t('phoneLink.sendCode'), sendCode, canSend)}
        </>
      ) : null}

      {step === 'code' ? (
        <>
          <Text style={s.body}>{t('phoneLink.codeBody', { phone: masked })}</Text>
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
            autoComplete="sms-otp"
            maxLength={CODE_LEN}
            editable={!busy}
            placeholder={t('phoneLink.codePlaceholder')}
            placeholderTextColor={colors.text.disabled}
            accessibilityLabel={t('phoneLink.codeLabel')}
          />
          <Pressable
            onPress={() => { setStep('number'); setError(null); }}
            disabled={resendLeft > 0 || busy}
            accessibilityRole="button"
          >
            <Text style={[s.link, (resendLeft > 0 || busy) && { color: colors.text.disabled }]}>
              {resendLeft > 0 ? t('phoneLink.resendIn', { time: formatCountdown(resendLeft) }) : t('phoneLink.resend')}
            </Text>
          </Pressable>
        </>
      ) : null}

      {step === 'done' ? (
        <>
          <Text style={s.body}>{t('phoneLink.done', { phone: masked })}</Text>
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
      paddingVertical: 12, fontSize: 18, color: colors.text.primary, backgroundColor: colors.background.surface,
      textAlign: 'left', writingDirection: 'ltr',
    },
    chipRow: { flexDirection: rtl ? 'row-reverse' : 'row', gap: 8, flexWrap: 'wrap' },
    chip:    { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.background.subtle, borderWidth: 1, borderColor: colors.border.subtle, minHeight: 36, justifyContent: 'center' },
    chipActive: { backgroundColor: colors.action.primary, borderColor: colors.action.primary },
    chipText: { fontSize: 13, fontWeight: '600', color: colors.text.secondary },
    chipTextActive: { color: colors.action.primaryFg },
    checkRow: { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'flex-start', gap: 10 },
    checkText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.text.primary, textAlign: align },
    btn:     { backgroundColor: colors.action.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: colors.action.primaryFg, fontWeight: '700', fontSize: 15 },
    link:    { fontSize: 14, fontWeight: '700', color: colors.action.primary, textAlign: align },
    err:     { fontSize: 13, fontWeight: '600', color: colors.state.error, textAlign: align },
  });
}
