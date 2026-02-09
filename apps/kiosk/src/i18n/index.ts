import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import es from './es.json';

const STORAGE_KEY = 'kiosk_language';

function detectLanguage(): string {
  // 1. Check localStorage preference
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && ['en', 'es'].includes(stored)) {
      return stored;
    }
  } catch {
    // localStorage may not be available
  }

  // 2. Check navigator language
  if (typeof navigator !== 'undefined') {
    const navLang = navigator.language?.split('-')[0];
    if (navLang && ['en', 'es'].includes(navLang)) {
      return navLang;
    }
  }

  // 3. Default to English
  return 'en';
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
  },
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false, // React already escapes
  },
  react: {
    useSuspense: false, // Avoid suspense issues on kiosk
  },
});

export default i18n;
