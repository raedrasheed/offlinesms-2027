import { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deleteClipDraft, listClipDrafts, type ClipDraft } from '../../lib/clipDrafts';
import { useClipsCopy } from '../../lib/clipsCopy';
import { clipOperationId } from '../../lib/clipSocialModel';
import { auth } from '../../lib/firebase';
import { reconcileClipDraftStatus } from '../../lib/clipDraftStatus';

export default function ClipDrafts({ navigation }: any) {
  const { c, rtl } = useClipsCopy(), insets = useSafeAreaInsets();
  const [rows, setRows] = useState<ClipDraft[]>([]), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const epoch = useRef(0), deleting = useRef(new Set<string>());
  const opening = useRef(new Set<string>());
  async function refresh() {
    const generation = ++epoch.current;
    setBusy(true); setError('');
    try {
      const list = await listClipDrafts(); if (generation === epoch.current) setRows(list);
      // Keep a refresh bounded; opening any older draft also checks its status.
      const candidates = list.filter(row => row.status === 'processing' && row.clipId).slice(0, 12);
      for (let i = 0; i < candidates.length; i += 3) {
        if (generation !== epoch.current) break;
        const updated = await Promise.all(candidates.slice(i, i + 3).map(reconcileClipDraftStatus));
        if (generation === epoch.current) setRows(old => old.map(row => updated.find(item => item.id === row.id) ?? row));
      }
    }
    catch { if (generation === epoch.current) setError(c('Could not load drafts. Pull to retry.', 'تعذّر تحميل المسودات. اسحب لإعادة المحاولة.')); }
    finally { if (generation === epoch.current) setBusy(false); }
  }
  useFocusEffect(useCallback(() => { void refresh(); return () => { epoch.current++; }; }, []));
  function remove(row: ClipDraft) {
    const generation = epoch.current, uid = auth.currentUser?.uid;
    Alert.alert(c('Delete local draft?', 'حذف المسودة المحلية؟'), c('This removes the saved video from this device. A published clip is managed separately.', 'سيُحذف الفيديو المحفوظ من هذا الجهاز. يمكنك إدارة المقطع المنشور بشكل منفصل.'), [
      { text: c('Cancel', 'إلغاء'), style: 'cancel' }, { text: c('Delete', 'حذف'), style: 'destructive', onPress: async () => {
        if (deleting.current.has(row.id) || generation !== epoch.current || uid !== auth.currentUser?.uid || row.uid !== uid) return;
        deleting.current.add(row.id);
        try { await deleteClipDraft(row.id); if (generation === epoch.current) setRows(old => old.filter(item => item.id !== row.id)); }
        catch { if (generation === epoch.current) setError(c('Could not delete the draft.', 'تعذّر حذف المسودة.')); }
        finally { deleting.current.delete(row.id); }
      } },
    ]);
  }
  async function open(row: ClipDraft) {
    if (opening.current.has(row.id)) return;
    opening.current.add(row.id); const generation = epoch.current, uid = auth.currentUser?.uid;
    try {
      const current = await reconcileClipDraftStatus(row);
      if (generation !== epoch.current || uid !== auth.currentUser?.uid) return;
      if (current.status === 'processing' && current.clipId) navigation.navigate('ClipViewer', { clipId: current.clipId });
      else navigation.navigate('ClipComposer', { draftId: current.id, draftRequestId: clipOperationId() });
    } finally { opening.current.delete(row.id); }
  }
  const status = (row: ClipDraft) => row.status === 'processing' ? c('Uploaded · view status', 'تم الرفع · عرض الحالة') : row.status === 'failed' ? c('Upload interrupted · retry', 'توقف الرفع · أعد المحاولة') : row.status === 'uploading' || row.status === 'uploaded' ? c('Ready to retry upload', 'جاهز لإعادة الرفع') : c('Saved on this device', 'محفوظ على هذا الجهاز');
  return <View style={[s.root, { paddingTop: insets.top }]}>
    <View style={[s.header, rtl && { flexDirection: 'row-reverse' }]}><Pressable onPress={() => navigation.goBack()} hitSlop={12}><Ionicons name={rtl ? 'arrow-forward' : 'arrow-back'} size={24} color="#172A3A" /></Pressable><Text style={s.title}>{c('Drafts', 'المسودات')}</Text><Pressable onPress={() => navigation.navigate('ClipComposer', { draftId: undefined, draftRequestId: clipOperationId() })} accessibilityLabel={c('New clip', 'مقطع جديد')}><Ionicons name="add-circle-outline" size={27} color="#1F7BA8" /></Pressable></View>
    <Text style={s.note}>{c('Drafts are private to your account on this device. They are not published until you choose an audience and tap Publish.', 'المسودات خاصة بحسابك على هذا الجهاز، ولا تُنشر حتى تختار الجمهور وتضغط نشر.')}</Text>
    {error ? <Text style={s.error}>{error}</Text> : null}
    <FlatList data={rows} keyExtractor={row => row.id} refreshing={busy} onRefresh={() => void refresh()} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 24, flexGrow: 1 }}
      ListEmptyComponent={busy ? <ActivityIndicator style={{ marginTop: 40 }} color="#1F7BA8" /> : <View style={s.empty}><Ionicons name="folder-open-outline" size={54} color="#9BB9CB" /><Text style={s.emptyTitle}>{c('Your ideas start here', 'هنا تبدأ أفكارك')}</Text><Text style={s.note}>{c('Record or upload a video and save it for later.', 'سجّل أو ارفع فيديو واحفظه لوقت لاحق.')}</Text><Pressable style={s.create} onPress={() => navigation.navigate('ClipComposer', { draftId: undefined, draftRequestId: clipOperationId() })}><Text style={s.createText}>{c('Create a clip', 'إنشاء مقطع')}</Text></Pressable></View>}
      renderItem={({ item }) => <View style={[s.row, rtl && { flexDirection: 'row-reverse' }]}><Pressable style={[s.open, rtl && { flexDirection: 'row-reverse' }]} onPress={() => void open(item)}><View style={s.thumbnail}><Ionicons name={item.status === 'failed' ? 'refresh-outline' : 'videocam-outline'} size={28} color="#1F7BA8" /><Text style={s.duration}>{Math.max(0, (item.trimEndMs - item.trimStartMs) / 1000).toFixed(1)} {c('s', 'ث')}</Text></View><View style={{ flex: 1 }}><Text numberOfLines={2} style={[s.caption, { textAlign: rtl ? 'right' : 'left' }]}>{item.caption || c('Untitled clip', 'مقطع بلا عنوان')}</Text><Text style={s.status}>{status(item)}</Text><Text style={s.date}>{new Date(item.updatedAtMs).toLocaleDateString()} · {(item.sizeBytes / 1024 / 1024).toFixed(1)} MB</Text></View></Pressable><Pressable onPress={() => remove(item)} accessibilityLabel={c('Delete draft', 'حذف المسودة')} hitSlop={10}><Ionicons name="trash-outline" size={21} color="#A94754" /></Pressable></View>} />
  </View>;
}
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: '#fff' }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 }, title: { fontSize: 22, fontWeight: '800', color: '#172A3A' }, note: { color: '#6B7D8F', fontSize: 13, lineHeight: 22, paddingHorizontal: 20, marginBottom: 20, textAlign: 'center' }, row: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#EBF0F5' }, open: { flexDirection: 'row', gap: 14, alignItems: 'center', flex: 1 }, thumbnail: { backgroundColor: '#E6F3FA', width: 70, height: 87, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 7 }, duration: { color: '#1F7BA8', fontSize: 11 }, caption: { color: '#172A3A', fontSize: 15, fontWeight: '700', lineHeight: 22 }, status: { color: '#1F7BA8', fontSize: 12, marginTop: 7 }, date: { color: '#8592A0', fontSize: 11, marginTop: 5 }, error: { color: '#A94754', margin: 18 }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center' }, emptyTitle: { color: '#172A3A', fontSize: 20, fontWeight: '800', marginVertical: 15 }, create: { backgroundColor: '#1F7BA8', padding: 15, borderRadius: 15 }, createText: { color: '#fff', fontWeight: '800' } });
