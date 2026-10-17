// Create a poll: a question, 2–12 options (add/remove), and the creator's
// choice of single or multiple answers. The same rules are enforced by the
// server (functions/src/chats/pollLogic.ts); the form shows them up front.

import { useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, Pressable, ScrollView, Switch, StyleSheet, KeyboardAvoidingView, Keyboard, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { isRTL } from '../../i18n';
import { pollFormScrollOffset } from './pollFormLayout';
import {
  validatePollDraft, POLL_OPTIONS_MAX, POLL_OPTION_MAX, POLL_QUESTION_MAX,
} from '../../lib/pollModel';

export interface PollDraft { question: string; options: string[]; multiple: boolean; anonymous?: boolean }

export function CreatePollSheet({ visible, onClose, onCreate, initial }: {
  visible: boolean;
  onClose: () => void;
  onCreate: (poll: PollDraft) => void;
  initial?: PollDraft;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => styles(colors), [colors]);
  const [question, setQuestion] = useState(initial?.question ?? '');
  const [options, setOptions] = useState<string[]>(initial ? [...initial.options, ''] : ['', '']);
  const [multiple, setMultiple] = useState(initial?.multiple ?? false);
  const [anonymous, setAnonymous] = useState(initial?.anonymous ?? false);
  const [touched, setTouched] = useState(false);

  // RN's Android Modal already uses SOFT_INPUT_ADJUST_RESIZE. A second
  // height-based avoider feeds its own resized layout back into the keyboard
  // calculation and can make the sheet repeatedly collapse/expand. Let that
  // native window be the only resize owner; iOS still needs padding avoidance.
  const KeyboardFrame = Platform.OS === 'ios' ? KeyboardAvoidingView : View;
  const keyboardProps = Platform.OS === 'ios' ? { behavior: 'padding' as const } : {};

  const scrollRef = useRef<ScrollView>(null);
  const fieldLayouts = useRef(new Map<string, { y: number; height: number }>());
  const focusedField = useRef<string | null>(null);
  const viewport = useRef(0);
  const scrollY = useRef(0);
  const revealFocused = () => {
    const field = fieldLayouts.current.get(focusedField.current ?? '');
    if (!field || viewport.current <= 0) return;
    const y = pollFormScrollOffset(field.y, field.height, viewport.current, scrollY.current);
    if (y !== scrollY.current) {
      // Repeated layout callbacks during IME resize must not restart an
      // animated scroll against the same stale native offset.
      scrollY.current = y;
      scrollRef.current?.scrollTo({ y, animated: false });
    }
  };
  const focusField = (key: string) => { focusedField.current = key; revealFocused(); };
  const recordField = (key: string, layout: { y: number; height: number }) => {
    fieldLayouts.current.set(key, layout);
    if (focusedField.current === key) revealFocused();
  };

  const error = validatePollDraft(question, options);
  const reset = () => { setQuestion(''); setOptions(['', '']); setMultiple(false); setAnonymous(false); setTouched(false); };
  const close = () => { Keyboard.dismiss(); focusedField.current = null; reset(); onClose(); };
  const submit = () => {
    setTouched(true);
    if (error) return;
    Keyboard.dismiss();
    focusedField.current = null;
    onCreate({ question: question.trim(), options: options.map(o => o.trim()).filter(Boolean), multiple, anonymous });
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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}
      onShow={() => { scrollY.current = 0; scrollRef.current?.scrollTo({ y: 0, animated: false }); }}>
      <KeyboardFrame {...keyboardProps} style={[s.backdrop, { paddingTop: insets.top + 12 }]}>
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
          <ScrollView
            ref={scrollRef}
            style={s.form}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onLayout={e => { viewport.current = e.nativeEvent.layout.height; revealFocused(); }}
            onScroll={e => { scrollY.current = e.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={16}
            contentContainerStyle={{ gap: 10, paddingBottom: 24 }}
          >
            <Text style={[s.label, { textAlign: align }]}>{t('poll.question')}</Text>
            <TextInput
              style={[s.input, { textAlign: align }]}
              onFocus={() => focusField('question')}
              onLayout={e => recordField('question', e.nativeEvent.layout)}
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
              <View key={i} style={s.optRow} onLayout={e => recordField(`option-${i}`, e.nativeEvent.layout)}>
                <TextInput
                  style={[s.input, { flex: 1, textAlign: align }]}
                  onFocus={() => focusField(`option-${i}`)}
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
            <View style={s.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={[s.switchLabel, { textAlign: align }]}>{t('poll.anonymous')}</Text>
                <Text style={[s.hint, { textAlign: align }]}>{t(anonymous ? 'poll.anonymousHint' : 'poll.publicHint')}</Text>
              </View>
              <Switch value={anonymous} onValueChange={setAnonymous} accessibilityLabel={t('poll.anonymous')} />
            </View>
            <Text style={[s.hint, { textAlign: align }]}>{t('poll.privacyFixed')}</Text>
            {touched && error ? <Text style={s.err} accessibilityLiveRegion="polite">{t(`poll.errors.${error}`)}</Text> : null}
          </ScrollView>
        </View>
      </KeyboardFrame>
    </Modal>
  );
}

function styles(colors: any) {
  return StyleSheet.create({
    backdrop:    { flex: 1, backgroundColor: 'rgba(15,18,32,0.55)', justifyContent: 'flex-end' },
    sheet:       { backgroundColor: colors.background.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 12, flex: 1, minHeight: 0 },
    form:        { flex: 1, minHeight: 0 },
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

