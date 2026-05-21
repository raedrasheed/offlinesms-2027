import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme';
export default function Status() { return <View style={s.root}><Text style={s.t}>Status / Stories — TODO</Text></View>; }
const s = StyleSheet.create({ root: { flex:1, padding:24, backgroundColor: colors.bgCanvas }, t: { color: '#6B7488' } });
