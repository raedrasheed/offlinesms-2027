import { View } from 'react-native';
import { EmptyState } from '../components/state';

// SMS escalation UI will land in a later phase. The backend callable
// `escalateSms` already exists and brands all dispatch as OfflineSMS.
export default function SmsEscalation() {
  return (
    <View style={{ flex: 1 }}>
      <EmptyState
        fullPage
        title="SMS escalation isn’t available yet"
        description="Escalating a message to SMS via OfflineSMS is reserved for a future phase. Points are spent through OfflineSMS only."
      />
    </View>
  );
}
