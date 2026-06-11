import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert, SafeAreaView, Modal, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';
import { requestPhoneOtp, otpErrorCopy } from '../lib/auth';
import { COUNTRIES, PRIORITY_CODES, flagEmoji, type Country } from '../lib/countries';

const DEFAULT_COUNTRY = COUNTRIES.find(c => c.code === 'PS') ?? COUNTRIES[0];

// Priority countries first (region-relevant), then the rest alphabetically.
const ORDERED: Country[] = [
  ...PRIORITY_CODES.map(code => COUNTRIES.find(c => c.code === code)).filter((c): c is Country => !!c),
  ...COUNTRIES.filter(c => !PRIORITY_CODES.includes(c.code)),
];

function formatPhone(digits: string): string {
  // Loose grouping for visual rhythm; doesn't enforce any spec.
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0,3)} ${digits.slice(3)}`;
  return `${digits.slice(0,3)} ${digits.slice(3,6)} ${digits.slice(6,10)}`;
}

export default function PhoneEntry({ navigation }: any) {
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [digits, setDigits]   = useState('');
  const [picker, setPicker]   = useState(false);
  const [search, setSearch]   = useState('');
  const [busy, setBusy]       = useState(false);
  const canSubmit = digits.length >= 7 && !busy;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ORDERED;
    const qDial = q.replace(/^\+/, '');
    return ORDERED.filter(c =>
      c.name.toLowerCase().includes(q) || c.dial.replace('+', '').startsWith(qDial),
    );
  }, [search]);

  function pick(c: Country) {
    setCountry(c);
    setPicker(false);
    setSearch('');
  }

  async function next() {
    // E.164 = dial code (already has +) + local digits.
    const phoneE164 = `${country.dial}${digits.replace(/\D/g, '')}`;
    setBusy(true);
    try {
      await requestPhoneOtp(phoneE164);
      navigation.navigate('Otp', { phone: phoneE164 });
    } catch (e: any) {
      Alert.alert('Couldn’t send code', otpErrorCopy(e?.message ?? e?.code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.root}>
      <Pressable style={s.back} onPress={() => navigation.goBack()} hitSlop={12}>
        <Ionicons name="chevron-back" size={24} color={colors.ink} />
      </Pressable>

      <Text style={s.h1}>Your phone number</Text>
      <Text style={s.sub}>We’ll text you a 6-digit code. Carrier rates may apply.</Text>

      <View style={s.row}>
        <Pressable style={s.country} onPress={() => setPicker(true)}>
          <Text style={s.flag}>{flagEmoji(country.code)}</Text>
          <Text style={s.dial}>{country.dial}</Text>
          <Ionicons name="chevron-down" size={14} color={colors.ink500} />
        </Pressable>
        <TextInput
          style={s.input}
          value={formatPhone(digits)}
          onChangeText={t => setDigits(t.replace(/\D/g, '').slice(0, 15))}
          keyboardType="phone-pad"
          placeholder="555 0188"
          placeholderTextColor={colors.ink400}
          autoFocus
        />
      </View>

      <View style={s.hintRow}>
        <Ionicons name="lock-closed" size={12} color={colors.ink500} />
        <Text style={s.hint}>Your number isn’t shared with contacts.</Text>
      </View>

      <View style={{ flex: 1 }} />

      <Pressable style={[s.btn, !canSubmit && { opacity: 0.5 }]} onPress={next} disabled={!canSubmit}>
        <Text style={s.btnText}>Send code</Text>
      </Pressable>

      <Modal visible={picker} animationType="slide" onRequestClose={() => setPicker(false)}>
        <SafeAreaView style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Choose country</Text>
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
              placeholder="Search country or code"
              placeholderTextColor={colors.ink400}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={c => c.code}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={s.empty}>No countries match “{search}”.</Text>}
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
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:  { flex: 1, backgroundColor: '#fff', paddingHorizontal: 24, paddingBottom: 24 },
  back:  { marginTop: 8, marginBottom: 24, alignSelf: 'flex-start' },
  h1:    { fontSize: 26, fontWeight: '800', color: colors.ink, letterSpacing: -0.4 },
  sub:   { fontSize: 13, color: colors.ink500, marginTop: 8, lineHeight: 20 },

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
