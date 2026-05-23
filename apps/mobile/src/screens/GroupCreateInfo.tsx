// Create-group flow · Step 3 — "Group info".
//
// Receives the selected members from the Add-members step, collects a name
// (and optional description / disappearing setting) and performs the
// createGroup call. Description and disappearing are UI-only for now — the
// createGroup callable accepts name + memberUids + avatarUrl.

import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createGroup, groupErrorCopy } from '../lib/conversations';
import { colors, radius } from '../theme';
import { avatarColor, initials } from '../lib/avatar';
import { ErrorState } from '../components/state';

const NAME_MAX = 80;
const DESC_MAX = 280;

export default function GroupCreateInfo({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const members = (route.params?.members ?? []) as Array<{ uid: string }>;
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canCreate = name.trim().length > 0 && members.length >= 1 && !busy;

  async function create() {
    if (!canCreate) return;
    setBusy(true); setErr(null);
    try {
      const res = await createGroup({ name: name.trim(), memberUids: members.map(m => m.uid) });
      navigation.replace('Conversation', { id: res.conversationId });
    } catch (e: any) { setErr(groupErrorCopy(e?.code ?? 'internal')); }
    finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
        </Pressable>
        <Text style={s.title}>Group info</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 24 }}>
        <View style={s.avatarWrap}>
          <View style={[s.avatar, { backgroundColor: avatarColor(name.trim() || 'group') }]}>
            <Text style={s.avatarText}>{initials(name || 'G')}</Text>
          </View>
          <View style={s.cameraBadge}>
            <Ionicons name="camera" size={15} color="#fff" />
          </View>
        </View>

        <Text style={s.label}>GROUP NAME</Text>
        <TextInput
          style={s.input}
          value={name}
          onChangeText={setName}
          maxLength={NAME_MAX}
          placeholder="Group name"
          placeholderTextColor={colors.ink400}
          autoFocus
        />

        <Text style={s.label}>DESCRIPTION (OPTIONAL)</Text>
        <TextInput
          style={[s.input, s.textArea]}
          value={desc}
          onChangeText={setDesc}
          maxLength={DESC_MAX}
          placeholder="What’s this group for?"
          placeholderTextColor={colors.ink400}
          multiline
        />

        <Pressable style={s.optionRow} onPress={() => Alert.alert('Disappearing messages', 'Coming soon.')}>
          <Ionicons name="timer-outline" size={20} color={colors.ink700} />
          <Text style={s.optionLabel}>Disappearing messages</Text>
          <Text style={s.optionValue}>Off</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.ink400} />
        </Pressable>

        {err ? <ErrorState compact title="Couldn’t create" description={err} /> : null}
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + 14 }]}>
        <Pressable style={[s.createBtn, !canCreate && { opacity: 0.5 }]} onPress={create} disabled={!canCreate}>
          <Text style={s.createText}>{busy ? 'Creating…' : 'Create group'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.surface },
  header:  { paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 12 },
  title:   { fontSize: 18, fontWeight: '800', color: colors.ink, flex: 1 },
  avatarWrap: { alignSelf: 'center', marginTop: 8, marginBottom: 16 },
  avatar:  { width: 96, height: 96, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 34, fontWeight: '800' },
  cameraBadge: { position: 'absolute', bottom: -2, right: -2, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.surface },
  label:   { fontSize: 11, fontWeight: '700', color: colors.ink500, letterSpacing: 0.6, marginTop: 14, marginBottom: 6 },
  input:   { padding: 14, backgroundColor: colors.surface, borderRadius: radius.md, fontSize: 15, color: colors.ink, borderWidth: 1, borderColor: colors.ink200 },
  textArea:{ minHeight: 90, textAlignVertical: 'top' },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18, paddingVertical: 14, paddingHorizontal: 14, backgroundColor: colors.surface2, borderRadius: radius.md },
  optionLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink },
  optionValue: { fontSize: 14, color: colors.ink500 },
  footer:  { paddingHorizontal: 20, paddingTop: 12, backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.ink100 },
  createBtn: { padding: 16, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center' },
  createText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
