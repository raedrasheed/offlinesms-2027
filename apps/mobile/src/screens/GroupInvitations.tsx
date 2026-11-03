import { useMemo, useState } from 'react';
import { View, Text, Pressable, FlatList, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useDisplayNames } from '../lib/userProfiles';
import { useGroupInvitations } from '../hooks/useGroupInvitations';
import { respondToGroupInvitation } from '../lib/conversations';
export default function GroupInvitations({ navigation }: any) {
  const { t } = useTranslation(), { colors } = useTheme(), insets = useSafeAreaInsets();
  const { items, error, loading } = useGroupInvitations();
  const nameFor = useDisplayNames(useMemo(() => items.map(item => item.inviterUid), [items]));
  const [busy, setBusy] = useState<string | null>(null);
  async function respond(id: string, accept: boolean) {
    if (busy) return;
    setBusy(id);
    try { await respondToGroupInvitation(id, accept); if (accept) navigation.replace('Conversation', { id }); }
    catch { Alert.alert(t('groupConsent.title'), t('groupConsent.error')); }
    finally { setBusy(null); }
  }
  return <View style={{ flex: 1, backgroundColor: colors.background.surface, paddingTop: insets.top, paddingBottom: insets.bottom }}>
    <Pressable onPress={() => navigation.goBack()} style={{ padding: 16 }}><Text style={{ color: colors.action.primary }}>{t('names.close')}</Text></Pressable>
    <Text style={{ color: colors.text.primary, fontSize: 22, fontWeight: '700', padding: 16 }}>{t('groupConsent.title')}</Text>
    {loading ? <ActivityIndicator/> : <FlatList data={items} keyExtractor={item => item.id}
      ListEmptyComponent={<Text style={{ padding: 16, color: colors.text.muted }}>{t(error ? 'groupConsent.error' : 'groupConsent.empty')}</Text>}
      renderItem={({ item }) => <View style={{ margin: 12, padding: 16, borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 12, gap: 12 }}>
        <Text style={{ color: colors.text.primary, fontSize: 18, fontWeight: '700' }}>{item.groupName}</Text>
        <Text style={{ color: colors.text.muted }}>{t('groupConsent.from', { name: nameFor(item.inviterUid) })}</Text>
        <Text style={{ color: colors.text.muted }}>{t('groupConsent.explanation')}</Text>
        <View style={{ flexDirection: 'row', gap: 24 }}>
          {[true, false].map(accept => <Pressable key={String(accept)} accessibilityRole="button" disabled={!!busy} onPress={() => void respond(item.id, accept)} style={{ padding: 12, opacity: busy ? 0.4 : 1 }}>
            <Text style={{ color: colors.action.primary }}>{t(accept ? 'groupConsent.accept' : 'groupConsent.decline')}</Text>
          </Pressable>)}
        </View>
      </View>}/>}</View>;
}
