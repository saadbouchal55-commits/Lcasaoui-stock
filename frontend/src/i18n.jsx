// i18n context with live language switching (FR / AR) and RTL support.
// Strings come from the backend (locales/fr.json, locales/ar.json). Product and
// item NAMES stay French in both languages — only interface chrome is translated.
import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const I18nContext = createContext({ t: (k) => k, lang: 'fr', setLang: () => {}, dir: 'ltr' });

const cache = {}; // lang -> strings

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem('lang') || 'fr');
  const [strings, setStrings] = useState(null);

  useEffect(() => {
    const dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', dir);
    localStorage.setItem('lang', lang);

    if (cache[lang]) { setStrings(cache[lang]); return; }
    api
      .get(`/api/meta/i18n?lang=${lang}`)
      .then((d) => { cache[lang] = d.strings; setStrings(d.strings); })
      .catch(() => setStrings(cache[lang] || {}));
  }, [lang]);

  const setLang = (l) => setLangState(l);

  const t = (key, params) => {
    if (!strings) return '';
    let s = key.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : null), strings) ?? key;
    if (params && typeof s === 'string') {
      s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
    }
    return s;
  };

  if (!strings) return null; // brief blank while the first language loads

  return (
    <I18nContext.Provider value={{ t, lang, setLang, dir: lang === 'ar' ? 'rtl' : 'ltr' }}>
      {children}
    </I18nContext.Provider>
  );
}

export const useI18n = () => useContext(I18nContext);
