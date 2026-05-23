import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, SafeAreaView, Switch, ScrollView, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';
import { getStatus, request, type PermissionKey, type PermissionStatus } from '../lib/permissions';

type Row = { key: PermissionKey; icon: keyof typeof Ionicons.glyphMap; title: string; sub: string };

const ROWS: Row[] = [
  { key: 'contacts',      icon: 'people',         title: 'Contacts',      sub: 'Find friends already on OfflineSMS' },
  { key: 'notifications', icon: 'notifications',  title: 'Notifications', sub: 'Get pinged for new messages' },
  { key: 'camera',        icon: 'camera',         title: 'Camera',        sub: 'Snap and share moments' },
  { key: 'microphone',    icon: 'mic',            title: 'Microphone',    sub: 'Voice notes and calls' },
];

export default function Permissions({ navigation }: any) {
  const [status, setStatus] = useState<Record<PermissionKey, PermissionStatus>>({
    contacts: 'undetermined', notifications: 'undetermined', camera: 'undetermined', microphone: 'undetermined',
  });
  const [busy, setBusy] = useState<PermissionKey | null>(null);

  useEffect(() => {
    (async () => {
      const next = { ...status };
      for (const r of ROWS) next[r.key] = await getStatus(r.key);
      setStatus(next);
    })();
  }, []);

  async function toggle(key: PermissionKey, on: boolean) {
    if (!on) {
      Alert.alert('Manage in Settings', 'To turn this off, use your device Settings.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
      return;
    }
    setBusy(key);
    try {
      const result = await request(key);
      setStatus(s => ({ ...s, [key]: result }));
      if (result === 'denied') {
        Alert.alert('Permission denied', 'You can enable it later in your device Settings.', [
          { text: 'OK' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.content}>
        <Pressable style={s.back} onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>

        <Text style={s.h1}>A few quick permissions</Text>
        <Text style={s.sub}>We only ask for what we need to make OfflineSMS work.</Text>

        <View style={s.list}>
          {ROWS.map(r => {
            const on = status[r.key] === 'granted';
            return (
              <View key={r.key} style={s.row}>
                <View style={s.iconWrap}>
                  <Ionicons name={r.icon} size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>{r.title}</Text>
                  <Text style={s.rowSub}>{r.sub}</Text>
                </View>
                <Switch
                  value={on}
                  onValueChange={v => toggle(r.key, v)}
                  disabled={busy === r.key}
                />
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={s.footer}>
        <Pressable style={s.btn} onPress={() => navigation.goBack()}>
          <Text style={s.btnText}>Continue</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#fff' },
  content: { paddingHorizontal: 24, paddingBottom: 24 },
  back:    { marginTop: 8, marginBottom: 16, alignSelf: 'flex-start' },
  h1:      { fontSize: 26, fontWeight: '800', color: colors.ink, letterSpacing: -0.4 },
  sub:     { fontSize: 13, color: colors.ink500, marginTop: 8, lineHeight: 20 },

  list:    { marginTop: 24, gap: 14 },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconWrap:{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  rowTitle:{ fontSize: 15, fontWeight: '700', color: colors.ink },
  rowSub:  { fontSize: 12, color: colors.ink500, marginTop: 2, lineHeight: 16 },

  footer:  { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 8 },
  btn:     { padding: 16, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
