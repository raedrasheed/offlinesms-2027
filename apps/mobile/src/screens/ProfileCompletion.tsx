import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { radius } from '../theme';
import { useTheme } from '../context/ThemeContext';
import { useTranslation } from 'react-i18next';
import { peekPendingInvite, subscribePendingInvite } from '../lib/deepLinks';
import {
  normalizeUsername, validateUsername, usernameErrorCopy,
} from '../lib/username';
import { claimUsername, claimUsernameErrorCopy } from '../lib/profile';
import { ErrorState } from '../components/state';

const DISPLAY_NAME_MAX = 60;
const ABOUT_MAX = 140;

export default function ProfileCompletion() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => buildStyles(colors), [colors]);
  const [hasInvite, setHasInvite] = useState(false);
  useEffect(() => {
    let active = true, revision = 0;
    const read = () => { const at = ++revision; void peekPendingInvite().then(code => { if (active && at === revision) setHasInvite(!!code); }); };
    const unsubscribe = subscribePendingInvite(read); read();
    return () => { active = false; unsubscribe(); };
  }, []);
  const [displayName, setDisplayName] = useState('');
  const [usernameRaw, setUsernameRaw] = useState('');
  const [about, setAbout] = useState('');
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const usernameLower = normalizeUsername(usernameRaw);
  const usernameCheck = useMemo(() => validateUsername(usernameLower), [usernameLower]);
  const usernameHint = usernameRaw.length > 0 ? usernameErrorCopy(usernameCheck) : null;

  const displayNameOk = displayName.trim().length > 0 && displayName.length <= DISPLAY_NAME_MAX;
  const aboutOk = about.length <= ABOUT_MAX;
  const canSubmit = displayNameOk && usernameCheck === 'ok' && aboutOk && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setServerError(null);
    try {
      await claimUsername({
        username: usernameLower,
        displayName: displayName.trim(),
        about: about.trim() || null,
      });
      // App.tsx watches users/{uid}.profileCompleted and swaps the navigator.
    } catch (e: any) {
      setServerError(claimUsernameErrorCopy(e?.code ?? 'internal'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.root} keyboardShouldPersistTaps="handled">
        <Text style={s.h1}>Set up your profile</Text>
        <Text style={s.sub}>Choose how you’ll appear on OfflineSMS. You can change these later.</Text>
        {hasInvite ? <Text style={s.notice} accessibilityRole="alert">{t('groupInvite.onboarding', { defaultValue: 'To join the group, first choose a display name and username. Your invitation is saved and will reopen after you continue.' })}</Text> : null}

        <Text style={s.label}>Display name</Text>
        <TextInput
          style={s.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your name"
          maxLength={DISPLAY_NAME_MAX}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
        />

        <Text style={s.label}>Username</Text>
        <View style={s.usernameRow}>
          <Text style={s.usernamePrefix}>@</Text>
          <TextInput
            style={[s.input, s.usernameInput]}
            value={usernameRaw}
            onChangeText={t => setUsernameRaw(t.replace(/\s+/g, ''))}
            placeholder="yourhandle"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={32}
          />
        </View>
        {usernameHint ? <Text style={s.hint}>{usernameHint}</Text> : <Text style={s.hintMuted}>3–20 characters · lowercase letters, numbers, dot, underscore.</Text>}

        <Text style={s.label}>About <Text style={s.optional}>(optional)</Text></Text>
        <TextInput
          style={[s.input, s.textArea]}
          value={about}
          onChangeText={setAbout}
          placeholder="A short bio your contacts will see."
          maxLength={ABOUT_MAX}
          multiline
        />
        <Text style={s.counter}>{about.length}/{ABOUT_MAX}</Text>

        {serverError ? (
          <View style={{ marginTop: 16 }}>
            <ErrorState compact title="Couldn’t save profile" description={serverError} />
          </View>
        ) : null}

        <Pressable style={[s.btn, !canSubmit && { opacity: 0.5 }]} onPress={submit} disabled={!canSubmit}>
          <Text style={s.btnText}>{busy ? 'Saving…' : 'Continue'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function buildStyles(colors: ReturnType<typeof useTheme>['colors']) { return StyleSheet.create({
  notice: { padding: 14, borderRadius: radius.md, backgroundColor: colors.notice.background, color: colors.notice.text, lineHeight: 22 },
  root: { padding: 24, paddingTop: 64, paddingBottom: 32, backgroundColor: colors.background.app, flexGrow: 1 },
  h1: { fontSize: 24, fontWeight: '800', color: colors.text.primary },
  sub: { fontSize: 13, color: colors.text.secondary, marginTop: 6, marginBottom: 20 },
  label: { fontSize: 12, fontWeight: '700', color: colors.text.secondary, marginTop: 14, marginBottom: 6, letterSpacing: 0.4 },
  optional: { color: colors.text.muted, fontWeight: '500' },
  input: { padding: 12, backgroundColor: colors.background.surface, borderRadius: radius.md, fontSize: 15, fontWeight: '500', borderWidth: 1, borderColor: colors.border.default, color: colors.text.primary },
  usernameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  usernamePrefix: { fontSize: 18, fontWeight: '800', color: colors.text.secondary },
  usernameInput: { flex: 1 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  hint: { fontSize: 12, color: colors.state.error, marginTop: 6 },
  hintMuted: { fontSize: 12, color: colors.text.secondary, marginTop: 6 },
  counter: { fontSize: 11, color: colors.text.muted, alignSelf: 'flex-end', marginTop: 4 },
  btn: { marginTop: 28, padding: 14, backgroundColor: colors.action.primary, borderRadius: radius.md, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
});
}
