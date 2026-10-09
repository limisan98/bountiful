// Reads the schedule that Microsoft Teams Shifts (Schichten) exports to Excel and turns it into planned shifts.
// Two layouts are understood (the layout is detected automatically):
//   LIST  one row per shift:   Member | Start Date | Start Time | End Date | End Time | ...   (the real Teams export)
//   GRID  one row per person:  Full Name | 1 Oct | 2 Oct | ...   with cells like "07:00–15:30"
// Nothing here touches the database: parse() reads the sheet, resolve() checks every row against our people, shifts and rules.
import { toMin } from './time.js';

// ---------------------------------------------------------------- small helpers
export const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// "Weber, Jonas" and "Jonas  Weber" and "JONAS WEBER" are the same person
export function nameKey(s) {
  let x = String(s == null ? '' : s).replace(/\(.*?\)/g, ' ').trim();
  if (x.includes(',')) { const [a, ...b] = x.split(','); x = b.join(' ') + ' ' + a; }
  return norm(x);
}
const pad = (n) => String(n).padStart(2, '0');
const ymdOf = (y, m, d) => {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};
export const weekdayOf = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); const w = new Date(y, m - 1, d).getDay(); return w === 0 ? 7 : w; };
export const fmtMin = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

const MONTHS = {};
[['january jan', 1], ['february feb', 2], ['march mar mrz', 3], ['april apr', 4], ['may mai mei maj', 5], ['june jun', 6], ['july jul', 7], ['august aug', 8], ['september sep sept', 9],
  ['october oct okt', 10], ['november nov', 11], ['december dec dez', 12],
  ['januar', 1], ['februar', 2], ['marz', 3], ['juni', 6], ['juli', 7], ['oktober', 10], ['dezember', 12],
  ['enero ene', 1], ['febrero', 2], ['marzo', 3], ['abril abr', 4], ['mayo', 5], ['junio', 6], ['julio', 7], ['agosto ago', 8], ['septiembre setiembre', 9], ['octubre', 10], ['noviembre', 11], ['diciembre dic', 12],
  ['janeiro', 1], ['fevereiro fev', 2], ['marco', 3], ['maio', 5], ['junho', 6], ['julho', 7], ['setembro set', 9], ['outubro out', 10], ['novembro', 11], ['dezembro dez', 12],
  ['januari', 1], ['februari', 2], ['maart', 3], ['augustus', 8], ['mars', 3], ['augusti', 8], ['december', 12],
].forEach(([names, n]) => names.split(' ').forEach((w) => { MONTHS[w] = n; }));
const monthOfWord = (w) => MONTHS[norm(w)] || null;
const WEEKDAY_WORDS = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|mo|di|mi|do|fr|sa|so|lun|mar|mie|jue|vie|sab|dom|seg|ter|qua|qui|sex|ma|woe|vr|za|zo|man|tis|ons|tors|fre|lor|son)\w*$/;

// ---------------------------------------------------------------- dates
// -> { ymd } | { day } (only a day number: needs the month) | null
export function parseDateText(text, ctx = {}) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return null;
  const year = ctx.year || new Date().getFullYear();
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) { const v = ymdOf(+m[1], +m[2], +m[3]); return v ? { ymd: v } : null; }
  if ((m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/.exec(s))) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    const sep = /[/]/.test(s) ? '/' : '.';
    let d, mo;
    if (sep === '.' || /-/.test(s.slice(0, 6))) { d = a; mo = b; }
    else if (a > 12) { d = a; mo = b; } else if (b > 12) { d = b; mo = a; } else if (ctx.dateOrder === 'dmy') { d = a; mo = b; } else { d = b; mo = a; }
    const v = ymdOf(y, mo, d); return v ? { ymd: v } : null;
  }
  if ((m = /^(?:[^\d]*\s)?(\d{1,2})\.(\d{1,2})\.?(?:\s|$)/.exec(s)) && +m[2] <= 12) { const v = ymdOf(year, +m[2], +m[1]); return v ? { ymd: v } : null; } // "05.10."
  // with a month name: "5 Oct 2026", "Oct 5, 2026", "5. Oktober"
  const words = s.split(/[^A-Za-zÀ-ÿ]+/).filter(Boolean);
  const mw = words.map(monthOfWord).find(Boolean);
  if (mw) {
    const nums = (s.match(/\d+/g) || []).map(Number);
    const day = nums.find((n) => n >= 1 && n <= 31);
    const y = nums.find((n) => n >= 1000) || year;
    if (day) { const v = ymdOf(y, mw, day); return v ? { ymd: v } : null; }
    return null;
  }
  // "Mon 5", "Mo 05", "5"
  if ((m = /^(?:([A-Za-zÀ-ÿ.]+),?\s*)?(\d{1,2})\.?$/.exec(s)) && (!m[1] || WEEKDAY_WORDS.test(norm(m[1])))) {
    const d = +m[2];
    return d >= 1 && d <= 31 ? { day: d } : null;
  }
  return null;
}

// ---------------------------------------------------------------- times and shift cells
const T = '(\\d{1,2})(?:\\s*(?::|\\.|h|u)\\s*|(?=\\d{2}\\b))?(\\d{2})?';
const DASH = '(?:-|to|bis|till|tot|until|a|al|até|ate|–)';
const RANGE = new RegExp(`${T}\\s*(am|pm)?\\s*${DASH}\\s*${T}\\s*(am|pm)?`, 'i');
const SINGLE = new RegExp(`^\\D*${T}\\s*(am|pm)?\\s*(?:uhr|h|hrs|hs)?\\D*$`, 'i');
const OFF = /^(off|free|frei|urlaub|vacation|holiday|leave|krank|sick|pto|libre|vacaciones|folga|ferias|vrij|ledig|semester|dayoff|day off|day-off|x|-|n a|na|k)$/;

function toMinutes(h, m, ap) {
  let hh = +h; const mm = m == null || m === '' ? 0 : +m;
  if (ap) { const a = ap.toLowerCase(); if (a === 'pm' && hh < 12) hh += 12; if (a === 'am' && hh === 12) hh = 0; }
  if (hh > 24 || mm > 59) return null;
  return hh * 60 + mm;
}

// One cell of the grid -> { start, end, startOnly, raw } | { off } | { unknown, raw } | null (empty)
export function parseShiftCell(cell) {
  if (!cell) return null;
  if (cell.t === 'num' && cell.n >= 0 && cell.n < 1) { const m = Math.round(cell.n * 1440) % 1440; return { start: m, end: null, startOnly: true, raw: fmtMin(m) }; }
  if (cell.t === 'time' || (cell.t === 'dt' && cell.min != null)) return { start: cell.min, end: null, startOnly: true, raw: fmtMin(cell.min) };
  const raw = String(cell.s).trim();
  if (!raw) return null;
  const flat = raw.replace(/[–—−‒]/g, '-').replace(/\s+/g, ' ');
  if (OFF.test(norm(flat)) || (flat.length <= 2 && /^[-–x]$/i.test(flat))) return { off: true, raw };
  const first = flat.split(/\n/)[0];
  const r = RANGE.exec(first.replace(/\s*-\s*/g, ' - '));
  if (r) {
    const a = toMinutes(r[1], r[2], r[3]), b = toMinutes(r[4], r[5], r[6]);
    if (a != null && b != null) return { start: a, end: b, startOnly: false, raw };
  }
  const one = SINGLE.exec(first);
  if (one && !/[-]/.test(first)) { const a = toMinutes(one[1], one[2], one[3]); if (a != null) return { start: a, end: null, startOnly: true, raw }; }
  return { unknown: true, raw };
}

// a time-of-day typed into a cell as text or number
function timeOfCell(cell) {
  if (!cell) return null;
  if (cell.t === 'num' && cell.n >= 0 && cell.n < 1) return Math.round(cell.n * 1440) % 1440;
  if (cell.t === 'time' || cell.t === 'dt') return cell.min;
  const r = parseShiftCell({ t: 'text', s: cell.s });
  return r && r.startOnly ? r.start : null;
}
const serialYmd = (n) => { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
function dateOfCell(cell, ctx) {
  if (!cell) return null;
  if (cell.t === 'num' && cell.n > 20000 && cell.n < 80000) return serialYmd(cell.n);
  if (cell.t === 'date' || cell.t === 'dt') return cell.ymd;
  const d = parseDateText(cell.s, ctx);
  return d && d.ymd ? d.ymd : null;
}

// ---------------------------------------------------------------- finding the structure
const HEAD = {
  name: /^(member|mitglied|full name|vollstandiger name|name|mitarbeiter|mitarbeiterin|employee|worker|person|nombre|nome|naam|namn|miembro|membro|lid|medlem)$/,
  email: /e ?mail/,
};
function headerKind(text) {
  const h = norm(text);
  if (!h) return null;
  if (HEAD.name.test(h)) return 'name';
  if (HEAD.email.test(h)) return 'email';
  const start = /\b(start|startdatum|startzeit|beginn|begin|begindatum|begintijd|inicio|inicio|starttid|von|from)\b/.test(h);
  const end = /\b(end|ende|enddatum|endzeit|fin|fim|einde|eind|slut|bis|to|hasta|ate|until)\b/.test(h);
  const isDate = /(date|datum|fecha|data|dag)/.test(h);
  const isTime = /(time|zeit|hora|ora|tijd|tid|uhr)/.test(h);
  if (start && !end) return isTime && !isDate ? 'startTime' : isDate && !isTime ? 'startDate' : 'start';
  if (end && !start) return isTime && !isDate ? 'endTime' : isDate && !isTime ? 'endDate' : 'end';
  return null;
}

const SKIP_NAME = /^(total|totals|summe|gesamt|sum|subtotal|gesamtstunden|hours|stunden)\b/;
const OPEN_NAME = /^(open shifts?|offene schichten?|open|unassigned|nicht zugewiesen|vacante|aberto|open dienst)/;

function findListHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const map = {};
    (rows[r] || []).forEach((c, i) => { if (c && c.t === 'text') { const k = headerKind(c.s); if (k && map[k] === undefined) map[k] = i; } });
    const hasStart = map.startDate !== undefined || map.start !== undefined;
    if (map.name !== undefined && hasStart && (map.endDate !== undefined || map.endTime !== undefined || map.end !== undefined || map.startTime !== undefined)) return { row: r, map };
  }
  return null;
}

function guessMonth(rows) {
  // a title like "October 2026" / "Oktober 2026" / "10/2026" in the first rows
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    for (const c of rows[r] || []) {
      if (!c || c.t === 'num') continue;
      if (c.t === 'date' || c.t === 'dt') { return c.ymd.slice(0, 7); }
      const s = String(c.s);
      const words = s.split(/[^A-Za-zÀ-ÿ]+/).filter(Boolean);
      const mo = words.map(monthOfWord).find(Boolean);
      const y = (/\b(20\d{2})\b/.exec(s) || [])[1];
      if (mo && y) return `${y}-${pad(mo)}`;
      const m2 = /\b(\d{1,2})[/.](20\d{2})\b/.exec(s);
      if (m2 && +m2[1] <= 12) return `${m2[2]}-${pad(+m2[1])}`;
    }
  }
  return null;
}

function headerCell(cell, ctx) {
  if (!cell) return null;
  if (cell.t === 'date' || cell.t === 'dt') return { ymd: cell.ymd };
  if (cell.t === 'num') { const n = cell.n; return Number.isInteger(n) && n >= 1 && n <= 31 ? { day: n } : null; }
  if (cell.t === 'text') return parseDateText(cell.s, ctx);
  return null;
}

function findGridHeader(rows, ctx) {
  let best = null;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const cells = rows[r] || [];
    const found = cells.map((c, i) => ({ i, d: headerCell(c, ctx) })).filter((x) => x.d);
    const filled = cells.filter(Boolean).length;
    if (found.length >= 3 && found.length >= filled * 0.6 && (!best || found.length > best.found.length)) best = { row: r, found };
  }
  return best;
}

// ---------------------------------------------------------------- the parser
// -> { layout: 'list'|'grid', rows: [...], needsMonth, month, ignored: { off, open }, warnings: [] }  |  null when nothing recognisable is found
export function parseSheet(sheet, opts = {}) {
  const ctx = { dateOrder: opts.dateOrder || 'mdy', year: opts.month ? +opts.month.slice(0, 4) : undefined };
  const rows = sheet.rows;
  let id = 0;
  const out = { sheet: sheet.name, rows: [], needsMonth: false, month: opts.month || null, ignored: { off: 0, open: 0 }, layout: null };
  const ref = (r, c) => `${sheet.name}!${String.fromCharCode(65 + (c % 26))}${r + 1}`;

  // ---- LIST layout
  const lh = findListHeader(rows);
  if (lh) {
    out.layout = 'list';
    const m = lh.map;
    for (let r = lh.row + 1; r < rows.length; r++) {
      const line = rows[r] || [];
      const nameCell = line[m.name];
      const name = nameCell ? String(nameCell.s).trim() : '';
      if (!name || SKIP_NAME.test(norm(name))) continue;
      if (OPEN_NAME.test(norm(name))) { out.ignored.open += 1; continue; }
      const sd = line[m.startDate !== undefined ? m.startDate : m.start];
      let day = dateOfCell(sd, ctx);
      let start = timeOfCell(m.startTime !== undefined ? line[m.startTime] : (sd && (sd.t === 'dt') ? sd : null));
      if (start == null && sd && sd.t === 'text' && m.startTime === undefined) { const p = parseShiftCell(sd); if (p && p.startOnly) start = p.start; }
      const endCell = line[m.endTime !== undefined ? m.endTime : m.end !== undefined ? m.end : m.endDate];
      let end = timeOfCell(endCell);
      const cellText = (c) => (c ? String(c.s) : '');
      const raw = start != null && end != null ? `${fmtMin(start)}–${fmtMin(end)}`
        : [cellText(sd), cellText(m.startTime !== undefined ? line[m.startTime] : null), cellText(endCell)].filter(Boolean).join(' – ');
      if (!sd && !line.some(Boolean)) continue;
      const row = { id: id++, name, ref: ref(r, m.name), day, start, end, startOnly: false, raw, problem: null };
      if (!day) row.problem = 'date';
      else if (start == null || end == null) row.problem = 'shift';
      out.rows.push(row);
    }
    if (out.rows.length) return out;
  }

  // ---- GRID layout
  const gh = findGridHeader(rows, ctx);
  if (gh) {
    out.layout = 'grid';
    const header = rows[gh.row];
    const firstDateCol = Math.min(...gh.found.map((x) => x.i));
    let nameCol = header.findIndex((c) => c && c.t === 'text' && HEAD.name.test(norm(c.s)));
    if (nameCol < 0) {
      let bestCount = 0;
      for (let c = 0; c < firstDateCol; c++) {
        const n = rows.slice(gh.row + 1).filter((l) => l && l[c] && l[c].t === 'text').length;
        if (n > bestCount) { bestCount = n; nameCol = c; }
      }
    }
    if (nameCol < 0) return null;

    // dates of the columns (bare day numbers need the month; the month rolls over when the numbers start again at 1)
    const month = opts.month || guessMonth(rows.slice(0, gh.row + 1));
    out.month = month;
    const dayOnly = gh.found.some((x) => !x.d.ymd);
    out.needsMonth = dayOnly; // the screen then shows the month picker
    if (dayOnly && !month) return out;
    const cols = [];
    let cur = month ? { y: +month.slice(0, 4), m: +month.slice(5, 7) } : null, prevDay = 0;
    gh.found.forEach(({ i, d }) => {
      if (d.ymd) { cols.push({ i, day: d.ymd }); prevDay = +d.ymd.slice(8); return; }
      if (d.day < prevDay) cur = cur.m === 12 ? { y: cur.y + 1, m: 1 } : { y: cur.y, m: cur.m + 1 };
      prevDay = d.day;
      cols.push({ i, day: ymdOf(cur.y, cur.m, d.day) });
    });

    for (let r = gh.row + 1; r < rows.length; r++) {
      const line = rows[r] || [];
      const nameCell = line[nameCol];
      const name = nameCell && nameCell.t !== 'bool' ? String(nameCell.s).trim() : '';
      if (!name || SKIP_NAME.test(norm(name))) continue;
      const isOpen = OPEN_NAME.test(norm(name));
      cols.forEach((c) => {
        const p = parseShiftCell(line[c.i]);
        if (!p) return;
        if (isOpen) { out.ignored.open += 1; return; }
        if (p.off) { out.ignored.off += 1; return; }
        const row = { id: id++, name, ref: ref(r, c.i), day: c.day, start: p.start == null ? null : p.start, end: p.end == null ? null : p.end, startOnly: !!p.startOnly, raw: p.raw, problem: null };
        if (!c.day) row.problem = 'date'; else if (p.unknown) row.problem = 'shift';
        out.rows.push(row);
      });
    }
    return out;
  }
  return null;
}

// Pick the sheet to read (a sheet called Shifts/Schichten first) -> { parsed, candidates }
export function parseWorkbook(book, opts = {}) {
  const score = (s) => (/shift|schicht|schedule|plan|dienst|turno|rooster|pass/i.test(s.name) ? 0 : /time ?off|urlaub|abwesen/i.test(s.name) ? 2 : 1);
  const order = book.sheets.filter((x) => score(x) < 2).sort((a, b) => score(a) - score(b)); // (time-off sheets are not shifts)
  const candidates = [];
  let parsed = null;
  for (const sh of order) {
    const p = parseSheet(sh, opts);
    if (p && (p.rows.length || p.needsMonth)) { candidates.push(sh.name); if (!parsed || (opts.sheet && opts.sheet === sh.name)) parsed = p; }
  }
  if (opts.sheet) { const forced = order.find((s) => s.name === opts.sheet); const p = forced && parseSheet(forced, opts); if (p) parsed = p; }
  return { parsed, candidates };
}

// ---------------------------------------------------------------- checking the rows against Bountiful
// ctx: { people: [{id, display_name, crew}], shifts: [shift rows from state], contractOf(id), planOf(id, day), nameMap, rowShift }
// -> rows with .person, .shift, .status ('ok' | 'same' | 'review' | 'skip'), .issues [codes], .note
export function matchShift(row, shifts) {
  if (row.start == null) return null;
  const same = shifts.filter((s) => toMin(s.start_time) === row.start && (row.startOnly || toMin(s.end_time) === row.end));
  if (!same.length) return null;
  const wd = row.day ? weekdayOf(row.day) : null;
  return same.find((s) => !wd || s.weekdays.includes(wd)) || same[0];
}

export function autoMatchName(raw, people) {
  const key = nameKey(raw);
  if (!key) return null;
  const exact = people.filter((p) => nameKey(p.display_name) === key);
  if (exact.length === 1) return { person: exact[0], how: 'exact' };
  const tokens = key.split(' ');
  const sameTokens = people.filter((p) => { const t = nameKey(p.display_name).split(' '); return t.length === tokens.length && tokens.every((x) => t.includes(x)); });
  if (sameTokens.length === 1) return { person: sameTokens[0], how: 'exact' };
  // "Jonas" or "Jonas W." for "Jonas Weber", when only one person fits
  const part = people.filter((p) => {
    const t = nameKey(p.display_name).split(' ');
    return tokens.every((x) => t.some((y) => y === x || (x.length === 1 && y.startsWith(x)) || (x.length >= 3 && y.startsWith(x) && tokens.length === 1)));
  });
  if (part.length === 1) return { person: part[0], how: 'partial' };
  return null;
}

export function resolveRows(rows, ctx) {
  const seen = new Map();
  return rows.map((r) => {
    const row = { ...r, person: null, shift: null, issues: [], note: '', status: 'ok' };
    if (ctx.rowShift[r.id] === 'skip') { row.status = 'skip'; return row; }
    const key = nameKey(r.name);
    const mapped = ctx.nameMap[key];
    if (mapped === 'skip') { row.status = 'skip'; return row; }
    if (mapped) row.person = ctx.people.find((p) => p.id === mapped) || null;
    else { const m = autoMatchName(r.name, ctx.people); if (m) { row.person = m.person; if (m.how === 'partial') row.note = 'partial'; } }
    if (!row.person) row.issues.push('name');
    else if (!row.person.crew) row.issues.push('notCrew');

    if (r.problem === 'date') row.issues.push('date');
    else {
      const picked = ctx.rowShift[r.id];
      if (picked === 'skip') { row.status = 'skip'; return row; }
      row.shift = picked ? ctx.shifts.find((s) => s.id === picked) || null : r.problem === 'shift' ? null : matchShift(r, ctx.shifts);
      if (!row.shift) row.issues.push('shift');
      else if (!row.shift.weekdays.includes(weekdayOf(r.day))) row.issues.push('weekday');
      if (row.shift && row.person && row.person.crew) {
        const c = ctx.contractOf(row.person.id);
        if ((c === 240) !== (row.shift.kind === 'part')) row.issues.push(c === 240 ? 'contract4' : 'contract8');
      }
    }
    if (!row.issues.length && row.person) {
      const k = row.person.id + '|' + r.day;
      if (seen.has(k)) row.issues.push('duplicate'); else seen.set(k, r.id);
      const cur = ctx.planOf(row.person.id, r.day);
      if (cur && cur.shift_id === row.shift.id) row.status = 'same';
      else if (cur) row.note = 'replaces:' + cur.shift_id;
    }
    if (row.issues.length) row.status = 'review';
    return row;
  });
}
