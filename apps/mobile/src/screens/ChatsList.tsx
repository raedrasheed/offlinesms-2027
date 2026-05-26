import { useEffect, useMemo, useState } from 'react';
import {
  FlatList, View, Text, Pressable, StyleSheet, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  collection, onSnapshot, doc, query, where,
} from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { db, auth } from '../lib/firebase';
import {
  subscribeConversations,
  Conversation,
  UserState,
} from '../lib/conversations';
import { useTheme } from '../context/ThemeContext';
import { useUnread } from '../context/UnreadContext';
import { isRTL } from '../i18n';
import { radius } from '../theme';
import { avatarColor, initials } from '../lib/avatar';
import { LoadingState, EmptyState } from '../components/state';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useOffline } from '../context/OfflineContext';
import { OfflineBanner, SyncingBanner } from '../components/OfflineBanners';

type Filter = 'all' | 'unread' | 'favorites' | 'groups';

type Row = Conversation & {
  state?:        UserState;
  peerName?:     string;
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
  const { unreadChats } = useUnread();
  const me = auth.currentUser?.uid;
  const insets = useSafeAreaInsets();
  const { isOffline, isSyncing, queuedCount } = useOffline();
  const [rows, setRows] = useState<Conversation[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  // Per-conversation state + typing + peer profile, keyed by conversation id.
  const [states, setStates]   = useState<Record<string, UserState | undefined>>({});
  const [typing, setTyping]   = useState<Record<string, boolean>>({});
  const [peers, setPeers]     = useState<Record<string, { name?: string }>>({});

  // Conversations list.
  useEffect(() => subscribeConversations(setRows), []);

  // Per-conversation subscriptions: userState + typing + peer display name.
  useEffect(() => {
    if (!me || !rows) return;
    const unsubs: Array<() => void> = [];
    for (const c of rows) {
      // user state
      unsubs.push(onSnapshot(doc(db, 'conversations', c.id, 'userState', me), snap => {
        setStates(prev => ({ ...prev, [c.id]: snap.exists() ? ({ uid: me, ...snap.data() } as UserState) : undefined }));
      }));
      // typing
      unsubs.push(onSnapshot(
        query(collection(db, 'conversations', c.id, 'typing'), where('isTyping', '==', true)),
        snap => {
          const now = Date.now();
          let live = false;
          for (const d of snap.docs) {
            if (d.id === me) continue;
            const exp = (d.data().expiresAt?.toMillis?.() ?? 0) as number;
            if (exp > now) { live = true; break; }
          }
          setTyping(prev => ({ ...prev, [c.id]: live }));
        },
      ));
      // peer profile (direct conversations only)
      if (c.type === 'direct' && c.participantUids?.length === 2) {
        const peerUid = c.participantUids.find(u => u !== me);
        if (peerUid && !peers[peerUid]) {
          unsubs.push(onSnapshot(doc(db, 'users', peerUid), snap => {
            const data = snap.data() as { displayName?: string; username?: string } | undefined;
            const name = data?.displayName || (data?.username ? `@${data.username}` : peerUid.slice(0, 6));
            setPeers(prev => ({ ...prev, [c.id]: { name } }));
          }));
        }
      }
    }
    return () => { for (const u of unsubs) try { u(); } catch {} };
  }, [me, rows]);

  const enriched: Row[] = useMemo(() => {
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
        someoneTyping: typing[c.id] ?? false,
      };
    });
  }, [rows, states, peers, typing]);

  const filtered = useMemo(() => {
    let out = enriched;
    if (filter === 'unread')         out = out.filter(c => (c.state?.unreadCount ?? 0) > 0);
    else if (filter === 'favorites') out = out.filter(c => c.state?.favorite === true);
    else if (filter === 'groups')    out = out.filter(c => c.type === 'group');
    else                             out = out.filter(c => c.state?.archived !== true);

    const t = search.trim().toLowerCase();
    if (t) out = out.filter(c => (c.peerName ?? '').toLowerCase().includes(t));
    return out;
  }, [enriched, filter, search]);

  const FILTER_LABELS: Record<Filter, string> = {
    all:       t('chats.filterAll'),
    unread:    t('chats.filterUnread'),
    favorites: t('chats.filterFavorites'),
    groups:    t('chats.filterGroups'),
  };

  const s = buildStyles(colors, isRTL);
  const firstName = (auth.currentUser?.displayName ?? '').trim().split(/\s+/)[0] || '';

  if (rows === null) return <LoadingState fullPage title="Loading chats…" />;

  return (
    <View style={s.root}>
      <StatusBar style="dark" translucent backgroundColor="transparent" />
      <View style={[s.header, { paddingTop: insets.top + 4 }]}>
        <Text style={s.h1}>OfflineSMS</Text>
        <TextInput
          style={s.search}
          placeholder={t('chats.search')}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          textAlign={isRTL ? 'right' : 'left'}
          accessibilityLabel={t('chats.search')}
        />
        <View style={s.chips}>
          {(['all','unread','favorites','groups'] as Filter[]).map(f => (
            <Pressable
              key={f}
              style={[s.chip, filter === f && s.chipActive]}
              onPress={() => setFilter(f)}
              accessibilityRole="radio"
              accessibilityLabel={FILTER_LABELS[f]}
              accessibilityState={{ selected: filter === f }}
            >
              <Text style={[s.chipText, filter === f && s.chipTextActive]}>
                {FILTER_LABELS[f]}
              </Text>
              {f === 'unread' && unreadChats > 0 ? (
                <View style={[s.chipBadge, filter === f && s.chipBadgeActive]}>
                  <Text style={[s.chipBadgeText, filter === f && s.chipBadgeTextActive]}>
                    {unreadChats > 99 ? '99+' : unreadChats}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      </View>

      {isSyncing && queuedCount > 0 ? <SyncingBanner count={queuedCount} /> : isOffline ? <OfflineBanner /> : null}

      {filtered.length === 0 ? (
        <EmptyState
          fullPage
          title={
            filter === 'unread'    ? 'Nothing unread' :
            filter === 'favorites' ? 'No favorite chats yet' :
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
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 96 }}
          renderItem={({ item }) => (
            <Pressable
              style={s.row}
              onPress={() => navigation.navigate('Conversation', { id: item.id })}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`${item.peerName}${(item.state?.unreadCount ?? 0) > 0 ? `, ${item.state?.unreadCount} unread` : ''}`}
            >
              <View style={s.avWrap} accessibilityElementsHidden>
                <View style={[s.av, item.type === 'group' && s.avGroup, { backgroundColor: avatarColor(item.id) }]}>
                  <Text style={s.avText}>{initials(item.peerName ?? '?')}</Text>
                </View>
                {item.type !== 'group' ? <View style={s.onlineDot} /> : null}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={s.rowTop}>
                  <Text style={s.name} numberOfLines={1}>
                    {item.peerName}
                    {item.type === 'group' && item.memberCount ? `  · ${item.memberCount}` : ''}
                  </Text>
                  {/* Timestamp is always LTR to prevent digit reversal in RTL */}
                  <Text
                    style={[s.time, (item.state?.unreadCount ?? 0) > 0 && s.timeUnread]}
                    accessibilityElementsHidden
                  >
                    {formatTime(item.state?.lastMessageAt ?? item.lastMessageAt)}
                  </Text>
                </View>
                <View style={s.rowBot}>
                  <Text style={s.preview} numberOfLines={1}>
                    {item.someoneTyping
                      ? t('convo.typing')
                      : (item.state?.lastMessagePreview || item.lastMessageText || '')}
                  </Text>
                  <View style={s.badges} accessibilityElementsHidden>
                    {item.state?.pinned   ? <Text style={s.tag}>📌</Text> : null}
                    {item.state?.muted    ? <Text style={s.tag}>🔕</Text> : null}
                    {(item.state?.unreadCount ?? 0) > 0 ? (
                      <View style={s.unread}>
                        <Text style={s.unreadText}>
                          {(item.state?.unreadCount ?? 0) > 99 ? '99+' : item.state?.unreadCount}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>
            </Pressable>
          )}
        />
      )}

      <Pressable
        style={[s.fab, isRTL && { right: undefined, left: 18 }]}
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
    root:        { flex: 1, backgroundColor: '#FFFFFF' },
    header:      { paddingHorizontal: 14, paddingBottom: 14, backgroundColor: '#FFFFFF', gap: 12 },
    h1:          { fontSize: 26, fontWeight: '800', color: colors.action.primary, textAlign: rtl ? 'right' : 'left' },
    search:      { padding: 12, backgroundColor: colors.background.subtle, borderRadius: radius.md, fontSize: 14, color: colors.text.primary },
    chips:       { flexDirection: rtl ? 'row-reverse' : 'row', gap: 8, flexWrap: 'wrap' },
    chip:        { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border.strong, minHeight: 32 },
    chipActive:  { backgroundColor: colors.action.primary, borderColor: colors.action.primary },
    chipText:    { fontSize: 13, color: colors.text.secondary, fontWeight: '700' },
    chipTextActive: { color: colors.action.primaryFg },
    chipBadge:   { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: colors.action.primary, alignItems: 'center', justifyContent: 'center' },
    chipBadgeActive: { backgroundColor: colors.action.primaryFg },
    chipBadgeText: { color: colors.action.primaryFg, fontSize: 11, fontWeight: '800' },
    chipBadgeTextActive: { color: colors.action.primary },
    row:         { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 16 },
    avWrap:      { width: 52, height: 52 },
    av:          { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
    avGroup:     { borderRadius: 18 },
    avText:      { color: '#fff', fontWeight: '800', fontSize: 17 },
    onlineDot:   { position: 'absolute', bottom: 1, right: rtl ? undefined : 1, left: rtl ? 1 : undefined, width: 15, height: 15, borderRadius: 8, backgroundColor: '#22C55E', borderWidth: 2.5, borderColor: '#FFFFFF' },
    rowTop:      { flexDirection: rtl ? 'row-reverse' : 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
    rowBot:      { flexDirection: rtl ? 'row-reverse' : 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2, gap: 6 },
    name:        { fontSize: 16, fontWeight: '800', color: colors.text.primary, flex: 1, textAlign: rtl ? 'right' : 'left' },
    time:        { fontSize: 12, color: colors.text.muted, writingDirection: 'ltr' },
    timeUnread:  { color: colors.action.primary, fontWeight: '700' },
    preview:     { fontSize: 14, color: colors.text.muted, flex: 1, textAlign: rtl ? 'right' : 'left' },
    badges:      { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 4 },
    tag:         { fontSize: 12 },
    unread:      { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: colors.action.primary, alignItems: 'center', justifyContent: 'center' },
    unreadText:  { color: colors.action.primaryFg, fontSize: 11, fontWeight: '800' },
    fab:         { position: 'absolute', right: 18, bottom: 22, width: 60, height: 60, borderRadius: 20, backgroundColor: colors.action.primary, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
    fabText:     { color: colors.action.primaryFg, fontSize: 28, fontWeight: '700', marginTop: -2 },
  });
}
