import {Alert,Platform} from 'react-native';
import i18n from 'i18next';
import {CLIPS_COMMUNITY_TERMS} from './clipTerms';

/** No acceptance is inferred from closing the dialog, navigation, or timeout. */
export function confirmClipTerms(version: string): Promise<boolean> {
  const ar = (i18n.resolvedLanguage ?? i18n.language ?? 'en').startsWith('ar');
  const title = ar ? 'شروط مجتمع المقاطع' : 'Clips community terms';
  const intro = ar ? 'للتفاعل مع المقاطع، اقرأ الشروط ووافق عليها.' : 'To interact with clips, read and accept these terms.';
  const body = `${intro}\n\n${ar ? CLIPS_COMMUNITY_TERMS.ar : CLIPS_COMMUNITY_TERMS.en}\n\n${ar ? 'الإصدار' : 'Version'}: ${version}`;
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof globalThis.confirm === 'function' && globalThis.confirm(`${title}\n\n${body}`));
  }
  return new Promise(resolve => Alert.alert(title, body, [
    {text: ar ? 'إلغاء' : 'Cancel', style: 'cancel', onPress: () => resolve(false)},
    {text: ar ? 'أوافق' : 'Accept', onPress: () => resolve(true)},
  ], {cancelable: true, onDismiss: () => resolve(false)}));
}
