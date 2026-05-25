import { View, Text, Pressable, StyleSheet, SafeAreaView, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, LinearGradient as SvgGradient, Stop, Rect } from 'react-native-svg';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function IncomingCall({ navigation, route }: any) {
  const name: string = route?.params?.name ?? 'Renison Hathway';
  const close = () => navigation.goBack();
  const { width, height } = useWindowDimensions();

  return (
    <View style={s.root}>
      <Svg style={StyleSheet.absoluteFill} width={width} height={height}>
        <Defs>
          <SvgGradient id="callBg" x1="0" y1="0" x2="0.35" y2="1">
            <Stop offset="0" stopColor="#1D4ED8" />
            <Stop offset="0.55" stopColor="#4338CA" />
            <Stop offset="1" stopColor="#6D28D9" />
          </SvgGradient>
        </Defs>
        <Rect x="0" y="0" width={width} height={height} fill="url(#callBg)" />
      </Svg>
      <SafeAreaView style={s.safe}>
      <View style={s.top}>
        <Text style={s.kicker}>OFFLINESMS VIDEO</Text>
        <Text style={s.status}>Incoming call…</Text>
      </View>

      <View style={s.center}>
        <View style={s.avatar}><Text style={s.avatarText}>{initials(name)}</Text></View>
        <Text style={s.name}>{name}</Text>
        <View style={s.metaRow}>
          <Ionicons name="lock-closed" size={11} color="#FFFFFFB3" />
          <Text style={s.meta}>via OfflineSMS · End-to-end encrypted</Text>
        </View>
      </View>

      <View style={s.actions}>
        <View style={s.actionItem}>
          <Pressable style={[s.circle, s.neutral]} onPress={close}>
            <Ionicons name="chatbubble" size={22} color="#fff" />
          </Pressable>
          <Text style={s.actionLabel}>Message</Text>
        </View>
        <View style={s.actionItem}>
          <Pressable style={[s.circle, s.neutral]} onPress={close}>
            <Ionicons name="alarm" size={22} color="#fff" />
          </Pressable>
          <Text style={s.actionLabel}>Remind</Text>
        </View>
        <View style={s.actionItem}>
          <Pressable style={[s.circle, s.decline]} onPress={close}>
            <Ionicons name="call" size={24} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
          </Pressable>
          <Text style={s.actionLabel}>Decline</Text>
        </View>
        <View style={s.actionItem}>
          <Pressable style={[s.circle, s.accept]} onPress={close}>
            <Ionicons name="videocam" size={24} color="#fff" />
          </Pressable>
          <Text style={s.actionLabel}>Accept</Text>
        </View>
      </View>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#3B2E8F' },
  safe:   { flex: 1, justifyContent: 'space-between', paddingVertical: 48 },
  top:    { alignItems: 'center', gap: 6, marginTop: 24 },
  kicker: { color: '#FFFFFF99', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  status: { color: '#FFFFFFE6', fontSize: 15, fontWeight: '600' },

  center: { alignItems: 'center', gap: 16 },
  avatar: { width: 132, height: 132, borderRadius: 66, backgroundColor: '#FFFFFF26', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 44, fontWeight: '800' },
  name:   { color: '#fff', fontSize: 26, fontWeight: '800' },
  metaRow:{ flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta:   { color: '#FFFFFFB3', fontSize: 12 },

  actions:    { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', paddingHorizontal: 16 },
  actionItem: { alignItems: 'center', gap: 8 },
  circle:     { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  neutral:    { backgroundColor: '#FFFFFF26' },
  decline:    { backgroundColor: '#EF4444' },
  accept:     { backgroundColor: '#22C55E' },
  actionLabel:{ color: '#FFFFFFCC', fontSize: 12, fontWeight: '600' },
});
