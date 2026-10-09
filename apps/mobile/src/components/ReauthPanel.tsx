// "Confirm it's you" — re-authenticate the signed-in account with a method it
// ALREADY has (a code to its email, or by SMS to its number) before a sign-in
// method is added or changed. Never switches accounts: the code must resolve
// to the current uid or nothing is signed in (see lib/signInMethods.ts).

import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { isRTL } from '../i18n';
import { radius } from '../theme';
import { auth } from '../lib/firebase';
import {
  reauthMethods, sendReauthEmailCode, reauthenticateWithEmailCode, sendReauthPhoneCode,
  reauthenticateWithPhoneCode, type ReauthMethod,
} from '../lib/signInMethods';
import { emailChangeErrorInfo, formatOwnPhone } from '../lib/signInMethods.helpers';
import { phoneAuthErrorInfo } from '../lib/phoneAuth.flow';
import { formatCountdown } from '../lib/phoneLink.helpers';

const CODE_LEN = 6;

export default function ReauthPanel({ onDone }: { onDone: () => void | Promise<void> }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => buildStyles(colors, isRTL), [colors]);
  const methods = useMemo(() => reauthMethods(), []);
  const [method, setMethod] = useState<ReauthMethod | null>(methods[0] ?? null);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function showError(e: unknown) {
    const info = method === 'phone' ? phoneAuthErrorInfo(e) : emailChangeErrorInfo(e);
    setError(t(info.key, {
      time: info.retryAfterSec ? formatCountdown(info.retryAfterSec) : '',
      count: info.attemptsLeft ?? 0,
    }));
  }

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { showError(e); } finally { setBusy(false); }
  }

  const send = () => run(async () => {
    if (method === 'phone') await sendReauthPhoneCode(); else await sendReauthEmailCode();
    setSent(true); setCode('');
  });
  const confirm = () => run(async () => {
    if (method === 'phone') await reauthenticateWithPhoneCode(code); else await reauthenticateWithEmailCode(code);
    setCode(''); setSent(false);
    await onDone();
  });

  if (!method) return <Text style={s.body}>{t('signInMethods.reauthNoMethod')}</Text>;
  const target = method === 'phone' ? formatOwnPhone(auth.currentUser?.phoneNumber) : auth.currentUser?.email ?? '';

  return (
    <View style={s.wrap}>
      <Text style={s.body}>{t(method === 'phone' ? 'signInMethods.reauthBodyPhone' : 'signInMethods.reauthBodyEmail', { target })}</Text>
      {methods.length > 1 && !sent ? (
        <View style={s.row}>
          {methods.map(m => (
            <Pressable
              key={m}
              style={[s.chip, method === m && s.chipActive]}
              onPress={() => { setMethod(m); setError(null); }}
              accessibilityRole="button"
              accessibilityState={{ selected: method === m }}
            >
              <Text style={[s.chipText, method === m && s.chipTextActive]}>
                {t(m === 'phone' ? 'signInMethods.viaPhone' : 'signInMethods.viaEmail')}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {!sent ? (
        <Pressable style={s.btn} onPress={send} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.action.primaryFg} /> : <Text style={s.btnText}>{t('signInMethods.reauthSend')}</Text>}
        </Pressable>
      ) : (
        <>
          <TextInput
            style={s.input}
            value={code}
            onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, CODE_LEN))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete={method === 'phone' ? 'sms-otp' : 'one-time-code'}
            maxLength={CODE_LEN}
            placeholder={t('phoneLink.codePlaceholder')}
            placeholderTextColor={colors.text.disabled}
            accessibilityLabel={t('signInMethods.reauthCodeLabel')}
          />
          <Pressable style={[s.btn, code.length !== CODE_LEN && s.btnDisabled]} onPress={confirm} disabled={busy || code.length !== CODE_LEN} accessibilityRole="button">
            {busy ? <ActivityIndicator color={colors.action.primaryFg} /> : <Text style={s.btnText}>{t('phoneLink.reauthConfirm')}</Text>}
          </Pressable>
          <Pressable onPress={send} disabled={busy} accessibilityRole="button">
            <Text style={s.link}>{t('signInMethods.reauthResend')}</Text>
          </Pressable>
        </>
      )}
      {error ? <Text style={s.err} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

function buildStyles(colors: any, rtl: boolean) {
  const align = rtl ? 'right' : 'left';
  return StyleSheet.create({
    wrap:  { gap: 14 },
    body:  { fontSize: 14, lineHeight: 21, color: colors.text.secondary, textAlign: align },
    row:   { flexDirection: rtl ? 'row-reverse' : 'row', gap: 8, flexWrap: 'wrap' },
    chip:  { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.background.subtle, borderWidth: 1, borderColor: colors.border.subtle, minHeight: 36, justifyContent: 'center' },
    chipActive: { backgroundColor: colors.action.primary, borderColor: colors.action.primary },
    chipText: { fontSize: 13, fontWeight: '600', color: colors.text.secondary },
    chipTextActive: { color: colors.action.primaryFg },
    input: {
      borderWidth: 1, borderColor: colors.border.subtle, borderRadius: radius.md, paddingHorizontal: 14,
      paddingVertical: 12, fontSize: 18, color: colors.text.primary, backgroundColor: colors.background.surface,
      textAlign: 'left', writingDirection: 'ltr',
    },
    btn:   { backgroundColor: colors.action.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: colors.action.primaryFg, fontWeight: '700', fontSize: 15 },
    link:  { fontSize: 14, fontWeight: '700', color: colors.action.primary, textAlign: align },
    err:   { fontSize: 13, fontWeight: '600', color: colors.state.error, textAlign: align },
  });
}
