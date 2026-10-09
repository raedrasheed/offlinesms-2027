// MemberInfoSheet — tap a sender's avatar in a group chat to see who they are.
//
// Slides up from the bottom with the member's avatar, display name and public
// @username (phone numbers are private PII and not readable by other members,
// so the handle is the public identifier), plus quick actions: message them
// directly, jump to the group info, or copy their handle.
//
// The header is seeded with the name/photo the caller already has (from the
// group member snapshot) so the sheet paints instantly, then upgrades to the
// live public profile (username/about/fresh photo) once it resolves.

import { useEffect, useState } from 'react';
import {
  Modal, View, Text, Pressable, StyleSheet, Image, Clipboard, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { avatarColor, initials } from '../lib/avatar';
import { useTranslation } from 'react-i18next';
import { getUserProfile, UserProfile } from '../lib/userProfiles';
import { displayNameFor } from '../lib/displayNames.pure';

export type MemberInfoSheetProps = {
  visible:      boolean;
  onClose:      () => void;
  uid:          string | null;
  // Seed values the caller already has (group member snapshot) for an instant
  // first paint before the live profile resolves.
  fallbackName?:  string | null;
  fallbackPhoto?: string | null;
  isSelf:       boolean;
  onMessage:    (uid: string) => void;
  onViewGroupInfo: () => void;
};

export function MemberInfoSheet({
  visible, onClose, uid, fallbackName, fallbackPhoto, isSelf, onMessage, onViewGroupInfo,
}: MemberInfoSheetProps) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);

  // Resolve the live public profile whenever the sheet opens for a uid.
  useEffect(() => {
    if (!visible || !uid) { setProfile(null); return; }
    let alive = true;
    setLoading(true);
    setPhotoFailed(false);
    getUserProfile(uid)
      .then(p => { if (alive) setProfile(p); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [visible, uid]);

  if (!uid) return null;

  const name  = displayNameFor(profile, { uid, snapshot: fallbackName, fallback: t('names.unknownUser') });
  const photo = profile?.photoURL ?? fallbackPhoto ?? null;
  const handle = profile?.username ? `@${profile.username}` : null;
  const about  = profile?.about || null;

  function copyHandle() {
    if (!handle) return;
    try { (Clipboard as any).setString?.(handle); } catch { /* noop */ }
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => { /* swallow */ }}>
          <View style={s.grabber} />

          {/* Identity header */}
          <View style={s.hero}>
            {photo && !photoFailed ? (
              <Image source={{ uri: photo }} style={s.avatar} onError={() => setPhotoFailed(true)} />
            ) : (
              <View style={[s.avatar, { backgroundColor: avatarColor(uid) }]}>
                <Text style={s.avatarText}>{initials(name)}</Text>
              </View>
            )}
            <Text style={s.name} numberOfLines={1}>{isSelf ? t('names.youSuffix', { name }) : name}</Text>
            {handle ? (
              <Text style={s.handle} numberOfLines={1}>{handle}</Text>
            ) : loading ? (
              <ActivityIndicator size="small" color={colors.ink400} style={{ marginTop: 6 }} />
            ) : null}
            {about ? <Text style={s.about} numberOfLines={3}>{about}</Text> : null}
          </View>

          {/* Actions */}
          <View style={s.actions}>
            {!isSelf ? (
              <Pressable style={s.action} onPress={() => onMessage(uid)}>
                <View style={[s.actionIcon, { backgroundColor: colors.primaryLight }]}>
                  <Ionicons name="chatbubble-ellipses" size={20} color={colors.primary} />
                </View>
                <Text style={s.actionLabel}>{t('names.message')}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.ink400} />
              </Pressable>
            ) : null}

            <Pressable style={s.action} onPress={() => { onClose(); onViewGroupInfo(); }}>
              <View style={[s.actionIcon, { backgroundColor: colors.surface2 }]}>
                <Ionicons name="people" size={20} color={colors.ink700} />
              </View>
              <Text style={s.actionLabel}>{t('names.viewGroupInfo')}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.ink400} />
            </Pressable>

            {handle ? (
              <Pressable style={s.action} onPress={copyHandle}>
                <View style={[s.actionIcon, { backgroundColor: colors.surface2 }]}>
                  <Ionicons name="copy-outline" size={20} color={colors.ink700} />
                </View>
                <Text style={s.actionLabel}>{t('names.copyUsername')}</Text>
              </Pressable>
            ) : null}
          </View>

          <Pressable style={s.cancel} onPress={onClose}>
            <Text style={s.cancelText}>{t('names.close')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: 'rgba(15,18,32,0.55)', justifyContent: 'flex-end' },
  sheet:       { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
  grabber:     { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.ink200, marginBottom: 12 },
  hero:        { alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8 },
  avatar:      { width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center' },
  avatarText:  { color: '#fff', fontWeight: '800', fontSize: 34 },
  name:        { fontSize: 20, fontWeight: '800', color: colors.ink, marginTop: 14, textAlign: 'center' },
  handle:      { fontSize: 14, color: colors.primary, fontWeight: '600', marginTop: 4 },
  about:       { fontSize: 13, color: colors.ink500, marginTop: 10, textAlign: 'center', lineHeight: 19 },
  actions:     { marginTop: 18, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.ink100, overflow: 'hidden' },
  action:      { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 14, borderTopWidth: 1, borderColor: colors.ink100 },
  actionIcon:  { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink },
  cancel:      { marginTop: 14, paddingVertical: 14, borderRadius: 14, backgroundColor: colors.surface2, alignItems: 'center' },
  cancelText:  { fontSize: 15, fontWeight: '700', color: colors.ink700 },
});
