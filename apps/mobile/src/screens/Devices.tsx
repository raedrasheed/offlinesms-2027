import { View } from 'react-native';
import { EmptyState } from '../components/state';

export default function Devices() {
  return (
    <View style={{ flex: 1 }}>
      <EmptyState
        fullPage
        title="Linked devices aren’t available yet"
        description="A future phase will list devices signed in to this account and let you revoke them."
      />
    </View>
  );
}
