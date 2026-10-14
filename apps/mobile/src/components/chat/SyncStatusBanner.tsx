// In-conversation synchronisation state, shown above the composer:
//   • a notification's message that isn't on screen yet ("Loading this message…",
//     "Waiting for connection…", "No longer available", retry on error);
//   • connection loss ("Offline — showing saved messages").
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { FocusState, LiveState } from '../../hooks/useLocalConversation';
import { syncBannerKind } from './syncBannerModel';

export { syncBannerKind, type SyncBannerKind } from './syncBannerModel';

export function SyncStatusBanner({ focus, live, onRetry }: { focus: FocusState | null; live: LiveState; onRetry: () => void }) {
  const { t } = useTranslation();
  const kind = syncBannerKind(focus, live);
  if (!kind) return null;

  const spinner = kind === 'loading-message';
  const icon = kind === 'offline' || kind === 'waiting-network' ? 'cloud-offline-outline'
    : kind === 'missing' ? 'alert-circle-outline' : kind === 'error' || kind === 'sync-error' ? 'refresh' : null;
  return (
    <View style={s.wrap} accessibilityRole="alert" accessibilityLiveRegion="polite">
      {spinner ? <ActivityIndicator size="small" color="#1F7BA8" /> : icon ? <Ionicons name={icon as any} size={16} color="#1F4E79" /> : null}
      <Text style={s.text}>{t(`sync.${kind}`)}</Text>
      {kind === 'error' || kind === 'sync-error' ? (
        <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={8}>
          <Text style={s.retry}>{t('common.retry', 'Retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center',
    backgroundColor: '#E6F1F7', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6,
    marginVertical: 4, maxWidth: '92%',
  },
  text: { fontSize: 13, color: '#1F4E79', fontWeight: '600', flexShrink: 1, textAlign: 'auto' },
  retry: { fontSize: 13, color: '#1F7BA8', fontWeight: '800' },
});

