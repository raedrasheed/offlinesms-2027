// EditGroup — owner/admin edits a group's name, description and avatar.
//
// The avatar image is uploaded to Storage (groupAvatars/{id}/{me}/…) and the
// resulting URL, plus the name/description, are persisted via the
// updateGroupInfo callable (which re-checks owner/admin server-side).

import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, getDoc } from 'firebase/firestore';
import { colors, radius } from '../theme';
import { auth, db, storage } from '../lib/firebase';
import { updateGroupInfo, groupErrorCopy, Conversation } from '../lib/conversations';

const NAME_MAX = 80;
const DESC_MAX = 500;

export default function EditGroup({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const me = auth.currentUser?.uid;
  const { id } = route.params as { id: string };

  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [avatarUrl, setAvatarUrl]     = useState<string | null>(null);
  const [loaded, setLoaded]           = useState(false);
  const [busy, setBusy]               = useState(false);
  const [uploading, setUploading]     = useState(false);

  // Prefill once from the conversation doc (one-shot read so a later update to
  // the doc can't clobber edits in progress).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'conversations', id));
        const c = snap.data() as Conversation | undefined;
        if (alive && c) {
          setName(c.name ?? '');
          setDescription(c.description ?? '');
          setAvatarUrl(c.avatarUrl ?? null);
        }
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  const nameOk = name.trim().length > 0 && name.trim().length <= NAME_MAX;
  const canSave = loaded && nameOk && !busy && !uploading;

  async function pickAvatar() {
    let ImagePicker: any;
    try { ImagePicker = require('expo-image-picker'); }
    catch { Alert.alert('Unavailable', 'Photo picker isn’t available in this build.'); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to set a group photo.'); return; }
    const mediaTypes =
      (ImagePicker as any).MediaTypeOptions?.Images ?? (ImagePicker as any).MediaType?.Images ?? 'images';
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes, allowsEditing: true, aspect: [1, 1], quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0] || !me) return;
    setUploading(true);
    try {
      const res = await fetch(result.assets[0].uri);
      const blob = await res.blob();
      // Timestamped filename so the download URL changes (avoids stale image cache).
      const r = ref(storage, `groupAvatars/${id}/${me}/avatar-${Date.now()}.jpg`);
      await uploadBytes(r, blob);
      setAvatarUrl(await getDownloadURL(r));
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Could not upload the image.');
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try {
      await updateGroupInfo(id, {
        name: name.trim(),
        description: description.trim() || null,
        avatarUrl,
      });
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Couldn’t save', groupErrorCopy(e?.code ?? 'internal'));
    } finally {
      setBusy(false);
    }
  }

  const initial = (name || 'G').slice(0, 1).toUpperCase();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgCanvas }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[s.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.headerRow}>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
              <Ionicons name="chevron-back" size={24} color={colors.ink} />
            </Pressable>
            <Text style={s.h1}>Edit group info</Text>
          </View>

          <View style={s.avatarWrap}>
            <Pressable onPress={pickAvatar} style={s.avatar} disabled={uploading}>
              {avatarUrl
                ? <Image source={{ uri: avatarUrl }} style={s.avatarImg} />
                : <Text style={s.avatarText}>{initial}</Text>}
              <View style={s.avatarBadge}>
                <Ionicons name="camera" size={15} color="#fff" />
              </View>
            </Pressable>
            <Text style={s.avatarHint}>{uploading ? 'Uploading…' : 'Tap to change photo'}</Text>
          </View>

          <Text style={s.label}>GROUP NAME</Text>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder="Group name"
            placeholderTextColor={colors.ink400}
            maxLength={NAME_MAX}
          />

          <Text style={s.label}>DESCRIPTION</Text>
          <TextInput
            style={[s.input, s.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder="What's this group about? (optional)"
            placeholderTextColor={colors.ink400}
            maxLength={DESC_MAX}
            multiline
          />
          <Text style={s.counter}>{description.length}/{DESC_MAX}</Text>

          <Pressable style={[s.btn, !canSave && { opacity: 0.5 }]} onPress={save} disabled={!canSave}>
            <Text style={s.btnText}>{busy ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root:    { paddingHorizontal: 24, flexGrow: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  h1:      { fontSize: 20, fontWeight: '800', color: colors.ink },

  avatarWrap: { alignItems: 'center', marginTop: 16, marginBottom: 8, gap: 8 },
  avatar:     { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarImg:  { width: 96, height: 96, borderRadius: 48 },
  avatarText: { color: '#fff', fontSize: 36, fontWeight: '800' },
  avatarBadge:{ position: 'absolute', bottom: 0, right: 0, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bgCanvas },
  avatarHint: { fontSize: 12, color: colors.ink500 },

  label:   { fontSize: 11, fontWeight: '700', color: colors.ink500, marginTop: 18, marginBottom: 6, letterSpacing: 0.6 },
  input:   { padding: 14, backgroundColor: '#fff', borderRadius: radius.md, fontSize: 15, fontWeight: '500', borderWidth: 1, borderColor: colors.ink200, color: colors.ink },
  textArea:{ minHeight: 90, textAlignVertical: 'top' },
  counter: { fontSize: 11, color: colors.ink400, alignSelf: 'flex-end', marginTop: 4 },

  btn:     { marginTop: 24, padding: 16, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
