import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, radius } from '../theme';

export default function Welcome({ navigation }: any) {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={s.root}>
      <View style={s.brandRow}>
        <Image source={require('../../assets/adaptive-icon.png')} style={s.logo} />
        <Text style={s.brand}>OfflineSMS</Text>
      </View>

      <View style={s.hero}>
        <Text style={s.title}>
          Conversations{'\n'}that <Text style={s.titleAccent}>just flow</Text>.
        </Text>
        <Text style={s.subtitle}>
          Private messaging built for how modern teams and friends actually talk.
        </Text>
      </View>

      <View style={s.actions}>
        <Pressable style={s.primaryBtn} onPress={() => navigation.navigate('PhoneEntry')}>
          <Text style={s.primaryBtnText}>{t('welcome.continuePhone')}</Text>
        </Pressable>
        <Pressable style={s.secondaryBtn} onPress={() => navigation.navigate('EmailLogin')}>
          <Text style={s.secondaryBtnText}>{t('welcome.continueEmail')}</Text>
        </Pressable>
        <Text style={s.terms}>
          By continuing you agree to our <Text style={s.termsLink}>Terms</Text> & <Text style={s.termsLink}>Privacy</Text>.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: '#fff', paddingHorizontal: 28 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 40 },
  logo:     { width: 32, height: 32, borderRadius: 8 },
  brand:    { fontSize: 16, fontWeight: '800', color: colors.ink },

  hero:     { flex: 1, justifyContent: 'center', marginTop: -40 },
  title:    { fontSize: 36, fontWeight: '800', letterSpacing: -0.8, color: colors.ink, lineHeight: 42 },
  titleAccent: { fontStyle: 'italic', color: colors.primary },
  subtitle: { fontSize: 14, color: colors.ink500, marginTop: 16, lineHeight: 22 },

  actions:  { paddingBottom: 24, gap: 10 },
  primaryBtn:     { backgroundColor: colors.primary, padding: 16, borderRadius: radius.md, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryBtn:   { backgroundColor: '#fff', padding: 16, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.ink200 },
  secondaryBtnText: { color: colors.ink, fontWeight: '700', fontSize: 15 },
  terms:    { fontSize: 11, color: colors.ink500, textAlign: 'center', marginTop: 10 },
  termsLink:{ fontWeight: '600', color: colors.ink700 },
});
