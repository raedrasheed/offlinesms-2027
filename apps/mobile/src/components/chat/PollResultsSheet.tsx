import { useMemo } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { useDisplayNames } from '../../lib/userProfiles';
import { pollView, type PollData } from '../../lib/pollModel';
import { isRTL } from '../../i18n';

/** Mounted only while open. Anonymous mode never requests voter profiles. */
export function PollResultsSheet({ poll, onClose }: { poll: PollData; onClose: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => styles(colors), [colors]);
  const voters = poll.anonymous ? [] : Object.keys(poll.votes).filter(uid => poll.votes[uid]?.length);
  const nameFor = useDisplayNames(voters);
  const rows = voters.map(uid => ({ uid, name: nameFor(uid, { selfAsYou: true }),
    choices: poll.options.filter(o => poll.votes[uid].includes(o.id)).map(o => o.text).join(' • '),
  })).sort((a, b) => a.name.localeCompare(b.name));
  const view = pollView(poll, undefined);
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <View style={[s.backdrop, { paddingTop: insets.top + 24 }]}>
      <View style={[s.sheet, { paddingBottom: insets.bottom + 12 }]} accessibilityViewIsModal>
        <View style={s.heading}>
          <Text style={s.title}>{t(poll.anonymous ? 'poll.results' : 'poll.viewVoters')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={10} style={s.close}>
            <Ionicons name="close" size={24} color={colors.text.primary} />
          </Pressable>
        </View>
        <FlatList data={rows} keyExtractor={row => row.uid} style={s.list} contentContainerStyle={s.content}
          ListHeaderComponent={<View style={s.summary}>
            <Text style={s.question}>{poll.question}</Text>
            <Text style={s.hint}>{t(poll.anonymous ? 'poll.anonymousHint' : 'poll.publicHint')}</Text>
            {view.options.map(option => <View key={option.id} style={s.result}>
              <View style={s.resultRow}>
                <Text style={s.option}>{option.text}</Text>
                <Text style={s.count}>{t('poll.votes', { count: option.count })} · {option.percent}%</Text>
              </View>
              <View style={s.track}><View style={[s.bar, { width: `${option.percent}%` }]} /></View>
            </View>)}
            <Text style={s.total}>{t('poll.voters', { count: view.voterCount })}</Text>
          </View>}
          ListEmptyComponent={<Text style={s.hint}>{t(poll.anonymous ? 'poll.identitiesHidden' : 'poll.noVoters')}</Text>}
          renderItem={({ item }) => <View style={s.voter}>
            <View style={s.avatar}><Ionicons name="person-outline" size={22} color={colors.action.primary} /></View>
            <View style={s.person}>
              <Text style={s.name}>{item.name}</Text>
              <Text style={s.choices}>{item.choices}</Text>
            </View>
          </View>} />
      </View>
    </View>
  </Modal>;
}

function styles(c: any) {
  const align = isRTL ? 'right' as const : 'left' as const;
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,18,32,0.55)' },
    sheet: { maxHeight: '94%', backgroundColor: c.background.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 16 },
    heading: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 12 },
    title: { flex: 1, fontSize: 19, fontWeight: '700', color: c.text.primary, textAlign: align },
    close: { padding: 10 }, list: { flexGrow: 0 }, content: { paddingBottom: 16 },
    summary: { gap: 12, paddingBottom: 16 },
    question: { fontSize: 18, fontWeight: '700', color: c.text.primary, textAlign: align },
    hint: { fontSize: 14, lineHeight: 22, color: c.text.muted, textAlign: align },
    result: { gap: 6 }, resultRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
    option: { flexGrow: 1, flexShrink: 1, fontSize: 15, color: c.text.primary, textAlign: align },
    count: { fontSize: 13, color: c.text.secondary },
    track: { height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: c.border.subtle },
    bar: { height: 6, borderRadius: 3, backgroundColor: c.action.primary },
    total: { fontSize: 14, fontWeight: '600', color: c.text.secondary, textAlign: align },
    voter: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle },
    avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.background.app, alignItems: 'center', justifyContent: 'center' },
    person: { flex: 1, gap: 4 },
    name: { fontSize: 16, fontWeight: '600', color: c.text.primary, textAlign: align },
    choices: { fontSize: 14, lineHeight: 22, color: c.text.secondary, textAlign: align },
  });
}
