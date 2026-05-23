import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, radius } from '../theme';

type Props = {
  onDigit: (d: string) => void;
  onDelete: () => void;
};

export default function NumberPad({ onDigit, onDelete }: Props) {
  return (
    <View style={s.pad}>
      {['1','2','3','4','5','6','7','8','9'].map(d => (
        <Pressable key={d} style={s.key} onPress={() => onDigit(d)} android_ripple={{ color: '#00000010' }}>
          <Text style={s.keyText}>{d}</Text>
        </Pressable>
      ))}
      <View style={s.key} />
      <Pressable style={s.key} onPress={() => onDigit('0')} android_ripple={{ color: '#00000010' }}>
        <Text style={s.keyText}>0</Text>
      </Pressable>
      <Pressable style={s.key} onPress={onDelete} android_ripple={{ color: '#00000010' }}>
        <Text style={[s.keyText, { fontSize: 22 }]}>⌫</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  pad: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    justifyContent:'space-between',
    rowGap:        12,
  },
  key: {
    width:           '31%',
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderRadius:    radius.md,
    alignItems:      'center',
    justifyContent:  'center',
    borderWidth:     1,
    borderColor:     colors.ink100,
  },
  keyText: {
    fontSize:   24,
    fontWeight: '700',
    color:      colors.ink,
  },
});
