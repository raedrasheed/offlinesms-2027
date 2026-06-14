import { useEffect } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

export default function Splash({ navigation }: any) {
  const insets = useSafeAreaInsets();
  useEffect(() => {
    const t = setTimeout(() => navigation.replace('Welcome'), 2000);
    return () => clearTimeout(t);
  }, [navigation]);

  return (
    <View style={s.root}>
      <View style={s.center}>
        <Image source={require('../../assets/icon.png')} style={s.logo} />
        <Text style={s.brand}>OfflineSMS</Text>
      </View>
      <View style={[s.footer, { bottom: insets.bottom + 24 }]}>
        <Ionicons name="lock-closed" size={12} color="#FFFFFF99" />
        <Text style={s.footerText}>End-to-end encrypted</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#01A0E1', justifyContent: 'center', alignItems: 'center' },
  center:  { alignItems: 'center', gap: 18 },
  logo:    { width: 160, height: 160 },
  brand:   { color: '#fff', fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  footer:  { position: 'absolute', bottom: 40, flexDirection: 'row', alignItems: 'center', gap: 6 },
  footerText: { color: '#FFFFFFB3', fontSize: 12, fontWeight: '600' },
});
