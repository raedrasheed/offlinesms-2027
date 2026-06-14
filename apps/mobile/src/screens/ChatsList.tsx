import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList, View, Text, Pressable, StyleSheet, TextInput, Alert, Platform, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { onSnapshot, doc } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { db, auth } from '../lib/firebase';
import {
  subscribeConversations,
  Conversation,
  UserState,
} from '../lib/conversations';
import { subscribeToPresence, type ChatPresence } from '../services/presenceService';
import { useTheme } from '../context/ThemeContext';
import { useLocalChatList } from '../hooks/useLocalChatList';
import { isRTL } from '../i18n';
import { radius } from '../theme';
import { setUnreadTotal } from '../lib/unreadStore';
import { clearChat } from '../localdb';
import { LoadingState, EmptyState } from '../components/state';
import { ChatRow } from './ChatRow';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useOffline } from '../context/OfflineContext';
import { OfflineBanner, SyncingBanner } from '../components/OfflineBanners';

type Filter = 'all' | 'unread' | 'favorites' | 'groups';

type Row = Conversation & {
  state?:        UserState;
  peerName?:     string;
  photoURL?:     string | null;
  someoneTyping: boolean;
};

function formatTime(ts?: any): string {
  const d: Date | null = ts?.toDate?.() ?? null;
  if (!d) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ChatsList({ navigation }: any) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const me = auth.currentUser?.uid;
  const insets = useSafeAreaInsets();
  const { isOffline, isSyncing, queuedCount } = useOffline();
  const [rows, setRows] = useState<Conversation[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  // Phase 22B — local-first chat list (flag-gated). `useLocal` is true only when
  // the flag is on AND the local DB initialised; otherwise the Firestore path
  // below runs unchanged (including as a fallback).
  const local = useLocalChatList(me);
  const useLocal = local.source === 'local';

  // Per-conversation state + peer profile, keyed by conversation id.
  const [states, setStates]   = useState<Record<string, UserState | undefined>>({});
  const [peers, setPeers]     = useState<Record<string, { name?: string; photoURL?: string | null }>>({});
  // Live presence (online + typing/recording) per conversation, both paths.
  const [presence, setPresence] = useState<Record<string, ChatPresence>>({});

  // Conversations list (Firestore path — skipped when the local DB drives the UI).
  useEffect(() => {
    if (useLocal) return;
    return subscribeConversations(setRows);
  }, [useLocal]);

  // Per-conversation subscriptions: userState + peer display name.
  // (typing/recording/online come from the unified presence effect below.)
  useEffect(() => {
    if (useLocal || !me || !rows) return;
    const unsubs: Array<() => void> = [];
    for (const c of rows) {
      // user state
      unsubs.push(onSnapshot(doc(db, 'conversations', c.id, 'userState', me), snap => {
        setStates(prev => ({ ...prev, [c.id]: snap.exists() ? ({ uid: me, ...snap.data() } as UserState) : undefined }));
      }));
      // peer profile (direct conversations only)
      if (c.type === 'direct' && c.participantUids?.length === 2) {
        const peerUid = c.participantUids.find(u => u !== me);
        if (peerUid && !peers[peerUid]) {
          unsubs.push(onSnapshot(doc(db, 'users', peerUid), snap => {
            const data = snap.data() as { displayName?: string; username?: string; photoURL?: string | null } | undefined;
            const name = data?.displayName || (data?.username ? `@${data.username}` : peerUid.slice(0, 6));
            setPeers(prev => ({ ...prev, [c.id]: { name, photoURL: data?.photoURL ?? null } }));
          }));
        }
      }
    }
    return () => { for (const u of unsubs) try { u(); } catch {} };
  }, [me, rows, useLocal]);

  const enriched: Row[] = useMemo(() => {
    if (useLocal) return local.items as unknown as Row[];
    if (!rows) return [];
    return rows.map(c => {
      const isGroup = c.type === 'group';
      const displayName = isGroup
        ? (c.name ?? 'Group')
        : (peers[c.id]?.name ?? c.name ?? 'Conversation');
      return {
        ...c,
        state:         states[c.id],
        peerName:      displayName,
        photoURL:      isGroup ? (c.avatarUrl ?? null) : (peers[c.id]?.photoURL ?? null),
        someoneTyping: false,
      };
    });
  }, [useLocal, local.items, rows, states, peers]);

  // Resolve the peer uid of a direct chat (Firestore: participantUids; local:
  // the sorted participant_key "<a>_<b>").
  const peerUidOf = (item: Row): string | null => {
    if (item.type === 'group' || !me) return null;
    const fromList = (item as any).participantUids as string[] | undefined;
    if (fromList?.length) return fromList.find(u => u !== me) ?? null;
    const key = (item as any).participantKey as string | null | undefined;
    if (key) return key.split('_').find(u => u !== me) ?? null;
    return null;
  };

  // Unified presence: subscribe to online + typing/recording for visible chats
  // (both local-first and Firestore paths). Keyed on a stable id+peer signature
  // so it only re-subscribes when the set of chats changes.
  const presenceKey = enriched.map(e => `${e.id}:${peerUidOf(e) ?? ''}`).join(',');
  useEffect(() => {
    if (!me || enriched.length === 0) return;
    const unsubs = enriched.map(item =>
      subscribeToPresence(item.id, { peerUid: peerUidOf(item) }, p =>
        setPresence(prev => ({ ...prev, [item.id]: p })),
      ),
    );
    return () => { for (const u of unsubs) try { u(); } catch { /* noop */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, presenceKey]);

  // Archived chats are always hidden from every filter now (no archive tab).
  const visible = useMemo(() => enriched.filter(c => c.state?.archived !== true), [enriched]);

  const filtered = useMemo(() => {
    let out = visible;
    if (filter === 'unread')         out = out.filter(c => (c.state?.unreadCount ?? 0) > 0);
    else if (filter === 'favorites') out = out.filter(c => c.state?.favorite === true);
    else if (filter === 'groups')    out = out.filter(c => c.type === 'group');

    const t = search.trim().toLowerCase();
    if (t) out = out.filter(c => (c.peerName ?? '').toLowerCase().includes(t));
    return out;
  }, [visible, filter, search]);

  // Unread-message totals per filter (shown as a badge on each chip), plus the
  // grand total that drives the bottom Chats-tab badge.
  const unreadCounts = useMemo(() => {
    const sum = (arr: Row[]) => arr.reduce((n, c) => n + (c.state?.unreadCount ?? 0), 0);
    return {
      all:       sum(visible),
      unread:    sum(visible.filter(c => (c.state?.unreadCount ?? 0) > 0)),
      favorites: sum(visible.filter(c => c.state?.favorite === true)),
      groups:    sum(visible.filter(c => c.type === 'group')),
    } as Record<Filter, number>;
  }, [visible]);

  useEffect(() => { setUnreadTotal(unreadCounts.all); }, [unreadCounts.all]);

  const confirmClearChat = useCallback((cid: string, name: string) => {
    Alert.alert(
      t('chats.clearChatTitle'),
      name ? `${t('chats.clearChatMessage')}\n\n${name}` : t('chats.clearChatMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('chats.clearChat'), style: 'destructive', onPress: () => { void clearChat(cid).then(() => local.refresh?.()); } },
      ],
    );
  }, [t, local]);

  // Stable handlers passed to every ChatRow so the row's memo comparator
  // sees identical references across parent renders.
  const openConversation = useCallback((cid: string) => navigation.navigate('Conversation', { id: cid }), [navigation]);
  const typingLabel    = t('convo.typing');
  const recordingLabel = t('presence.recording');

  const FILTER_LABELS: Record<Filter, string> = {
    all:       t('chats.filterAll'),
    unread:    t('chats.filterUnread'),
    favorites: t('chats.filterFavorites'),
    groups:    t('chats.filterGroups'),
  };

  const s = buildStyles(colors, isRTL);
  const firstName = (auth.currentUser?.displayName ?? '').trim().split(/\s+/)[0] || '';

  if (useLocal) {
    if (local.loading && local.items.length === 0) return <LoadingState fullPage title="Loading chats…" />;
  } else if (rows === null) {
    return <LoadingState fullPage title="Loading chats…" />;
  }

  return (
    <View style={s.root}>
      <StatusBar style="dark" translucent backgroundColor="transparent" />
      <View style={[s.header, { paddingTop: insets.top + 4 }]}>
        <View style={s.headerRow}>
          <Text style={s.h1}>OfflineSMS</Text>
          <Pressable
            onPress={() => navigation.navigate('Settings')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('tabs.settings', { defaultValue: 'Settings' })}
          >
            <Ionicons name="ellipsis-vertical" size={20} color={colors.text.primary} />
          </Pressable>
        </View>
        <View style={s.searchWrap}>
          <Ionicons name="search" size={17} color={colors.text.muted} />
          <TextInput
            style={s.search}
            placeholder={t('chats.search')}
            placeholderTextColor={colors.text.muted}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            textAlign={isRTL ? 'right' : 'left'}
            accessibilityLabel={t('chats.search')}
          />
        </View>
      </View>

      {/* Telegram-style folder strip: a rounded card holding scrollable filter
          chips; the active chip gets a soft blue pill, inactive are plain text. */}
      <View style={s.chipsCard}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.chipsContent}
        >
          {(['all','unread','favorites','groups'] as Filter[]).map(f => {
            const count = unreadCounts[f];
            return (
              <Pressable
                key={f}
                style={[s.chip, filter === f && s.chipActive]}
                onPress={() => setFilter(f)}
                accessibilityRole="radio"
                accessibilityLabel={count > 0 ? `${FILTER_LABELS[f]}, ${count} unread` : FILTER_LABELS[f]}
                accessibilityState={{ selected: filter === f }}
              >
                <Text style={[s.chipText, filter === f && s.chipTextActive]}>
                  {FILTER_LABELS[f]}
                </Text>
                {count > 0 ? (
                  <View style={[s.chipBadge, filter === f && s.chipBadgeActive]}>
                    <Text style={[s.chipBadgeText, filter === f && s.chipBadgeTextActive]}>
                      {count > 99 ? '99+' : count}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isSyncing && queuedCount > 0 ? <SyncingBanner count={queuedCount} /> : isOffline ? <OfflineBanner /> : null}

      {filtered.length === 0 ? (
        <EmptyState
          fullPage
          title={
            filter === 'unread'    ? 'Nothing unread' :
            filter === 'favorites' ? 'No favorite chats yet' :
            filter === 'groups'    ? 'No group chats yet' :
            firstName ? `You’re all set, ${firstName}` : 'You’re all set'
          }
          description={
            filter === 'all'
              ? 'Tap the pencil to start your first conversation.'
              : undefined
          }
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={r => r.id}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 150 }}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={10}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews={Platform.OS === 'android'}
          // `extraData` so FlatList knows to call renderItem when the presence
          // map identity changes (memoised row will then bail out if its slice
          // is unchanged).
          extraData={presence}
          renderItem={({ item }) => (
            <ChatRow
              item={item}
              presence={presence[item.id]}
              typingLabel={typingLabel}
              recordingLabel={recordingLabel}
              onOpen={openConversation}
              onLongPress={confirmClearChat}
              formatTime={formatTime}
              colors={colors}
            />
          )}
        />
      )}

      <Pressable
        style={[s.fab, { bottom: insets.bottom + 94 }, isRTL && { right: undefined, left: 18 }]}
        onPress={() => navigation.navigate('NewChatMenu')}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="New conversation"
      >
        <Ionicons name="pencil" size={22} color={colors.action.primaryFg} accessibilityElementsHidden />
      </Pressable>
    </View>
  );
}

function buildStyles(colors: any, rtl: boolean) {
  return StyleSheet.create({
    root:        { flex: 1, backgroundColor: colors.background.app },
    header:      { paddingHorizontal: 14, paddingBottom: 12, backgroundColor: colors.background.app, gap: 14 },
    headerRow:   { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', justifyContent: 'space-between' },
    h1:          { fontSize: 26, fontWeight: '800', color: colors.action.primary, textAlign: rtl ? 'right' : 'left' },
    searchWrap:  { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, backgroundColor: colors.background.subtle, borderRadius: 999, minHeight: 46 },
    search:      { flex: 1, paddingVertical: 12, fontSize: 15, color: colors.text.primary },
    chipsCard:   { marginHorizontal: 10, marginBottom: 8, backgroundColor: colors.background.surface, borderRadius: 24, borderWidth: 1, borderColor: colors.border.subtle, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
    chipsContent:{ flexDirection: rtl ? 'row-reverse' : 'row', gap: 4, paddingHorizontal: 6, paddingVertical: 6 },
    chip:        { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: 'transparent', minHeight: 36 },
    chipActive:  { backgroundColor: colors.action.subtle },
    chipText:    { fontSize: 14, color: colors.text.muted, fontWeight: '600' },
    chipTextActive: { color: colors.action.primary, fontWeight: '800' },
    chipBadge:   { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: colors.text.muted, alignItems: 'center', justifyContent: 'center' },
    chipBadgeActive: { backgroundColor: colors.action.primary },
    chipBadgeText: { fontSize: 10, fontWeight: '800', color: colors.background.surface },
    chipBadgeTextActive: { color: colors.action.primaryFg },
    row:         { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 16 },
    avWrap:      { width: 52, height: 52 },
    av:          { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
    avGroup:     { borderRadius: 18 },
    avText:      { color: '#fff', fontWeight: '800', fontSize: 17 },
    onlineDot:   { position: 'absolute', bottom: 1, right: rtl ? undefined : 1, left: rtl ? 1 : undefined, width: 15, height: 15, borderRadius: 8, backgroundColor: '#22C55E', borderWidth: 2.5, borderColor: colors.background.app },
    rowTop:      { flexDirection: rtl ? 'row-reverse' : 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
    rowBot:      { flexDirection: rtl ? 'row-reverse' : 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2, gap: 6 },
    name:        { fontSize: 16, fontWeight: '800', color: colors.text.primary, flex: 1, textAlign: rtl ? 'right' : 'left' },
    time:        { fontSize: 12, color: colors.text.muted, writingDirection: 'ltr' },
    preview:     { fontSize: 14, color: colors.text.muted, flex: 1, textAlign: rtl ? 'right' : 'left' },
    previewActivity: { color: colors.text.link, fontWeight: '600' },
    badges:      { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 4 },
    tag:         { fontSize: 12 },
    unread:      { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: colors.action.primary, alignItems: 'center', justifyContent: 'center' },
    unreadText:  { color: colors.action.primaryFg, fontSize: 11, fontWeight: '800' },
    fab:         { position: 'absolute', right: 18, bottom: 108, width: 60, height: 60, borderRadius: 20, backgroundColor: colors.action.primary, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
    fabText:     { color: colors.action.primaryFg, fontSize: 28, fontWeight: '700', marginTop: -2 },
  });
}
