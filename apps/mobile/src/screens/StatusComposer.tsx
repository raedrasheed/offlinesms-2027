// StatusComposer — two modes:
//   • text  (default): WhatsApp-style full-screen colored canvas, centered
//     multiline input, palette cycler.
//   • media (route.params.media): full-screen photo/video preview with an
//     optional caption input.
// Posting goes through createTextStatus / createMediaStatus (24h expiry is
// server-set; media is uploaded to statuses/{uid}/ first).

import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Alert, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Video, ResizeMode } from 'expo-av';
import {
  createTextStatus, createMediaStatus, STATUS_BG_COLORS, STATUS_BODY_MAX,
} from '../lib/statuses';
import { AppContactPicker } from '../components/chat/AppContactPicker';
import type { AppContact } from '../lib/appContacts';
import { auth } from '../lib/firebase';
import { useTheme } from '../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type MediaParam = {
  uri:        string;
  type:       'image' | 'video';
  mimeType:   string;
  durationMs: number | null;
};

export default function StatusComposer({ route, navigation }: any) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const media: MediaParam | undefined = route.params?.media;
  const [body, setBody] = useState('');
  const [colorIdx, setColorIdx] = useState(0);
  const [posting, setPosting] = useState(false);
  const [mentions, setMentions] = useState<AppContact[]>([]);
  const [mentionPicker, setMentionPicker] = useState(false);

  const bg = media ? '#000' : STATUS_BG_COLORS[colorIdx];
  const canPost = posting ? false : media ? true : body.trim().length > 0;

  async function post() {
    if (!canPost) return;
    setPosting(true);
    try {
      if (media) {
        await createMediaStatus({
          localUri:   media.uri,
          type:       media.type,
          mimeType:   media.mimeType,
          caption:    body.trim(),
          durationMs: media.durationMs,
          mentionUids: mentions.map(m => m.uid),
        });
      } else {
        await createTextStatus({ body: body.trim(), backgroundColor: bg, mentionUids: mentions.map(m => m.uid) });
      }
      navigation.goBack();
    } catch {
      Alert.alert(t('status.title'), t('status.postFailed'));
      setPosting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[s.root, { backgroundColor: bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[s.topBar, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={s.topBtn}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        {!media ? (
          <Pressable
            onPress={() => setColorIdx(i => (i + 1) % STATUS_BG_COLORS.length)}
            hitSlop={10}
            style={s.topBtn}
          >
            <Ionicons name="color-palette-outline" size={24} color="#fff" />
          </Pressable>
        ) : null}
        <Pressable style={s.topBtn} disabled={posting || mentions.length >= 10} onPress={() => setMentionPicker(true)} accessibilityLabel={t('status.mention', { defaultValue: 'Mention someone' })}><Ionicons name="at" size={25} color="#fff" /></Pressable>
      </View>

      {mentions.length ? <View style={s.mentions}>{mentions.map(person => <Pressable key={person.uid} disabled={posting} style={s.mention} onPress={() => setMentions(old => old.filter(m => m.uid !== person.uid))} accessibilityLabel={t('status.removeMention', { defaultValue: 'Remove mention: {{name}}', name: person.name })}><Text style={s.mentionText}>@{person.username || person.name} ×</Text></Pressable>)}</View> : null}

      {media ? (
        <>
          <View style={s.previewWrap}>
            {media.type === 'video' ? (
              <Video
                source={{ uri: media.uri }}
                style={s.preview}
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay
                isLooping
                isMuted
              />
            ) : (
              <Image source={{ uri: media.uri }} style={s.preview} resizeMode="contain" />
            )}
          </View>
          <View style={s.bottomBar}>
            <TextInput
              style={s.captionInput}
              value={body}
              onChangeText={v => v.length <= STATUS_BODY_MAX && setBody(v)}
              placeholder={t('status.addCaption')}
              placeholderTextColor="rgba(255,255,255,0.7)"
              multiline
            />
            <Pressable
              style={[s.postBtn, !canPost && { opacity: 0.5 }]}
              onPress={post}
              disabled={!canPost}
            >
              {posting
                ? <ActivityIndicator color="#fff" size="small" />
                : <Ionicons name="send" size={20} color="#fff" />}
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <View style={s.center}>
            <TextInput
              style={s.input}
              value={body}
              onChangeText={v => v.length <= STATUS_BODY_MAX && setBody(v)}
              placeholder={t('status.typeStatus')}
              placeholderTextColor="rgba(255,255,255,0.7)"
              multiline
              autoFocus
              textAlign="center"
            />
          </View>
          <View style={s.bottomBar}>
            <Text style={s.counter}>{body.length}/{STATUS_BODY_MAX}</Text>
            <Pressable
              style={[s.postBtn, !canPost && { opacity: 0.5 }]}
              onPress={post}
              disabled={!canPost}
            >
              {posting
                ? <ActivityIndicator color="#fff" size="small" />
                : <Ionicons name="send" size={20} color="#fff" />}
            </Pressable>
          </View>
        </>
      )}
      <Modal visible={mentionPicker} animationType="slide" onRequestClose={() => setMentionPicker(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background.app, paddingTop: insets.top, paddingBottom: insets.bottom }}>
          <View style={s.pickerHeader}><Text style={{ color: colors.text.primary, fontSize: 18, fontWeight: '700' }}>{t('status.mention', { defaultValue: 'Mention someone' })}</Text><Pressable onPress={() => setMentionPicker(false)} accessibilityLabel={t('common.close')}><Ionicons name="close" size={26} color={colors.text.primary} /></Pressable></View>
          <AppContactPicker onPick={person => {
            if (person.uid === auth.currentUser?.uid) return;
            setMentions(old => old.some(m => m.uid === person.uid) ? old : [...old, person].slice(0, 10));
            setMentionPicker(false);
          }} />
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:     { flex: 1 },
  topBar:   { paddingTop: 54, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 2 },
  topBtn:   { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' },
  center:   { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  input:    { color: '#fff', fontSize: 28, fontWeight: '700', maxHeight: 320 },
  previewWrap: { flex: 1, justifyContent: 'center' },
  preview:  { width: '100%', height: '100%' },
  bottomBar:{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 28, gap: 10 },
  counter:  { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600' },
  captionInput: { flex: 1, color: '#fff', fontSize: 15, maxHeight: 110, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11 },
  postBtn:  { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  mentions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingTop: 10 },
  mention: { borderRadius: 16, paddingVertical: 7, paddingHorizontal: 11, backgroundColor: 'rgba(0,0,0,0.4)' },
  mentionText: { color: '#fff', fontWeight: '700' },
  pickerHeader: { padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
