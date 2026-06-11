// Settings → Notifications (Phase 27). Backed by
// users/{uid}/notificationSettings/current.

import { useEffect, useState } from 'react';
import { View, Text, Switch, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../lib/firebase';
import { useTheme } from '../context/ThemeContext';
import {
  NotificationSettings as Settings, DEFAULT_NOTIFICATION_SETTINGS,
  subscribeNotificationSettings, updateNotificationSettings,
} from '../lib/notificationSettings';

type Row = { key: keyof Settings; label: string; hint?: string; dependsOn?: keyof Settings };

const ROWS: Row[] = [
  { key: 'enabled',        label: 'Enable notifications', hint: 'Master switch for all push notifications.' },
  { key: 'directMessages', label: 'Direct messages', dependsOn: 'enabled' },
  { key: 'groupMessages',  label: 'Group messages',  dependsOn: 'enabled' },
  { key: 'reactions',      label: 'Reactions',       dependsOn: 'enabled' },
  { key: 'sound',          label: 'Sound',           dependsOn: 'enabled' },
  { key: 'vibration',      label: 'Vibration',       dependsOn: 'enabled' },
  { key: 'showPreview',    label: 'Show message preview', hint: 'When off, notifications hide the message text.', dependsOn: 'enabled' },
];

export default function NotificationSettings({ navigation }: any) {
  const me = auth.currentUser?.uid ?? '';
  const { colors } = useTheme();
  const [settings, setSettings] = useState<Settings>(DEFAULT_NOTIFICATION_SETTINGS);

  useEffect(() => { if (me) return subscribeNotificationSettings(me, setSettings); }, [me]);

  function toggle(key: keyof Settings, value: boolean) {
    setSettings(s => ({ ...s, [key]: value }));   // optimistic
    if (me) void updateNotificationSettings(me, { [key]: value });
  }

  return (
    <View style={[s.root, { backgroundColor: colors.background.app }]}>
      <View style={[s.header, { backgroundColor: colors.background.surface, borderColor: colors.border.subtle }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.text.primary} />
        </Pressable>
        <Text style={[s.title, { color: colors.text.primary }]}>Notifications</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={[s.card, { backgroundColor: colors.background.surface, borderColor: colors.border.subtle }]}>
          {ROWS.map((row, i) => {
            const disabled = !!row.dependsOn && !settings[row.dependsOn];
            return (
              <View key={row.key} style={[s.row, i < ROWS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border.subtle }, disabled && { opacity: 0.45 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.label, { color: colors.text.primary }]}>{row.label}</Text>
                  {row.hint ? <Text style={[s.hint, { color: colors.text.muted }]}>{row.hint}</Text> : null}
                </View>
                <Switch
                  value={!!settings[row.key]}
                  onValueChange={v => toggle(row.key, v)}
                  disabled={disabled}
                />
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 50, paddingBottom: 12, borderBottomWidth: 1 },
  title:  { fontSize: 17, fontWeight: '800' },
  card:   { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  row:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  label:  { fontSize: 15, fontWeight: '600' },
  hint:   { fontSize: 12, marginTop: 2 },
});
