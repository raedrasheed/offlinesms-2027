// The panel that replaces the keyboard under the composer: Emoji | Stickers.
// Its height follows the last keyboard height, so switching between keyboard
// and panel doesn't make the conversation jump. Each tab mounts on first use.

import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { EmojiPanel } from './EmojiPanel';
import { StickerPanel, type PickedSticker } from './StickerPanel';

export type ComposerTab = 'emoji' | 'stickers';

export function ComposerPanel({
  uid, height, bottomInset, onEmoji, onSticker, initialTab = 'emoji', initialQuery,
}: {
  uid: string;
  height: number;
  bottomInset: number;
  onEmoji: (emoji: string) => void;
  onSticker: (s: PickedSticker) => void;
  initialTab?: ComposerTab;
  initialQuery?: string;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const [tab, setTab] = useState<ComposerTab>(initialTab);
  const [seen, setSeen] = useState<Record<ComposerTab, boolean>>({ emoji: initialTab === 'emoji', stickers: initialTab === 'stickers' });
  const select = (k: ComposerTab) => { setTab(k); setSeen(v => (v[k] ? v : { ...v, [k]: true })); };

  return (
    <View style={[s.root, { height: height + bottomInset, paddingBottom: bottomInset }]}>
      <View style={s.tabs} accessibilityRole="tablist">
        {(['emoji', 'stickers'] as const).map(k => (
          <Pressable
            key={k}
            style={[s.tab, tab === k && s.tabActive]}
            onPress={() => select(k)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === k }}
          >
            <Text style={[s.tabText, tab === k && s.tabTextActive]}>{t(`composer.${k}`)}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flex: 1, display: tab === 'emoji' ? 'flex' : 'none' }}>
        {seen.emoji ? <EmojiPanel uid={uid} onPick={onEmoji} initialQuery={initialQuery} /> : null}
      </View>
      <View style={{ flex: 1, display: tab === 'stickers' ? 'flex' : 'none' }}>
        {seen.stickers ? <StickerPanel key={uid} uid={uid} onSend={onSticker} /> : null}
      </View>
    </View>
  );
}

function styles(colors: any) {
  return StyleSheet.create({
    root:          { backgroundColor: colors.background.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border.subtle },
    tabs:          { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingTop: 8 },
    tab:           { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16 },
    tabActive:     { backgroundColor: colors.background.subtle },
    tabText:       { fontSize: 14, fontWeight: '600', color: colors.text.muted },
    tabTextActive: { color: colors.text.primary },
  });
}
