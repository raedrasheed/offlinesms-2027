// ReactionsSheet — bottom sheet showing who reacted to a message and with what.
//
// Opened by tapping a message's reaction pill in a group. Lists every reactor
// with their avatar, name and the emoji they used, plus emoji filter tabs.
// Tapping your own row removes your reaction. Names are resolved via the
// shared display-name resolver; `resolveName` (from the conversation screen)
// only supplies photos / member snapshots used while a profile loads.

import { useMemo, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ScrollView, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius } from '../theme';
import { useTranslation } from 'react-i18next';
import { avatarColor, initials } from '../lib/avatar';
import { useDisplayNames, useUserProfiles } from '../lib/userProfiles';

export type ReactorInfo = { name: string; photoURL?: string | null };

export function ReactionsSheet({
  visible, onClose, reactions, myUid, resolveName, onRemoveMine,
}: {
  visible:      boolean;
  onClose:      () => void;
  reactions:    Record<string, string[]> | null | undefined;
  myUid:        string;
  resolveName?: (uid: string) => ReactorInfo | null | undefined;
  onRemoveMine: (emoji: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [tab, setTab] = useState<string>('all'); // 'all' or a specific emoji

  // Flatten reactions into per-user rows and tally per-emoji counts.
  const { rows, emojis, total } = useMemo(() => {
    const entries = Object.entries(reactions ?? {})
      .filter(([, uids]) => (uids ?? []).length > 0);
    const allRows = entries.flatMap(([emoji, uids]) =>
      uids.map((uid) => ({ uid, emoji })),
    );
    const emojiList = entries.map(([emoji, uids]) => ({ emoji, count: uids.length }));
    return { rows: allRows, emojis: emojiList, total: allRows.length };
  }, [reactions]);

  // Resolve reactor names/photos only while the sheet is open.
  const reactorUids = useMemo(
    () => (visible ? rows.map((r) => r.uid) : []),
    [visible, rows],
  );
  const nameFor = useDisplayNames(reactorUids);
  const profiles = useUserProfiles(reactorUids);

  const visibleRows = useMemo(
    () => (tab === 'all' ? rows : rows.filter((r) => r.emoji === tab)),
    [rows, tab],
  );

  // Reset to "All" whenever the active tab's emoji disappears.
  const tabExists = tab === 'all' || emojis.some((e) => e.emoji === tab);
  const activeTab = tabExists ? tab : 'all';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={[s.sheet, { paddingBottom: insets.bottom + 12 }]} onPress={() => {}}>
          <View style={s.grabber} />
          <Text style={s.title}>Reactions</Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.tabs}
          >
            <Pressable
              style={[s.tab, activeTab === 'all' && s.tabOn]}
              onPress={() => setTab('all')}
            >
              <Text style={[s.tabText, activeTab === 'all' && s.tabTextOn]}>All {total}</Text>
            </Pressable>
            {emojis.map((e) => (
              <Pressable
                key={e.emoji}
                style={[s.tab, activeTab === e.emoji && s.tabOn]}
                onPress={() => setTab(e.emoji)}
              >
                <Text style={s.tabEmoji}>{e.emoji}</Text>
                <Text style={[s.tabText, activeTab === e.emoji && s.tabTextOn]}>{e.count}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <ScrollView style={s.list} contentContainerStyle={{ paddingBottom: 8 }}>
            {visibleRows.map((r) => {
              const known = resolveName?.(r.uid) ?? null;
              const mine = r.uid === myUid;
              const info: ReactorInfo = {
                name: nameFor(r.uid, { snapshot: known?.name }),
                photoURL: profiles[r.uid]?.photoURL || known?.photoURL || null,
              };
              return (
                <Pressable
                  key={`${r.emoji}:${r.uid}`}
                  style={s.row}
                  disabled={!mine}
                  onPress={() => { if (mine) { onRemoveMine(r.emoji); onClose(); } }}
                >
                  {info.photoURL ? (
                    <Image source={{ uri: info.photoURL }} style={s.avatar} />
                  ) : (
                    <View style={[s.avatar, { backgroundColor: avatarColor(r.uid) }]}>
                      <Text style={s.avatarText}>{initials(info.name)}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.name} numberOfLines={1}>
                      {mine ? t('names.you') : info.name}
                    </Text>
                    {mine ? <Text style={s.tapHint}>Tap to remove</Text> : null}
                  </View>
                  <Text style={s.rowEmoji}>{r.emoji}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,18,32,0.55)', justifyContent: 'flex-end' },
  sheet:    { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 18, paddingTop: 10, maxHeight: '70%' },
  grabber:  { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: colors.ink300, marginBottom: 12 },
  title:    { fontSize: 17, fontWeight: '800', color: colors.ink, marginBottom: 12 },
  tabs:     { gap: 8, paddingBottom: 12 },
  tab:      { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.ink300 },
  tabOn:    { backgroundColor: colors.primary, borderColor: colors.primary },
  tabEmoji: { fontSize: 14 },
  tabText:  { fontSize: 13, fontWeight: '700', color: colors.ink700 },
  tabTextOn:{ color: '#fff' },
  list:     { marginTop: 2 },
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  avatar:   { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  name:     { fontSize: 15, fontWeight: '700', color: colors.ink },
  tapHint:  { fontSize: 11, color: colors.ink500, marginTop: 2 },
  rowEmoji: { fontSize: 22 },
});
