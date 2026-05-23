import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert, Image, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { colors, radius } from '../theme';
import { auth, db, storage } from '../lib/firebase';
import { subscribeMe } from '../lib/user';
import { normalizeUsername, validateUsername, usernameErrorCopy } from '../lib/username';
import { claimUsername, claimUsernameErrorCopy } from '../lib/profile';

const DISPLAY_NAME_MAX = 60;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function EditProfile({ navigation }: any) {
  const me = auth.currentUser?.uid;
  const [displayName, setDisplayName] = useState('');
  const [usernameRaw, setUsernameRaw] = useState('');
  const [photoURL, setPhotoURL]       = useState<string | null>(null);
  const [busy, setBusy]               = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    // Pre-fill from the auth profile immediately so the form is never blank
    // even if the Firestore snapshot is slow or errors.
    if (auth.currentUser?.displayName) setDisplayName(auth.currentUser.displayName);
    return subscribeMe(me, m => {
      if (m) {
        setDisplayName(m.displayName ?? '');
        setUsernameRaw(m.username ?? '');
        setPhotoURL(m.photoURL ?? null);
      }
    });
  }, [me]);

  const usernameLower = normalizeUsername(usernameRaw);
  const usernameCheck = useMemo(() => validateUsername(usernameLower), [usernameLower]);
  const usernameHint  = usernameRaw.length > 0 ? usernameErrorCopy(usernameCheck) : null;

  const displayNameOk = displayName.trim().length > 0 && displayName.length <= DISPLAY_NAME_MAX;
  const canSubmit = displayNameOk && usernameCheck === 'ok' && !busy && !uploading;

  async function pickAvatar() {
    // Loaded lazily so a missing/unlinked native module can't blank the
    // whole screen on open — username editing must always work.
    let ImagePicker: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      ImagePicker = require('expo-image-picker');
    } catch {
      Alert.alert('Unavailable', 'Photo picker isn’t available in this build.');
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to set a profile picture.');
      return;
    }
    const mediaTypes =
      (ImagePicker as any).MediaTypeOptions?.Images ?? (ImagePicker as any).MediaType?.Images ?? 'images';
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0] || !me) return;
    setUploading(true);
    try {
      const res = await fetch(result.assets[0].uri);
      const blob = await res.blob();
      const r = ref(storage, `avatars/${me}.jpg`);
      await uploadBytes(r, blob);
      const url = await getDownloadURL(r);
      await updateDoc(doc(db, 'users', me), { photoURL: url, updatedAt: serverTimestamp() });
      setPhotoURL(url);
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Could not upload the image.');
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!canSubmit) return;
    setBusy(true);
    setServerError(null);
    try {
      await claimUsername({ username: usernameLower, displayName: displayName.trim(), about: null });
      Alert.alert('Profile saved', 'Your profile has been updated.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      setServerError(claimUsernameErrorCopy(e?.code ?? 'internal'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.root} keyboardShouldPersistTaps="handled">
          <Pressable style={s.back} onPress={() => navigation.goBack()} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </Pressable>

          <Text style={s.h1}>Set up your profile</Text>
          <Text style={s.sub}>How friends will see you.</Text>

          <View style={s.avatarWrap}>
            <Pressable onPress={pickAvatar} style={s.avatar}>
              {photoURL
                ? <Image source={{ uri: photoURL }} style={s.avatarImg} />
                : <Text style={s.avatarText}>{initials(displayName)}</Text>}
              <View style={s.avatarBadge}>
                <Ionicons name="pencil" size={13} color="#fff" />
              </View>
            </Pressable>
          </View>

          <Text style={s.label}>DISPLAY NAME</Text>
          <TextInput
            style={s.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your name"
            placeholderTextColor={colors.ink400}
            maxLength={DISPLAY_NAME_MAX}
            autoCapitalize="words"
          />

          <Text style={s.label}>USERNAME</Text>
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

          {serverError ? <Text style={s.serverError}>{serverError}</Text> : null}

          <View style={{ flex: 1, minHeight: 24 }} />

          <Pressable style={[s.btn, !canSubmit && { opacity: 0.5 }]} onPress={save} disabled={!canSubmit}>
            <Text style={s.btnText}>{busy ? 'Saving…' : 'Create profile'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:    { padding: 24, flexGrow: 1, backgroundColor: '#fff' },
  back:    { marginBottom: 8, alignSelf: 'flex-start' },
  h1:      { fontSize: 26, fontWeight: '800', color: colors.ink, letterSpacing: -0.4 },
  sub:     { fontSize: 13, color: colors.ink500, marginTop: 6 },

  avatarWrap: { alignItems: 'center', marginTop: 24, marginBottom: 8 },
  avatar:     { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarImg:  { width: 84, height: 84, borderRadius: 42 },
  avatarText: { color: '#fff', fontSize: 28, fontWeight: '800' },
  avatarBadge:{ position: 'absolute', bottom: 0, right: 0, width: 26, height: 26, borderRadius: 13, backgroundColor: colors.ok, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },

  label:   { fontSize: 11, fontWeight: '700', color: colors.ink500, marginTop: 18, marginBottom: 6, letterSpacing: 0.6 },
  input:   { padding: 14, backgroundColor: '#fff', borderRadius: radius.md, fontSize: 15, fontWeight: '500', borderWidth: 1, borderColor: colors.ink200, color: colors.ink },
  usernameRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  usernamePrefix: { fontSize: 18, fontWeight: '800', color: colors.ink500 },
  usernameInput:  { flex: 1 },
  hintError: { fontSize: 12, color: colors.err, marginTop: 6 },
  hintMuted: { fontSize: 12, color: colors.ink500, marginTop: 6 },
  serverError: { fontSize: 13, color: colors.err, marginTop: 16, textAlign: 'center' },

  btn:     { padding: 16, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', marginTop: 16 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
