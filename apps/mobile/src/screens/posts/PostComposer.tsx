import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../../lib/firebase';
import { useTheme } from '../../context/ThemeContext';
import { useClipsCopy } from '../../lib/clipsCopy';
import { createPost, type PostAudience } from '../../lib/posts';
import { pickPostImage, removePostImage, type PostImageDraft } from '../../lib/postImage';
import { clipOperationId } from '../../lib/clipSocialModel';
import { isClipTermsCancellation } from '../../lib/clipTerms';
import { postFailure, postStyles, usePostAccount } from './postScreen';

export default function PostComposer({ navigation }: any) {
  const { colors } = useTheme(), { c, rtl } = useClipsCopy(), s = postStyles(colors, rtl), insets = useSafeAreaInsets(), uid = usePostAccount();
  const [body, setBody] = useState(''), [audience, setAudience] = useState<PostAudience | null>(null), [image, setImage] = useState<PostImageDraft | null>(null);
  const [busy, setBusy] = useState(false), [picking, setPicking] = useState(false), [error, setError] = useState('');
  const epoch = useRef(0), sending = useRef(false), importing = useRef(false), imageRef = useRef<PostImageDraft | null>(null);
  const operation = useRef<{ key: string; id: string } | null>(null);
  const current = (generation: number) => generation === epoch.current && !!uid && auth.currentUser?.uid === uid;
  useEffect(() => {
    epoch.current++; setBody(''); setAudience(null); setImage(null); setBusy(false); setPicking(false); setError(''); operation.current = null; sending.current = false; importing.current = false;
    return () => { epoch.current++; if (imageRef.current) void removePostImage(imageRef.current.uri); imageRef.current = null; };
  }, [uid]);
  useEffect(() => navigation.addListener?.('beforeRemove', (event: any) => {
    if (sending.current) { event.preventDefault(); setError(c('Wait for publishing to finish.', 'انتظر حتى تنتهي عملية النشر.')); }
  }), [navigation, uid]);
  async function choose() {
    if (importing.current || sending.current || !uid) return;
    const generation = epoch.current; importing.current = true; setPicking(true); setError('');
    try {
      const selected = await pickPostImage();
      if (!selected) return;
      if (!current(generation)) { void removePostImage(selected.uri); return; }
      if (imageRef.current) void removePostImage(imageRef.current.uri);
      imageRef.current = selected; setImage(selected);
    } catch { if (current(generation)) setError(c('Could not add this image. Choose a smaller photo and try again.', 'تعذّرت إضافة الصورة. اختر صورة أصغر وحاول مجددًا.')); }
    finally { if (current(generation)) { importing.current = false; setPicking(false); } }
  }
  function clearImage() {
    if (sending.current || importing.current) return;
    if (imageRef.current) void removePostImage(imageRef.current.uri);
    imageRef.current = null; setImage(null);
  }
  async function publish() {
    if (sending.current || importing.current || !uid || auth.currentUser?.uid !== uid || !audience || (!body.trim() && !image) || body.length > 2200) return;
    const generation = epoch.current, key = JSON.stringify([body.trim(), audience, image?.uri]);
    if (operation.current?.key !== key) operation.current = { key, id: clipOperationId() };
    sending.current = true; setBusy(true); setError('');
    try {
      const post = await createPost({ body: body.trim(), audience, clientId: operation.current.id, ...(image ? { imageBase64: image.base64 } : {}) });
      if (!current(generation)) return;
      sending.current = false; setBusy(false); navigation.replace('PostViewer', { postId: post.id });
    } catch (failure) { if (current(generation) && !isClipTermsCancellation(failure)) setError(`${postFailure(failure, c)} ${c('Your text and image are kept here. Retry will not duplicate this post.', 'بقي النص والصورة هنا. إعادة المحاولة لن تكرر هذا المنشور.')}`); }
    finally { if (current(generation)) { sending.current = false; setBusy(false); } }
  }
  const disabled = busy || picking || !uid || !audience || body.length > 2200 || (!body.trim() && !image);
  return <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={[s.header, { paddingTop: insets.top + 8 }]}><Pressable disabled={busy} onPress={() => navigation.goBack()} accessibilityLabel={c('Back', 'رجوع')} style={s.icon}><Ionicons name={rtl ? 'arrow-forward' : 'arrow-back'} size={24} color={colors.text.primary} /></Pressable><Text style={s.title}>{c('Create post', 'إنشاء منشور')}</Text></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, gap: 18, paddingBottom: insets.bottom + 28 }}>
      <TextInput accessibilityLabel={c('Post text', 'نص المنشور')} value={body} onChangeText={setBody} editable={!busy} multiline maxLength={2200}
        placeholder={c('What would you like to share?', 'ماذا تريد أن تشارك؟')} placeholderTextColor={colors.text.muted} style={[s.input, { minHeight: 150, textAlignVertical: 'top' }]} />
      <Text style={s.muted}>{body.length}/2200</Text>
      {image ? <View style={{ gap: 10 }}><Image source={{ uri: image.uri }} resizeMode="contain" style={{ width: '100%', height: 240, borderRadius: 14, backgroundColor: colors.background.subtle }} />
        <Pressable disabled={busy || picking} onPress={clearImage} accessibilityLabel={c('Remove image', 'إزالة الصورة')} style={s.secondary}><Text style={s.link}>{c('Remove image', 'إزالة الصورة')}</Text></Pressable></View> : null}
      <Pressable disabled={busy || picking} onPress={() => void choose()} accessibilityLabel={c('Add photo', 'إضافة صورة')} style={[s.secondary, s.row]}>
        {picking ? <ActivityIndicator color={colors.action.primary} /> : <Ionicons name="image-outline" size={23} color={colors.text.link} />}<Text style={s.link}>{image ? c('Replace photo', 'استبدال الصورة') : c('Add photo', 'إضافة صورة')}</Text>
      </Pressable>
      <Text style={[s.body, { fontWeight: '700' }]}>{c('Who can see this post?', 'من يمكنه مشاهدة المنشور؟')}</Text>
      <Text style={s.muted}>{c('Choose before publishing. Private profiles are visible only to approved followers.', 'اختر قبل النشر. تظهر منشورات الحساب الخاص للمتابعين المقبولين فقط.')}</Text>
      {([['public', 'Public', 'عام'], ['followers', 'Approved followers', 'المتابعون المقبولون'], ['private', 'Only me', 'أنا فقط']] as const).map(([value, en, ar]) => <Pressable key={value} disabled={busy} accessibilityRole="radio" accessibilityLabel={c(en, ar)} accessibilityState={{ checked: audience === value }} onPress={() => setAudience(value)} style={[s.secondary, s.row]}><Ionicons name={audience === value ? 'radio-button-on' : 'radio-button-off'} size={23} color={colors.text.link} /><Text style={s.body}>{c(en, ar)}</Text></Pressable>)}
      {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
      <Pressable disabled={!!disabled} onPress={() => void publish()} accessibilityLabel={c('Publish post', 'نشر المنشور')} style={[s.button, { opacity: disabled ? .5 : 1 }]}>{busy ? <ActivityIndicator color={colors.action.primaryFg} /> : <Text style={s.buttonText}>{c('Publish post', 'نشر المنشور')}</Text>}</Pressable>
    </ScrollView>
  </KeyboardAvoidingView>;
}
