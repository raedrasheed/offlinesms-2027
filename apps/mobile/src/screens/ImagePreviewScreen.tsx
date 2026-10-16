// Phase 23 — image preview + caption (Attach → Photos → Preview → Send).
//
// Dark full-screen preview of the picked image with a caption field and send
// button. Sending writes an optimistic local message via the outbox and returns
// to the conversation, where the upload progress renders inline.

import { useState } from 'react';
import {
  View, Text, Image, TextInput, Pressable, StyleSheet, Alert, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth } from '../lib/firebase';
import { openLocalDb, queueSendAttachment } from '../localdb';
import { validateMediaMessage } from '../media/mediaValidation';
import { MIME_EXTENSIONS } from '../media/attachmentModel';
import { isRTL } from '../i18n';

export default function ImagePreviewScreen({ route, navigation }: any) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { conversationId, uri, width, height, mimeType, sizeBytes, replyTo } = route.params as {
    conversationId: string; uri: string; width?: number; height?: number;
    mimeType: string; sizeBytes: number; replyTo?: any;
  };
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const me = auth.currentUser?.uid ?? '';

  async function send() {
    if (busy) return;
    // The picker doesn't always report a size; treat unknown (0) as valid here
    // and let the upload step compute the authoritative size from the file.
    const check = validateMediaMessage({ mediaType: 'image', mimeType, sizeBytes: sizeBytes || 1 });
    if (!check.ok) {
      Alert.alert(t('media.uploadFailed'), check.reason === 'too-large' ? 'Image is too large (max 10 MB).' : 'This image type is not supported.');
      return;
    }
    setBusy(true);
    try {
      await openLocalDb(me);
      await queueSendAttachment({
        mediaType:'image',
        fileName:`photo.${MIME_EXTENSIONS[mimeType] ?? 'jpg'}`,
        conversationId,
        senderUid: me,
        localUri: uri,
        mimeType,
        sizeBytes,
        width: width ?? null,
        height: height ?? null,
        caption: caption.trim() || null,
        replyTo: replyTo ?? null,
      });
      navigation.goBack();
    } catch (e: any) {
      setBusy(false);
      Alert.alert(t('media.uploadFailed'), e?.message ?? 'try-again');
    }
  }

  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <Text style={s.headerTitle}>{t('media.preview')}</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={s.previewWrap}>
        <Image source={{ uri }} style={s.preview} resizeMode="contain" />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.composer, { paddingBottom: insets.bottom + 10 }]}>
          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder={t('media.addCaption')}
            placeholderTextColor="rgba(255,255,255,0.5)"
            style={s.input}
            multiline
            maxLength={1000}
            textAlign={isRTL ? 'right' : 'left'}
            accessibilityLabel={t('media.addCaption')}
          />
          <Pressable
            style={[s.sendBtn, busy && { opacity: 0.5 }]}
            onPress={send}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('media.sendPhoto')}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={20} color="#fff" />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#0A0F1C' },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  previewWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  preview:     { width: '100%', height: '100%' },
  composer:    { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 14, paddingTop: 10 },
  input:       { flex: 1, color: '#fff', fontSize: 15, maxHeight: 120, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 22 },
  sendBtn:     { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1F7BA8', alignItems: 'center', justifyContent: 'center' },
});
