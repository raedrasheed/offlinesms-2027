import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../lib/firebase';
import { useTheme } from '../context/ThemeContext';
import { useClipsCopy } from '../lib/clipsCopy';
import { listSocialActivity, markSocialActivityRead, socialActivityDestination, type SocialActivityItem } from '../lib/socialActivity';

export default function SocialActivity({ navigation }: any) {
  const { c, rtl } = useClipsCopy(), { colors } = useTheme(), insets = useSafeAreaInsets();
  const [items, setItems] = useState<SocialActivityItem[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const epoch = useRef(0), loading = useRef(false);
  const uid = auth.currentUser?.uid;
  async function load(more = false) {
    if (loading.current || !uid) return;
    loading.current = true; const generation = epoch.current; setBusy(true); setError('');
    try {
      const page = await listSocialActivity({ limit: 30, ...(more && cursor ? { cursor } : {}) });
      if (generation !== epoch.current || uid !== auth.currentUser?.uid) return;
      setItems(old => more ? [...old, ...page.items.filter(row => !old.some(item => item.id === row.id))] : page.items);
      setCursor(page.nextCursor);
    } catch { if (generation === epoch.current) setError(c('Could not load notifications. Try again.', 'تعذّر تحميل الإشعارات. حاول مجددًا.')); }
    finally { if (generation === epoch.current) { loading.current = false; setBusy(false); } }
  }
  useFocusEffect(useCallback(() => {
    epoch.current++; loading.current = false; setItems([]); setCursor(null); void load();
    return () => { epoch.current++; };
  }, [uid]));
  function label(item: SocialActivityItem) {
    switch (item.kind) {
      case 'like': return c('liked your clip', 'أعجب بمقطعك');
      case 'comment': return c('commented on your clip', 'علّق على مقطعك');
      case 'reply': return c('replied to your comment', 'ردّ على تعليقك');
      case 'commentLike': return c('liked your comment', 'أعجب بتعليقك');
      case 'follow': return item.followStatus === 'pending' ? c('requested to follow you', 'طلب متابعتك') : c('started following you', 'بدأ متابعتك');
      case 'followAccepted': return c('accepted your follow request', 'قبل طلب متابعتك');
      case 'statusMention': return c('mentioned you in a story', 'أشار إليك في حالة');
      case 'statusLike': return c('liked your story', 'أعجب بحالتك');
      case 'statusReply': return c('replied to your story', 'ردّ على حالتك');
      case 'postLike': return c('liked your post', 'أعجب بمنشورك');
      case 'postComment': return c('commented on your post', 'علّق على منشورك');
    }
  }
  async function open(item: SocialActivityItem) {
    const generation = epoch.current;
    try {
      await markSocialActivityRead([item.id]);
      if (generation !== epoch.current || uid !== auth.currentUser?.uid) return;
      setItems(old => old.map(row => row.id === item.id ? { ...row, unread: false } : row));
      const target = socialActivityDestination(item); navigation.navigate(target.screen, target.params);
    } catch { if (generation === epoch.current) setError(c('Could not open this notification. Try again.', 'تعذّر فتح الإشعار. حاول مجددًا.')); }
  }
  return <View style={[s.root, { paddingTop: insets.top, backgroundColor: colors.background.app }]}>
    <View style={[s.header, rtl && s.rtl, { borderColor: colors.border.subtle }]}>
      <Pressable onPress={() => navigation.goBack()} accessibilityLabel={c('Back', 'رجوع')} hitSlop={12}><Ionicons name={rtl ? 'arrow-forward' : 'arrow-back'} size={25} color={colors.text.primary} /></Pressable>
      <Text style={[s.title, { color: colors.text.primary }]}>{c('Notifications', 'الإشعارات')}</Text>
    </View>
    {error ? <Pressable onPress={() => void load()}><Text style={[s.error, { color: colors.text.primary }]}>{error}</Text></Pressable> : null}
    <FlatList data={items} keyExtractor={item => item.id} refreshing={busy} onRefresh={() => void load()}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} onEndReached={() => { if (cursor) void load(true); }}
      ListEmptyComponent={busy ? <ActivityIndicator style={s.empty} /> : <Text style={[s.empty, { color: colors.text.secondary }]}>{c('No activity yet. Likes, comments, mentions and followers will appear here.', 'لا توجد تفاعلات بعد. ستظهر هنا الإعجابات والتعليقات والإشارات والمتابعون.')}</Text>}
      ListFooterComponent={cursor ? <Pressable style={s.more} onPress={() => void load(true)}>{busy ? <ActivityIndicator /> : <Text style={{ color: colors.text.primary }}>{c('Load more', 'تحميل المزيد')}</Text>}</Pressable> : null}
      renderItem={({ item }) => <Pressable onPress={() => void open(item)} style={[s.row, rtl && s.rtl, { backgroundColor: item.unread ? colors.background.surface : colors.background.app, borderColor: colors.border.subtle }]}>
        {item.actor.photoURL ? <Image source={{ uri: item.actor.photoURL }} style={s.avatar} /> : <View style={[s.avatar, s.avatarEmpty]}><Ionicons name="person-outline" color={colors.text.secondary} size={24} /></View>}
        <View style={s.body}><Text style={[s.name, { color: colors.text.primary, textAlign: rtl ? 'right' : 'left' }]}>{item.actor.displayName || item.actor.username || c('User', 'مستخدم')}</Text><Text style={{ color: colors.text.secondary, textAlign: rtl ? 'right' : 'left' }}>{label(item)}</Text><Text style={[s.date, { color: colors.text.muted }]}>{new Date(item.createdAtMs).toLocaleString(rtl ? 'ar' : 'en')}</Text></View>
        {item.unread ? <View accessibilityLabel={c('Unread', 'غير مقروء')} style={s.dot} /> : null}
      </Pressable>} />
  </View>;
}
const s = StyleSheet.create({ root: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', gap: 18, padding: 20, borderBottomWidth: 1 }, rtl: { flexDirection: 'row-reverse' }, title: { fontSize: 23, fontWeight: '800' }, row: { flexDirection: 'row', alignItems: 'center', padding: 18, gap: 12, borderBottomWidth: 1 }, avatar: { width: 46, height: 46, borderRadius: 23 }, avatarEmpty: { alignItems: 'center', justifyContent: 'center' }, body: { flex: 1, gap: 5 }, name: { fontWeight: '700', fontSize: 16 }, date: { fontSize: 11 }, dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1F7BA8' }, empty: { textAlign: 'center', margin: 35, lineHeight: 24 }, error: { margin: 20 }, more: { alignItems: 'center', padding: 22 } });
