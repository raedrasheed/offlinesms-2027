import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert, Modal, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, radius } from '../theme';
import { requestPhoneOtp, otpErrorCopy, getSupportedPhoneCountries } from '../lib/auth';
import { availableCountries, flagEmoji, type Country } from '../lib/countries';

type LoadState = 'loading' | 'ready' | 'error';

function formatPhone(digits: string): string {
  // Loose grouping for visual rhythm; doesn't enforce any spec.
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0,3)} ${digits.slice(3)}`;
  return `${digits.slice(0,3)} ${digits.slice(3,6)} ${digits.slice(6,10)}`;
}

export default function PhoneEntry({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [country, setCountry] = useState<Country | null>(null);
  const [digits, setDigits]   = useState('');
  const [picker, setPicker]   = useState(false);
  const [search, setSearch]   = useState('');
  const [busy, setBusy]       = useState(false);

  // Supported countries (only those an active relay currently serves).
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [supported, setSupported] = useState<Set<string>>(new Set());

  async function loadSupported() {
    setLoadState('loading');
    try {
      const codes = await getSupportedPhoneCountries();
      setSupported(new Set(codes));
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }

  useEffect(() => { loadSupported(); }, []);

  // The picker shows only supported countries (priority-ordered).
  const available = useMemo(() => availableCountries(supported), [supported]);

  // Default/clamp the selection to a supported country whenever the set changes.
  useEffect(() => {
    if (available.length === 0) { setCountry(null); return; }
    setCountry(prev => (prev && supported.has(prev.code) ? prev : available[0]));
  }, [available, supported]);

  const hasCountries = loadState === 'ready' && available.length > 0;
  const canSubmit = hasCountries && !!country && digits.length >= 7 && !busy;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return available;
    const qDial = q.replace(/^\+/, '');
    return available.filter(c =>
      c.name.toLowerCase().includes(q) || c.dial.replace('+', '').startsWith(qDial),
    );
  }, [search, available]);

  function pick(c: Country) {
    setCountry(c);
    setPicker(false);
    setSearch('');
  }

  async function next() {
    if (!country) return;
    // E.164 = dial code (already has +) + local digits.
    const phoneE164 = `${country.dial}${digits.replace(/\D/g, '')}`;
    setBusy(true);
    try {
      await requestPhoneOtp(phoneE164);
      navigation.navigate('Otp', { phone: phoneE164 });
    } catch (e: any) {
      Alert.alert(t('auth.couldntSendCode'), otpErrorCopy(e?.message ?? e?.code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[s.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <Pressable style={s.back} onPress={() => navigation.goBack()} hitSlop={12}>
        <Ionicons name="chevron-back" size={24} color={colors.ink} />
      </Pressable>

      <Text style={s.h1}>{t('auth.yourPhone')}</Text>
      <Text style={s.sub}>{t('auth.phoneSubtitle')}</Text>

      {loadState === 'loading' ? (
        <View style={s.stateBox}>
          <ActivityIndicator color={colors.primary} />
          <Text style={s.stateText}>{t('auth.loadingCountries')}</Text>
        </View>
      ) : loadState === 'error' ? (
        <Pressable style={s.stateBox} onPress={loadSupported}>
          <Ionicons name="refresh" size={20} color={colors.ink500} />
          <Text style={s.stateText}>{t('auth.countriesLoadError')}</Text>
        </Pressable>
      ) : available.length === 0 ? (
        <View style={s.stateBox}>
          <Ionicons name="globe-outline" size={20} color={colors.ink500} />
          <Text style={s.stateText}>{t('auth.noCountriesAvailable')}</Text>
        </View>
      ) : (
        <>
          <View style={s.row}>
            <Pressable style={s.country} onPress={() => setPicker(true)}>
              <Text style={s.flag}>{country ? flagEmoji(country.code) : '🏳️'}</Text>
              <Text style={s.dial}>{country?.dial ?? ''}</Text>
              <Ionicons name="chevron-down" size={14} color={colors.ink500} />
            </Pressable>
            <TextInput
              style={s.input}
              value={formatPhone(digits)}
              onChangeText={v => setDigits(v.replace(/\D/g, '').slice(0, 15))}
              keyboardType="phone-pad"
              placeholder="555 0188"
              placeholderTextColor={colors.ink400}
              autoFocus
            />
          </View>

          <View style={s.hintRow}>
            <Ionicons name="lock-closed" size={12} color={colors.ink500} />
            <Text style={s.hint}>{t('auth.phonePrivacyHint')}</Text>
          </View>
        </>
      )}

      <View style={{ flex: 1 }} />

      <Pressable style={[s.btn, !canSubmit && { opacity: 0.5 }]} onPress={next} disabled={!canSubmit}>
        <Text style={s.btnText}>{t('auth.sendCode')}</Text>
      </Pressable>

      <Modal visible={picker} animationType="slide" onRequestClose={() => setPicker(false)}>
        <SafeAreaView style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>{t('auth.chooseCountry')}</Text>
            <Pressable onPress={() => { setPicker(false); setSearch(''); }} hitSlop={12}>
              <Ionicons name="close" size={26} color={colors.ink} />
            </Pressable>
          </View>
          <View style={s.searchWrap}>
            <Ionicons name="search" size={16} color={colors.ink400} />
            <TextInput
              style={s.search}
              value={search}
              onChangeText={setSearch}
              placeholder={t('auth.searchCountry')}
              placeholderTextColor={colors.ink400}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={c => c.code}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={s.empty}>{t('auth.noCountryMatch', { query: search })}</Text>}
            renderItem={({ item }) => (
              <Pressable style={s.countryRow} onPress={() => pick(item)}>
                <Text style={s.flag}>{flagEmoji(item.code)}</Text>
                <Text style={s.countryName}>{item.name}</Text>
                <Text style={s.countryDial}>{item.dial}</Text>
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root:  { flex: 1, backgroundColor: '#fff', paddingHorizontal: 24 },
  back:  { marginTop: 8, marginBottom: 24, alignSelf: 'flex-start' },
  h1:    { fontSize: 26, fontWeight: '800', color: colors.ink, letterSpacing: -0.4 },
  sub:   { fontSize: 13, color: colors.ink500, marginTop: 8, lineHeight: 20 },

  stateBox:   { marginTop: 28, alignItems: 'center', gap: 10, paddingVertical: 28, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.ink200, borderRadius: radius.md, backgroundColor: '#fff' },
  stateText:  { fontSize: 13, color: colors.ink500, textAlign: 'center', lineHeight: 20 },

  row:        { flexDirection: 'row', gap: 10, marginTop: 28 },
  country:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 14, borderWidth: 1, borderColor: colors.ink200, borderRadius: radius.md, backgroundColor: '#fff' },
  flag:       { fontSize: 18 },
  dial:       { fontSize: 15, fontWeight: '700', color: colors.ink },
  input:      { flex: 1, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 2, borderColor: colors.primary, borderRadius: radius.md, fontSize: 16, fontWeight: '600', color: colors.ink, backgroundColor: '#fff' },

  hintRow:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  hint:       { fontSize: 12, color: colors.ink500 },

  btn:        { padding: 16, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center' },
  btnText:    { color: '#fff', fontWeight: '700', fontSize: 15 },

  modal:        { flex: 1, backgroundColor: '#fff' },
  modalHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: colors.ink100 },
  modalTitle:   { fontSize: 18, fontWeight: '800', color: colors.ink },
  searchWrap:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginVertical: 12, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.ink200, borderRadius: radius.md, backgroundColor: '#fff' },
  search:       { flex: 1, fontSize: 15, color: colors.ink, padding: 0 },
  empty:        { textAlign: 'center', color: colors.ink500, fontSize: 14, marginTop: 24 },
  countryRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.ink100 },
  countryName:  { flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink },
  countryDial:  { fontSize: 14, fontWeight: '700', color: colors.ink500 },
});
