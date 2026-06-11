// StatusComposer — WhatsApp-style text status: full-screen colored canvas,
// centered multiline input, palette cycler, post button. Posting goes
// through the createStatus callable (24h expiry is server-set).

import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Alert,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { createTextStatus, STATUS_BG_COLORS, STATUS_BODY_MAX } from '../lib/statuses';

export default function StatusComposer({ navigation }: any) {
  const { t } = useTranslation();
  const [body, setBody] = useState('');
  const [colorIdx, setColorIdx] = useState(0);
  const [posting, setPosting] = useState(false);

  const bg = STATUS_BG_COLORS[colorIdx];
  const canPost = body.trim().length > 0 && !posting;

  async function post() {
    if (!canPost) return;
    setPosting(true);
    try {
      await createTextStatus({ body: body.trim(), backgroundColor: bg });
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
      <View style={s.topBar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={s.topBtn}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <Pressable
          onPress={() => setColorIdx(i => (i + 1) % STATUS_BG_COLORS.length)}
          hitSlop={10}
          style={s.topBtn}
        >
          <Ionicons name="color-palette-outline" size={24} color="#fff" />
        </Pressable>
      </View>

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
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:     { flex: 1 },
  topBar:   { paddingTop: 54, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topBtn:   { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' },
  center:   { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  input:    { color: '#fff', fontSize: 28, fontWeight: '700', maxHeight: 320 },
  bottomBar:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 28 },
  counter:  { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600' },
  postBtn:  { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
});
