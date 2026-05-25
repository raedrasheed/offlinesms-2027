// Offline-first journey UI: the Chats-list offline/syncing banners, the
// in-conversation offline notice, and the post-reconnect success chip.

import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';

export function OfflineBanner() {
  return (
    <View style={s.offline}>
      <Ionicons name="cloud-offline-outline" size={18} color="#92400E" />
      <View style={{ flex: 1 }}>
        <Text style={s.offlineTitle}>You're offline</Text>
        <Text style={s.offlineBody}>Drafts stay safe — we'll send when you're back.</Text>
      </View>
    </View>
  );
}

export function SyncingBanner({ count }: { count: number }) {
  return (
    <View style={s.syncing}>
      <ActivityIndicator size="small" color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={s.syncingTitle}>Back online — syncing</Text>
        <Text style={s.syncingBody}>
          Sending {count} queued message{count === 1 ? '' : 's'}…
        </Text>
      </View>
    </View>
  );
}

export function OfflineNotice() {
  return (
    <View style={s.notice}>
      <Ionicons name="cloud-offline-outline" size={14} color="#92400E" />
      <Text style={s.noticeText}>You're offline — messages will queue</Text>
    </View>
  );
}

export function SyncSuccessChip({ count }: { count: number }) {
  return (
    <View style={s.success}>
      <Ionicons name="checkmark-circle" size={15} color="#166534" />
      <Text style={s.successText}>
        {count} message{count === 1 ? '' : 's'} delivered after reconnect
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  offline:      { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FEF7E0', borderWidth: 1, borderColor: '#F2C94C', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, marginHorizontal: 14, marginBottom: 4 },
  offlineTitle: { fontSize: 13, fontWeight: '800', color: '#92400E' },
  offlineBody:  { fontSize: 12, color: '#A16207', marginTop: 1 },
  syncing:      { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#E6F1F7', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, marginHorizontal: 14, marginBottom: 4 },
  syncingTitle: { fontSize: 13, fontWeight: '800', color: colors.primaryDark },
  syncingBody:  { fontSize: 12, color: colors.primary, marginTop: 1 },
  notice:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'center', backgroundColor: '#FEF7E0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7, marginVertical: 8 },
  noticeText:   { fontSize: 12, color: '#92400E', fontWeight: '600' },
  success:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'center', backgroundColor: '#DCFCE7', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginVertical: 8 },
  successText:  { fontSize: 12, color: '#166534', fontWeight: '700' },
});
