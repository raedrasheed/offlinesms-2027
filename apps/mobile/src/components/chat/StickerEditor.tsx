import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Keyboard, KeyboardAvoidingView, Modal, PanResponder, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { captureRef, releaseCapture } from 'react-native-view-shot';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { cleanStickerEdits, DEFAULT_STICKER_EDITS, STICKER_COLORS, STICKER_EDGE, stickerImageLayout, type StickerEdits } from '../../lib/stickerEditorModel';
import { saveCustomSticker, type CustomSticker } from '../../lib/customStickers';
import { orientStickerImage, removeStickerTemp, type StickerSource } from '../../media/stickerImage';

type StickerEditorProps = {
  uid: string; source: StickerSource; previous?: CustomSticker;
  embedded?: boolean;
  onClose: () => void; onSaved: (stickers: CustomSticker[]) => void;
};
export type StickerEditorHandle = { requestClose: () => void };
export const StickerEditor = forwardRef<StickerEditorHandle, StickerEditorProps>(function StickerEditor({ uid, source, previous, onClose, onSaved, embedded = false }, ref) {
  const { t } = useTranslation(), { colors } = useTheme(), insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const side = Math.max(180, Math.min(width - 48, height * 0.38, 320));
  const [edits, setEdits] = useState<StickerEdits>(() => cleanStickerEdits(previous?.edits));
  const [history, setHistory] = useState<StickerEdits[]>([]);
  const [name, setName] = useState(previous?.name ?? '');
  const [oriented, setOriented] = useState<StickerSource | null>(null);
  const orientationKey = `${source.uri}/${edits.rotation}/${edits.flipX}/${edits.flipY}`;
  const [preparedKey, setPreparedKey] = useState('');
  const [loadedUri, setLoadedUri] = useState('');
  const [saving, setSaving] = useState(false), [imageError, setImageError] = useState(false);
  const [laidOut, setLaidOut] = useState(false), [imageAttempt, setImageAttempt] = useState(0);
  const capture = useRef<View>(null), alive = useRef(true), savingRef = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const current = useRef({ edits, oriented, side, blocked: true });
  const ready = !!oriented && preparedKey === orientationKey && loadedUri === oriented.uri && laidOut && !imageError;
  current.current = { edits, oriented, side, blocked: saving || !ready };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true, temporary: string | undefined;
    setOriented(null); setPreparedKey(''); setLoadedUri(''); setImageError(false);
    void orientStickerImage(source, edits).then(image => {
      if (image.uri !== source.uri) temporary = image.uri;
      if (active) { setOriented(image); setPreparedKey(orientationKey); } else if (temporary) void removeStickerTemp(temporary);
    }).catch(() => { if (active) setImageError(true); });
    return () => { active = false; if (temporary) void removeStickerTemp(temporary); };
  }, [orientationKey, imageAttempt]);

  const remember = () => setHistory(h => [...h.slice(-31), { ...current.current.edits }]);
  const update = (changes: Partial<StickerEdits>) => {
    if (savingRef.current) return;
    remember(); setEdits(e => cleanStickerEdits({ ...e, ...changes }));
  };
  const gesture = useRef({ x: 0, y: 0, zoom: 1, rangeX: 0, rangeY: 0, distance: 0 });
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !current.current.blocked,
    onMoveShouldSetPanResponder: () => !current.current.blocked,
    onPanResponderGrant: () => {
      const c = current.current;
      if (!c.oriented) return;
      remember();
      const layout = stickerImageLayout(c.oriented.width, c.oriented.height, c.side, c.edits);
      gesture.current = { x: c.edits.x, y: c.edits.y, zoom: c.edits.zoom, rangeX: layout.rangeX, rangeY: layout.rangeY, distance: 0 };
    },
    onPanResponderMove: (event, g) => {
      if (current.current.blocked) return;
      const start = gesture.current, touches = event.nativeEvent.touches;
      if (touches.length >= 2) {
        const distance = Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
        if (!start.distance) { start.distance = distance; start.zoom = current.current.edits.zoom; }
        if (start.distance > 0) setEdits(e => cleanStickerEdits({ ...e, zoom: start.zoom * distance / start.distance }));
      } else if (!start.distance) {
        setEdits(e => cleanStickerEdits({ ...e, x: start.rangeX > 0 ? start.x + g.dx / start.rangeX : 0,
          y: start.rangeY > 0 ? start.y + g.dy / start.rangeY : 0 }));
      }
    },
    onPanResponderTerminationRequest: () => false,
  }), []);
  const close = () => {
    if (savingRef.current) return;
    if (history.length || name !== (previous?.name ?? '')) Alert.alert(t('stickers.discardTitle'), t('stickers.discardBody'), [
      { text: t('common.cancel'), style: 'cancel' }, { text: t('stickers.discard'), style: 'destructive', onPress: onClose },
    ]); else onClose();
  };
  useImperativeHandle(ref, () => ({ requestClose: close }));
  async function save() {
    if (!ready || savingRef.current) return;
    savingRef.current = true; setSaving(true); Keyboard.dismiss();scroll.current?.scrollTo({y:0,animated:false});
    let uri: string | undefined;
    try {
      // Wait for the final text/layout paint. Only this transparent view is
      // captured: the checkerboard, crop guides and controls are siblings.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!alive.current) return;
      uri = await captureRef(capture, { format: 'png', result: 'tmpfile', width: STICKER_EDGE, height: STICKER_EDGE });
      const list = await saveCustomSticker(uid, { previous, name: name || t('stickers.customSticker'), sourceUri: source.uri,
        sourceWidth: source.width, sourceHeight: source.height, imageUri: uri, edits });
      if (alive.current) onSaved(list);
    } catch (error: any) {
      if (alive.current) Alert.alert(t('stickers.saveError'), t(error?.message === 'sticker-library-full' ? 'stickers.libraryFull' : 'stickers.tryAgain'));
    } finally {
      if (uri) try { releaseCapture(uri); } catch { /* Temporary-file cleanup is best effort. */ }
      savingRef.current = false; if (alive.current) setSaving(false);
    }
  }
  const layout = oriented ? stickerImageLayout(oriented.width, oriented.height, side, edits) : null;
  const tool = (label: string, icon: keyof typeof Ionicons.glyphMap, action: () => void, selected = false, disabled = false) =>
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled: saving || disabled }}
      disabled={saving || disabled} onPress={action} style={[s.tool, { backgroundColor: selected ? colors.action.primary : colors.background.subtle, opacity: saving || disabled ? 0.45 : 1 }]}>
      <Ionicons name={icon} size={21} color={selected ? colors.action.primaryFg : colors.text.primary} />
      <Text style={{ fontSize: 11, color: selected ? colors.action.primaryFg : colors.text.primary }}>{label}</Text>
    </Pressable>;
  const body = <KeyboardAvoidingView style={[s.screen, { backgroundColor: colors.background.surface, paddingTop: insets.top, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.bar}>
        <Pressable onPress={close} disabled={saving} accessibilityRole="button" accessibilityLabel={t('common.cancel')} style={s.barButton}><Ionicons name="close" size={26} color={colors.text.primary} /></Pressable>
        <Text style={[s.title, { color: colors.text.primary }]}>{t(previous ? 'stickers.edit' : 'stickers.create')}</Text>
        <Pressable onPress={() => void save()} disabled={!ready || saving} accessibilityRole="button" accessibilityLabel={t('common.save')}
          style={[s.barButton, { opacity: ready && !saving ? 1 : 0.4 }]}>
          {saving ? <ActivityIndicator color={colors.action.primary} /> : <Text style={{ color: colors.action.primary, fontWeight: '700' }}>{t('common.save')}</Text>}
        </Pressable>
      </View>
      <ScrollView ref={scroll} removeClippedSubviews={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.body}>
        <View style={[s.checker, { width: side, height: side }]} {...pan.panHandlers} testID="sticker-gesture-stage">
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>{Array.from({ length: 100 }, (_, i) =>
            <View key={i} style={{ position: 'absolute', width: side / 10, height: side / 10,
              left: (i % 10) * side / 10, top: Math.floor(i / 10) * side / 10,
              backgroundColor: (Math.floor(i / 10) + i % 10) % 2 ? '#DADEE3' : '#F5F6F7' }} />)}</View>
          <View ref={capture} collapsable={false} onLayout={() => setLaidOut(true)} testID="sticker-capture"
            style={{ width: side, height: side, overflow: 'hidden', backgroundColor: 'transparent' }}>
            <View style={[StyleSheet.absoluteFill,{overflow:'hidden',borderRadius:edits.shape==='circle'?side/2:0}]}>
            {oriented && layout ? <Image key={oriented.uri} source={{ uri: oriented.uri }} fadeDuration={0} resizeMode="stretch"
              onLoad={() => setLoadedUri(oriented.uri)} onError={() => setImageError(true)} style={{ position: 'absolute', width: layout.width, height: layout.height, left: layout.left, top: layout.top }} /> : null}
            </View>
            {edits.text ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { padding: side * 0.06,
              justifyContent: edits.textPosition === 'top' ? 'flex-start' : edits.textPosition === 'center' ? 'center' : 'flex-end' }]}>
              <Text allowFontScaling={false} numberOfLines={3} style={{ textAlign: 'center', fontSize: side * edits.textSize, lineHeight: side * edits.textSize * 1.25,
                fontWeight: '800', color: edits.color, textShadowColor: edits.color === '#111111' ? '#FFFFFF' : '#111111', textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 } }}>{edits.text}</Text>
            </View> : null}
          </View>
          {!ready ? <View style={[StyleSheet.absoluteFill, s.center, { backgroundColor: '#FFFFFF99' }]}>
            {imageError ? <Pressable onPress={() => setImageAttempt(n => n + 1)} accessibilityRole="button"><Text>{t('stickers.retryImage')}</Text></Pressable> : <ActivityIndicator color={colors.action.primary} />}
          </View> : null}
        </View>
        <Text style={[s.hint, { color: colors.text.muted }]}>{t('stickers.dragHint')}</Text>
        <View style={s.tools}>
          {tool(t('stickers.zoomOut'), 'remove', () => update({ zoom: edits.zoom - 0.25 }), false, edits.zoom <= 1)}
          {tool(t('stickers.zoomIn'), 'add', () => update({ zoom: edits.zoom + 0.25 }), false, edits.zoom >= 4)}
          {tool(t('stickers.rotate'), 'refresh', () => update({ rotation: (edits.rotation + 90) % 360, x: 0, y: 0 }))}
          {tool(t('stickers.flipX'), 'swap-horizontal', () => update({ flipX: !edits.flipX, x: 0 }), edits.flipX)}
          {tool(t('stickers.flipY'), 'swap-vertical', () => update({ flipY: !edits.flipY, y: 0 }), edits.flipY)}
          {tool(t('stickers.crop'), 'crop', () => update({ fit: edits.fit === 'cover' ? 'contain' : 'cover', zoom: 1, x: 0, y: 0 }), edits.fit === 'cover')}
          {tool(t('stickers.circle'), 'ellipse-outline', () => update({ shape: edits.shape === 'circle' ? 'square' : 'circle' }), edits.shape === 'circle')}
          {tool(t('stickers.undo'), 'arrow-undo', () => { const last = history[history.length - 1]; if (last) { setEdits(last); setHistory(h => h.slice(0, -1)); } }, false, !history.length)}
          {tool(t('stickers.reset'), 'reload', () => update(DEFAULT_STICKER_EDITS))}
        </View>
        <TextInput style={[s.input, { color: colors.text.primary, borderColor: colors.border.subtle }]} placeholderTextColor={colors.text.muted}
          value={edits.text} onChangeText={text => update({ text })} editable={!saving} maxLength={80} multiline
          placeholder={t('stickers.addText')} accessibilityLabel={t('stickers.addText')} />
        <View style={s.colors}>{STICKER_COLORS.map(color => <Pressable key={color} onPress={() => update({ color })} disabled={saving}
          accessibilityRole="button" accessibilityLabel={`${t('stickers.textColor')} ${color}`} accessibilityState={{ selected: edits.color === color }}
          style={[s.swatch, { backgroundColor: color, borderWidth: edits.color === color ? 3 : 1, borderColor: edits.color === color ? colors.action.primary : '#AAB2BD' }]} />)}</View>
        <View style={s.tools}>
          {(['top', 'center', 'bottom'] as const).map(position => tool(t(`stickers.text${position}`), 'text', () => update({ textPosition: position }), edits.textPosition === position))}
          {tool(t('stickers.smallerText'), 'remove', () => update({ textSize: edits.textSize - 0.02 }), false, edits.textSize <= 0.07)}
          {tool(t('stickers.largerText'), 'add', () => update({ textSize: edits.textSize + 0.02 }), false, edits.textSize >= 0.15)}
        </View>
        <TextInput style={[s.input, { color: colors.text.primary, borderColor: colors.border.subtle }]} placeholderTextColor={colors.text.muted}
          value={name} onChangeText={setName} editable={!saving} maxLength={60} placeholder={t('stickers.name')} accessibilityLabel={t('stickers.name')} />
      </ScrollView>
    </KeyboardAvoidingView>;
  return embedded ? body : <Modal visible animationType="slide" onRequestClose={close}>{body}</Modal>;
});
const s = StyleSheet.create({
  screen: { flex: 1 }, bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  barButton: { minWidth: 56, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, title: { fontSize: 18, fontWeight: '700' },
  body: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 28, gap: 12 }, checker: { overflow: 'hidden', direction: 'ltr' },
  center: { alignItems: 'center', justifyContent: 'center' }, hint: { textAlign: 'center', fontSize: 12 },
  tools: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, width: '100%' },
  tool: { minWidth: 58, padding: 8, borderRadius: 10, gap: 4, alignItems: 'center' },
  input: { width: '100%', minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  colors: { flexDirection: 'row', gap: 10 }, swatch: { width: 34, height: 34, borderRadius: 17 },
});
