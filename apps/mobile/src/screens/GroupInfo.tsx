// GroupInfo — manage a group conversation.
//
// Reads the conversation doc + members sub-collection live, then drives
// the Phase 5 callables. UI gates actions by the current user's role and
// the conversation status; the callables independently enforce the same
// rules server-side.

import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, Alert, ScrollView,
} from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import {
  Conversation,
  GroupMember,
  subscribeMembers,
  removeGroupMember,
  changeGroupRole,
  leaveGroup,
  lockGroup,
  groupErrorCopy,
} from '../lib/conversations';
import { colors, radius } from '../theme';
import { LoadingState, EmptyState, PermissionState } from '../components/state';

function roleBadge(role: GroupMember['role']) {
  switch (role) {
    case 'owner': return { label: 'Owner', color: '#A16207', bg: '#FEF3C7' };
    case 'admin': return { label: 'Admin', color: colors.primaryDark, bg: colors.primaryLight };
    default:      return null;
  }
}

export default function GroupInfo({ route, navigation }: any) {
  const me = auth.currentUser?.uid;
  const { id } = route.params as { id: string };

  const [convo, setConvo]     = useState<Conversation | null | undefined>(undefined);
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [busy, setBusy]       = useState(false);

  useEffect(() => {
    return onSnapshot(doc(db, 'conversations', id), snap => {
      setConvo(snap.exists() ? ({ id, ...snap.data() } as Conversation) : null);
    });
  }, [id]);

  useEffect(() => subscribeMembers(id, setMembers), [id]);

  const myRole: GroupMember['role'] | null = useMemo(() => {
    const m = members?.find(x => x.uid === me);
    return m?.role ?? null;
  }, [members, me]);

  if (convo === undefined || members === null) return <LoadingState fullPage title="Loading group…" />;
  if (convo === null) return <PermissionState fullPage title="Not available" description="This conversation no longer exists." />;
  if (convo.type !== 'group') return <PermissionState fullPage title="Not a group" description="This conversation isn’t a group." />;
  if (!myRole) return <PermissionState fullPage title="Not a member" description="You aren’t in this group." />;

  const isOwner = myRole === 'owner';
  const isAdmin = myRole === 'owner' || myRole === 'admin';
  const locked  = convo.status === 'locked';
  const disabled = convo.status === 'disabled';

  async function withBusy(fn: () => Promise<void>, label: string) {
    setBusy(true);
    try { await fn(); }
    catch (e: any) { Alert.alert(label, groupErrorCopy(e?.code ?? 'internal')); }
    finally { setBusy(false); }
  }

  function confirmRemove(m: GroupMember) {
    Alert.alert(
      'Remove member',
      `Remove ${m.displayNameSnapshot ?? m.uid} from this group?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => withBusy(() => removeGroupMember(id, m.uid), 'Couldn’t remove') },
      ],
    );
  }
  function confirmChangeRole(m: GroupMember, role: 'admin' | 'member') {
    const verb = role === 'admin' ? 'Promote to admin' : 'Demote to member';
    Alert.alert(
      verb,
      `${verb}: ${m.displayNameSnapshot ?? m.uid}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: verb, onPress: () => withBusy(() => changeGroupRole(id, m.uid, role), 'Couldn’t change role') },
      ],
    );
  }
  function confirmLeave() {
    Alert.alert(
      'Leave group',
      'You won’t receive new messages from this group.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave', style: 'destructive', onPress: () => withBusy(async () => {
            await leaveGroup(id);
            navigation.popToTop();
          }, 'Couldn’t leave'),
        },
      ],
    );
  }
  function toggleLock() {
    const next = !locked;
    withBusy(() => lockGroup(id, next), next ? 'Couldn’t lock' : 'Couldn’t unlock');
  }

  function memberActions(m: GroupMember) {
    if (m.uid === me) return;
    if (m.role === 'owner') return; // owner is immutable from here
    const buttons: Array<{ text: string; onPress?: () => void; style?: 'destructive' | 'cancel' }> = [];

    if (isOwner) {
      if (m.role === 'admin') buttons.push({ text: 'Demote to member', onPress: () => confirmChangeRole(m, 'member') });
      else                    buttons.push({ text: 'Promote to admin', onPress: () => confirmChangeRole(m, 'admin') });
    }
    if (isOwner) buttons.push({ text: 'Remove from group', style: 'destructive', onPress: () => confirmRemove(m) });
    else if (isAdmin && m.role === 'member') buttons.push({ text: 'Remove from group', style: 'destructive', onPress: () => confirmRemove(m) });

    if (buttons.length === 0) return;
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(m.displayNameSnapshot ?? m.uid, undefined, buttons);
  }

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()}><Text style={s.back}>‹</Text></Pressable>
        <Text style={s.title}>Group info</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={s.hero}>
          <View style={s.avatar}><Text style={s.avatarText}>{(convo.name ?? '?').slice(0, 1).toUpperCase()}</Text></View>
          <Text style={s.name}>{convo.name ?? 'Group'}</Text>
          <Text style={s.sub}>{members.length} member{members.length === 1 ? '' : 's'}{locked ? ' · locked' : disabled ? ' · disabled' : ''}</Text>
        </View>

        <View style={s.section}>
          <Text style={s.sectionLabel}>Actions</Text>
          {isAdmin ? (
            <>
              <Pressable style={s.actionRow} onPress={() => navigation.navigate('AddMembers', { id })}>
                <Text style={s.actionText}>Add members</Text>
                <Text style={s.actionChevron}>›</Text>
              </Pressable>
              <Pressable style={s.actionRow} onPress={toggleLock} disabled={busy || disabled}>
                <Text style={s.actionText}>{locked ? 'Unlock group' : 'Lock group'}</Text>
                <Text style={s.actionChevron}>›</Text>
              </Pressable>
            </>
          ) : null}
          <Pressable style={[s.actionRow, s.dangerRow]} onPress={confirmLeave} disabled={busy}>
            <Text style={[s.actionText, { color: colors.err }]}>Leave group</Text>
          </Pressable>
        </View>

        <View style={s.section}>
          <Text style={s.sectionLabel}>Members ({members.length})</Text>
          {members.length === 0 ? (
            <EmptyState compact title="No members" />
          ) : (
            <FlatList
              scrollEnabled={false}
              data={members}
              keyExtractor={m => m.uid}
              renderItem={({ item }) => {
                const badge = roleBadge(item.role);
                const isSelf = item.uid === me;
                return (
                  <Pressable style={s.memberRow} onPress={() => memberActions(item)}>
                    <View style={s.memberAvatar}><Text style={s.memberAvatarText}>{(item.displayNameSnapshot ?? item.uid).slice(0, 1).toUpperCase()}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.memberName}>{item.displayNameSnapshot ?? item.uid}{isSelf ? ' (you)' : ''}</Text>
                    </View>
                    {badge ? (
                      <View style={[s.badge, { backgroundColor: badge.bg }]}>
                        <Text style={[s.badgeText, { color: badge.color }]}>{badge.label}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:      { flex: 1, backgroundColor: colors.bgCanvas },
  header:    { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back:      { fontSize: 24, color: colors.primary },
  title:     { fontSize: 14, fontWeight: '700', color: colors.ink },
  hero:      { alignItems: 'center', padding: 24, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.ink100 },
  avatar:    { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText:{ fontSize: 32, fontWeight: '800', color: '#fff' },
  name:      { fontSize: 20, fontWeight: '800', color: colors.ink, marginTop: 12, textAlign: 'center' },
  sub:       { fontSize: 12, color: colors.ink500, marginTop: 4, textAlign: 'center' },
  section:   { marginTop: 16, backgroundColor: colors.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.ink100 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: colors.ink500, letterSpacing: 0.6, paddingHorizontal: 16, paddingVertical: 8 },
  actionRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderTopWidth: 1, borderColor: colors.ink100 },
  actionText:{ flex: 1, fontSize: 14, color: colors.ink, fontWeight: '600' },
  actionChevron: { fontSize: 18, color: colors.ink400 },
  dangerRow: {},
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderTopWidth: 1, borderColor: colors.ink100 },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { fontWeight: '700', color: colors.primaryDark },
  memberName: { fontSize: 14, color: colors.ink, fontWeight: '600' },
  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 10, fontWeight: '700' },
});
