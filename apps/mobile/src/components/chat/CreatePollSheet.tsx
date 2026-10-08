// Create a poll: a question, 2–12 options (add/remove), and the creator's
// choice of single or multiple answers. The same rules are enforced by the
// server (functions/src/chats/pollLogic.ts); the form shows them up front.

import { useMemo, useState } from 'react';
import {
  Modal, View, Text, TextInput, Pressable, ScrollView, Switch, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { isRTL } from '../../i18n';
import {
  validatePollDraft, POLL_OPTIONS_MAX, POLL_OPTION_MAX, POLL_QUESTION_MAX,
} from '../../lib/pollModel';

export interface PollDraft { question: string; options: string[]; multiple: boolean }

export function CreatePollSheet({ visible, onClose, onCreate }: {
  visible: boolean;
  onClose: () => void;
  onCreate: (poll: PollDraft) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => styles(colors), [colors]);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [touched, setTouched] = useState(false);

  const error = validatePollDraft(question, options);
  const reset = () => { setQuestion(''); setOptions(['', '']); setMultiple(false); setTouched(false); };
  const close = () => { reset(); onClose(); };
  const submit = () => {
    setTouched(true);
    if (error) return;
    onCreate({ question: question.trim(), options: options.map(o => o.trim()).filter(Boolean), multiple });
    reset();
  };
  const setOption = (i: number, v: string) => setOptions(prev => {
    const next = prev.map((o, j) => (j === i ? v : o));
    // Typing into the last field adds an empty one (up to the maximum).
    if (i === next.length - 1 && v.trim() && next.length < POLL_OPTIONS_MAX) next.push('');
    return next;
  });
  const removeOption = (i: number) => setOptions(prev => (prev.length <= 2 ? prev : prev.filter((_, j) => j !== i)));
  const align = isRTL ? 'right' : 'left';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.backdrop}>
        <View style={[s.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={s.headerRow}>
            <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
              <Text style={s.cancel}>{t('common.cancel')}</Text>
            </Pressable>
            <Text style={s.title}>{t('poll.create')}</Text>
            <Pressable onPress={submit} hitSlop={10} accessibilityRole="button" accessibilityState={{ disabled: !!error }}>
              <Text style={[s.send, !!error && s.sendDisabled]}>{t('common.send')}</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10, paddingBottom: 12 }}>
            <Text style={[s.label, { textAlign: align }]}>{t('poll.question')}</Text>
            <TextInput
              style={[s.input, { textAlign: align }]}
              value={question}
              onChangeText={setQuestion}
              placeholder={t('poll.questionPlaceholder')}
              placeholderTextColor={colors.text.disabled}
              maxLength={POLL_QUESTION_MAX}
              multiline
              accessibilityLabel={t('poll.question')}
            />
            <Text style={[s.label, { textAlign: align }]}>{t('poll.options')}</Text>
            {options.map((o, i) => (
              <View key={i} style={s.optRow}>
                <TextInput
                  style={[s.input, { flex: 1, textAlign: align }]}
                  value={o}
                  onChangeText={v => setOption(i, v)}
                  placeholder={t('poll.optionPlaceholder', { n: i + 1 })}
                  placeholderTextColor={colors.text.disabled}
                  maxLength={POLL_OPTION_MAX}
                  accessibilityLabel={t('poll.optionPlaceholder', { n: i + 1 })}
                />
                {options.length > 2 ? (
                  <Pressable onPress={() => removeOption(i)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('poll.removeOption')}>
                    <Ionicons name="close-circle" size={22} color={colors.text.muted} />
                  </Pressable>
                ) : null}
              </View>
            ))}
            <Text style={[s.hint, { textAlign: align }]}>{t('poll.optionsHint', { max: POLL_OPTIONS_MAX })}</Text>
            <View style={s.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={[s.switchLabel, { textAlign: align }]}>{t('poll.allowMultiple')}</Text>
                <Text style={[s.hint, { textAlign: align }]}>{multiple ? t('poll.selectMany') : t('poll.selectOne')}</Text>
              </View>
              <Switch value={multiple} onValueChange={setMultiple} accessibilityLabel={t('poll.allowMultiple')} />
            </View>
            {touched && error ? <Text style={s.err} accessibilityLiveRegion="polite">{t(`poll.errors.${error}`)}</Text> : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function styles(colors: any) {
  return StyleSheet.create({
    backdrop:    { flex: 1, backgroundColor: 'rgba(15,18,32,0.55)', justifyContent: 'flex-end' },
    sheet:       { backgroundColor: colors.background.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 12, maxHeight: '90%' },
    headerRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    title:       { fontSize: 16, fontWeight: '800', color: colors.text.primary },
    cancel:      { fontSize: 15, color: colors.text.muted },
    send:        { fontSize: 15, fontWeight: '700', color: colors.action.primary },
    sendDisabled:{ opacity: 0.4 },
    label:       { fontSize: 13, fontWeight: '700', color: colors.text.secondary },
    input:       { borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text.primary, backgroundColor: colors.background.app },
    optRow:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
    hint:        { fontSize: 12, color: colors.text.muted },
    switchRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
    switchLabel: { fontSize: 15, color: colors.text.primary, fontWeight: '600' },
    err:         { fontSize: 13, fontWeight: '600', color: colors.state.error },
  });
}
