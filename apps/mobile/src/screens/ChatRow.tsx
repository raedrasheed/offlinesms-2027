// Memoised chat-list row.
//
// Extracted from ChatsList so a presence/state update on ONE chat doesn't
// re-render every visible row. The memo comparator compares the fields the
// row actually paints, so the cheap shallow check skips identical rows even
// though `filtered` rebuilds a fresh `item` reference per parent render.

import { memo, useCallback, useMemo } from 'react';
import { View, Text, Pressable, Image, StyleSheet } from 'react-native';
import type { ChatPresence } from '../services/presenceService';
import type { Conversation, UserState } from '../lib/conversations';
import { avatarColor, initials } from '../lib/avatar';
import { isRTL } from '../i18n';

export type ChatListRow = Conversation & {
  state?:        UserState;
  peerName?:     string;
  photoURL?:     string | null;
  someoneTyping: boolean;
};

type Props = {
  item:           ChatListRow;
  presence?:      ChatPresence;
  typingLabel:    string;
  recordingLabel: string;
  onOpen:         (id: string) => void;
  onLongPress:    (id: string, name: string) => void;
  formatTime:     (ts?: any) => string;
  colors:         any;
};

function activityText(p: ChatPresence | undefined, typing: string, recording: string): string | null {
  if (!p) return null;
  if (p.recordingUids.length > 0) return recording;
  if (p.typingUids.length > 0)    return typing;
  return null;
}

function ChatRowImpl({ item, presence, typingLabel, recordingLabel, onOpen, onLongPress, formatTime, colors }: Props) {
  const s = useMemo(() => styles(colors), [colors]);
  const handlePress     = useCallback(() => onOpen(item.id), [onOpen, item.id]);
  const handleLongPress = useCallback(() => onLongPress(item.id, item.peerName ?? ''), [onLongPress, item.id, item.peerName]);

  const photoSrc = useMemo(() => (item.photoURL ? { uri: item.photoURL } : null), [item.photoURL]);
  const placeholderStyle = useMemo<any>(() => ({ backgroundColor: avatarColor(item.id) }), [item.id]);

  const activity = activityText(presence, typingLabel, recordingLabel);
  const unread   = item.state?.unreadCount ?? 0;
  const online   = item.type !== 'group' && !!presence?.online;
  const lastAt   = item.state?.lastMessageAt ?? item.lastMessageAt;
  const preview  = activity ?? (item.state?.lastMessagePreview || item.lastMessageText || '');

  return (
    <Pressable
      style={s.row}
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={300}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${item.peerName ?? ''}${unread > 0 ? `, ${unread} unread` : ''}`}
    >
      <View style={s.avWrap} accessibilityElementsHidden>
        {photoSrc ? (
          <Image source={photoSrc} style={[s.av, item.type === 'group' && s.avGroup]} />
        ) : (
          <View style={[s.av, item.type === 'group' && s.avGroup, placeholderStyle]}>
            <Text style={s.avText}>{initials(item.peerName ?? '?')}</Text>
          </View>
        )}
        {online ? <View style={s.onlineDot} /> : null}
      </View>
      <View style={s.bodyCol}>
        <View style={s.rowTop}>
          <Text style={s.name} numberOfLines={1}>
            {item.peerName}
            {item.type === 'group' && item.memberCount ? `  · ${item.memberCount}` : ''}
          </Text>
          <Text style={s.time} accessibilityElementsHidden>{formatTime(lastAt)}</Text>
        </View>
        <View style={s.rowBot}>
          <Text style={[s.preview, activity ? s.previewActivity : null]} numberOfLines={1}>{preview}</Text>
          <View style={s.badges} accessibilityElementsHidden>
            {item.state?.pinned ? <Text style={s.tag}>📌</Text> : null}
            {item.state?.muted  ? <Text style={s.tag}>🔕</Text> : null}
            {unread > 0 ? (
              <View style={s.unread}>
                <Text style={s.unreadText}>{unread > 99 ? '99+' : unread}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// Comparator: only the fields this row paints. Reference-compare presence
// (the parent updates the map immutably so untouched slices stay identical).
function areRowPropsEqual(a: Props, b: Props): boolean {
  if (a.onOpen        !== b.onOpen)        return false;
  if (a.onLongPress   !== b.onLongPress)   return false;
  if (a.formatTime    !== b.formatTime)    return false;
  if (a.typingLabel   !== b.typingLabel)   return false;
  if (a.recordingLabel!== b.recordingLabel)return false;
  if (a.colors        !== b.colors)        return false;
  if (a.presence      !== b.presence)      return false;
  const i = a.item, j = b.item;
  if (i === j) return true;
  if (i.id !== j.id) return false;
  if (i.peerName  !== j.peerName)  return false;
  if (i.photoURL  !== j.photoURL)  return false;
  if (i.type      !== j.type)      return false;
  if (i.memberCount !== j.memberCount) return false;
  if ((i as any).lastMessageAt !== (j as any).lastMessageAt) return false;
  if ((i as any).lastMessageText !== (j as any).lastMessageText) return false;
  const sa = i.state, sb = j.state;
  if (sa === sb) return true;
  if (!!sa !== !!sb) return false;
  if (sa && sb) {
    if (sa.unreadCount !== sb.unreadCount) return false;
    if (sa.pinned      !== sb.pinned)      return false;
    if (sa.muted       !== sb.muted)       return false;
    if ((sa as any).lastMessageAt !== (sb as any).lastMessageAt) return false;
    if ((sa as any).lastMessagePreview !== (sb as any).lastMessagePreview) return false;
    if (sa.archived    !== sb.archived)    return false;
    if (sa.favorite    !== sb.favorite)    return false;
  }
  return true;
}

export const ChatRow = memo(ChatRowImpl, areRowPropsEqual);

function styles(colors: any) {
  const rtl = isRTL;
  // Mirrors the styles previously inlined in ChatsList.tsx so the row keeps
  // its exact prior look. Single source of truth lives here now.
  return StyleSheet.create({
    row:         { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 16 },
    avWrap:      { width: 52, height: 52 },
    av:          { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
    avGroup:     { borderRadius: 18 },
    avText:      { color: '#fff', fontWeight: '800', fontSize: 17 },
    onlineDot:   { position: 'absolute', bottom: 1, right: rtl ? undefined : 1, left: rtl ? 1 : undefined, width: 15, height: 15, borderRadius: 8, backgroundColor: '#22C55E', borderWidth: 2.5, borderColor: colors.background.app },
    bodyCol:     { flex: 1, minWidth: 0 },
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
  });
}
