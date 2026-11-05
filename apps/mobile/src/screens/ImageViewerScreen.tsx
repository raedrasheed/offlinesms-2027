// Phase 23 — full-screen image viewer (tap an image bubble to open).

import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ImageViewerScreen({ route, navigation }: any) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { uri } = route.params as { uri: string };

  return (
    <View style={s.root}>
      <Pressable
        style={[s.close, { top: insets.top + 8 }]}
        onPress={() => navigation.goBack()}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={t('common.cancel')}
      >
        <Ionicons name="close" size={28} color="#fff" />
      </Pressable>
      <Image source={{ uri }} style={s.image} contentFit="contain" useAppleWebpCodec={false} recyclingKey={uri} />
    </View>
  );
}

const s = StyleSheet.create({
  root:  { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  close: { position: 'absolute', right: 16, zIndex: 2, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
});
