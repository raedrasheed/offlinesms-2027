import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager } from 'react-native';
import * as Localization from 'expo-localization';
import en from './en.json';
import ar from './ar.json';

const SUPPORTED = ['en', 'ar'] as const;
type SupportedLocale = (typeof SUPPORTED)[number];

function isSupportedLocale(s: string | null | undefined): s is SupportedLocale {
  return SUPPORTED.includes(s as SupportedLocale);
}

const deviceLocale = Localization.getLocales()[0]?.languageCode ?? 'en';
const initialLocale: SupportedLocale = isSupportedLocale(deviceLocale) ? deviceLocale : 'en';

export let isRTL = initialLocale === 'ar';

function applyRTL(locale: string) {
  const rtl = locale === 'ar';
  if (I18nManager.isRTL !== rtl) {
    I18nManager.allowRTL(rtl);
    I18nManager.forceRTL(rtl);
  }
  isRTL = rtl;
}

applyRTL(initialLocale);

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  lng:          initialLocale,
  fallbackLng:  'en',
  interpolation: { escapeValue: false },
});

// Runtime language change — persists for the session.
// A full RTL switch requires app restart (React Native limitation).
export async function changeLanguage(locale: SupportedLocale): Promise<void> {
  await i18n.changeLanguage(locale);
  applyRTL(locale);
}

export default i18n;
