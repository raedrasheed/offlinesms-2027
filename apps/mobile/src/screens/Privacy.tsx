import { View } from 'react-native';
import { EmptyState } from '../components/state';

export default function Privacy() {
  return (
    <View style={{ flex: 1 }}>
      <EmptyState
        fullPage
        title="Privacy controls aren’t available yet"
        description="A future phase will let you manage who can see your profile, last seen, and read receipts."
      />
    </View>
  );
}
