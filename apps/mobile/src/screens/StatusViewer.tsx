import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Animated, Alert, Easing, Image, ActivityIndicator, Modal, FlatList, AppState, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AVPlaybackStatus } from 'expo-av';
import { VideoPlayer } from '../components/VideoPlayer';
import { markStatusViewed, deleteStatus, subscribeStatusViewCount, setStatusLike, listStatusViewers, replyToStatus, getStatus, type StatusViewerProfile } from '../lib/statuses';
import type { StatusMention } from '../lib/statusModel';

const ITEM_MS = 5000;
export type ViewerItem = {
  statusId: string; type?: 'text' | 'image' | 'video'; body: string;
  mediaUrl?: string | null; durationMs?: number | null; backgroundColor: string | null;
  createdAtMs: number; expiresAtMs?: number; likedByMe?: boolean; likeCount?: number; mentions?: StatusMention[];
};
function Avatar({ uri, name, small = false }: { uri?: string | null; name: string; small?: boolean }) {
  return uri ? <Image source={{ uri }} style={[s.avatar, small && s.smallAvatar]} /> :
    <View style={[s.avatar, s.avatarFallback, small && s.smallAvatar]}><Text style={s.name}>{name.trim().slice(0, 1) || '◉'}</Text></View>;
}
export default function StatusViewer({ route, navigation }: any) {
  const { t } = useTranslation();
  const statusId = route.params?.statusId;
  const [resolved, setResolved] = useState<{ id: string; params: any } | null>(null);
  const [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!statusId) return;
    let live = true; setError(false); setResolved(null);
    void getStatus(statusId).then(({ item, isMine }) => { if (item.expiresAtMs <= Date.now()) throw new Error('status-expired'); if (live) setResolved({ id: statusId, params: { title: item.authorName, authorId: item.authorId, authorPhotoURL: item.authorPhotoURL, isMine, validatedStatusId: statusId, items: [item] } }); }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [statusId, attempt]);
  if (!statusId) return <StatusViewerContent key={route.key} route={route} navigation={navigation} />;
  if (resolved && resolved.id === statusId) return <StatusViewerContent key={statusId} route={{ ...route, params: resolved.params }} navigation={navigation} />;
  return <View style={[s.root, { backgroundColor: '#08141B', justifyContent: 'center', alignItems: 'center', gap: 20 }]}>{error ? <><Text style={s.name}>{t('status.unavailable', { defaultValue: 'This story expired or is unavailable.' })}</Text><Pressable onPress={() => setAttempt(n => n + 1)}><Text style={s.name}>{t('common.retry')}</Text></Pressable></> : <ActivityIndicator color="#fff" />}<Pressable onPress={() => navigation.goBack()}><Text style={s.name}>{t('common.close')}</Text></Pressable></View>;
}
function StatusViewerContent({ route, navigation }: any) {
  const { t } = useTranslation(), insets = useSafeAreaInsets(), focused = useIsFocused();
  const params = route.params as { title: string; authorId?: string; authorPhotoURL?: string | null; isMine?: boolean; startIndex?: number; items: ViewerItem[]; validatedStatusId?: string };
  const isMine = params.isMine === true;
  const [items, setItems] = useState<ViewerItem[]>(params.items ?? []);
  const [index, setIndex] = useState(Math.min(Math.max(params.startIndex ?? 0, 0), Math.max((params.items?.length ?? 1) - 1, 0)));
  const current = items[index], currentId = current?.statusId, currentType = current?.type ?? 'text';
  const [access, setAccess] = useState<{ id?: string; allowed: boolean; failed: boolean }>({ id: params.validatedStatusId, allowed: !!params.validatedStatusId, failed: false });
  const authorized = (!current?.expiresAtMs || current.expiresAtMs > Date.now()) && (isMine || (access.id === currentId && access.allowed));
  const usedInitialValidation = useRef(false);
  const currentRef = useRef(currentId); currentRef.current = currentId;
  const [mediaState, setMediaState] = useState<{ id?: string; ready: boolean; error: boolean }>({ ready: false, error: false });
  const [attempt, setAttempt] = useState(0), [held, setHeld] = useState(false), [replyFocused, setReplyFocused] = useState(false);
  const [accessRevision, setAccessRevision] = useState(0);
  const playbackKey = `${currentId}:${attempt}:${accessRevision}`;
  const playbackRef = useRef(playbackKey); playbackRef.current = playbackKey;
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [viewCount, setViewCount] = useState<number | null>(null), [busy, setBusy] = useState(false), [likeBusy, setLikeBusy] = useState(false);
  const [viewersOpen, setViewersOpen] = useState(false), [viewers, setViewers] = useState<StatusViewerProfile[]>([]);
  const [viewersNext, setViewersNext] = useState<string | null>(null), [viewersBusy, setViewersBusy] = useState(false), [viewersError, setViewersError] = useState(false);
  const [reply, setReply] = useState(''), [replyBusy, setReplyBusy] = useState(false), [deleteOpen, setDeleteOpen] = useState(false);
  const replyId = useRef<string | null>(null), pressAt = useRef(0), longPress = useRef(false), viewersGeneration = useRef(0);
  const progress = useRef(new Animated.Value(0)).current, remaining = useRef(ITEM_MS);
  const ready = authorized && (currentType === 'text' || (mediaState.id === currentId && mediaState.ready));
  const error = (mediaState.id === currentId && mediaState.error) || (access.id === currentId && access.failed);
  const paused = held || replyFocused || replyBusy || viewersOpen || deleteOpen || !focused || !appActive;
  const nextRef = useRef(() => {});
  function next() { if (index + 1 >= items.length) navigation.goBack(); else setIndex(index + 1); }
  nextRef.current = next;
  useEffect(() => {
    if (!currentId || isMine) return;
    if (!focused || !appActive) { setAccess({ id: currentId, allowed: false, failed: false }); return; }
    if (attempt === 0 && params.validatedStatusId === currentId && !usedInitialValidation.current) { usedInitialValidation.current = true; return; }
    let live = true;
    setAccessRevision(n => n + 1);
    setMediaState({ id: currentId, ready: false, error: false });
    setAccess({ id: currentId, allowed: false, failed: false });
    void getStatus(currentId).then(({ item }) => {
      if (!live || currentRef.current !== currentId) return;
      if (item.expiresAtMs <= Date.now()) { setAccess({ id: currentId, allowed: false, failed: true }); return; }
      setItems(previous => previous.map(value => value.statusId === currentId ? { ...value, ...item } : value));
      setAccess({ id: currentId, allowed: true, failed: false });
    }).catch(() => { if (live) setAccess({ id: currentId, allowed: false, failed: true }); });
    return () => { live = false; };
  }, [currentId, isMine, attempt, params.validatedStatusId, focused, appActive]);
  useEffect(() => {
    if (!currentId || !current?.expiresAtMs) return;
    const timer = setTimeout(() => setAccess({ id: currentId, allowed: false, failed: true }), Math.max(0, current.expiresAtMs - Date.now()));
    return () => clearTimeout(timer);
  }, [currentId, current?.expiresAtMs, isMine]);
  useEffect(() => { const sub = AppState.addEventListener('change', state => setAppActive(state === 'active')); return () => sub.remove(); }, []);
  useEffect(() => {
    progress.setValue(0); remaining.current = ITEM_MS; setHeld(false); setReply(''); replyId.current = null;
    setViewCount(null); setViewers([]); setViewersNext(null); setViewersOpen(false); setViewersBusy(false); viewersGeneration.current++;
    setLikeBusy(false);
  }, [currentId, progress]);
  useEffect(() => {
    if (!currentId || currentType === 'video' || !ready || paused || error) return;
    let live = true; const began = Date.now();
    const animation = Animated.timing(progress, { toValue: 1, duration: remaining.current, easing: Easing.linear, useNativeDriver: false });
    animation.start(({ finished }) => { if (live && finished && currentRef.current === currentId) nextRef.current(); });
    return () => { live = false; remaining.current = Math.max(0, remaining.current - (Date.now() - began)); animation.stop(); };
  }, [currentId, currentType, ready, paused, error, progress]);
  useEffect(() => {
    if (!isMine && currentId && ready && focused && appActive) void markStatusViewed(currentId).catch(() => {});
  }, [currentId, isMine, ready, focused, appActive]);
  useEffect(() => {
    if (!isMine || !currentId) return;
    return subscribeStatusViewCount(currentId, setViewCount);
  }, [currentId, isMine]);
  // Warm only the next image. The old native image is unmounted at every item boundary.
  useEffect(() => { const nextItem = items[index + 1]; if (nextItem?.type === 'image' && nextItem.mediaUrl) void Image.prefetch(nextItem.mediaUrl).catch(() => {}); }, [items, index]);
  useEffect(() => () => { viewersGeneration.current++; }, []);
  function loaded(key: string) { if (playbackRef.current === key) setMediaState({ id: currentId, ready: true, error: false }); }
  function failed(key: string) { if (playbackRef.current === key) setMediaState({ id: currentId, ready: false, error: true }); }
  function onVideoStatus(key: string, status: AVPlaybackStatus) {
    if (playbackRef.current !== key) return;
    if (!status.isLoaded) { if (status.error) failed(key); return; }
    if (!ready || paused) return;
    const duration = status.durationMillis ?? current?.durationMs ?? 0;
    if (duration > 0) progress.setValue(Math.min(status.positionMillis / duration, 1));
    if (status.didJustFinish) nextRef.current();
  }
  function beginHold() { pressAt.current = Date.now(); longPress.current = false; setHeld(true); }
  function tap(direction: 'previous' | 'next') {
    if (longPress.current || Date.now() - pressAt.current >= 220) return;
    if (direction === 'previous') setIndex(i => Math.max(0, i - 1)); else next();
  }
  async function loadViewers(after?: string) {
    if (!currentId || viewersBusy) return;
    const id = currentId, generation = ++viewersGeneration.current;
    setViewersBusy(true); setViewersError(false);
    try {
      const result = await listStatusViewers(id, after);
      if (generation !== viewersGeneration.current || currentRef.current !== id) return;
      setViewers(previous => after ? [...previous, ...result.viewers.filter(v => !previous.some(p => p.uid === v.uid))] : result.viewers); setViewersNext(result.next);
    } catch { if (generation === viewersGeneration.current) setViewersError(true); }
    finally { if (generation === viewersGeneration.current) setViewersBusy(false); }
  }
  async function toggleLike() {
    if (!current || likeBusy || !authorized) return;
    const id = current.statusId; setLikeBusy(true);
    try { const result = await setStatusLike(id, !current.likedByMe); setItems(previous => previous.map(item => item.statusId === id ? { ...item, likedByMe: result.liked, likeCount: result.likeCount } : item)); }
    catch { Alert.alert(t('status.title'), t('status.interactionFailed', { defaultValue: 'Could not update this story. Try again.' })); }
    finally { if (currentRef.current === id) setLikeBusy(false); }
  }
  async function sendReply() {
    if (!current || replyBusy || !reply.trim() || !authorized) return;
    const id = current.statusId;
    if (!replyId.current) replyId.current = `reply_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    setReplyBusy(true);
    try {
      const result = await replyToStatus(id, reply.trim(), replyId.current);
      navigation.replace('Conversation', { id: result.conversationId, title: params.title });
    } catch { Alert.alert(t('status.title'), t('status.replyFailed', { defaultValue: 'Could not send your reply. Your text is kept for retry.' })); }
    finally { setReplyBusy(false); }
  }
  function confirmDelete() {
    if (!current) return;
    const id = current.statusId; setDeleteOpen(true);
    Alert.alert(t('status.deleteTitle'), t('status.deleteMessage'), [
      { text: t('common.cancel'), style: 'cancel', onPress: () => setDeleteOpen(false) },
      { text: t('common.delete'), style: 'destructive', onPress: async () => {
        setBusy(true);
        try { await deleteStatus(id); const rest = items.filter(item => item.statusId !== id); if (!rest.length) navigation.goBack(); else { setItems(rest); setIndex(i => Math.min(i, rest.length - 1)); } }
        catch { Alert.alert(t('status.title'), t('status.deleteFailed')); }
        finally { setBusy(false); setDeleteOpen(false); }
      } },
    ], { cancelable: true, onDismiss: () => setDeleteOpen(false) });
  }
  if (!current) return null;
  return <KeyboardAvoidingView style={[s.root, { backgroundColor: currentType === 'text' ? current.backgroundColor ?? '#075E54' : '#08141B' }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={[s.barsRow, { paddingTop: insets.top + 8 }]}>{items.map((item, i) => <View key={item.statusId} style={s.barTrack}>{i < index ? <View style={[s.barFill, { width: '100%' }]} /> : i === index ? <Animated.View style={[s.barFill, { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} /> : null}</View>)}</View>
    <View style={s.header}><Avatar uri={params.authorPhotoURL} name={params.title} /><View style={{ flex: 1 }}><Text style={s.name} numberOfLines={1}>{params.title}</Text><Text style={s.time}>{new Date(current.createdAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text></View><Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel={t('common.close')} style={s.iconButton}><Ionicons name="close" size={26} color="#fff" /></Pressable></View>
    <View style={s.bodyWrap}>
      {!authorized ? null : currentType === 'image' && current.mediaUrl ? <Image key={playbackKey} testID="status-image" source={{ uri: current.mediaUrl }} style={[s.media, !ready && { opacity: 0 }]} resizeMode="contain" onLoad={() => loaded(playbackKey)} onError={() => failed(playbackKey)} /> : currentType === 'video' && current.mediaUrl ? <VideoPlayer key={playbackKey} nativeTestID="status-video" uri={current.mediaUrl} style={s.media} controls={false} paused={paused || error} onReady={() => loaded(playbackKey)} onError={() => failed(playbackKey)} onStatus={status => onVideoStatus(playbackKey, status)} /> : <Text style={s.body}>{current.body}</Text>}
      {!ready && !error ? <View style={s.loading} pointerEvents="none"><ActivityIndicator color="#fff" /><Text style={s.time}>{t('status.loadingMedia', { defaultValue: 'Loading story…' })}</Text></View> : null}
      <Pressable testID="status-previous" style={s.tapLeft} onPressIn={beginHold} onPressOut={() => setHeld(false)} onLongPress={() => { longPress.current = true; }} delayLongPress={220} onPress={() => tap('previous')} accessibilityLabel={t('status.previous', { defaultValue: 'Previous story. Hold to pause.' })} />
      <Pressable testID="status-next" style={s.tapRight} onPressIn={beginHold} onPressOut={() => setHeld(false)} onLongPress={() => { longPress.current = true; }} delayLongPress={220} onPress={() => tap('next')} accessibilityLabel={t('status.next', { defaultValue: 'Next story. Hold to pause.' })} />
      {error ? <View style={s.loading}><Text style={s.caption}>{t('status.mediaFailed', { defaultValue: 'This story could not be loaded.' })}</Text><Pressable style={s.pill} onPress={() => { setMediaState({ id: currentId, ready: false, error: false }); setAttempt(n => n + 1); }}><Text style={s.name}>{t('common.retry')}</Text></Pressable></View> : null}
      {authorized && ((currentType !== 'text' && current.body) || current.mentions?.length) ? <View style={s.captionWrap} pointerEvents="none">{currentType !== 'text' && current.body ? <Text style={s.caption}>{current.body}</Text> : null}{current.mentions?.length ? <Text style={s.caption}>{current.mentions.map(m => `@${m.username || m.name}`).join('  ')}</Text> : null}</View> : null}
    </View>
    <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>{isMine ? <><Pressable style={s.pill} onPress={() => { setViewersOpen(true); void loadViewers(); }} accessibilityLabel={t('status.viewersTitle', { defaultValue: 'Who viewed your story' })}><Ionicons name="eye-outline" size={19} color="#fff" /><Text style={s.viewsText}>{t('status.views', { n: viewCount ?? 0 })}</Text></Pressable><Pressable onPress={confirmDelete} disabled={busy} style={s.iconButton} accessibilityLabel={t('common.delete')}><Ionicons name="trash-outline" size={23} color="#fff" /></Pressable></> : <><TextInput testID="status-reply" style={s.replyInput} value={reply} onChangeText={value => { setReply(value); replyId.current = null; }} maxLength={3000} editable={!replyBusy} onFocus={() => setReplyFocused(true)} onBlur={() => setReplyFocused(false)} placeholder={t('status.replyPlaceholder', { defaultValue: 'Reply privately…' })} placeholderTextColor="#C4D1D9" /><Pressable style={s.iconButton} onPress={() => void toggleLike()} disabled={likeBusy || !ready} accessibilityRole="button" accessibilityLabel={t(current.likedByMe ? 'status.unlike' : 'status.like', { defaultValue: current.likedByMe ? 'Unlike story' : 'Like story' })}><Ionicons name={current.likedByMe ? 'heart' : 'heart-outline'} size={27} color={current.likedByMe ? '#FF6B88' : '#fff'} /></Pressable>{reply.trim() ? <Pressable style={s.iconButton} onPress={() => void sendReply()} disabled={replyBusy || !authorized} accessibilityLabel={t('common.send')}>{replyBusy ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={22} color="#fff" />}</Pressable> : null}</>}</View>
    <Modal visible={viewersOpen} transparent animationType="slide" onRequestClose={() => setViewersOpen(false)}><View style={s.sheetBackdrop}><View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}><View style={s.sheetHeader}><Text style={s.name}>{t('status.viewersTitle', { defaultValue: 'Who viewed your story' })}</Text><Pressable onPress={() => setViewersOpen(false)} accessibilityLabel={t('common.close')}><Ionicons name="close" size={25} color="#fff" /></Pressable></View><FlatList data={viewers} keyExtractor={item => item.uid} renderItem={({ item }) => <View style={s.viewerRow}><Avatar uri={item.photoURL} name={item.name} small /><Text style={[s.name, { flex: 1 }]}>{item.name || t('common.unknownUser', { defaultValue: 'User' })}</Text>{item.liked ? <Ionicons name="heart" color="#FF6B88" size={20} /> : null}</View>} ListEmptyComponent={!viewersBusy && !viewersError ? <Text style={s.time}>{t('status.noViewers', { defaultValue: 'No views yet.' })}</Text> : null} ListFooterComponent={<View style={s.sheetFooter}>{viewersBusy ? <ActivityIndicator color="#fff" /> : viewersError ? <Pressable onPress={() => void loadViewers(viewersNext ?? undefined)}><Text style={s.name}>{t('common.retry')}</Text></Pressable> : viewersNext ? <Pressable onPress={() => void loadViewers(viewersNext)}><Text style={s.name}>{t('status.moreViewers', { defaultValue: 'Load more' })}</Text></Pressable> : null}</View>} /></View></View></Modal>
  </KeyboardAvoidingView>;
}
const s = StyleSheet.create({
  root: { flex: 1 }, barsRow: { flexDirection: 'row', gap: 4, paddingHorizontal: 10 }, barTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: '#607079', overflow: 'hidden' }, barFill: { height: 3, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, gap: 12 }, name: { color: '#fff', fontSize: 16, fontWeight: '700' }, time: { color: '#D3DEE5', fontSize: 12, marginTop: 4 },
  avatar: { width: 42, height: 42, borderRadius: 21 }, smallAvatar: { width: 36, height: 36, borderRadius: 18 }, avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#245975' }, iconButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' },
  bodyWrap: { flex: 1, justifyContent: 'center' }, body: { color: '#fff', fontSize: 28, fontWeight: '700', textAlign: 'center', lineHeight: 38, paddingHorizontal: 28 }, media: { width: '100%', height: '100%' },
  loading: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', gap: 16 }, captionWrap: { position: 'absolute', left: 15, right: 15, bottom: 18, alignItems: 'center', gap: 5 }, caption: { color: '#fff', fontSize: 15, textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  tapLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '35%' }, tapRight: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '65%' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, gap: 9 }, pill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 25, paddingHorizontal: 14, paddingVertical: 10 }, viewsText: { color: '#fff', fontSize: 14, fontWeight: '700' }, replyInput: { flex: 1, borderWidth: 1, borderColor: '#A4B5C0', color: '#fff', borderRadius: 22, paddingHorizontal: 15, paddingVertical: 10, fontSize: 15 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' }, sheet: { backgroundColor: '#132834', maxHeight: '65%', minHeight: 250, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 20 }, sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 18 }, viewerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }, sheetFooter: { paddingVertical: 18, alignItems: 'center' },
});

