// i18n context. Strings come from the backend (locales/fr.json) so there is a
// single source of truth and Arabic can be added later with no code change.
import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const I18nContext = createContext({ t: (k) => k, lang: 'fr' });

export function I18nProvider({ children }) {
  const [strings, setStrings] = useState(null);
  const [lang, setLang] = useState('fr');

  useEffect(() => {
    api
      .get('/api/meta/i18n?lang=fr')
      .then((d) => {
        setStrings(d.strings);
        setLang(d.lang);
      })
      .catch(() => setStrings({}));
  }, []);

  const t = (key) => {
    if (!strings) return '';
    return key.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : null), strings) ?? key;
  };

  if (!strings) return null; // brief blank while strings load

  return <I18nContext.Provider value={{ t, lang }}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
