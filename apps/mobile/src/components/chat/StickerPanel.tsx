// Composer sticker panel: recently used + each pack. Tap sends; long-press
// shows a large preview first (release / tap "Send" to send it). Images are
// bundled with the app and only decoded when a cell is on screen.

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, FlatList, Image, Modal, StyleSheet, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { isRTL } from '../../i18n';
import { STICKER_PACKS, findSticker, stickerKey, parseStickerKey, type StickerDef } from '../../lib/stickers';
import { createRecentStore } from '../../lib/recents';
import { STICKER_SOURCES } from './stickerSources';

const RECENT_MAX = 16;
const stores = new Map<string, ReturnType<typeof createRecentStore<string>>>();
function recentStore(uid: string) {
  let s = stores.get(uid);
  if (!s) { s = createRecentStore<string>(`recents.sticker.v1:${uid}`, RECENT_MAX); stores.set(uid, s); }
  return s;
}

export interface PickedSticker { packId: string; stickerId: string; alt: string }

type Row = { key: string; header?: string; cells?: Array<StickerDef & { packId: string }> };

export function StickerPanel({ uid, onSend }: { uid: string; onSend: (s: PickedSticker) => void }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const { width } = useWindowDimensions();
  const columns = Math.max(3, Math.floor(width / 96));
  const cell = Math.floor((width - 16) / columns);
  const [recents, setRecents] = useState<string[]>([]);
  const [preview, setPreview] = useState<(StickerDef & { packId: string }) | null>(null);
  useEffect(() => { void recentStore(uid).load().then(setRecents); }, [uid]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const push = (key: string, header: string, list: Array<StickerDef & { packId: string }>) => {
      if (!list.length) return;
      out.push({ key: `h:${key}`, header });
      for (let i = 0; i < list.length; i += columns) out.push({ key: `${key}:${i}`, cells: list.slice(i, i + columns) });
    };
    const recent = recents.map(parseStickerKey).filter(Boolean)
      .map(r => findSticker(r!.packId, r!.stickerId)!).filter(Boolean);
    push('recent', t('stickers.recent'), recent);
    for (const p of STICKER_PACKS) push(p.id, t(`stickers.pack.${p.id}`), p.stickers.map(st => ({ ...st, packId: p.id })));
    return out;
  }, [recents, columns, t]);

  const send = useCallback((st: StickerDef & { packId: string }) => {
    setPreview(null);
    onSend({ packId: st.packId, stickerId: st.id, alt: st.alt });
    void recentStore(uid).add(stickerKey(st.packId, st.id)).then(setRecents);
  }, [onSend, uid]);

  const name = (st: StickerDef) => (i18n.language?.startsWith('ar') ? st.ar : st.en);

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={rows}
        keyExtractor={r => r.key}
        initialNumToRender={6}
        windowSize={5}
        renderItem={({ item }) => item.header ? (
          <Text style={s.header}>{item.header}</Text>
        ) : (
          <StickerRow cells={item.cells!} size={cell} onSend={send} onPreview={setPreview} label={name} />
        )}
      />
      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <Pressable style={s.backdrop} onPress={() => setPreview(null)}>
          {preview ? (
            <View style={s.previewCard}>
              <Image source={STICKER_SOURCES[preview.packId]?.[preview.id]} style={s.previewImg} />
              <Text style={s.previewName}>{name(preview)}</Text>
              <Pressable style={s.sendBtn} onPress={() => send(preview)} accessibilityRole="button" accessibilityLabel={t('common.send')}>
                <Text style={s.sendText}>{t('common.send')}</Text>
              </Pressable>
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

const StickerRow = memo(function StickerRow({ cells, size, onSend, onPreview, label }: {
  cells: Array<StickerDef & { packId: string }>; size: number;
  onSend: (s: StickerDef & { packId: string }) => void;
  onPreview: (s: StickerDef & { packId: string }) => void;
  label: (s: StickerDef) => string;
}) {
  return (
    <View style={{ flexDirection: 'row', paddingHorizontal: 8 }}>
      {cells.map(st => (
        <Pressable
          key={`${st.packId}/${st.id}`}
          style={{ width: size, height: size, padding: 8 }}
          onPress={() => onSend(st)}
          onLongPress={() => onPreview(st)}
          delayLongPress={250}
          accessibilityRole="button"
          accessibilityLabel={label(st)}
          accessibilityHint="Long-press to preview"
        >
          <Image source={STICKER_SOURCES[st.packId]?.[st.id]} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
        </Pressable>
      ))}
    </View>
  );
});

function styles(colors: any) {
  return StyleSheet.create({
    header:      { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4, fontSize: 12, fontWeight: '700', color: colors.text.muted, textAlign: isRTL ? 'right' : 'left' },
    backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
    previewCard: { backgroundColor: colors.background.surface, borderRadius: 20, padding: 20, alignItems: 'center', gap: 10 },
    previewImg:  { width: 200, height: 200 },
    previewName: { fontSize: 15, fontWeight: '600', color: colors.text.primary },
    sendBtn:     { backgroundColor: colors.action.primary, borderRadius: 20, paddingHorizontal: 28, paddingVertical: 10 },
    sendText:    { color: colors.action.primaryFg, fontWeight: '700' },
  });
}
