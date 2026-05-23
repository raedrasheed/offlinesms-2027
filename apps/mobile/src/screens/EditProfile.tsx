import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { colors, radius } from '../theme';
import { auth } from '../lib/firebase';
import { subscribeMe } from '../lib/user';
import { normalizeUsername, validateUsername, usernameErrorCopy } from '../lib/username';
import { claimUsername, claimUsernameErrorCopy } from '../lib/profile';

const DISPLAY_NAME_MAX = 60;
const ABOUT_MAX = 140;

export default function EditProfile({ navigation }: any) {
  const me = auth.currentUser?.uid;
  const [loading, setLoading]         = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [usernameRaw, setUsernameRaw] = useState('');
  const [about, setAbout]             = useState('');
  const [busy, setBusy]               = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    return subscribeMe(me, m => {
      if (m) {
        setDisplayName(m.displayName ?? '');
        setUsernameRaw(m.username ?? '');
        setAbout(m.about ?? '');
      }
      setLoading(false);
    });
  }, [me]);

  const usernameLower = normalizeUsername(usernameRaw);
  const usernameCheck = useMemo(() => validateUsername(usernameLower), [usernameLower]);
  const usernameHint  = usernameRaw.length > 0 ? usernameErrorCopy(usernameCheck) : null;

  const displayNameOk = displayName.trim().length > 0 && displayName.length <= DISPLAY_NAME_MAX;
  const aboutOk = about.length <= ABOUT_MAX;
  const canSubmit = displayNameOk && usernameCheck === 'ok' && aboutOk && !busy;

  async function save() {
    if (!canSubmit) return;
    setBusy(true);
    setServerError(null);
    try {
      await claimUsername({
        username:    usernameLower,
        displayName: displayName.trim(),
        about:       about.trim() || null,
      });
      Alert.alert('Profile saved', 'Your profile has been updated.');
      navigation.goBack();
    } catch (e: any) {
      setServerError(claimUsernameErrorCopy(e?.code ?? 'internal'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <View style={s.root} />;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.root} keyboardShouldPersistTaps="handled">
        <Text style={s.h1}>Edit profile</Text>
        <Text style={s.sub}>Update how you appear on OfflineSMS.</Text>

        <Text style={s.label}>Display name</Text>
        <TextInput
          style={s.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your name"
          placeholderTextColor={colors.ink400}
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
            placeholderTextColor={colors.ink400}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={32}
          />
        </View>
        {usernameHint
          ? <Text style={s.hintError}>{usernameHint}</Text>
          : <Text style={s.hintMuted}>3–20 characters · lowercase letters, numbers, dot, underscore.</Text>}

        <Text style={s.label}>About <Text style={s.optional}>(optional)</Text></Text>
        <TextInput
          style={[s.input, s.textArea]}
          value={about}
          onChangeText={setAbout}
          placeholder="A short bio your contacts will see."
          placeholderTextColor={colors.ink400}
          maxLength={ABOUT_MAX}
          multiline
        />
        <Text style={s.counter}>{about.length}/{ABOUT_MAX}</Text>

        {serverError ? <Text style={s.serverError}>{serverError}</Text> : null}

        <Pressable style={[s.btn, !canSubmit && { opacity: 0.5 }]} onPress={save} disabled={!canSubmit}>
          <Text style={s.btnText}>{busy ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:    { padding: 24, paddingTop: 64, paddingBottom: 32, backgroundColor: colors.bgCanvas, flexGrow: 1 },
  h1:      { fontSize: 24, fontWeight: '800', color: colors.ink },
  sub:     { fontSize: 13, color: colors.ink500, marginTop: 6, marginBottom: 20 },
  label:   { fontSize: 12, fontWeight: '700', color: colors.ink700, marginTop: 14, marginBottom: 6, letterSpacing: 0.4 },
  optional:{ color: colors.ink400, fontWeight: '500' },
  input:   { padding: 12, backgroundColor: '#fff', borderRadius: radius.md, fontSize: 15, fontWeight: '500', borderWidth: 1, borderColor: colors.ink200, color: colors.ink },
  usernameRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  usernamePrefix: { fontSize: 18, fontWeight: '800', color: colors.ink500 },
  usernameInput:  { flex: 1 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  hintError: { fontSize: 12, color: colors.err, marginTop: 6 },
  hintMuted: { fontSize: 12, color: colors.ink500, marginTop: 6 },
  counter:   { fontSize: 11, color: colors.ink400, alignSelf: 'flex-end', marginTop: 4 },
  serverError: { fontSize: 13, color: colors.err, marginTop: 16, textAlign: 'center' },
  btn:     { marginTop: 28, padding: 14, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
});
