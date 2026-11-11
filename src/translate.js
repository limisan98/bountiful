// Translates what people write (chat messages, task names, notes, comments, handover notes) into the reader's language.
// trFor(text, authorId) answers at once with the text it has: the translation if it is already known, otherwise the original,
// and asks for the translation in the background (batched). When it arrives the screen redraws by itself.
// The interface texts are NOT translated here: they come from src/locales (written in advance, no service needed).
import { state, set } from './store.js';
import { api } from './api.js';

const KEY = 'bountiful.translate';
try { if (localStorage.getItem(KEY) === '0') state.trOn = false; } catch (_) { /* private mode */ }

let broken = false;            // no key yet / quota used up / bad key: stop asking for this session
const asked = new Set();       // "lang\ntext" already requested
let queue = [];                // [{ text, lang }]
let timer = null;

export const translateOn = () => state.trOn && !broken;
export function setTranslateOn(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) { /* ignore */ }
  set({ trOn: on });
}

// The text to show: translated when it was written in another language than mine
export function trFor(text, authorId, authorLang) {
  if (!text || !translateOn()) return text;
  const lang = state.lang;
  if (authorId && state.profile && authorId === state.profile.id) return text;      // my own words
  const author = authorId && state.profiles[authorId];
  const from = authorLang || (author && author.language);
  if (from && from === lang) return text;                                           // same language: nothing to do
  if (text.trim().length < 3 || !/\p{L}/u.test(text)) return text;                   // numbers, room codes, "ok"…
  const hit = state.tr[lang] && state.tr[lang][text];
  if (hit !== undefined) return hit || text;
  const key = lang + '\n' + text;
  if (!asked.has(key)) { asked.add(key); queue.push({ text, lang }); if (!timer) timer = setTimeout(flush, 150); }
  return text;
}
// Is this text currently shown translated? (for the "show original" link)
export const isTranslated = (text, authorId, authorLang) => trFor(text, authorId, authorLang) !== text;

async function flush() {
  timer = null;
  const batch = queue.splice(0, 50);
  if (queue.length) timer = setTimeout(flush, 150);
  if (!batch.length) return;
  const lang = batch[0].lang;
  const texts = batch.filter((b) => b.lang === lang).map((b) => b.text);
  batch.filter((b) => b.lang !== lang).forEach((b) => queue.push(b)); // (the reader changed language meanwhile)
  try {
    const r = await api.translate(texts, lang);
    if (!r || r.error) {
      if (r && ['not_configured', 'quota', 'bad_key'].includes(r.error)) broken = true;
      texts.forEach((x) => asked.delete(lang + '\n' + x)); // may try again later
      return;
    }
    const tr = { ...state.tr, [lang]: { ...(state.tr[lang] || {}) } };
    r.results.forEach((res, i) => { tr[lang][texts[i]] = res.text && res.text !== texts[i] && res.source !== lang ? res.text : ''; });
    set({ tr });
  } catch (_) {
    texts.forEach((x) => asked.delete(lang + '\n' + x));
  }
}
