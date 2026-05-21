import { View, StyleSheet } from 'react-native';
import { semantic } from '@offlinesms/design-tokens';
import { EmptyState } from '../components/state';

export default function Status() {
  return (
    <View style={s.root}>
      <EmptyState
        fullPage
        title="Status isn’t available yet"
        description="Status updates are reserved for a future phase. You’ll be able to share text, images, and short videos with selected contacts."
      />
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: semantic.color.background.app },
});
