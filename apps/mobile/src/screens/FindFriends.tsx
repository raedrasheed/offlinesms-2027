import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, SafeAreaView, FlatList, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';
import { request as requestPermission } from '../lib/permissions';
import {
  loadDeviceContactsAsE164, matchContactsOnServer, type ContactMatch, type SyncProgress,
} from '../lib/contactSync';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function FindFriends({ navigation }: any) {
  const [phase, setPhase]       = useState<'idle' | 'syncing' | 'done'>('idle');
  const [progress, setProgress] = useState<SyncProgress>({ scanned: 0, total: 0, matched: 0 });
  const [matches, setMatches]   = useState<ContactMatch[]>([]);

  async function sync() {
    const status = await requestPermission('contacts');
    if (status !== 'granted') {
      Alert.alert('Contacts permission needed', 'Allow contacts access to find friends already on OfflineSMS.');
      return;
    }
    setPhase('syncing');
    try {
      const phones = await loadDeviceContactsAsE164();
      setProgress({ scanned: 0, total: phones.length, matched: 0 });
      const found = await matchContactsOnServer(phones, setProgress);
      setMatches(found);
      setPhase('done');
    } catch (e: any) {
      Alert.alert('Sync failed', e?.message ?? 'Could not sync contacts. Please try again.');
      setPhase('idle');
    }
  }

  const pct = progress.total > 0 ? Math.round((progress.scanned / progress.total) * 100) : 0;

  return (
    <SafeAreaView style={s.root}>
      <Pressable style={s.back} onPress={() => navigation.goBack()} hitSlop={12}>
        <Ionicons name="chevron-back" size={24} color={colors.ink} />
      </Pressable>

      <Text style={s.h1}>Finding friends</Text>
      <Text style={s.sub}>Looking through your contacts for people already on OfflineSMS.</Text>

      {phase === 'idle' && (
        <View style={s.centerArea}>
          <View style={s.iconBubble}>
            <Ionicons name="people" size={32} color={colors.primary} />
          </View>
          <Pressable style={s.btn} onPress={sync}>
            <Text style={s.btnText}>Sync contacts</Text>
          </Pressable>
        </View>
      )}

      {phase !== 'idle' && (
        <>
          <View style={s.syncCard}>
            <View style={s.syncTop}>
              <Text style={s.syncLabel}>{phase === 'syncing' ? 'Syncing' : 'Synced'}</Text>
              <Text style={s.syncCount}>{progress.scanned}/{progress.total}</Text>
            </View>
            <View style={s.bar}>
              <View style={[s.barFill, { width: `${pct}%` }]} />
            </View>
            <Text style={s.syncFound}>
              {progress.matched} found on OfflineSMS · {pct}%
            </Text>
          </View>

          {phase === 'syncing' && matches.length === 0 ? (
            <View style={s.centerArea}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <FlatList
              data={matches}
              keyExtractor={m => m.uid}
              contentContainerStyle={{ paddingVertical: 8 }}
              ListEmptyComponent={
                phase === 'done'
                  ? <Text style={s.empty}>None of your contacts are on OfflineSMS yet.</Text>
                  : null
              }
              renderItem={({ item }) => (
                <View style={s.friendRow}>
                  <View style={s.av}><Text style={s.avText}>{initials(item.displayName)}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.friendName}>{item.displayName || (item.username ? `@${item.username}` : 'OfflineSMS user')}</Text>
                  </View>
                  <View style={s.badge}>
                    <View style={s.badgeDot} />
                    <Text style={s.badgeText}>ON OFFLINESMS</Text>
                  </View>
                </View>
              )}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 24 },
  back: { marginTop: 8, marginBottom: 16, alignSelf: 'flex-start' },
  h1:   { fontSize: 26, fontWeight: '800', color: colors.ink, letterSpacing: -0.4 },
  sub:  { fontSize: 13, color: colors.ink500, marginTop: 8, lineHeight: 20 },

  centerArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  iconBubble: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  btn:        { paddingHorizontal: 28, paddingVertical: 14, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center' },
  btnText:    { color: '#fff', fontWeight: '700', fontSize: 15 },

  syncCard:  { marginTop: 20, padding: 16, borderRadius: radius.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.ink100 },
  syncTop:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  syncLabel: { fontSize: 14, fontWeight: '700', color: colors.ink },
  syncCount: { fontSize: 13, fontWeight: '700', color: colors.ink500 },
  bar:       { height: 6, borderRadius: 3, backgroundColor: colors.ink200, marginTop: 10, overflow: 'hidden' },
  barFill:   { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  syncFound: { fontSize: 12, color: colors.ink500, marginTop: 8 },

  friendRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  av:         { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' },
  avText:     { fontSize: 14, fontWeight: '800', color: colors.primaryDark },
  friendName: { fontSize: 15, fontWeight: '700', color: colors.ink },
  badge:      { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.primaryLight },
  badgeDot:   { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.ok },
  badgeText:  { fontSize: 10, fontWeight: '800', color: colors.primaryDark, letterSpacing: 0.3 },
  empty:      { textAlign: 'center', color: colors.ink500, fontSize: 13, marginTop: 32 },
});
