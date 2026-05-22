import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radius } from '../theme';

export default function Welcome({ navigation }: any) {
  const { t } = useTranslation();
  return (
    <View style={s.root}>
      <View style={s.logoTile}/>
      <Text style={s.brand}>OfflineSMS</Text>
      <Text style={s.title}>{t('welcome.title')}</Text>
      <Text style={s.subtitle}>{t('welcome.subtitle')}</Text>
      <View style={{ flex: 1 }}/>
      <Pressable style={s.primaryBtn} onPress={() => navigation.navigate('PhoneEntry')}>
        <Text style={s.primaryBtnText}>{t('welcome.continuePhone')}</Text>
      </Pressable>
      <Pressable style={s.secondaryBtn} onPress={() => navigation.navigate('EmailLogin')}>
        <Text style={s.secondaryBtnText}>{t('welcome.continueEmail')}</Text>
      </Pressable>
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, padding: 28, paddingTop: 80, backgroundColor: colors.bgCanvas },
  logoTile: { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.primary },
  brand: { fontSize: 24, fontWeight: '800', marginTop: 14, color: colors.ink },
  title: { fontSize: 34, fontWeight: '800', letterSpacing: -0.6, marginTop: 64, color: colors.ink, lineHeight: 40 },
  subtitle: { fontSize: 14, color: colors.ink500, marginTop: 14, lineHeight: 22 },
  primaryBtn: { backgroundColor: colors.primary, padding: 14, borderRadius: radius.md, alignItems: 'center', marginBottom: 10 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  secondaryBtn: { backgroundColor: colors.surface, padding: 14, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.ink200 },
  secondaryBtnText: { color: colors.ink, fontWeight: '700' },
});
