import { useCallback, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../../lib/firebase';
import { useTheme } from '../../context/ThemeContext';
import { useClipsCopy } from '../../lib/clipsCopy';
import { getPost, setPostLike, deletePost, reportPost, listPostComments, addPostComment, deletePostComment, type PostItem, type PostComment } from '../../lib/posts';
import type { ClipReportReason } from '../../lib/clips';
import { appendUnique, clipOperationId } from '../../lib/clipSocialModel';
import { isClipTermsCancellation } from '../../lib/clipTerms';
import { PostCard } from '../../components/posts/PostCard';
import { postFailure, postStyles, usePostAccount } from './postScreen';

export default function PostViewer({ route, navigation }: any) {
  const { colors } = useTheme(), { c, rtl } = useClipsCopy(), s = postStyles(colors, rtl), insets = useSafeAreaInsets(), uid = usePostAccount();
  const postId = typeof route.params?.postId === 'string' ? route.params.postId : '';
  const [post, setPost] = useState<PostItem | null>(null), [comments, setComments] = useState<PostComment[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [commentsLoading, setCommentsLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [text, setText] = useState(''), [reporting, setReporting] = useState(false), [reason, setReason] = useState<ClipReportReason>('other'), [details, setDetails] = useState('');
  const epoch = useRef(0), postRequest = useRef(0), commentsRequest = useRef(0), action = useRef(false), commentsGuard = useRef(false);
  const operation = useRef<{ key: string; id: string } | null>(null), imageRequests = useRef(new Set<string>());
  const current = (generation: number) => generation === epoch.current && !!uid && auth.currentUser?.uid === uid;

  async function loadComments(more = false) {
    if (commentsGuard.current || !postId || !uid || more && !cursor) return;
    const generation = epoch.current, request = ++commentsRequest.current;
    commentsGuard.current = true; setCommentsLoading(true);
    try {
      const page = await listPostComments({ postId, ...(more && cursor ? { cursor } : {}), limit: 20 });
      if (!current(generation) || request !== commentsRequest.current) return;
      setComments(old => more ? appendUnique(old, page.items) : page.items); setCursor(page.nextCursor);
    } catch (failure) { if (current(generation) && request === commentsRequest.current) setError(postFailure(failure, c)); }
    finally { if (current(generation) && request === commentsRequest.current) { commentsGuard.current = false; setCommentsLoading(false); } }
  }
  async function refresh(loadThread = true) {
    if (!postId || !uid || auth.currentUser?.uid !== uid) return;
    const generation = epoch.current, request = ++postRequest.current;
    setLoading(true); setError('');
    try {
      const value = await getPost(postId);
      if (!current(generation) || request !== postRequest.current) return;
      setPost(value);
      if (value.status === 'published' && loadThread) void loadComments();
      if (value.status !== 'published') { setComments([]); setCursor(null); }
    } catch (failure) {
      if (current(generation) && request === postRequest.current) { setPost(null); setComments([]); setCursor(null); setError(postFailure(failure, c)); }
    } finally { if (current(generation) && request === postRequest.current) setLoading(false); }
  }
  useFocusEffect(useCallback(() => {
    epoch.current++; postRequest.current++; commentsRequest.current++; commentsGuard.current = false; action.current = false; operation.current = null; imageRequests.current.clear();
    setPost(null); setComments([]); setCursor(null); setText(''); setError(''); setReporting(false); setDetails(''); setBusy(false); setCommentsLoading(false); setLoading(!!uid && !!postId);
    if (uid && postId) void refresh();
    return () => { epoch.current++; setPost(null); setComments([]); setCursor(null); };
  }, [uid, postId]));
  function mediaExpired() {
    const key = `${post?.imageUrl}/${post?.imageExpiresAtMs}`;
    if (!post?.imageUrl || imageRequests.current.has(key)) return;
    const generation = epoch.current;
    imageRequests.current.add(key);
    void refresh(false).finally(() => { if (current(generation)) imageRequests.current.delete(key); });
  }
  async function perform(work: () => Promise<void>) {
    if (action.current || !uid || auth.currentUser?.uid !== uid) return;
    const generation = epoch.current; action.current = true; setBusy(true); setError('');
    try { await work(); }
    catch (failure) { if (current(generation) && !isClipTermsCancellation(failure)) setError(postFailure(failure, c)); }
    finally { if (current(generation)) { action.current = false; setBusy(false); } }
  }
  function like() {
    if (!post || post.status !== 'published') return;
    const generation = epoch.current, active = !post.likedByMe;
    void perform(async () => {
      const value = await setPostLike(post.id, active);
      if (current(generation)) setPost(old => old ? { ...old, likedByMe: active, likeCount: value.likeCount } : old);
    });
  }
  function remove() {
    if (!post?.canDelete || busy) return;
    const generation = epoch.current;
    Alert.alert(c('Delete post?', 'حذف المنشور؟'), c('This post and its comments will no longer be visible.', 'لن يظهر هذا المنشور وتعليقاته بعد الحذف.'), [
      { text: c('Cancel', 'إلغاء'), style: 'cancel' },
      { text: c('Delete', 'حذف'), style: 'destructive', onPress: () => { if (current(generation)) void perform(async () => {
        await deletePost(post.id); if (current(generation)) { setPost(null); setComments([]); navigation.goBack(); }
      }); } },
    ]);
  }
  function sendComment() {
    const value = text.trim();
    if (!post || post.status !== 'published' || !value || value.length > 1000 || action.current) return;
    const generation = epoch.current, key = `${post.id}/${value}`;
    if (operation.current?.key !== key) operation.current = { key, id: clipOperationId() };
    void perform(async () => {
      await addPostComment({ postId: post.id, text: value, clientId: operation.current!.id });
      if (!current(generation)) return;
      setText(''); operation.current = null;
      // Invalidate older pagination before reloading the authoritative list.
      commentsRequest.current++; commentsGuard.current = false;
      await Promise.all([refresh(false), loadComments()]);
    });
  }
  function removeComment(row: PostComment) {
    if (!row.canDelete || busy) return;
    const generation = epoch.current;
    Alert.alert(c('Delete comment?', 'حذف التعليق؟'), undefined, [
      { text: c('Cancel', 'إلغاء'), style: 'cancel' },
      { text: c('Delete', 'حذف'), style: 'destructive', onPress: () => { if (current(generation)) void perform(async () => {
        await deletePostComment(postId, row.id);
        if (!current(generation)) return;
        setComments(old => old.filter(item => item.id !== row.id));
        commentsRequest.current++; commentsGuard.current = false;
        await Promise.all([refresh(false), loadComments()]);
      }); } },
    ]);
  }
  function sendReport() {
    if (!post) return;
    const generation = epoch.current;
    void perform(async () => {
      await reportPost({ postId, reason, details: details.trim() });
      if (current(generation)) { setReporting(false); setDetails(''); Alert.alert(c('Report received', 'تم استلام البلاغ'), c('Our moderators will review it.', 'ستراجعه إدارة المحتوى.')); }
    });
  }
  return <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={[s.header, { paddingTop: insets.top + 8 }]}><Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel={c('Back', 'رجوع')} style={s.icon}><Ionicons name={rtl ? 'arrow-forward' : 'arrow-back'} size={24} color={colors.text.primary} /></Pressable>
      <Text style={s.title}>{c('Post', 'المنشور')}</Text><Pressable onPress={() => void refresh()} disabled={loading || busy} accessibilityRole="button" accessibilityLabel={c('Refresh post', 'تحديث المنشور')} style={s.icon}><Ionicons name="refresh" size={23} color={colors.text.link} /></Pressable></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 24 }}>
      {loading ? <ActivityIndicator color={colors.action.primary} style={{ margin: 12 }} /> : null}
      {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
      {!post && !loading ? <View style={s.empty}><Text style={s.body}>{c('Post unavailable', 'المنشور غير متاح')}</Text><Pressable onPress={() => void refresh()} style={s.secondary}><Text style={s.link}>{c('Try again', 'حاول مجددًا')}</Text></Pressable></View> : null}
      {post ? <>
        <PostCard post={post} onProfile={() => navigation.navigate('ClipProfile', { uid: post.ownerUid })} onImageExpired={mediaExpired} />
        <View style={s.row}>
          {post.status === 'published' ? <Pressable onPress={like} disabled={busy} accessibilityRole="button" accessibilityLabel={post.likedByMe ? c('Unlike post', 'إلغاء الإعجاب بالمنشور') : c('Like post', 'الإعجاب بالمنشور')} accessibilityState={{ selected: post.likedByMe, disabled: busy }} style={[s.secondary, s.row]}><Ionicons name={post.likedByMe ? 'heart' : 'heart-outline'} size={24} color={colors.text.link} /><Text style={s.link}>{post.likeCount}</Text></Pressable> : null}
          {post.ownerUid !== uid && post.status === 'published' ? <Pressable disabled={busy} onPress={() => setReporting(value => !value)} style={s.secondary} accessibilityLabel={c('Report post', 'الإبلاغ عن المنشور')}><Text style={s.link}>{c('Report', 'إبلاغ')}</Text></Pressable> : null}
          {post.canDelete ? <Pressable disabled={busy} onPress={remove} style={s.secondary} accessibilityLabel={c('Delete post', 'حذف المنشور')}><Text style={[s.link, { color: colors.state.error }]}>{c('Delete', 'حذف')}</Text></Pressable> : null}
        </View>
        {reporting ? <View style={s.card}><Text style={[s.body, { fontWeight: '700' }]}>{c('Reason for report', 'سبب البلاغ')}</Text>
          {([['spam', 'Spam', 'محتوى مزعج'], ['abuse', 'Harassment or abuse', 'إساءة أو مضايقة'], ['sexual', 'Sexual content', 'محتوى جنسي'], ['violence', 'Violence', 'عنف'], ['copyright', 'Copyright', 'حقوق نشر'], ['other', 'Other', 'سبب آخر']] as const).map(([value, en, ar]) => <Pressable key={value} onPress={() => setReason(value)} disabled={busy} accessibilityRole="radio" accessibilityState={{ checked: reason === value }} style={s.row}><Ionicons name={reason === value ? 'radio-button-on' : 'radio-button-off'} color={colors.text.link} size={23} /><Text style={s.body}>{c(en, ar)}</Text></Pressable>)}
          <TextInput value={details} onChangeText={setDetails} maxLength={1000} editable={!busy} multiline placeholder={c('Optional details', 'تفاصيل اختيارية')} accessibilityLabel={c('Report details', 'تفاصيل البلاغ')} placeholderTextColor={colors.text.muted} style={s.input} />
          <Pressable onPress={sendReport} disabled={busy} accessibilityLabel={c('Send report', 'إرسال البلاغ')} style={s.button}><Text style={s.buttonText}>{c('Send report', 'إرسال البلاغ')}</Text></Pressable>
        </View> : null}
        {post.status === 'published' ? <View style={{ gap: 14 }}>
          <Text style={[s.body, { fontWeight: '800' }]}>{c('Comments', 'التعليقات')} ({post.commentCount})</Text>
          {comments.map(row => <View key={row.id} style={[s.card, s.row]}>
            {row.author.photoURL ? <Image source={{ uri: row.author.photoURL }} style={{ width: 32, height: 32, borderRadius: 16 }} /> : <Ionicons name="person-circle-outline" size={32} color={colors.text.muted} />}
            <View style={{ flex: 1 }}><Text style={[s.body, { fontWeight: '700' }]}>{row.author.displayName || c('User', 'مستخدم')}</Text><Text style={s.body}>{row.text}</Text></View>
            {row.canDelete ? <Pressable disabled={busy} onPress={() => removeComment(row)} accessibilityLabel={c('Delete comment', 'حذف التعليق')} style={s.icon}><Ionicons name="trash-outline" size={20} color={colors.state.error} /></Pressable> : null}
          </View>)}
          {commentsLoading ? <ActivityIndicator color={colors.action.primary} /> : !comments.length ? <Text style={s.muted}>{c('No comments yet. Start the conversation.', 'لا توجد تعليقات بعد. ابدأ الحوار.')}</Text> : null}
          {cursor ? <Pressable disabled={commentsLoading} onPress={() => void loadComments(true)} style={s.secondary}><Text style={s.link}>{c('More comments', 'المزيد من التعليقات')}</Text></Pressable> : null}
          <View style={s.row}><TextInput value={text} onChangeText={setText} editable={!busy} maxLength={1000} multiline placeholder={c('Write a comment…', 'اكتب تعليقًا…')} accessibilityLabel={c('Comment text', 'نص التعليق')} placeholderTextColor={colors.text.muted} style={[s.input, { flex: 1, maxHeight: 150 }]} />
            <Pressable onPress={sendComment} disabled={busy || !text.trim()} accessibilityLabel={c('Send comment', 'إرسال التعليق')} style={[s.button, { opacity: busy || !text.trim() ? .5 : 1 }]}><Ionicons name={rtl ? 'arrow-back' : 'arrow-forward'} size={23} color={colors.action.primaryFg} /></Pressable></View>
        </View> : null}
        {busy ? <ActivityIndicator color={colors.action.primary} /> : null}
      </> : null}
    </ScrollView>
  </KeyboardAvoidingView>;
}
