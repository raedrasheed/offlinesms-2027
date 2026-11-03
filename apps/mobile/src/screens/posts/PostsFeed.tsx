import { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../../lib/firebase';
import { useTheme } from '../../context/ThemeContext';
import { useClipsCopy } from '../../lib/clipsCopy';
import { getPost, listPosts, type PostItem } from '../../lib/posts';
import { appendUnique } from '../../lib/clipSocialModel';
import { PostCard } from '../../components/posts/PostCard';
import { postFailure, postStyles, usePostAccount } from './postScreen';

export default function PostsFeed({ navigation }: any) {
  const { colors } = useTheme(), { c, rtl } = useClipsCopy(), s = postStyles(colors, rtl), insets = useSafeAreaInsets();
  const uid = usePostAccount();
  const [mode, setMode] = useState<'feed' | 'mine'>('feed');
  const [rows, setRows] = useState<PostItem[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const epoch = useRef(0), loading = useRef(false), imageRequests = useRef(new Set<string>());
  const current = (generation: number) => generation === epoch.current && !!uid && auth.currentUser?.uid === uid;
  async function load(more = false) {
    if (loading.current || !uid || auth.currentUser?.uid !== uid || more && !cursor) return;
    const generation = epoch.current;
    loading.current = true; setBusy(true); setError('');
    if (!more) imageRequests.current.clear();
    try {
      const page = await listPosts({ mode, ...(more && cursor ? { cursor } : {}), limit: 20 });
      if (!current(generation)) return;
      setRows(old => more ? appendUnique(old, page.items) : page.items); setCursor(page.nextCursor);
    } catch (failure) { if (current(generation)) { setError(postFailure(failure, c)); if (!more) { setRows([]); setCursor(null); } } }
    finally { if (current(generation)) { loading.current = false; setBusy(false); } }
  }
  useFocusEffect(useCallback(() => {
    epoch.current++; loading.current = false; imageRequests.current.clear(); setRows([]); setCursor(null); setError(''); setBusy(false);
    if (uid) void load();
    return () => { epoch.current++; loading.current = false; setRows([]); setCursor(null); };
  }, [uid, mode]));
  async function refreshImage(id: string) {
    const row = rows.find(item => item.id === id), key = `${id}/${row?.imageUrl ?? ''}/${row?.imageExpiresAtMs ?? 0}`;
    if (!row?.imageUrl || imageRequests.current.has(key) || !uid) return;
    const generation = epoch.current;
    imageRequests.current.add(key);
    try {
      const value = await getPost(id);
      if (current(generation)) setRows(old => old.map(item => item.id === id ? value : item));
    } catch { if (current(generation)) setRows(old => old.filter(item => item.id !== id)); }
    finally { if (current(generation)) imageRequests.current.delete(key); }
  }
  return <View style={s.root}>
    <View style={[s.header, { paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel={c('Back', 'رجوع')} style={s.icon}><Ionicons name={rtl ? 'arrow-forward' : 'arrow-back'} size={24} color={colors.text.primary} /></Pressable>
      <Text style={s.title}>{c('Posts', 'المنشورات')}</Text>
      <Pressable disabled={!uid} onPress={() => navigation.navigate('PostComposer')} accessibilityRole="button" accessibilityLabel={c('Create post', 'إنشاء منشور')} style={s.icon}><Ionicons name="add-circle-outline" size={28} color={colors.text.link} /></Pressable>
    </View>
    <View style={[s.row, { padding: 12 }]}>{(['feed', 'mine'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: mode === value }} onPress={() => setMode(value)}
      style={[s.secondary, { flex: 1 }, mode === value && { borderWidth: 1, borderColor: colors.border.focus }]}><Text style={s.link}>{value === 'feed' ? c('For you', 'لك') : c('My posts', 'منشوراتي')}</Text></Pressable>)}</View>
    {error ? <View style={{ paddingHorizontal: 16 }}><Text accessibilityRole="alert" style={s.error}>{error}</Text><Pressable onPress={() => void load()} disabled={busy} style={s.secondary}><Text style={s.link}>{c('Try again', 'حاول مجددًا')}</Text></Pressable></View> : null}
    <FlatList data={rows} keyExtractor={item => item.id} refreshing={busy && rows.length === 0} onRefresh={() => void load()}
      contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: insets.bottom + 24 }}
      onEndReached={() => { if (cursor) void load(true); }} onEndReachedThreshold={.4}
      renderItem={({ item }) => <PostCard post={item} onOpen={() => navigation.navigate('PostViewer', { postId: item.id })}
        onProfile={() => navigation.navigate('ClipProfile', { uid: item.ownerUid })} onImageExpired={id => void refreshImage(id)} />}
      ListEmptyComponent={!busy && !error ? <View style={s.empty}><Ionicons name="newspaper-outline" size={40} color={colors.text.muted} /><Text style={s.body}>{mode === 'mine' ? c('Your posts will appear here.', 'ستظهر منشوراتك هنا.') : c('No posts yet.', 'لا توجد منشورات بعد.')}</Text></View> : null}
      ListFooterComponent={busy ? <ActivityIndicator color={colors.action.primary} style={{ margin: 20 }} /> : cursor ? <Pressable onPress={() => void load(true)} style={s.secondary}><Text style={s.link}>{c('Load more', 'تحميل المزيد')}</Text></Pressable> : null} />
  </View>;
}
