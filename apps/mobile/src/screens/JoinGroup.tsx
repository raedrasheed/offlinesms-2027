// Invite preview and recovery. Profile completion returns to this same invite;
// the server revalidates it before any membership change.
import { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { doc, getDocFromServer } from 'firebase/firestore';
import { InvitePreview, resolveGroupInviteLink, joinGroupByInviteLink, cancelMyJoinRequest } from '../lib/conversations';
import { auth, db } from '../lib/firebase';
import { useOffline } from '../context/OfflineContext';
import { useTheme } from '../context/ThemeContext';
import { avatarColor, initials } from '../lib/avatar';
import { inviteNeedsUsername, inviteProblem, type InviteProblem } from '../lib/inviteJoinModel';
import { radius } from '../theme';

export default function JoinGroup({ route, navigation }: any) {
  const { code } = (route.params ?? {}) as { code?: string };
  const me = auth.currentUser?.uid ?? '';
  const { isOffline } = useOffline();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => buildStyles(colors), [colors]);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [problem, setProblem] = useState<InviteProblem | null>(null);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const resumeJoin = useRef(false);
  const generation = useRef(0);
  const joining = useRef(false);

  const openGroup = useCallback((conversationId: string) =>
    navigation.reset({ index: 1, routes: [{ name: 'Tabs' }, { name: 'Conversation', params: { id: conversationId } }] }), [navigation]);

  const join = useCallback(async () => {
    if (!code || !me || joining.current || isOffline) return;
    const at = generation.current;
    joining.current = true; setBusy(true); setProblem(null);
    try {
      const res = await joinGroupByInviteLink(code);
      if (at !== generation.current || auth.currentUser?.uid !== me) return;
      if (res.status === 'joined' || res.status === 'already_member') openGroup(res.conversationId);
      else setPreview(current => current ? { ...current, status: 'request_pending', hasPendingRequest: true } : current);
    } catch (error) {
      if (at !== generation.current || auth.currentUser?.uid !== me) return;
      const reason = inviteProblem(error);
      if (reason === 'username') setNeedsUsername(true);
      setProblem(reason);
    } finally { joining.current = false; if (at === generation.current) setBusy(false); }
  }, [code, me, isOffline, openGroup]);

  const load = useCallback(async () => {
    const at = ++generation.current;
    setProblem(null); setPreview(null); setLoading(true); setBusy(false);
    if (!code) { setProblem('expired'); setLoading(false); return; }
    if (isOffline) { setProblem('offline'); setLoading(false); return; }
    try {
      const [next, profile] = await Promise.all([
        resolveGroupInviteLink(code), getDocFromServer(doc(db, 'users', me)),
      ]);
      if (at !== generation.current || auth.currentUser?.uid !== me) return;
      const missing = inviteNeedsUsername(profile.data());
      setPreview(next); setNeedsUsername(missing); setLoading(false);
      // This is only armed by an explicit Join/Request to join action.
      if (resumeJoin.current && !missing) {
        resumeJoin.current = false;
        if (next.status === 'can_join') await join();
        else if (next.status === 'already_member') openGroup(next.conversationId);
      }
    } catch (error) {
      if (at === generation.current && auth.currentUser?.uid === me) { setProblem(inviteProblem(error)); setLoading(false); }
    }
  }, [code, isOffline, me, join, openGroup]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { generation.current++; };
  }, [load]));

  function completeProfile() {
    resumeJoin.current = true;
    navigation.navigate('EditProfile', { returnToInvite: true });
  }

  async function cancel() {
    if (!preview || busy) return;
    setBusy(true);
    try { await cancelMyJoinRequest(preview.conversationId, me); await load(); }
    catch (error) { setProblem(inviteProblem(error)); }
    finally { setBusy(false); }
  }

  const errors: Record<InviteProblem, string> = {
    username: t('groupInvite.usernameRequired', { defaultValue: 'Choose a username before joining this group. After saving, we will return to this invitation.' }),
    expired: t('groupInvite.expired', { defaultValue: 'This invitation is invalid or has expired. Ask a group admin for a new link.' }),
    disabled: t('groupInvite.disabled', { defaultValue: 'This invite link has been disabled. Ask a group admin for a new link.' }),
    full: t('groupInvite.full', { defaultValue: 'This group is full. Contact a group admin.' }),
    permission: t('groupInvite.permission', { defaultValue: 'You do not have permission to join this group. Contact a group admin.' }),
    signin: t('groupInvite.signin', { defaultValue: 'Sign in again to use this invitation.' }),
    rateLimit: t('groupInvite.rateLimit', { defaultValue: 'Too many attempts. Wait a while before trying again.' }),
    offline: t('groupInvite.offline', { defaultValue: 'Connect to the internet to open this invitation.' }),
    generic: t('groupInvite.failed', { defaultValue: 'Could not complete this invitation. Please try again.' }),
  };
  const usernamePrompt = !loading && (problem === 'username' || (!problem && preview?.status === 'can_join' && needsUsername));

  return <View style={s.root}>
    <Pressable style={s.close} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel={t('common.close', { defaultValue: 'Close' })}><Text style={s.closeText}>✕</Text></Pressable>
    {loading ? <View style={s.center}><ActivityIndicator color={colors.action.primary} /></View> : (
      <View style={s.card}>
        {preview ? <>
          {preview.groupPhotoURL ? <Image source={{ uri: preview.groupPhotoURL }} style={s.avatar} /> : <View style={[s.avatar, { backgroundColor: avatarColor(preview.conversationId) }]}><Text style={s.avatarText}>{initials(preview.groupName)}</Text></View>}
          <Text style={s.name}>{preview.groupName}</Text>
          <Text style={s.sub}>{t('groupInvite.memberCount', { count: preview.memberCount, defaultValue: '{{count}} members' })} · {preview.joinMode === 'open' ? t('groupInvite.open', { defaultValue: 'Anyone can join' }) : t('groupInvite.approval', { defaultValue: 'Admin approval required' })}</Text>
        </> : null}
        {usernamePrompt ? <>
          <Text accessibilityRole="alert" style={s.notice}>{errors.username}</Text>
          <Pressable style={s.primaryBtn} onPress={completeProfile} accessibilityRole="button"><Text style={s.primaryText}>{t('groupInvite.setUsername', { defaultValue: 'Set username and continue' })}</Text></Pressable>
        </> : problem ? <>
          <Text accessibilityRole="alert" style={s.errText}>{errors[problem]}</Text>
          {!isOffline && !['permission', 'full', 'disabled', 'expired', 'signin'].includes(problem) ? <Pressable style={s.secondaryBtn} onPress={load}><Text style={s.secondaryText}>{t('common.retry', { defaultValue: 'Try again' })}</Text></Pressable> : null}
        </> : preview?.status === 'already_member' ? <Pressable style={s.primaryBtn} onPress={() => openGroup(preview.conversationId)}><Text style={s.primaryText}>{t('groupInvite.openGroup', { defaultValue: 'Open group' })}</Text></Pressable>
          : preview?.status === 'request_pending' ? <>
            <Text style={s.notice}>{t('groupInvite.pending', { defaultValue: 'Your request is pending admin approval.' })}</Text>
            <Pressable style={s.secondaryBtn} onPress={cancel} disabled={busy}><Text style={s.secondaryText}>{busy ? '…' : t('groupInvite.cancel', { defaultValue: 'Cancel request' })}</Text></Pressable>
          </> : preview?.status === 'disabled' ? <Text style={s.errText}>{errors.disabled}</Text>
            : preview ? <Pressable style={s.primaryBtn} onPress={join} disabled={busy}><Text style={s.primaryText}>{busy ? '…' : preview.joinMode === 'open' ? t('groupInvite.join', { defaultValue: 'Join group' }) : t('groupInvite.request', { defaultValue: 'Request to join' })}</Text></Pressable> : null}
      </View>
    )}
  </View>;
}

function buildStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background.app, paddingTop: 60 },
    close: { position: 'absolute', top: 50, right: 18, zIndex: 2, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    closeText: { fontSize: 22, color: colors.text.secondary },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
    card: { alignItems: 'center', padding: 32, paddingTop: 50, gap: 12 },
    avatar: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    avatarText: { color: '#fff', fontSize: 34, fontWeight: '800' },
    name: { fontSize: 22, fontWeight: '800', color: colors.text.primary, textAlign: 'center' },
    sub: { fontSize: 14, color: colors.text.secondary, textAlign: 'center', marginBottom: 16 },
    primaryBtn: { marginTop: 8, paddingVertical: 14, paddingHorizontal: 28, borderRadius: radius.md, backgroundColor: colors.action.primary },
    primaryText: { color: colors.action.primaryFg, fontSize: 15, fontWeight: '700', textAlign: 'center' },
    secondaryBtn: { marginTop: 8, paddingVertical: 12, paddingHorizontal: 32, borderRadius: radius.md, backgroundColor: colors.background.surface, borderWidth: 1, borderColor: colors.border.default },
    secondaryText: { color: colors.text.primary, fontSize: 14, fontWeight: '700' },
    notice: { fontSize: 14, color: colors.notice.text, backgroundColor: colors.notice.background, borderRadius: radius.md, padding: 14, textAlign: 'center', lineHeight: 22 },
    errText: { fontSize: 15, color: colors.text.primary, textAlign: 'center', lineHeight: 22 },
  });
}
