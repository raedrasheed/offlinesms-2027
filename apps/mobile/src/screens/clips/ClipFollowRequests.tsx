import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, ActivityIndicator, Image, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listClipFollowRequests, listClipFollowers, removeClipFollower, respondClipFollowRequest, type ClipFollowRequest } from '../../lib/clips';
import { useClipsCopy } from '../../lib/clipsCopy';
import { isClipTermsCancellation } from '../../lib/clipTerms';
import { auth } from '../../lib/firebase';

export default function ClipFollowRequests({ navigation }: any) {
  const { c, rtl } = useClipsCopy(), insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'requests' | 'followers'>('requests');
  const [rows, setRows] = useState<ClipFollowRequest[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [pending, setPending] = useState(new Set<string>());
  const epoch = useRef(0), actionGuard = useRef(new Set<string>()), loadGuard = useRef(false);
  async function load(more = false) {
    if (loadGuard.current) return;
    loadGuard.current = true; const generation = epoch.current;
    setBusy(true); setError('');
    try {
      const page = await (mode === 'requests' ? listClipFollowRequests : listClipFollowers)({ limit: 30, ...(more && cursor ? { cursor } : {}) });
      if (generation !== epoch.current) return;
      setRows(old => more ? [...old, ...page.items.filter(row => !old.some(item => item.uid === row.uid))] : page.items); setCursor(page.nextCursor);
    } catch { if (generation === epoch.current) setError(c('Could not load this list. Try again.', 'تعذّر تحميل القائمة. حاول مجددًا.')); }
    finally { if (generation === epoch.current) { setBusy(false); loadGuard.current = false; } }
  }
  useEffect(() => { epoch.current++; loadGuard.current = false; setRows([]); setCursor(null); setPending(new Set()); void load(); return () => { epoch.current++; }; }, [mode]);
  async function act(uid: string, accept: boolean) {
    if (actionGuard.current.has(uid)) return;
    actionGuard.current.add(uid); setPending(new Set(actionGuard.current)); const generation = epoch.current;
    try { if (mode === 'followers') await removeClipFollower(uid); else await respondClipFollowRequest(uid, accept); if (generation === epoch.current) setRows(old => old.filter(row => row.uid !== uid)); }
    catch (failure) { if (generation === epoch.current && !isClipTermsCancellation(failure)) setError(c('Could not update this follower. Retry.', 'تعذّر تحديث المتابع. أعد المحاولة.')); }
    finally { actionGuard.current.delete(uid); if (generation === epoch.current) setPending(new Set(actionGuard.current)); }
  }
  function remove(row: ClipFollowRequest) {
    const generation = epoch.current, uid = auth.currentUser?.uid;
    Alert.alert(c('Remove follower?', 'إزالة المتابع؟'), c('This person will lose access to clips limited to approved followers.', 'سيفقد هذا الشخص الوصول للمقاطع المخصصة للمتابعين المقبولين.'), [{ text: c('Cancel', 'إلغاء'), style: 'cancel' }, { text: c('Remove', 'إزالة'), style: 'destructive', onPress: () => { if (generation === epoch.current && uid === auth.currentUser?.uid) void act(row.uid, false); } }]);
  }
  return <View style={[s.root, { paddingTop: insets.top }]}><View style={[s.header, rtl && { flexDirection: 'row-reverse' }]}><Pressable onPress={() => navigation.goBack()} hitSlop={12}><Ionicons name={rtl ? 'arrow-forward' : 'arrow-back'} size={24} color="#172A3A" /></Pressable><Text style={s.title}>{c('Manage followers', 'إدارة المتابعين')}</Text><View style={{ width: 24 }} /></View>
    <View style={s.tabs}>{(['requests', 'followers'] as const).map(value => <Pressable key={value} onPress={() => setMode(value)} style={[s.tab, value === mode && s.active]}><Text style={value === mode ? s.activeText : s.tabText}>{value === 'requests' ? c('Requests', 'الطلبات') : c('Followers', 'المتابعون')}</Text></Pressable>)}</View>
    <Text style={s.note}>{c('A private account limits every clip to you and approved followers. Group clips also require group membership.', 'الحساب الخاص يقصر مشاهدة جميع المقاطع عليك وعلى المتابعين المقبولين. وتتطلب مقاطع المجموعة عضوية المجموعة أيضًا.')}</Text>
    {error ? <Pressable onPress={() => void load()}><Text style={s.error}>{error}</Text></Pressable> : null}
    <FlatList data={rows} keyExtractor={row => row.uid} refreshing={busy} onRefresh={() => void load()} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 20 }} onEndReached={() => { if (cursor && !busy) void load(true); }} onEndReachedThreshold={0.5}
      ListEmptyComponent={busy ? <ActivityIndicator style={{ margin: 35 }} color="#1F7BA8" /> : <Text style={s.empty}>{mode === 'requests' ? c('No pending requests.', 'لا توجد طلبات معلقة.') : c('No followers yet.', 'لا يوجد متابعون بعد.')}</Text>}
      ListFooterComponent={busy && rows.length ? <ActivityIndicator color="#1F7BA8" /> : cursor ? <Pressable onPress={() => void load(true)} style={{ alignItems: 'center', padding: 18 }}><Text style={s.activeText}>{c('Load more', 'تحميل المزيد')}</Text></Pressable> : null}
      renderItem={({ item }) => <View style={[s.row, rtl && { flexDirection: 'row-reverse' }]}><Pressable style={[s.identity, rtl && { flexDirection: 'row-reverse' }]} onPress={() => navigation.navigate('ClipProfile', { uid: item.uid })}>{item.photoURL ? <Image source={{ uri: item.photoURL }} style={s.avatar} /> : <View style={s.avatar}><Ionicons name="person-outline" size={22} color="#1F7BA8" /></View>}<View style={{ flex: 1 }}><Text style={s.name} numberOfLines={1}>{item.displayName || c('User', 'مستخدم')}</Text>{item.username ? <Text style={s.username}>@{item.username}</Text> : null}</View></Pressable>{pending.has(item.uid) ? <ActivityIndicator color="#1F7BA8" /> : mode === 'requests' ? <View style={s.actions}><Pressable onPress={() => void act(item.uid, true)} style={s.approve}><Text style={s.approveText}>{c('Accept', 'قبول')}</Text></Pressable><Pressable onPress={() => void act(item.uid, false)} hitSlop={8} accessibilityLabel={c('Decline request', 'رفض الطلب')}><Ionicons name="close" size={23} color="#718091" /></Pressable></View> : <Pressable onPress={() => remove(item)} style={s.remove}><Text style={s.tabText}>{c('Remove', 'إزالة')}</Text></Pressable>}</View>} />
  </View>;
}
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: '#fff' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 }, title: { fontSize: 21, fontWeight: '800', color: '#172A3A' }, tabs: { flexDirection: 'row', marginHorizontal: 20, backgroundColor: '#F1F5F8', borderRadius: 15, padding: 4 }, tab: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12 }, active: { backgroundColor: '#DDF0FB' }, activeText: { color: '#1F7BA8', fontWeight: '800' }, tabText: { color: '#6D7D8D', fontWeight: '700', fontSize: 12 }, note: { color: '#718091', fontSize: 12, lineHeight: 21, margin: 20, textAlign: 'center' }, row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#ECF1F5' }, identity: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }, avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E3F1FA', alignItems: 'center', justifyContent: 'center' }, name: { fontSize: 14, fontWeight: '800', color: '#172A3A' }, username: { fontSize: 12, color: '#718091', marginTop: 4 }, actions: { flexDirection: 'row', alignItems: 'center', gap: 10 }, approve: { paddingVertical: 9, paddingHorizontal: 13, borderRadius: 10, backgroundColor: '#1F7BA8' }, approveText: { color: '#fff', fontWeight: '800', fontSize: 12 }, remove: { padding: 10, borderRadius: 10, backgroundColor: '#EEF3F7' }, error: { color: '#B33449', margin: 20 }, empty: { textAlign: 'center', color: '#718091', margin: 35 } });
