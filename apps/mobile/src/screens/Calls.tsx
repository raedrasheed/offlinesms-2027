import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme';
export default function Calls() { return <View style={s.root}><Text style={s.t}>Calls history — TODO</Text></View>; }
const s = StyleSheet.create({ root: { flex:1, padding:24, backgroundColor: colors.bgCanvas }, t: { color: '#6B7488' } });
