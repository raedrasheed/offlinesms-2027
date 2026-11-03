import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { auth } from '../lib/firebase';
import { normalizePhoneToE164 } from '../lib/phone';
import { ContactPickerModal } from './ContactPickerModal';

export type PhoneRecipient = { displayName: string; phoneNumber: string };
export function PhoneRecipientForm({ onAdd, disabled = false }: { onAdd: (contact: PhoneRecipient) => void; disabled?: boolean }) {
  const { t } = useTranslation(), { colors } = useTheme();
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [picker, setPicker] = useState(false);
  const dial = auth.currentUser?.phoneNumber?.startsWith('+972') ? '+972' : '+970';
  const normalized = normalizePhoneToE164(phone, dial);
  const input = [s.input, { color: colors.text.primary, backgroundColor: colors.background.surface, borderColor: colors.border.subtle }];
  return <View style={s.form}>
    <Text style={{ color: colors.text.muted }}>{t('phoneChat.hint')}</Text>
    <TextInput accessibilityLabel={t('phoneChat.name')} placeholder={t('phoneChat.name')} placeholderTextColor={colors.text.muted}
      style={input} value={name} onChangeText={setName} maxLength={80} editable={!disabled}/>
    <TextInput accessibilityLabel={t('phoneChat.number')} placeholder={t('phoneChat.number')} placeholderTextColor={colors.text.muted}
      style={input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={30} editable={!disabled}/>
    <View style={s.actions}>
      <Pressable accessibilityRole="button" disabled={disabled} onPress={() => setPicker(true)} style={s.button}><Text style={{ color: colors.action.primary }}>{t('phoneChat.pick')}</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={disabled || !normalized || !name.trim()} style={[s.button, { opacity: disabled || !normalized || !name.trim() ? 0.4 : 1 }]}
        onPress={() => { if (normalized && name.trim()) { onAdd({ displayName: name.trim(), phoneNumber: normalized }); setName(''); setPhone(''); } }}>
        <Text style={{ color: colors.action.primary }}>{t('phoneChat.add')}</Text>
      </Pressable>
    </View>
    <ContactPickerModal visible={picker} defaultCountry={dial} onClose={() => setPicker(false)} onPick={c => { setName(c.name); setPhone(c.phoneE164); setPicker(false); }}/>
  </View>;
}
const s = StyleSheet.create({ form: { padding: 14, gap: 8 }, input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 }, actions: { flexDirection: 'row', justifyContent: 'space-between' }, button: { padding: 12 } });
