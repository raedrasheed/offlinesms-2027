// A poll message: question, mode ("Select one" / "Select one or more"),
// options with live counts + bars, the number of people who voted, and — for
// the creator — "End poll". Tapping an option votes (single choice replaces the
// previous vote; multiple choice toggles). Results update live from the
// conversation's realtime feed; my own vote shows optimistically.

import { memo, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { isRTL } from '../../i18n';
import { pollView, toggleSelection, type PollData } from '../../lib/pollModel';

export const PollBubble = memo(function PollBubble({
  poll, me, isCreator, mine, onVote, onClose, interactive = true,
}: {
  poll: PollData;
  me: string;
  isCreator: boolean;
  mine: boolean;          // rendered in my (sent) bubble
  onVote: (selection: string[]) => void;
  onClose: () => void;
  interactive?: boolean; // pending/failed sends still render their full question and options
}) {
  const { t } = useTranslation();
  const v = useMemo(() => pollView(poll, me), [poll, me]);
  const accent = mine ? '#3E7B33' : '#1F7BA8';
  const align = isRTL ? 'right' : 'left';
  const disabled = !interactive || poll.closed || !!poll.closingPending;

  return (
    <View style={s.root}>
      <Text style={[s.q, { textAlign: align }]}>{poll.question}</Text>
      <Text style={[s.mode, { textAlign: align }]}>
        {!interactive ? t('poll.waitingToSend') : poll.closed ? t('poll.closed') : poll.closingPending ? t('poll.ending') : poll.closingFailed ? t('poll.endFailed') : poll.multiple ? t('poll.selectMany') : t('poll.selectOne')}
      </Text>
      {v.options.map(o => (
        <Pressable
          key={o.id}
          style={s.opt}
          disabled={disabled}
          onPress={() => onVote(toggleSelection(poll, v.mine, o.id))}
          accessibilityRole={poll.multiple ? 'checkbox' : 'radio'}
          accessibilityState={{ checked: o.mine, disabled }}
          accessibilityLabel={`${o.text}, ${t('poll.votes', { count: o.count })}`}
        >
          <View style={s.optRow}>
            <Ionicons
              name={o.mine ? (poll.multiple ? 'checkbox' : 'radio-button-on') : (poll.multiple ? 'square-outline' : 'radio-button-off')}
              size={20}
              color={o.mine ? accent : '#8A99A8'}
            />
            <Text style={[s.optText, { textAlign: align }]} numberOfLines={3}>{o.text}</Text>
            <Text style={s.count}>{o.count}</Text>
          </View>
          <View style={s.track}>
            <View style={[s.bar, { width: `${o.percent}%`, backgroundColor: accent }]} />
          </View>
        </Pressable>
      ))}
      <View style={s.footer}>
        <Text style={s.voters}>{t('poll.voters', { count: v.voterCount })}</Text>
        {isCreator && !disabled ? (
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8}>
            <Text style={[s.close, { color: accent }]}>{t('poll.end')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

const s = StyleSheet.create({
  root:    { minWidth: 240, maxWidth: 300, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 2, gap: 6 },
  q:       { fontSize: 16, fontWeight: '700', color: '#16212B' },
  mode:    { fontSize: 12, color: '#5B6B7A' },
  opt:     { paddingVertical: 4 },
  optRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  optText: { flex: 1, fontSize: 15, color: '#16212B' },
  count:   { fontSize: 13, fontWeight: '600', color: '#5B6B7A', minWidth: 18, textAlign: 'center' },
  track:   { height: 5, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.08)', marginTop: 5, marginStart: 28, overflow: 'hidden' },
  bar:     { height: 5, borderRadius: 3 },
  footer:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 },
  voters:  { fontSize: 12, color: '#5B6B7A' },
  close:   { fontSize: 13, fontWeight: '700' },
});

