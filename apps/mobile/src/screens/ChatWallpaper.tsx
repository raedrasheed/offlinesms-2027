// Chat wallpaper picker — used for both the global default (Settings →
// Appearance) and per-conversation overrides (Chat details). When a
// conversationId param is present the screen edits that chat's wallpaper and
// "Use default" means "fall back to the global default"; otherwise it edits
// the global default and "Use default" clears it to the theme background.

import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import {
  getChatWallpaper,
  pickAndSaveWallpaper,
  setChatWallpaper,
  setGlobalWallpaper,
  useWallpaper,
} from '../lib/wallpaper';
import { ChatWallpaperBackground } from '../components/ChatWallpaperBackground';

type Params = { conversationId?: string };

export default function ChatWallpaperScreen({ route, navigation }: any) {
  const { conversationId } = (route?.params ?? {}) as Params;
  const isPerChat = !!conversationId;
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);

  // Effective preview = exactly what the chat will show after this save.
  const effective = useWallpaper(conversationId);
  const previewUri = effective.type === 'custom' ? effective.uri : undefined;

  // Track whether a per-chat override exists (controls Remove visibility).
  const [hasChatOverride, setHasChatOverride] = useState(false);
  useEffect(() => {
    if (!conversationId) { setHasChatOverride(false); return; }
    let alive = true;
    getChatWallpaper(conversationId).then(p => { if (alive) setHasChatOverride(!!p); });
    return () => { alive = false; };
  }, [conversationId, previewUri]);

  const [busy, setBusy] = useState(false);

  async function onChoose() {
    setBusy(true);
    try {
      await pickAndSaveWallpaper(isPerChat ? conversationId! : 'global');
    } finally { setBusy(false); }
  }

  async function onUseDefault() {
    setBusy(true);
    try {
      if (isPerChat) await setChatWallpaper(conversationId!, { type: 'default' });
      else           await setGlobalWallpaper({ type: 'default' });
    } finally { setBusy(false); }
  }

  async function onRemoveOverride() {
    if (!isPerChat) return;
    setBusy(true);
    try { await setChatWallpaper(conversationId!, null); }
    finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={colors.text.primary} />
        </Pressable>
        <Text style={s.title}>{isPerChat ? 'Chat wallpaper' : 'Default chat wallpaper'}</Text>
      </View>

      {/* Live preview — exactly how the chat will look. */}
      <View style={s.preview}>
        <ChatWallpaperBackground uri={previewUri} />
        <View style={s.previewBubbles} pointerEvents="none">
          <View style={[s.bubble, s.bubbleIn]}><Text style={s.bubbleText}>Hello 👋</Text></View>
          <View style={[s.bubble, s.bubbleOut]}><Text style={[s.bubbleText, { color: '#fff' }]}>Looking good!</Text></View>
        </View>
      </View>

      <View style={s.actions}>
        <PickerRow
          icon="image-outline"
          label="Choose from gallery"
          onPress={onChoose}
          disabled={busy}
          colors={colors}
        />
        <PickerRow
          icon="refresh-outline"
          label={isPerChat ? 'Use global default' : 'Use default wallpaper'}
          onPress={onUseDefault}
          disabled={busy}
          colors={colors}
        />
        {isPerChat && hasChatOverride ? (
          <PickerRow
            icon="trash-outline"
            label="Remove chat wallpaper"
            onPress={onRemoveOverride}
            disabled={busy}
            colors={colors}
            destructive
          />
        ) : null}
        {busy ? <ActivityIndicator style={{ marginTop: 12 }} color={colors.action.primary} /> : null}
      </View>
    </SafeAreaView>
  );
}

function PickerRow({
  icon, label, onPress, disabled, colors, destructive,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
  destructive?: boolean;
}) {
  const color = destructive ? colors.state.error : colors.text.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: colors.border.subtle,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
        backgroundColor: colors.background.surface,
      })}
    >
      <Ionicons name={icon} size={20} color={color} />
      <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color }}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.text.muted} />
    </Pressable>
  );
}

function styles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    root:   { flex: 1, backgroundColor: colors.background.app },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.background.surface, borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
    title:  { fontSize: 17, fontWeight: '800', color: colors.text.primary },
    preview:{ height: 240, margin: 16, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.background.surface },
    previewBubbles: { position: 'absolute', left: 12, right: 12, bottom: 12, gap: 6 },
    bubble: { maxWidth: '75%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14 },
    bubbleIn:  { backgroundColor: colors.background.surface, alignSelf: 'flex-start' },
    bubbleOut: { backgroundColor: colors.action.primary, alignSelf: 'flex-end' },
    bubbleText:{ fontSize: 13, color: colors.text.primary },
    actions:{ marginTop: 4 },
  });
}
