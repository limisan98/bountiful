import { html, useState, useEffect, useRef } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Avatar, Segmented } from '../ui.js';
import { isSupervisor } from '../roles.js';
import { WEEKLY } from '../weeklydata.js';
import { WEEKLY_TEXT } from '../weeklytext.js';
import { todayYmd, parseYmd, startOfWeek, addDays, ymd, isoWeekday, fmt } from '../time.js';
import { ensureWeekly, weeklyOf, setWeeklyItem, assignmentsOn, ensureMonth, itemName, finishAssignment, reopenAssignment } from '../data.js';
import { goalOf } from '../shifts.js';

// The Monday-to-Saturday cleaning checklist, shared by the whole custodian team (supervisor included).
// Tap an item: "I'm doing it" (yellow, with my picture) -> tap again: done (green, with my name) -> tap again: clear.
// Somebody else's item can only be changed by them or by the supervisor.
// Text of a checklist line / section title in the current language (English if there is no translation)
const FLAT = {}; // "day.section.index" -> position in the translated list
{ let n = 0; WEEKLY.forEach((d) => d.sections.forEach((sec, si) => sec.items.forEach((_, ii) => { FLAT[`${d.day}.${si}.${ii}`] = n++; }))); }
const TITLES = ['Temple', 'Rooms', 'On Monday everything in the rooms must be cleaned', 'Morning', 'Afternoon', 'Rooms left from Monday'];
const itemText = (id, en, lang) => { const tr = WEEKLY_TEXT[lang]; return (tr && tr.items[FLAT[id]]) || en; };
const titleText = (en, lang) => { const tr = WEEKLY_TEXT[lang]; const i = TITLES.indexOf(en); return (tr && i >= 0 && tr.titles[i]) || en; };

// every checkable text line of the weekly list (not the room tiles): { id, day, section, text } in the given language
export function checklistLines(lang) {
  const out = [];
  WEEKLY.forEach((d) => d.sections.forEach((sec, si) => { if (sec.info || sec.carry) return; sec.items.forEach((txt, ii) => { const id = `${d.day}.${si}.${ii}`; out.push({ id, day: d.day, section: sec.title ? titleText(sec.title, lang) : '', text: itemText(id, txt, lang) }); }); }));
  return out;
}

export const weekStart = () => ymd(startOfWeek(parseYmd(todayYmd())));
export const todayWeekday = () => { const w = isoWeekday(new Date()); return w === 7 ? 0 : w; }; // 0 = Sunday: nothing planned

// which sections are folded open on this device (everything starts closed: not everybody does the temple)
const OPEN_KEY = 'bountiful.weekly.open';
const loadOpen = () => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'); } catch { return {}; } };

export function WeeklyList({ day, compact }) {
  const s = useStore();
  const me = s.profile;
  const sup = isSupervisor(me);
  const wk = weekStart();
  const lang = s.lang;
  const [open, setOpen] = useState(loadOpen);
  const dayYmd = ymd(addDays(parseYmd(wk), day - 1));
  useEffect(() => { ensureWeekly(wk).catch(() => {}); ensureMonth(wk.slice(0, 7)).catch(() => {}); ensureMonth(dayYmd.slice(0, 7)).catch(() => {}); }, [wk]);
  const toggleOpen = (k) => setOpen((o) => { const n = { ...o, [k]: !o[k] }; try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)); } catch { /* private mode */ } return n; });

  const d = WEEKLY.find((x) => x.day === day);
  if (!d) return null;
  const id = (si, ii) => `${day}.${si}.${ii}`;
  const rooms = [...s.guestRooms].sort((a, b) => a.house - b.house || a.floor - b.floor || a.num - b.num);
  // Rooms that were not finished on Monday (not ticked done in the list, and no finished room task) carry over to Tuesday's list. Only from Tuesday on.
  const monYmd = wk;
  const monRooms = assignmentsOn(monYmd).filter((a) => a.kind === 'room');
  const monDone = (label) => { const w = weeklyOf(wk, `1.r.${label}`); return (!!w && w.status === 'done') || monRooms.some((a) => a.title === label && a.status === 'done'); };
  const carryOn = isoWeekday(new Date()) >= 2;
  const carried = carryOn ? rooms.filter((r) => !monDone(r.label)) : [];
  const roomsOf = (sec) => (sec.rooms ? rooms : sec.carry ? carried : null);
  // every checkable thing of a section: its lines (unless they are only instructions) and, for "Rooms", one tile per guest room
  const idsOf = (sec, si) => [...(sec.info ? [] : sec.items.map((_, ii) => id(si, ii))), ...((roomsOf(sec) || []).map((r) => `${day}.r.${r.label}`))];
  const isDone = (i) => { const r = weeklyOf(wk, i); return !!r && r.status === 'done'; };
  const all = d.sections.flatMap((sec, si) => idsOf(sec, si));
  const done = all.filter(isDone).length;
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;

  async function tap(i) {
    const r = weeklyOf(wk, i);
    if (r && r.user_id !== me.id && !sup) {
      const p = s.profiles[r.user_id];
      toast(t('weekly.taken', { name: p ? p.display_name.split(' ')[0] : '' }), 'bad');
      return;
    }
    const next = !r ? 'doing' : r.status === 'doing' ? 'done' : null;
    try { await setWeeklyItem(wk, i, next); } catch (ex) { toast(friendlyError(ex), 'bad'); return; }
    // Custodians no longer see rooms as separate tasks, they tick them here. So finishing a room tile also finishes its room task
    // (that is what Reception watches: the tile turns green there). Only if the task is theirs (or they are the supervisor); otherwise the tick alone stays.
    const code = (/^\d\.r\.(\d+)$/.exec(i) || [])[1];
    if (code && (next === 'done' || (r && r.status === 'done' && !next))) {
      const days = [dayYmd, ...(day === 2 ? [wk] : [])];
      const a = days.flatMap((dy) => assignmentsOn(dy)).find((x) => x.kind === 'room' && x.title === code && (next === 'done' ? x.status !== 'done' : x.status === 'done'));
      if (a && (sup || a.assignee === me.id)) {
        try {
          if (next === 'done') { const m = a.started_at ? Math.min(Math.max(1, Math.round((Date.now() - Date.parse(a.started_at)) / 60000)), 1440) : goalOf(a); await finishAssignment(a.id, m, '', ''); }
          else await reopenAssignment(a.id);
        } catch (_) { /* the tick is saved; the task keeps its own state */ }
      }
    }
  }
  // the rooms on the list the supervisor uploaded (or Reception sent) for this day and not finished yet = priority, shown in red; the whole list stays
  const urgent = {};
  const markUrgent = (ymdDay) => assignmentsOn(ymdDay).forEach((a) => { if (a.kind === 'room' && a.status !== 'done') urgent[a.title] = (s.tasks[a.task_id] && s.tasks[a.task_id].room_flow) || true; });
  markUrgent(dayYmd);
  if (day === 2) markUrgent(monYmd); // a priority room nobody finished on Monday stays a priority on Tuesday
  const nUrgentOf = (list) => list.filter((r) => urgent[r.label]).length;
  const first = (p) => (p ? p.display_name.split(' ')[0] : '');

  const row = (i, txt) => {
    const r = weeklyOf(wk, i);
    const p = r ? s.profiles[r.user_id] : null;
    const st = r ? r.status : '';
    return html`<button type="button" key=${i} class=${'check-row weekly-row ' + st + (st === 'done' ? ' on' : '')} aria-pressed=${st === 'done'} onClick=${() => tap(i)}>
      <span class="check-box">${st === 'doing' ? html`<${Icon} name="hourglass" size=${16} />` : html`<${Icon} name="check" size=${18} />`}</span>
      <span class="check-text"><b>${txt}</b>
        ${r ? html`<span class="weekly-who"><${Avatar} profile=${p} name=${p ? p.display_name : ''} size=${22} ring=${false} />${first(p)} · ${r.status === 'done' ? t('status.done') : t('weekly.doing')}</span>` : null}
      </span>
    </button>`;
  };
  // a guest room as a small tile (there are many): yellow = somebody is on it, green = done, with that person's picture
  const tile = (r) => {
    const i = `${day}.r.${r.label}`, w = weeklyOf(wk, i), p = w ? s.profiles[w.user_id] : null;
    const u = !w && urgent[r.label], uTxt = u ? (typeof u === 'string' ? t('flow.' + u) + ' · ' : '') + t('weekly.urgentOne') : '';
    return html`<button type="button" key=${i} class=${'wk-room ' + (w ? w.status : u ? 'urgent' : '')} aria-pressed=${!!w && w.status === 'done'} title=${w ? first(p) + ' · ' + (w.status === 'done' ? t('status.done') : t('weekly.doing')) : uTxt}
      aria-label=${r.label + (w ? ', ' + first(p) + ', ' + (w.status === 'done' ? t('status.done') : t('weekly.doing')) : uTxt ? ', ' + uTxt : '')} onClick=${() => tap(i)}>
      <b>${r.label}</b>${w ? html`<${Avatar} profile=${p} name=${p ? p.display_name : ''} size=${20} ring=${false} />` : null}
    </button>`;
  };

  return html`<div class=${'weekly-list' + (compact ? ' compact' : '')}>
    <div class="weekly-prog"><div class="weekly-bar" role="progressbar" aria-valuenow=${pct} aria-valuemin="0" aria-valuemax="100"><span style=${`width:${pct}%`}></span></div>
      <b>${t('weekly.progress', { done, total: all.length })}</b></div>
    ${d.sections.map((sec, si) => {
      if (sec.carry && !carryOn) return null;
      const ids = idsOf(sec, si), nDone = ids.filter(isDone).length, k = `${day}.${si}`;
      const folded = !!sec.title && !open[k];
      return html`<section class=${'weekly-sec' + (sec.title ? ' foldable' : '')} key=${k}>
        ${sec.title ? html`<button type="button" class="weekly-fold" aria-expanded=${!folded} onClick=${() => toggleOpen(k)}>
          <b>${titleText(sec.title, lang)}</b>${ids.length ? html`<span class=${'weekly-count' + (nDone === ids.length ? ' all' : '')}>${nDone}/${ids.length}</span>` : null}
          <${Icon} name=${folded ? 'caret-down' : 'caret-up'} size=${20} />
        </button>` : null}
        ${folded ? null : html`
          ${sec.note ? html`<p class="field-hint">${titleText(sec.note, lang)}</p>` : null}
          ${sec.info ? html`<ul class="weekly-info">${sec.items.map((txt, ii) => html`<li key=${ii}>${itemText(id(si, ii), txt, lang)}</li>`)}</ul>`
            : html`<div class="checklist">${sec.items.map((txt, ii) => row(id(si, ii), itemText(id(si, ii), txt, lang)))}</div>`}
          ${sec.carry ? html`<p class="field-hint">${carried.length ? t('weekly.carryHint') : t('weekly.carryNone')}</p>` : null}
          ${roomsOf(sec) && nUrgentOf(roomsOf(sec)) ? html`<p class="wk-urgent-note"><i></i>${t('weekly.urgent', { n: nUrgentOf(roomsOf(sec)) })}</p>` : null}
          ${roomsOf(sec) ? [1, 2, 3, 4].map((h) => {
            const hr = roomsOf(sec).filter((r) => r.house === h);
            if (!hr.length) return null;
            const hd = hr.filter((r) => isDone(`${day}.r.${r.label}`)).length;
            return html`<div class="wk-house" key=${h}>
              <h5>${t('house.n', { n: h })}<span class=${'weekly-count' + (hd === hr.length ? ' all' : '')}>${hd}/${hr.length}</span></h5>
              <div class="wk-rooms">${hr.map(tile)}</div>
            </div>`;
          }) : null}`}
      </section>`;
    })}
  </div>`;
}

// The full screen: day tabs + the list
export function WeeklyView() {
  const monday = parseYmd(weekStart());
  const wd = todayWeekday();
  const [day, setDay] = useState(wd || 1);
  const dayName = (n, style) => fmt(addDays(monday, n - 1), { weekday: style });
  return html`<div class="stack weekly-page">
    <div class="page-head"><div><h2 class="page-title">${t('nav.weekly')}</h2><p class="page-sub">${t('weekly.sub')}</p></div></div>
    <${Segmented} label=${t('nav.weekly')} value=${day} onChange=${setDay}
      options=${WEEKLY.map((x) => ({ value: x.day, label: dayName(x.day, 'short') }))} />
    <div class="cal-head"><div class="rooms-day" key=${day}>
      <h3 class="cal-title">${dayName(day, 'long')}${day === wd ? html` <span class="log-now">${t('chat.today')}</span>` : null}</h3>
    </div></div>
    <${WeeklyList} day=${day} />
  </div>`;
}

// Card for the home screens: today's list, folded open
export function WeeklyToday() {
  const wd = todayWeekday();
  if (!wd) return null;
  const [open, setOpen] = useState(true);
  return html`<section class="rise weekly-card" aria-label=${t('nav.weekly')}>
    <button type="button" class="weekly-card-head" aria-expanded=${open} onClick=${() => setOpen(!open)}>
      <span class="weekly-card-ic"><${Icon} name="clipboard-check" size=${24} /></span>
      <span><b>${t('weekly.today')}</b><small>${fmt(new Date(), { weekday: 'long' })}</small></span>
      <${Icon} name=${open ? 'caret-up' : 'caret-down'} size=${20} />
    </button>
    ${open ? html`<${WeeklyList} day=${wd} compact=${true} />` : null}
    <a class="section-link weekly-all" href="#/weekly">${t('weekly.week')}</a>
  </section>`;
}

// What is designated for a day, as a flat list with a state each - used by the supervisor's progress ring and its detail:
// the weekday's checklist lines, every guest room (Monday) or the rooms left over from Monday (Tuesday on), and the other tasks given for that day.
// -> [{ kind: 'line' | 'room' | 'task', label, state: 'done' | 'doing' | 'waiting' (given out by nobody yet) | 'todo', who: profile id or '' }]
export function dayProgressItems(s, dayYmd) {
  const wk = ymd(startOfWeek(parseYmd(dayYmd))), wd = isoWeekday(parseYmd(dayYmd)), d = WEEKLY.find((x) => x.day === wd);
  const lang = s.lang;
  const asg = assignmentsOn(dayYmd).filter((a) => s.tasks[a.task_id]);
  const stateOfAsg = (a) => (a.status === 'done' ? 'done' : !a.assignee ? 'waiting' : a.status === 'doing' ? 'doing' : 'todo');
  const roomAsg = {}; asg.filter((a) => a.kind === 'room').forEach((a) => { if (!roomAsg[a.title] || roomAsg[a.title].status === 'done') roomAsg[a.title] = a; });
  const roomState = (label, tick) => {
    const tk = tick ? tick.status : null, a = roomAsg[label];
    if (tk === 'done' || (a && a.status === 'done')) return 'done';
    if (tk === 'doing' || (a && a.status === 'doing')) return 'doing';
    if (a && !a.assignee) return 'waiting';
    return 'todo';
  };
  const out = [];
  if (d) {
    const rooms = [...s.guestRooms].sort((x, y) => x.house - y.house || x.floor - y.floor || x.num - y.num);
    const monDone = (label) => { const w = weeklyOf(wk, `1.r.${label}`); return (!!w && w.status === 'done') || assignmentsOn(wk).some((a) => a.kind === 'room' && a.title === label && a.status === 'done'); };
    d.sections.forEach((sec, si) => {
      if (!sec.info && !sec.carry) sec.items.forEach((txt, ii) => {
        const id = `${wd}.${si}.${ii}`, k = weeklyOf(wk, id);
        out.push({ kind: 'line', label: itemText(id, txt, lang), state: k && k.status === 'done' ? 'done' : k && k.status === 'doing' ? 'doing' : 'todo', who: k ? k.user_id : '' });
      });
      const list = sec.rooms ? rooms : sec.carry && isoWeekday(new Date()) >= 2 ? rooms.filter((r) => !monDone(r.label)) : [];
      list.forEach((r) => { const k = weeklyOf(wk, `${wd}.r.${r.label}`), a = roomAsg[r.label]; out.push({ kind: 'room', label: r.label, state: roomState(r.label, k), who: k ? k.user_id : (a && a.assignee) || '' }); });
    });
  }
  const known = new Set(s.guestRooms.map((r) => r.label));
  Object.values(roomAsg).filter((a) => !known.has(a.title)).forEach((a) => out.push({ kind: 'room', label: a.title, state: stateOfAsg(a), who: a.assignee || '' })); // requested rooms that are not in the room list
  asg.filter((a) => a.kind !== 'room').forEach((a) => out.push({ kind: 'task', label: itemName(a), state: stateOfAsg(a), who: a.assignee || '' }));
  return out;
}
