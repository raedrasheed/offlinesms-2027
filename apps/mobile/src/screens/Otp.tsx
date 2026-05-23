import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';
import NumberPad from '../components/NumberPad';

const LENGTH = 6;
const RESEND_SECONDS = 42;

export default function Otp({ navigation, route }: any) {
  const phone: string = route?.params?.phone ?? '+1 (415) 555-0188';
  const [code, setCode] = useState('');
  const [remaining, setRemaining] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (remaining <= 0) return;
    const t = setInterval(() => setRemaining(r => r - 1), 1000);
    return () => clearInterval(t);
  }, [remaining]);

  function pressDigit(d: string) {
    if (code.length >= LENGTH) return;
    setCode(c => c + d);
  }
  function pressDelete() {
    setCode(c => c.slice(0, -1));
  }
  function resend() {
    if (remaining > 0) return;
    setRemaining(RESEND_SECONDS);
  }

  const mm = Math.floor(remaining / 60).toString().padStart(1, '0');
  const ss = (remaining % 60).toString().padStart(2, '0');

  return (
    <SafeAreaView style={s.root}>
      <Pressable style={s.back} onPress={() => navigation.goBack()} hitSlop={12}>
        <Ionicons name="chevron-back" size={24} color={colors.ink} />
      </Pressable>

      <Text style={s.h1}>Verify your number</Text>
      <Text style={s.sub}>Code sent to <Text style={{ fontWeight: '700', color: colors.ink }}>{phone}</Text></Text>

      <View style={s.boxes}>
        {Array.from({ length: LENGTH }).map((_, i) => {
          const ch = code[i];
          const active = i === code.length;
          return (
            <View key={i} style={[s.box, active && s.boxActive, !!ch && s.boxFilled]}>
              <Text style={s.boxText}>{ch ?? ''}</Text>
            </View>
          );
        })}
      </View>

      <View style={s.resendRow}>
        <Text style={s.didnt}>Didn’t receive?</Text>
        <Pressable onPress={resend} disabled={remaining > 0}>
          <Text style={[s.resend, remaining > 0 && { color: colors.ink400 }]}>
            {remaining > 0 ? `Resend ${mm}:${ss}` : 'Resend code'}
          </Text>
        </Pressable>
      </View>

      <View style={{ flex: 1 }} />

      <NumberPad onDigit={pressDigit} onDelete={pressDelete} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:  { flex: 1, backgroundColor: '#fff', paddingHorizontal: 24, paddingBottom: 24 },
  back:  { marginTop: 8, marginBottom: 24, alignSelf: 'flex-start' },
  h1:    { fontSize: 26, fontWeight: '800', color: colors.ink, letterSpacing: -0.4 },
  sub:   { fontSize: 13, color: colors.ink500, marginTop: 8 },

  boxes: { flexDirection: 'row', gap: 10, marginTop: 28, justifyContent: 'space-between' },
  box:   { flex: 1, aspectRatio: 1, borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink200, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  boxFilled: { borderColor: colors.ink300 },
  boxActive: { borderColor: colors.primary, borderWidth: 2 },
  boxText:   { fontSize: 24, fontWeight: '800', color: colors.ink },

  resendRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18 },
  didnt:  { fontSize: 13, color: colors.ink500 },
  resend: { fontSize: 13, fontWeight: '700', color: colors.primary },
});
