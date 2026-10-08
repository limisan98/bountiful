import en from './locales/en.js';
import de from './locales/de.js';
import es from './locales/es.js';
import pt from './locales/pt.js';
import nl from './locales/nl.js';
import sv from './locales/sv.js';
import { state, set } from './store.js';

const DICTS = { en, de, es, pt, nl, sv };

export const LANGS = [
  { code: 'en', name: 'English', short: 'EN', locale: 'en-GB' },
  { code: 'de', name: 'Deutsch', short: 'DE', locale: 'de-DE' },
  { code: 'es', name: 'Español', short: 'ES', locale: 'es-ES' },
  { code: 'pt', name: 'Português', short: 'PT', locale: 'pt-PT' },
  { code: 'nl', name: 'Nederlands', short: 'NL', locale: 'nl-NL' },
  { code: 'sv', name: 'Svenska', short: 'SV', locale: 'sv-SE' },
];

// t('some.key') gives the text in the current language (English if a translation is missing)
export function t(key, vars) {
  let text = (DICTS[state.lang] && DICTS[state.lang][key]) || en[key] || key;
  if (vars) text = text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return text;
}

export function currentLocale() {
  return (LANGS.find((l) => l.code === state.lang) || LANGS[0]).locale;
}

export function setLang(code) {
  if (!DICTS[code]) return;
  try { localStorage.setItem('bountiful.lang', code); } catch (_) { /* private mode */ }
  document.documentElement.lang = code;
  set({ lang: code });
}

export function initLang() {
  let saved = 'en';
  try { saved = localStorage.getItem('bountiful.lang') || 'en'; } catch (_) { /* ignore */ }
  if (!DICTS[saved]) saved = 'en';
  document.documentElement.lang = saved;
  state.lang = saved;
}

// Turns a technical error into a kind sentence in the user's language.
export function friendlyError(e) {
  const msg = String((e && (e.message || e.error_description)) || e || '').toLowerCase();
  if (e && e.code === 'weak') return t('err.weak');
  if (msg.includes('invalid login')) return t('err.badLogin');
  if (msg.includes('database error saving new user') || msg.includes('not on the bountiful list')) return t('err.notListed');
  if (msg.includes('already registered') || msg.includes('already been registered')) return t('err.exists');
  if (msg.includes('password should be') || msg.includes('weak password')) return t('err.weak');
  if (msg.includes('rate limit') || msg.includes('too many')) return t('err.rate');
  if (e && (e.code === '23505' || msg.includes('duplicate key'))) return t('err.duplicate');
  if (msg.includes('failed to fetch') || msg.includes('network')) return t('err.network');
  return t('err.generic');
}
