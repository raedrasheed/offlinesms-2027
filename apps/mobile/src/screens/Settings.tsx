import { View, Text, Pressable, StyleSheet } from 'react-native';
import { signOut } from '../lib/auth';
import { colors } from '../theme';

export default function Settings({ navigation }: any) {
  return (
    <View style={s.root}>
      <Pressable style={s.row} onPress={() => navigation.navigate('Points')}><Text style={s.txt}>Points wallet →</Text></Pressable>
      <Pressable style={s.row} onPress={() => navigation.navigate('Privacy')}><Text style={s.txt}>Privacy →</Text></Pressable>
      <Pressable style={s.row} onPress={() => navigation.navigate('Devices')}><Text style={s.txt}>Linked devices →</Text></Pressable>
      <Pressable style={s.row} onPress={() => signOut()}><Text style={[s.txt, { color: colors.err }]}>Sign out</Text></Pressable>
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex:1, padding: 14, backgroundColor: colors.bgCanvas, gap: 8 },
  row: { padding: 14, backgroundColor: '#fff', borderRadius: 12 },
  txt: { fontSize: 14, fontWeight: '600', color: colors.ink },
});
