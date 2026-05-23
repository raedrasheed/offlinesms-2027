import { useEffect, useMemo, useState } from 'react';
import {
  FlatList, View, Text, Pressable, StyleSheet, TextInput, Alert,
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
import { isRTL } from '../i18n';
import { radius } from '../theme';
import { LoadingState, EmptyState } from '../components/state';

type Filter = 'all' | 'unread' | 'favorites' | 'groups' | 'archived';

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
  const me = auth.currentUser?.uid;
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
    else if (filter === 'archived')  out = out.filter(c => c.state?.archived === true);
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
    archived:  'Archived',
  };

  const s = buildStyles(colors, isRTL);
  const firstName = (auth.currentUser?.displayName ?? '').trim().split(/\s+/)[0] || '';

  if (rows === null) return <LoadingState fullPage title="Loading chats…" />;

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.h1}>{t('chats.title')}</Text>
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
          {(['all','unread','favorites','groups','archived'] as Filter[]).map(f => (
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
            </Pressable>
          ))}
        </View>
      </View>

      {filtered.length === 0 ? (
        <EmptyState
          fullPage
          title={
            filter === 'unread'    ? 'Nothing unread' :
            filter === 'favorites' ? 'No favorite chats yet' :
            filter === 'archived'  ? 'No archived chats' :
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
          contentContainerStyle={{ padding: 12, paddingBottom: 96 }}
          renderItem={({ item }) => (
            <Pressable
              style={s.row}
              onPress={() => navigation.navigate('Conversation', { id: item.id })}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`${item.peerName}${(item.state?.unreadCount ?? 0) > 0 ? `, ${item.state?.unreadCount} unread` : ''}`}
            >
              <View style={s.av} accessibilityElementsHidden>
                <Text style={s.avText}>{(item.peerName ?? '?').slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={s.rowTop}>
                  <Text style={s.name} numberOfLines={1}>
                    {item.peerName}
                    {item.type === 'group' && item.memberCount ? `  · ${item.memberCount}` : ''}
                  </Text>
                  {/* Timestamp is always LTR to prevent digit reversal in RTL */}
                  <Text style={s.time} accessibilityElementsHidden>
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
        onPress={() => Alert.alert(
          'New conversation',
          undefined,
          [
            { text: 'New chat',  onPress: () => navigation.navigate('NewChat') },
            { text: 'New group', onPress: () => navigation.navigate('NewGroup') },
            { text: 'Cancel', style: 'cancel' },
          ],
        )}
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
    header:      { padding: 14, paddingTop: 50, backgroundColor: colors.background.surface, borderBottomWidth: 1, borderColor: colors.border.subtle, gap: 10 },
    h1:          { fontSize: 24, fontWeight: '800', color: colors.text.primary, textAlign: rtl ? 'right' : 'left' },
    search:      { padding: 10, backgroundColor: colors.background.subtle, borderRadius: radius.md, fontSize: 14, color: colors.text.primary },
    chips:       { flexDirection: rtl ? 'row-reverse' : 'row', gap: 8, flexWrap: 'wrap' },
    chip:        { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.background.subtle, borderWidth: 1, borderColor: colors.border.default, minHeight: 32 },
    chipActive:  { backgroundColor: colors.action.primary, borderColor: colors.action.primary },
    chipText:    { fontSize: 12, color: colors.text.secondary, fontWeight: '600' },
    chipTextActive: { color: colors.action.primaryFg },
    row:         { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, marginBottom: 6, backgroundColor: colors.background.surface, borderWidth: 1, borderColor: colors.border.subtle },
    av:          { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.action.primary, alignItems: 'center', justifyContent: 'center' },
    avText:      { color: colors.action.primaryFg, fontWeight: '700' },
    rowTop:      { flexDirection: rtl ? 'row-reverse' : 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
    rowBot:      { flexDirection: rtl ? 'row-reverse' : 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2, gap: 6 },
    name:        { fontSize: 14, fontWeight: '700', color: colors.text.primary, flex: 1, textAlign: rtl ? 'right' : 'left' },
    time:        { fontSize: 11, color: colors.text.muted, writingDirection: 'ltr' },
    preview:     { fontSize: 12, color: colors.text.muted, flex: 1, textAlign: rtl ? 'right' : 'left' },
    badges:      { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 4 },
    tag:         { fontSize: 12 },
    unread:      { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: colors.action.primary, alignItems: 'center', justifyContent: 'center' },
    unreadText:  { color: colors.action.primaryFg, fontSize: 11, fontWeight: '800' },
    fab:         { position: 'absolute', right: 18, bottom: 22, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.action.primary, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
    fabText:     { color: colors.action.primaryFg, fontSize: 28, fontWeight: '700', marginTop: -2 },
  });
}
