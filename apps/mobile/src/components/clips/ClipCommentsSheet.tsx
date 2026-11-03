import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, ActivityIndicator, Image, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../../lib/firebase';
import { isClipTermsCancellation } from '../../lib/clipTerms';
import { addClipComment, deleteClipComment, listClipComments, reportClip, setClipCommentLike, type ClipItem, type ClipComment } from '../../lib/clips';
import { useClipsCopy } from '../../lib/clipsCopy';
import { appendUnique, clipOperationId } from '../../lib/clipSocialModel';
import ClipSheet from './ClipSheet';

type Thread = { items: ClipComment[]; cursor: string | null; busy: boolean };
export default function ClipCommentsSheet({ visible, clip, onClose, onCountChange }: {
  visible: boolean; clip: ClipItem; onClose: () => void; onCountChange?: (count: number) => void;
}) {
  const { c, rtl } = useClipsCopy();
  const [rows, setRows] = useState<ClipComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [busy, setBusy] = useState(false), [sending, setSending] = useState(false);
  const [text, setText] = useState(''), [error, setError] = useState('');
  const [reply, setReply] = useState<ClipComment | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const epoch = useRef(0), count = useRef(clip.commentCount);
  const sendGuard = useRef(false), pendingIds = useRef(new Set<string>());
  const operation = useRef<{ key: string; id: string } | null>(null);

  async function load(more = false, parentId?: string) {
    const generation = epoch.current;
    const next = parentId ? threads[parentId]?.cursor : cursor;
    if (parentId) setThreads(old => ({ ...old, [parentId]: { items: old[parentId]?.items ?? [], cursor: old[parentId]?.cursor ?? null, busy: true } }));
    else setBusy(true);
    setError('');
    try {
      const page = await listClipComments({ clipId: clip.id, ...(parentId ? { parentId } : {}), ...(more && next ? { cursor: next } : {}), limit: 20 });
      if (generation !== epoch.current) return;
      if (parentId) setThreads(old => ({ ...old, [parentId]: { items: more ? appendUnique(old[parentId]?.items ?? [], page.items) : page.items, cursor: page.nextCursor, busy: false } }));
      else { setRows(old => more ? appendUnique(old, page.items) : page.items); setCursor(page.nextCursor); }
    } catch {
      if (generation === epoch.current) setError(c('Could not load comments. Try again.', 'تعذّر تحميل التعليقات. حاول مجددًا.'));
    } finally {
      if (generation === epoch.current) {
        if (parentId) setThreads(old => ({ ...old, [parentId]: { ...old[parentId], items: old[parentId]?.items ?? [], cursor: old[parentId]?.cursor ?? null, busy: false } }));
        else setBusy(false);
      }
    }
  }
  useEffect(() => {
    epoch.current++; setRows([]); setCursor(null); setThreads({}); setReply(null); setText(''); setError('');
    setSending(false); sendGuard.current = false; operation.current = null; count.current = clip.commentCount;
    if (visible) void load();
    return () => { epoch.current++; };
  }, [visible, clip.id, auth.currentUser?.uid]);

  function patch(id: string, change: Partial<ClipComment>) {
    setRows(old => old.map(row => row.id === id ? { ...row, ...change } : row));
    setThreads(old => Object.fromEntries(Object.entries(old).map(([key, thread]) => [key, { ...thread, items: thread.items.map(row => row.id === id ? { ...row, ...change } : row) }])));
  }
  async function like(row: ClipComment) {
    if (pendingIds.current.has(row.id) || row.deleted) return;
    const generation = epoch.current;
    pendingIds.current.add(row.id); setPending(new Set(pendingIds.current));
    try {
      const out = await setClipCommentLike(clip.id, row.id, !row.likedByMe);
      if (generation === epoch.current) patch(row.id, { likedByMe: !row.likedByMe, likeCount: out.likeCount });
    } catch (failure) { if (generation === epoch.current && !isClipTermsCancellation(failure)) setError(c('Could not update the comment.', 'تعذّر تحديث التعليق.')); }
    finally { pendingIds.current.delete(row.id); if (generation === epoch.current) setPending(new Set(pendingIds.current)); }
  }
  async function remove(row: ClipComment) {
    if (pendingIds.current.has(row.id) || row.deleted) return;
    pendingIds.current.add(row.id); setPending(new Set(pendingIds.current));
    const generation = epoch.current;
    try {
      await deleteClipComment(clip.id, row.id);
      if (generation !== epoch.current) return;
      patch(row.id, { deleted: true, text: '', likedByMe: false, likeCount: 0 });
      count.current = Math.max(0, count.current - 1); onCountChange?.(count.current);
    } catch (failure) { if (generation === epoch.current && !isClipTermsCancellation(failure)) setError(c('Could not delete the comment.', 'تعذّر حذف التعليق.')); }
    finally { pendingIds.current.delete(row.id); if (generation === epoch.current) setPending(new Set(pendingIds.current)); }
  }
  function menu(row: ClipComment) {
    const generation = epoch.current;
    const canDelete = (row as ClipComment & { canDelete?: boolean }).canDelete ?? (row.authorUid === auth.currentUser?.uid || clip.ownerUid === auth.currentUser?.uid);
    Alert.alert(c('Comment', 'التعليق'), undefined, [
      { text: c('Cancel', 'إلغاء'), style: 'cancel' },
      ...(canDelete ? [{ text: c('Delete', 'حذف'), style: 'destructive' as const, onPress: () => { if (generation === epoch.current) void remove(row); } }] : []),
      { text: c('Report abuse', 'الإبلاغ عن إساءة'), onPress: () => {
        if (generation !== epoch.current) return;
        void reportClip({ clipId: clip.id, commentId: row.id, reason: 'abuse' }).then(() => { if (generation === epoch.current) Alert.alert(c('Report received', 'تم استلام البلاغ')); })
          .catch(failure => { if (generation === epoch.current && !isClipTermsCancellation(failure)) setError(c('Could not send the report.', 'تعذّر إرسال البلاغ.')); });
      } },
    ]);
  }
  async function send() {
    const value = text.trim();
    if (!value || sendGuard.current || !clip.allowComments) return;
    const generation = epoch.current, parentId = reply ? reply.parentId ?? reply.id : undefined;
    const key = JSON.stringify([clip.id, value, parentId]);
    if (operation.current?.key !== key) operation.current = { key, id: clipOperationId() };
    sendGuard.current = true; setSending(true); setError('');
    try {
      await addClipComment({ clipId: clip.id, text: value, ...(parentId ? { parentId } : {}), clientId: operation.current.id });
      if (generation !== epoch.current) return;
      setText(''); setReply(null); operation.current = null;
      count.current++; onCountChange?.(count.current);
      if (parentId) { setRows(old => old.map(row => row.id === parentId ? { ...row, replyCount: row.replyCount + 1 } : row)); await load(false, parentId); }
      else await load();
    } catch (failure) { if (generation === epoch.current && !isClipTermsCancellation(failure)) setError(c('Comment was not confirmed. Retry sends it only once.', 'لم يتأكد إرسال التعليق. يمكنك المحاولة مجددًا دون تكراره.')); }
    finally { if (generation === epoch.current) { sendGuard.current = false; setSending(false); } }
  }
  function rowView(row: ClipComment, nested = false) {
    return <View key={row.id} style={[s.comment, nested && { marginStart: 38 }, rtl && { flexDirection: 'row-reverse' }]}>
      {row.author.photoURL ? <Image source={{ uri: row.author.photoURL }} style={s.avatar} /> : <View style={s.avatar}><Text style={s.initial}>{row.author.displayName?.slice(0, 1) || '•'}</Text></View>}
      <View style={{ flex: 1 }}>
        <View style={[s.row, rtl && { flexDirection: 'row-reverse' }]}>
          <Text style={s.name}>{row.author.displayName || c('User', 'مستخدم')}</Text>
          {row.authorUid === clip.ownerUid ? <Text style={s.creator}>{c('Creator', 'الناشر')}</Text> : null}
          {!row.deleted ? <Pressable onPress={() => menu(row)} accessibilityLabel={c('Comment actions', 'خيارات التعليق')} hitSlop={10}><Ionicons name="ellipsis-horizontal" size={17} color="#6D7885" /></Pressable> : null}
        </View>
        <Text style={[s.body, { textAlign: rtl ? 'right' : 'left' }, row.deleted && { color: '#82909F', fontStyle: 'italic' }]}>{row.deleted ? c('Comment deleted', 'حُذف التعليق') : row.text}</Text>
        {!row.deleted && clip.allowComments ? <Pressable onPress={() => setReply(row)} style={s.reply}><Text style={s.link}>{c('Reply', 'رد')}</Text></Pressable> : null}
        {!nested && row.replyCount > 0 ? <Pressable disabled={threads[row.id]?.busy} onPress={() => void load(false, row.id)}><Text style={s.muted}>{c(`View ${row.replyCount} replies`, `عرض ${row.replyCount} ردود`)}</Text></Pressable> : null}
      </View>
      {!row.deleted ? <Pressable disabled={pending.has(row.id)} onPress={() => void like(row)} style={s.like} accessibilityLabel={c('Like comment', 'إعجاب بالتعليق')}><Ionicons name={row.likedByMe ? 'heart' : 'heart-outline'} size={19} color={row.likedByMe ? '#E34569' : '#647180'} /><Text style={s.muted}>{row.likeCount}</Text></Pressable> : null}
    </View>;
  }
  return <ClipSheet visible={visible} title={c('Comments', 'التعليقات')} onClose={onClose}>
    {error ? <View style={s.error}><Text style={s.errorText}>{error}</Text><Pressable onPress={() => void load()}><Text style={s.link}>{c('Reload', 'إعادة تحميل')}</Text></Pressable></View> : null}
    <ScrollView style={s.list} keyboardShouldPersistTaps="handled">
      {busy && !rows.length ? <ActivityIndicator style={s.space} color="#1F7BA8" /> : null}
      {!busy && !rows.length && !error ? <Text style={[s.muted, s.empty]}>{c('Start the conversation.', 'كن أول من يضيف تعليقًا.')}</Text> : null}
      {rows.map(row => <View key={row.id}>{rowView(row)}{threads[row.id]?.items.map(child => rowView(child, true))}{threads[row.id]?.busy ? <ActivityIndicator color="#1F7BA8" /> : null}{threads[row.id]?.cursor && !threads[row.id]?.busy ? <Pressable onPress={() => void load(true, row.id)} style={s.more}><Text style={s.link}>{c('More replies', 'المزيد من الردود')}</Text></Pressable> : null}</View>)}
      {cursor ? <Pressable disabled={busy} onPress={() => void load(true)} style={s.more}><Text style={s.link}>{busy ? c('Loading…', 'جارٍ التحميل…') : c('More comments', 'المزيد من التعليقات')}</Text></Pressable> : null}
    </ScrollView>
    {reply ? <View style={s.replying}><Text style={s.muted}>{c('Replying to ', 'رد على ')}{reply.author.displayName}</Text><Pressable onPress={() => setReply(null)}><Ionicons name="close" size={18} color="#647180" /></Pressable></View> : null}
    {clip.allowComments ? <View style={[s.composer, rtl && { flexDirection: 'row-reverse' }]}><TextInput style={[s.input, { textAlign: rtl ? 'right' : 'left' }]} value={text} onChangeText={setText} maxLength={1000} multiline editable={!sending} placeholder={c('Add a comment…', 'أضف تعليقًا…')} placeholderTextColor="#7B8998" accessibilityLabel={c('Comment text', 'نص التعليق')} /><Pressable disabled={sending || !text.trim()} onPress={() => void send()} style={[s.send, (!text.trim() || sending) && { opacity: 0.5 }]} accessibilityLabel={c('Send comment', 'إرسال التعليق')}>{sending ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={20} color="#fff" />}</Pressable></View> : <Text style={[s.muted, s.empty]}>{c('Comments are turned off for this clip.', 'التعليقات مغلقة لهذا المقطع.')}</Text>}
  </ClipSheet>;
}
const s = StyleSheet.create({
  list: { maxHeight: 420 }, row: { flexDirection: 'row', gap: 6, alignItems: 'center' }, comment: { flexDirection: 'row', gap: 10, paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E7EDF2' },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#E3F1FA', alignItems: 'center', justifyContent: 'center' }, initial: { color: '#1F7BA8', fontWeight: '800' }, name: { fontWeight: '800', color: '#182330', flex: 1 }, body: { fontSize: 15, lineHeight: 23, color: '#273543', marginTop: 4 }, creator: { color: '#1F7BA8', fontSize: 10, backgroundColor: '#E3F1FA', borderRadius: 5, padding: 3 },
  muted: { color: '#708091', fontSize: 12 }, link: { color: '#1F7BA8', fontWeight: '700', fontSize: 13 }, reply: { alignSelf: 'flex-start', marginVertical: 7 }, like: { alignItems: 'center', gap: 5, padding: 3 }, more: { paddingVertical: 14, alignItems: 'center' }, space: { margin: 25 }, empty: { textAlign: 'center', marginVertical: 25 },
  composer: { flexDirection: 'row', gap: 9, paddingTop: 13, alignItems: 'flex-end' }, input: { flex: 1, borderRadius: 22, paddingVertical: 11, paddingHorizontal: 15, color: '#182330', backgroundColor: '#F0F4F7', maxHeight: 110, minHeight: 44 }, send: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1F7BA8', alignItems: 'center', justifyContent: 'center' }, replying: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10 }, error: { padding: 12, borderRadius: 10, backgroundColor: '#FFF1F1', gap: 8 }, errorText: { color: '#9B2935', fontSize: 13 },
});
