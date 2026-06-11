// Status tab — my status + the audience-filtered feed of other users'
// active statuses.
//
// Own statuses subscribe live (authorId == uid is the one rules-provable
// query); the others' feed comes from the getStatusFeed callable since the
// audience rules are per-document. Feed refreshes on focus and via
// pull-to-refresh.

import { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, RefreshControl, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { auth } from '../lib/firebase';
import { useTheme } from '../context/ThemeContext';
import { isRTL } from '../i18n';
import {
  MyStatus, StatusFeedItem, AuthorStatusGroup,
  subscribeMyStatuses, fetchStatusFeed, groupStatusFeed,
  STATUS_VIDEO_MAX_MS,
} from '../lib/statuses';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatTime(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function Status({ navigation }: any) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const myName = auth.currentUser?.displayName ?? 'You';
  const s = buildStyles(colors, isRTL);

  const [mine, setMine] = useState<MyStatus[]>([]);
  const [feed, setFeed] = useState<StatusFeedItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(useCallback(() => subscribeMyStatuses(setMine), []));

  const loadFeed = useCallback(async () => {
    try { setFeed(await fetchStatusFeed()); }
    catch { setFeed(prev => prev ?? []); }
  }, []);

  useFocusEffect(useCallback(() => { void loadFeed(); }, [loadFeed]));

  async function onRefresh() {
    setRefreshing(true);
    try { await loadFeed(); } finally { setRefreshing(false); }
  }

  const groups = useMemo(() => groupStatusFeed(feed ?? []), [feed]);
  const recent = groups.filter(g => g.unviewedCount > 0);
  const viewed = groups.filter(g => g.unviewedCount === 0);

  function openComposer() { navigation.navigate('StatusComposer'); }

  // Pick a photo or video from the library and hand it to the composer for
  // preview + caption. Video length is checked here so the user finds out
  // before the upload, and again server-side.
  async function pickMedia() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert(t('status.title'), t('status.mediaPermission')); return; }
    const mediaTypes =
      (ImagePicker as any).MediaTypeOptions?.All ?? (ImagePicker as any).MediaType?.All ?? 'all';
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes, quality: 0.8 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    const isVideo = a.type === 'video';
    const durationMs = isVideo ? (a.duration ?? 0) : null;
    if (isVideo && (durationMs ?? 0) > STATUS_VIDEO_MAX_MS) {
      Alert.alert(t('status.title'), t('status.videoTooLong'));
      return;
    }
    const mimeType = a.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg');
    navigation.navigate('StatusComposer', {
      media: { uri: a.uri, type: isVideo ? 'video' : 'image', mimeType, durationMs },
    });
  }

  function toViewerItems(items: { statusId: string; type: string; body: string; mediaUrl: string | null; durationMs: number | null; backgroundColor: string | null; createdAtMs: number }[]) {
    return items.map(m => ({
      statusId: m.statusId, type: m.type, body: m.body,
      mediaUrl: m.mediaUrl, durationMs: m.durationMs,
      backgroundColor: m.backgroundColor, createdAtMs: m.createdAtMs,
    }));
  }

  function openMine() {
    if (mine.length === 0) { openComposer(); return; }
    navigation.navigate('StatusViewer', {
      title: t('status.myStatus'),
      isMine: true,
      startIndex: 0,
      items: toViewerItems(mine),
    });
  }

  function openGroup(g: AuthorStatusGroup) {
    navigation.navigate('StatusViewer', {
      title: g.authorName,
      isMine: false,
      startIndex: g.startIndex,
      items: toViewerItems(g.items),
    });
  }

  function renderGroupRow(g: AuthorStatusGroup, unviewed: boolean) {
    return (
      <Pressable key={g.authorId} style={s.row} onPress={() => openGroup(g)}>
        <View style={[s.ring, { borderColor: unviewed ? colors.action.primary : colors.border.default }]}>
          <View style={s.av}><Text style={s.avText}>{initials(g.authorName)}</Text></View>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>{g.authorName}</Text>
          <Text style={s.sub}>{formatTime(g.latestAtMs)}</Text>
        </View>
      </Pressable>
    );
  }

  const latestMine = mine.length > 0 ? mine[mine.length - 1] : null;

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.h1}>{t('status.title')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 150 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Pressable style={s.myRow} onPress={openMine}>
          <View style={s.myAvatarWrap}>
            <View style={[s.ring, latestMine ? { borderColor: colors.action.primary } : { borderColor: 'transparent' }]}>
              <View style={s.av}><Text style={s.avText}>{initials(myName)}</Text></View>
            </View>
            <Pressable style={s.plusBadge} onPress={openComposer} hitSlop={8}>
              <Ionicons name="add" size={14} color="#fff" />
            </Pressable>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{t('status.myStatus')}</Text>
            <Text style={s.sub}>
              {latestMine ? formatTime(latestMine.createdAtMs) : t('status.tapToAdd')}
            </Text>
          </View>
        </Pressable>

        <Text style={s.sectionLabel}>{t('status.recentUpdates')}</Text>

        {recent.length === 0 && viewed.length === 0 ? (
          <View style={s.emptyWrap}>
            <View style={s.emptyIcon}>
              <Ionicons name="ellipse-outline" size={28} color={colors.text.disabled} />
            </View>
            <Text style={s.emptyTitle}>{t('status.noUpdatesTitle')}</Text>
            <Text style={s.emptyDesc}>{t('status.noUpdatesDesc')}</Text>
          </View>
        ) : (
          <>
            {recent.map(g => renderGroupRow(g, true))}
            {viewed.length > 0 ? (
              <>
                <Text style={s.sectionLabel}>{t('status.viewedUpdates')}</Text>
                {viewed.map(g => renderGroupRow(g, false))}
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      <Pressable
        style={s.fabSecondary}
        onPress={() => { void pickMedia(); }}
        accessibilityRole="button"
        accessibilityLabel={t('status.photoVideo')}
      >
        <Ionicons name="camera" size={22} color={colors.action.primary} />
      </Pressable>
      <Pressable style={s.fab} onPress={openComposer}>
        <Ionicons name="create-outline" size={24} color={colors.action.primaryFg} />
      </Pressable>
    </View>
  );
}

function buildStyles(colors: any, rtl: boolean) {
  return StyleSheet.create({
    root:   { flex: 1, backgroundColor: colors.background.app },
    header: { paddingHorizontal: 16, paddingTop: 50, paddingBottom: 14, backgroundColor: colors.background.surface, borderBottomWidth: 1, borderColor: colors.border.subtle },
    h1:     { fontSize: 24, fontWeight: '800', color: colors.text.primary, textAlign: rtl ? 'right' : 'left' },

    myRow:  { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.background.surface, marginTop: 8 },
    myAvatarWrap: { width: 58, height: 58 },
    ring:   { width: 58, height: 58, borderRadius: 29, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
    av:     { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.action.primary, alignItems: 'center', justifyContent: 'center' },
    avText: { color: colors.action.primaryFg, fontWeight: '800', fontSize: 16 },
    plusBadge: { position: 'absolute', bottom: -2, right: rtl ? undefined : -2, left: rtl ? -2 : undefined, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.action.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.background.surface },
    title:  { fontSize: 15, fontWeight: '700', color: colors.text.primary, textAlign: rtl ? 'right' : 'left' },
    sub:    { fontSize: 12, color: colors.text.muted, marginTop: 2, textAlign: rtl ? 'right' : 'left' },

    sectionLabel: { fontSize: 12, fontWeight: '700', color: colors.text.muted, letterSpacing: 0.5, paddingHorizontal: 16, paddingTop: 22, paddingBottom: 8, textTransform: 'uppercase', textAlign: rtl ? 'right' : 'left' },

    row:    { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.background.surface },

    emptyWrap:  { alignItems: 'center', paddingTop: 40, paddingHorizontal: 32, gap: 10 },
    emptyIcon:  { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.background.subtle, alignItems: 'center', justifyContent: 'center' },
    emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.text.primary, textAlign: 'center' },
    emptyDesc:  { fontSize: 13, color: colors.text.muted, textAlign: 'center', lineHeight: 19 },

    fab: { position: 'absolute', bottom: 104, right: rtl ? undefined : 18, left: rtl ? 18 : undefined, width: 54, height: 54, borderRadius: 27, backgroundColor: colors.action.primary, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
    fabSecondary: { position: 'absolute', bottom: 170, right: rtl ? undefined : 22, left: rtl ? 22 : undefined, width: 46, height: 46, borderRadius: 23, backgroundColor: colors.background.surface, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  });
}
