// JoinGroup — invite-link preview + join/request flow.
//
// Opened by a deep link (offlinesms://join/{code} or https://
// links.offlinesms.com/join/{code}, plus legacy offlinesms.com links) or
// programmatically. Requires connectivity: invites are validated
// server-side, so offline shows a clear message rather than queuing.

import { useCallback, useEffect, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import {
  InvitePreview, resolveGroupInviteLink, joinGroupByInviteLink, cancelMyJoinRequest,
} from '../lib/conversations';
import { auth } from '../lib/firebase';
import { useOffline } from '../context/OfflineContext';
import { avatarColor, initials } from '../lib/avatar';
import { colors, radius } from '../theme';

export default function JoinGroup({ route, navigation }: any) {
  const { code } = (route.params ?? {}) as { code?: string };
  const me = auth.currentUser?.uid ?? '';
  const { isOffline } = useOffline();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!code) { setErr('This invite link is invalid.'); return; }
    if (isOffline) { setErr('Internet connection is required to join by invite link.'); return; }
    setErr(null);
    try {
      setPreview(await resolveGroupInviteLink(code));
    } catch (e: any) {
      const c = e?.code ?? '';
      if (c.includes('not-found')) setErr('This invite link is no longer valid.');
      else if (c.includes('invalid-argument')) setErr('This invite link is invalid.');
      else setErr('Couldn’t open this invite. Please try again.');
    }
  }, [code, isOffline]);

  useEffect(() => { load(); }, [load]);

  const openGroup = (conversationId: string) =>
    navigation.reset({ index: 0, routes: [{ name: 'Tabs' }, { name: 'Conversation', params: { id: conversationId } }] });

  async function join() {
    if (!code) return;
    setBusy(true);
    try {
      const res = await joinGroupByInviteLink(code);
      if (res.status === 'joined' || res.status === 'already_member') openGroup(res.conversationId);
      else await load();  // pending → refresh to show request state
    } catch {
      setErr('Couldn’t join. Please try again.');
    } finally { setBusy(false); }
  }

  async function cancel() {
    if (!preview) return;
    setBusy(true);
    try { await cancelMyJoinRequest(preview.conversationId, me); await load(); }
    catch { /* noop */ }
    finally { setBusy(false); }
  }

  return (
    <View style={s.root}>
      <Pressable style={s.close} onPress={() => navigation.goBack()}><Text style={s.closeText}>✕</Text></Pressable>

      {err ? (
        <View style={s.center}>
          <Text style={s.errText}>{err}</Text>
          {!isOffline ? <Pressable style={s.secondaryBtn} onPress={load}><Text style={s.secondaryText}>Try again</Text></Pressable> : null}
        </View>
      ) : !preview ? (
        <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <View style={s.card}>
          {preview.groupPhotoURL ? (
            <Image source={{ uri: preview.groupPhotoURL }} style={s.avatar} />
          ) : (
            <View style={[s.avatar, { backgroundColor: avatarColor(preview.conversationId) }]}>
              <Text style={s.avatarText}>{initials(preview.groupName)}</Text>
            </View>
          )}
          <Text style={s.name}>{preview.groupName}</Text>
          <Text style={s.sub}>{preview.memberCount} member{preview.memberCount === 1 ? '' : 's'} · {preview.joinMode === 'open' ? 'Anyone can join' : 'Admin approval required'}</Text>

          {preview.status === 'already_member' ? (
            <Pressable style={s.primaryBtn} onPress={() => openGroup(preview.conversationId)}><Text style={s.primaryText}>Open group</Text></Pressable>
          ) : preview.status === 'request_pending' ? (
            <>
              <Text style={s.pending}>Your request is pending admin approval.</Text>
              <Pressable style={s.secondaryBtn} onPress={cancel} disabled={busy}><Text style={s.secondaryText}>{busy ? '…' : 'Cancel request'}</Text></Pressable>
            </>
          ) : preview.status === 'disabled' ? (
            <Text style={s.errText}>This invite link has been disabled.</Text>
          ) : (
            <Pressable style={s.primaryBtn} onPress={join} disabled={busy}>
              <Text style={s.primaryText}>{busy ? '…' : preview.joinMode === 'open' ? 'Join group' : 'Request to join'}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bgCanvas, paddingTop: 60 },
  close:   { position: 'absolute', top: 50, right: 18, zIndex: 2, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 22, color: colors.ink500 },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  card:    { alignItems: 'center', padding: 32, gap: 8 },
  avatar:  { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  avatarText: { color: '#fff', fontSize: 34, fontWeight: '800' },
  name:    { fontSize: 22, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  sub:     { fontSize: 14, color: colors.ink500, textAlign: 'center', marginBottom: 16 },
  primaryBtn: { marginTop: 8, paddingVertical: 14, paddingHorizontal: 40, borderRadius: radius.md, backgroundColor: colors.primary },
  primaryText:{ color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: { marginTop: 8, paddingVertical: 12, paddingHorizontal: 32, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.ink200 },
  secondaryText:{ color: colors.ink, fontSize: 14, fontWeight: '700' },
  pending: { fontSize: 14, color: colors.primaryDark, textAlign: 'center', marginTop: 8 },
  errText: { fontSize: 15, color: colors.ink600, textAlign: 'center', lineHeight: 22 },
});
