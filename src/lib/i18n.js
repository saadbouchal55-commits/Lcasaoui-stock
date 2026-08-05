// i18n. French only for v1, but every string lives in locales/*.json so Arabic
// (+ RTL) can be added later with no code changes. NO hardcoded UI strings.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, '..', '..', 'locales');

const cache = {};

export function loadLocale(lang = 'fr') {
  if (!cache[lang]) {
    cache[lang] = JSON.parse(readFileSync(join(LOCALES_DIR, `${lang}.json`), 'utf-8'));
  }
  return cache[lang];
}

/** Dotted-key lookup, e.g. t('waste.title'). Falls back to the key itself. */
export function t(key, lang = 'fr') {
  const dict = loadLocale(lang);
  return key.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : null), dict) ?? key;
}

export default { loadLocale, t };
