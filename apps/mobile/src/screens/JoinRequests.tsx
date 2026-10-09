// JoinRequests — group admins review pending invite join requests.

import { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert } from 'react-native';
import {
  JoinRequest, subscribePendingJoinRequests,
  approveGroupJoinRequest, rejectGroupJoinRequest, groupErrorCopy,
} from '../lib/conversations';
import { avatarColor, initials } from '../lib/avatar';
import { useDisplayNames } from '../lib/userProfiles';
import { colors, radius } from '../theme';
import { EmptyState } from '../components/state';

export default function JoinRequests({ route, navigation }: any) {
  const { id } = route.params as { id: string };
  const [rows, setRows] = useState<JoinRequest[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => subscribePendingJoinRequests(id, setRows), [id]);
  // Live requester names (the stored requesterName may be stale or, on old
  // requests, the uid itself — the resolver ignores uid-like snapshots).
  const nameFor = useDisplayNames(useMemo(() => (rows ?? []).map(r => r.requesterUid), [rows]));

  async function act(r: JoinRequest, approve: boolean) {
    setBusyId(r.requestId);
    try {
      if (approve) await approveGroupJoinRequest(id, r.requestId);
      else         await rejectGroupJoinRequest(id, r.requestId);
    } catch (e: any) {
      Alert.alert('Couldn’t complete', groupErrorCopy(e?.code ?? 'internal'));
    } finally { setBusyId(null); }
  }

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()}><Text style={s.back}>‹</Text></Pressable>
        <Text style={s.title}>Join requests</Text>
      </View>
      <FlatList
        data={rows ?? []}
        keyExtractor={r => r.requestId}
        contentContainerStyle={{ padding: 14 }}
        ListEmptyComponent={rows === null ? null : <EmptyState compact title="No pending requests" />}
        renderItem={({ item }) => (
          <View style={s.row}>
            <View style={[s.avatar, { backgroundColor: avatarColor(item.requesterUid) }]}>
              <Text style={s.avatarText}>{initials(nameFor(item.requesterUid, { snapshot: item.requesterName }))}</Text>
            </View>
            <Text style={s.name} numberOfLines={1}>{nameFor(item.requesterUid, { snapshot: item.requesterName })}</Text>
            <Pressable style={[s.btn, s.reject]} disabled={busyId === item.requestId} onPress={() => act(item, false)}>
              <Text style={[s.btnText, { color: colors.err }]}>Reject</Text>
            </Pressable>
            <Pressable style={[s.btn, s.approve]} disabled={busyId === item.requestId} onPress={() => act(item, true)}>
              <Text style={[s.btnText, { color: '#fff' }]}>{busyId === item.requestId ? '…' : 'Approve'}</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: colors.bgCanvas },
  header: { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back:   { fontSize: 24, color: colors.primary, width: 24 },
  title:  { fontSize: 14, fontWeight: '700', color: colors.ink },
  row:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '800' },
  name:   { flex: 1, fontSize: 14, fontWeight: '700', color: colors.ink },
  btn:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
  reject: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.ink200 },
  approve:{ backgroundColor: colors.primary },
  btnText:{ fontSize: 13, fontWeight: '700' },
});
