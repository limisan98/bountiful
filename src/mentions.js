// @mentions in chat. A mention is stored as plain text ("@Anna Lane") inside the message,
// so it needs no database change and old messages stay readable everywhere.
import { state } from './store.js';
import { activePeople } from './data.js';
import { departmentOf } from './roles.js';

const strip = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const isWordChar = (c) => !!c && /[\p{L}\p{N}_]/u.test(c);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Who can be mentioned in a channel (everyone who can read it, except me)
export function mentionable(channel) {
  const me = state.profile;
  return activePeople()
    .filter((p) => (!me || p.id !== me.id) && (channel === 'all' || departmentOf(p) === channel))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

// Is the cursor inside an "@something" the person is typing? Returns { start, query } or null.
export function mentionTrigger(text, caret) {
  const head = text.slice(0, caret);
  const at = head.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(head[at - 1])) return null; // e-mail addresses are not mentions
  const query = head.slice(at + 1);
  if (query.length > 30 || /[\n]/.test(query)) return null;
  return { start: at, query };
}

// People matching what has been typed after the "@". Works with names that contain spaces.
export function matchPeople(list, query) {
  const q = strip(query).trim();
  const scored = [];
  for (const p of list) {
    const name = strip(p.display_name);
    let score = -1;
    if (!q) score = 3;
    else if (name.startsWith(q)) score = 0;
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 1;
    else if ((' ' + name).includes(' ' + q)) score = 1;
    else if (name.includes(q)) score = 2;
    if (score >= 0) scored.push([score, p]);
  }
  return scored.sort((a, b) => a[0] - b[0]).map((x) => x[1]).slice(0, 6);
}

// Cut a message into plain text and mention pieces: [{ text, who }] (who = profile when it is a mention)
export function splitMentions(body) {
  const people = Object.values(state.profiles).filter((p) => p.display_name).sort((a, b) => b.display_name.length - a.display_name.length);
  if (!people.length || !body.includes('@')) return [{ text: body }];
  const re = new RegExp('@(' + people.map((p) => escapeRe(p.display_name)).join('|') + ')', 'giu');
  const out = [];
  let last = 0, m;
  while ((m = re.exec(body))) {
    const before = body[m.index - 1], after = body[m.index + m[0].length];
    if ((before && !/\s|[(\[{"'“‘]/.test(before)) || isWordChar(after)) { re.lastIndex = m.index + 1; continue; }
    const who = people.find((p) => p.display_name.toLowerCase() === m[1].toLowerCase());
    if (m.index > last) out.push({ text: body.slice(last, m.index) });
    out.push({ text: m[0], who });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last) });
  return out;
}

export const mentionsMe = (body) => !!state.profile && splitMentions(body).some((x) => x.who && x.who.id === state.profile.id);
