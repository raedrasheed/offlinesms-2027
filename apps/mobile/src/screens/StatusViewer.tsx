// StatusViewer — full-screen story-style playback of one author's statuses.
//
// Text/image items auto-advance after 5s on an animated progress bar; video
// items drive the bar from real playback position and advance when the clip
// finishes. Viewing someone else's status records the view via
// markStatusViewed (server dedupes). Viewing my own shows the live viewer
// count and a delete action instead.

import { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated, Alert, Easing, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import {
  markStatusViewed, deleteStatus, subscribeStatusViewCount,
} from '../lib/statuses';

const ITEM_MS = 5000;
const FALLBACK_BG = '#075E54';

type ViewerItem = {
  statusId:        string;
  type?:           'text' | 'image' | 'video';
  body:            string;
  mediaUrl?:       string | null;
  durationMs?:     number | null;
  backgroundColor: string | null;
  createdAtMs:     number;
};

function formatTime(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function StatusViewer({ route, navigation }: any) {
  const { t } = useTranslation();
  const params = route.params as {
    title: string; isMine?: boolean; startIndex?: number; items: ViewerItem[];
  };
  const isMine = params.isMine === true;

  const [items, setItems] = useState<ViewerItem[]>(params.items ?? []);
  const [index, setIndex] = useState(
    Math.min(Math.max(params.startIndex ?? 0, 0), Math.max((params.items?.length ?? 1) - 1, 0)),
  );
  const [viewCount, setViewCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const current: ViewerItem | undefined = items[index];
  const currentType = current?.type ?? 'text';
  const isMedia = currentType === 'image' || currentType === 'video';

  // Auto-advance timer — text and images only. Videos drive the bar from
  // playback status and advance on didJustFinish instead.
  useEffect(() => {
    if (!current) return;
    progress.setValue(0);
    if (currentType === 'video') return;
    const anim = Animated.timing(progress, {
      toValue: 1, duration: ITEM_MS, easing: Easing.linear, useNativeDriver: false,
    });
    anim.start(({ finished }) => { if (finished) next(); });
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items.length]);

  // Record the view for someone else's status (server dedupes).
  useEffect(() => {
    if (!isMine && current) markStatusViewed(current.statusId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, isMine]);

  // Live viewer count for my own current status.
  useEffect(() => {
    if (!isMine || !current) return;
    setViewCount(null);
    return subscribeStatusViewCount(current.statusId, setViewCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, isMine, items.length]);

  function next() {
    if (index + 1 >= items.length) { navigation.goBack(); return; }
    setIndex(index + 1);
  }
  function prev() {
    setIndex(i => Math.max(i - 1, 0));
  }

  function onVideoStatus(st: AVPlaybackStatus) {
    if (!st.isLoaded) return;
    const dur = st.durationMillis ?? current?.durationMs ?? 0;
    if (dur > 0) progress.setValue(Math.min((st.positionMillis ?? 0) / dur, 1));
    if (st.didJustFinish) next();
  }

  function confirmDelete() {
    if (!current) return;
    Alert.alert(t('status.deleteTitle'), t('status.deleteMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'), style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await deleteStatus(current.statusId);
            const remaining = items.filter(x => x.statusId !== current.statusId);
            if (remaining.length === 0) { navigation.goBack(); return; }
            setItems(remaining);
            setIndex(i => Math.min(i, remaining.length - 1));
          } catch {
            Alert.alert(t('status.title'), t('status.deleteFailed'));
          } finally { setBusy(false); }
        },
      },
    ]);
  }

  if (!current) return null;

  const bg = isMedia ? '#000' : (current.backgroundColor ?? FALLBACK_BG);

  return (
    <View style={[s.root, { backgroundColor: bg }]}>
      {/* Progress bars */}
      <View style={s.barsRow}>
        {items.map((it, i) => (
          <View key={it.statusId} style={s.barTrack}>
            {i < index ? (
              <View style={[s.barFill, { width: '100%' }]} />
            ) : i === index ? (
              <Animated.View style={[s.barFill, {
                width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              }]} />
            ) : null}
          </View>
        ))}
      </View>

      {/* Header */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.name} numberOfLines={1}>{params.title}</Text>
          <Text style={s.time}>{formatTime(current.createdAtMs)}</Text>
        </View>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={s.closeBtn}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
      </View>

      {/* Body + tap zones */}
      <View style={s.bodyWrap}>
        {currentType === 'image' && current.mediaUrl ? (
          <Image source={{ uri: current.mediaUrl }} style={s.media} resizeMode="contain" />
        ) : currentType === 'video' && current.mediaUrl ? (
          <Video
            key={current.statusId}
            source={{ uri: current.mediaUrl }}
            style={s.media}
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay
            onPlaybackStatusUpdate={onVideoStatus}
          />
        ) : (
          <Text style={s.body}>{current.body}</Text>
        )}
        {isMedia && current.body ? (
          <View style={s.captionWrap} pointerEvents="none">
            <Text style={s.caption}>{current.body}</Text>
          </View>
        ) : null}
        <Pressable style={s.tapLeft}  onPress={prev} />
        <Pressable style={s.tapRight} onPress={next} />
      </View>

      {/* Owner footer: viewer count + delete */}
      {isMine ? (
        <View style={s.footer}>
          <View style={s.viewsPill}>
            <Ionicons name="eye-outline" size={16} color="#fff" />
            <Text style={s.viewsText}>{t('status.views', { n: viewCount ?? 0 })}</Text>
          </View>
          <Pressable onPress={confirmDelete} disabled={busy} hitSlop={10} style={s.deleteBtn}>
            <Ionicons name="trash-outline" size={20} color="#fff" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root:     { flex: 1 },
  barsRow:  { flexDirection: 'row', gap: 4, paddingTop: 52, paddingHorizontal: 10, zIndex: 2 },
  barTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  barFill:  { height: 3, borderRadius: 2, backgroundColor: '#fff' },
  header:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, gap: 12, zIndex: 2 },
  name:     { color: '#fff', fontSize: 16, fontWeight: '800' },
  time:     { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' },
  bodyWrap: { flex: 1, justifyContent: 'center' },
  body:     { color: '#fff', fontSize: 28, fontWeight: '700', textAlign: 'center', lineHeight: 38, paddingHorizontal: 28 },
  media:    { width: '100%', height: '100%' },
  captionWrap: { position: 'absolute', left: 0, right: 0, bottom: 24, paddingHorizontal: 20, alignItems: 'center' },
  caption:  { color: '#fff', fontSize: 15, textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8, overflow: 'hidden' },
  tapLeft:  { position: 'absolute', left: 0, top: 0, bottom: 0, width: '35%' },
  tapRight: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '65%' },
  footer:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 34 },
  viewsPill:{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  viewsText:{ color: '#fff', fontSize: 13, fontWeight: '700' },
  deleteBtn:{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },
});
