import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager } from 'react-native';
import * as Localization from 'expo-localization';
import en from './en.json';
import ar from './ar.json';

const locale = Localization.getLocales()[0]?.languageCode ?? 'en';
const isRTL = locale === 'ar';

if (I18nManager.isRTL !== isRTL) {
  I18nManager.allowRTL(isRTL);
  I18nManager.forceRTL(isRTL);
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: locale,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
