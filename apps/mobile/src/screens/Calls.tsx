import { View, StyleSheet } from 'react-native';
import { semantic } from '@offlinesms/design-tokens';
import { EmptyState } from '../components/state';

export default function Calls() {
  return (
    <View style={s.root}>
      <EmptyState
        fullPage
        title="Calls aren’t available yet"
        description="Voice and video calls are reserved for a future phase."
      />
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: semantic.color.background.app },
});
