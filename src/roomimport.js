// Reads a list of guest rooms to clean from a spreadsheet (.xlsx / .csv), a text file or pasted email text.
// It is forgiving: it looks at every row for 3-digit room codes (e.g. 322), a date and the words Check-out / Check-in,
// and heading rows ("Check-out", "11.11.2026") carry down to the rows below them. The supervisor checks the result before anything is saved.
import { parseDateText, norm } from './teamsimport.js';

const OUT = /check ?out|abreise|departure|salida|saida|vertrek|avresa|\bc\/o\b/;
const IN = /check ?in|anreise|arrival|llegada|chegada|aankomst|ankomst|\bc\/i\b/;
const DATE_RES = [/\d{4}-\d{1,2}-\d{1,2}/g, /\d{1,2}[./]\d{1,2}[./]\d{2,4}/g, /\d{1,2}\.\d{1,2}\./g, /\b\d{1,2}\.?\s+[A-Za-zÀ-ÿ]{3,}\.?(?:\s+\d{4})?/g];
const TIME_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

// A CSV / text table -> rows of cells (same shape as readXlsx)
export function parseDelimited(text) {
  const sample = text.split(/\r?\n/).slice(0, 5).join('\n');
  const count = (c) => (sample.match(new RegExp(c === '\t' ? '\t' : '\\' + c, 'g')) || []).length;
  const delim = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];
  const rows = []; let row = [], cell = '', q = false;
  const push = () => { row.push(cell); cell = ''; };
  const end = () => { push(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"' && !cell) q = true;
    else if (ch === delim) push();
    else if (ch === '\n') end();
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) end();
  return rows.map((r) => r.map((s) => (s.trim() ? { t: 'text', s: s.trim() } : null)));
}

export async function readTextFile(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}

// Dates in a line of text -> [ymd...]; also returns the line with the dates and times taken out (so they are not read as rooms)
function datesIn(line, dateOrder) {
  const found = []; let rest = line;
  for (const re of DATE_RES) {
    rest = rest.replace(re, (m) => {
      const p = parseDateText(m, { dateOrder, year: new Date().getFullYear() });
      if (p && p.ymd) { found.push(p.ymd); return ' '; }
      return m;
    });
  }
  return { found, rest: rest.replace(TIME_RE, ' ') };
}

// rows: array of arrays of cells ({t,s,ymd?}) -> { items: [{id, code, day, flow}], sawDay, sawFlow }
export function parseRooms(rows, { dateOrder = 'dmy' } = {}) {
  const items = []; const seen = new Set();
  let curDay = null, curFlow = null, id = 0, sawDay = false, sawFlow = false;
  for (const cells of rows) {
    const parts = []; const cellDays = [];
    for (const c of cells || []) {
      if (!c) continue;
      if ((c.t === 'date' || c.t === 'dt') && c.ymd) { cellDays.push(c.ymd); continue; }
      if (c.t === 'time') continue;
      parts.push(String(c.s));
    }
    const line = parts.join(' | ');
    const { found, rest } = datesIn(line, dateOrder);
    const days = [...cellDays, ...found];
    const n = norm(line);
    const flow = OUT.test(n) && !(IN.test(n) && n.search(IN) < n.search(OUT)) ? 'checkout' : IN.test(n) ? 'checkin' : null;
    const codes = [...rest.matchAll(/(?<!\d[.,]?)[1-9]\d{2}(?![\d:]|[.,]\d)/g)].map((m) => m[0]);
    if (days.length) { curDay = days[0]; sawDay = true; }
    if (flow) { curFlow = flow; sawFlow = true; }
    // a row with no room in it is a heading (it only sets the day / the type for the rows below)
    for (const code of codes) {
      const key = `${days[0] || curDay}|${flow || curFlow}|${code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ id: ++id, code, day: days[0] || curDay, flow: flow || curFlow });
    }
  }
  return { items, sawDay, sawFlow };
}

export function parseRoomText(text, opts) {
  return parseRooms(text.split(/\r?\n/).map((l) => [{ t: 'text', s: l }]), opts);
}
