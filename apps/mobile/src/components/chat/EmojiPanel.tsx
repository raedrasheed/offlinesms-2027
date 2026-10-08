// Composer emoji panel: search (English + Arabic keywords), recently used,
// the animated 3D set, and the full Unicode categories the device can render.
// Rendered inline in place of the keyboard (see ComposerPanel). Virtualized:
// only the visible rows mount, so opening stays fast with ~1,900 emoji.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, StyleSheet, Platform, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { isRTL } from '../../i18n';
import {
  emojiGroups, maxEmojiVersionFor, buildRows, searchEmoji, type PickerRow, type PickerSection,
} from '../../lib/emojiCatalog';
import { EMOJI_3D } from '../../lib/emoji3d';
import { createRecentStore } from '../../lib/recents';

const CELL = 44;
const HEADER = 30;
const RECENT_MAX = 32;

const MAX_VERSION = maxEmojiVersionFor(Platform.OS, Platform.Version as any);
const stores = new Map<string, ReturnType<typeof createRecentStore<string>>>();
function recentStore(uid: string) {
  let s = stores.get(uid);
  if (!s) { s = createRecentStore<string>(`recents.emoji.v1:${uid}`, RECENT_MAX); stores.set(uid, s); }
  return s;
}

export function EmojiPanel({ uid, onPick, initialQuery = '' }: { uid: string; onPick: (emoji: string) => void; initialQuery?: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const { width } = useWindowDimensions();
  const columns = Math.max(6, Math.floor((width - 16) / CELL));
  const listRef = useRef<FlatList<PickerRow>>(null);

  const [recents, setRecents] = useState<string[]>([]);
  const [query, setQuery] = useState(initialQuery);
  useEffect(() => { void recentStore(uid).load().then(setRecents); }, [uid]);

  const groups = useMemo(() => emojiGroups(MAX_VERSION), []);
  const sections: PickerSection[] = useMemo(() => [
    { key: 'recent', items: recents },
    { key: 'animated', items: EMOJI_3D.map(e => e.char) },
    ...groups.map(g => ({ key: g.key, items: g.emojis })),
  ], [recents, groups]);

  const results = useMemo(() => (query.trim() ? searchEmoji(query, MAX_VERSION) : null), [query]);
  const { rows, sectionStart } = useMemo(
    () => buildRows(results ? [{ key: 'results', items: results }] : sections, columns),
    [results, sections, columns],
  );
  const offsets = useMemo(() => {
    const o: number[] = [];
    let y = 0;
    for (const r of rows) { o.push(y); y += r.type === 'header' ? HEADER : CELL; }
    return o;
  }, [rows]);

  const pick = useCallback((e: string) => {
    onPick(e);
    void recentStore(uid).add(e).then(setRecents);
  }, [onPick, uid]);

  const jump = (key: string) => {
    const i = sectionStart[key];
    if (i != null) listRef.current?.scrollToOffset({ offset: offsets[i], animated: false });
  };

  const tabs: Array<{ key: string; icon: string }> = [
    ...(recents.length ? [{ key: 'recent', icon: '🕘' }] : []),
    { key: 'animated', icon: '✨' },
    ...groups.map(g => ({ key: g.key, icon: g.icon })),
  ];

  const renderItem = useCallback(({ item }: { item: PickerRow }) => (
    item.type === 'header'
      ? <Text style={s.header}>{t(`emoji.cat.${item.section}`)}</Text>
      : <EmojiRow items={item.items} onPick={pick} cellStyle={s.cell} textStyle={s.emoji} />
  ), [pick, s, t]);

  return (
    <View style={s.root}>
      <View style={s.searchRow}>
        <Ionicons name="search" size={16} color={colors.text.muted} />
        <TextInput
          style={[s.search, { textAlign: isRTL ? 'right' : 'left' }]}
          value={query}
          onChangeText={setQuery}
          placeholder={t('emoji.search')}
          placeholderTextColor={colors.text.disabled}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={t('emoji.search')}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
            <Ionicons name="close-circle" size={18} color={colors.text.muted} />
          </Pressable>
        ) : null}
      </View>
      {results && results.length === 0 ? <Text style={s.empty}>{t('emoji.noResults')}</Text> : null}
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={r => r.key}
        renderItem={renderItem}
        getItemLayout={(_, index) => ({
          length: rows[index]?.type === 'header' ? HEADER : CELL, offset: offsets[index] ?? 0, index,
        })}
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={5}
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews
      />
      {!results ? (
        <View style={s.tabs}>
          {tabs.map(tb => (
            <Pressable
              key={tb.key}
              style={s.tab}
              onPress={() => jump(tb.key)}
              accessibilityRole="button"
              accessibilityLabel={t(`emoji.cat.${tb.key}`)}
            >
              <Text style={s.tabIcon}>{tb.icon}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const EmojiRow = memo(function EmojiRow({ items, onPick, cellStyle, textStyle }: {
  items: string[]; onPick: (e: string) => void; cellStyle: any; textStyle: any;
}) {
  return (
    <View style={{ flexDirection: 'row', paddingHorizontal: 8 }}>
      {items.map(e => (
        <Pressable key={e} style={cellStyle} onPress={() => onPick(e)} accessibilityRole="button" accessibilityLabel={e}>
          <Text style={textStyle} allowFontScaling={false}>{e}</Text>
        </Pressable>
      ))}
    </View>
  );
});

function styles(colors: any) {
  return StyleSheet.create({
    root:      { flex: 1 },
    searchRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 10, marginVertical: 8,
      paddingHorizontal: 10, height: 36, borderRadius: 18, backgroundColor: colors.background.subtle,
    },
    search:    { flex: 1, fontSize: 15, color: colors.text.primary, paddingVertical: 0 },
    header:    { height: HEADER, lineHeight: HEADER, paddingHorizontal: 12, fontSize: 12, fontWeight: '700', color: colors.text.muted, textAlign: isRTL ? 'right' : 'left' },
    cell:      { width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center' },
    emoji:     { fontSize: 28, lineHeight: 34 },
    empty:     { textAlign: 'center', color: colors.text.muted, paddingVertical: 16 },
    tabs:      { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border.subtle, paddingVertical: 4 },
    tab:       { paddingHorizontal: 4, paddingVertical: 4 },
    tabIcon:   { fontSize: 20 },
  });
}
