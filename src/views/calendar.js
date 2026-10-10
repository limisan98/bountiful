import { html, useState, useEffect } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Avatar, Segmented, Sheet, Empty } from '../ui.js';
import { isSupervisor } from '../roles.js';
import { colorStyle } from '../color.js';
import { STATUS_ICON_COLOR, badgeStatus } from '../ui.js';
import { ensureMonth, itemName, areaOf, areaName } from '../data.js';
import { ymd, parseYmd, addDays, addMonths, monthKey, monthGrid, startOfWeek, weekdayNames, fmt, todayYmd, toMin, hhmm, dur, taskGoal, hasTime, timeKey, pad } from '../time.js';
import { AssignmentRow, AssignmentSheet, AssignSheet } from './assign.js';

// Group everything by day once, so the grids stay quick
function byDay(assignments, onlyMe) {
  const map = {};
  for (const a of Object.values(assignments)) {
    if (onlyMe && a.assignee !== onlyMe) continue;
    (map[a.day] = map[a.day] || []).push(a);
  }
  for (const k in map) map[k].sort((x, y) => timeKey(x) - timeKey(y));
  return map;
}

export function CalendarView() {
  const s = useStore();
  const me = s.profile;
  const sup = isSupervisor(me);
  const [mode, setMode] = useState('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [who, setWho] = useState(sup ? 'all' : 'mine');
  const [dir, setDir] = useState(0);
  const [openDay, setOpenDay] = useState(null);
  const [openA, setOpenA] = useState(null);
  const [assigning, setAssigning] = useState(null);

  const days = byDay(s.assignments, who === 'mine' ? me.id : null);
  const today = todayYmd();
  const grid = monthGrid(cursor);
  const wStart = startOfWeek(cursor);
  const week = Array.from({ length: 7 }, (_, i) => addDays(wStart, i));
  const span = mode === 'month' ? [grid[0], grid[41]] : [week[0], week[6]];

  useEffect(() => {
    const keys = new Set([monthKey(span[0]), monthKey(span[1]), monthKey(cursor)]);
    keys.forEach((k) => ensureMonth(k).catch((e) => toast(friendlyError(e), 'bad')));
  }, [mode, ymd(cursor)]);

  const go = (n) => {
    setDir(n);
    setCursor(mode === 'month' ? addMonths(cursor, n) : addDays(cursor, 7 * n));
  };
  const toToday = () => { setDir(0); setCursor(new Date()); };
  const names = weekdayNames('short');
  const title = mode === 'month'
    ? fmt(cursor, { month: 'long', year: 'numeric' })
    : `${fmt(week[0], { day: 'numeric', month: 'short' })} – ${fmt(week[6], { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const rows = mode === 'month' ? (grid[35].getMonth() === cursor.getMonth() ? 6 : 5) : 0;

  return html`<div class="stack">
    <div class="cal-head">
      <h2 class="page-title cal-title" key=${title}>${title}</h2>
      <div class="cal-nav">
        <button class="icon-btn" aria-label="previous" onClick=${() => go(-1)}><${Icon} name="caret-left" size=${20} /></button>
        <button class="icon-btn" aria-label="next" onClick=${() => go(1)}><${Icon} name="caret-right" size=${20} /></button>
      </div>
    </div>

    <div class="cal-tools">
      <${Segmented} value=${mode} onChange=${setMode} options=${[
        { value: 'month', label: t('cal.month'), icon: 'calendar-month' }, { value: 'week', label: t('cal.week'), icon: 'calendar-week' }]} />
      <div class="chips">
        <button class=${'pick' + (who === 'all' ? ' on' : '')} onClick=${() => setWho('all')}><${Icon} name="user" size=${16} />${t('cal.everyone')}</button>
        <button class=${'pick' + (who === 'mine' ? ' on' : '')} onClick=${() => setWho('mine')}><${Icon} name="star" size=${16} />${t('cal.mine')}</button>
        <button class="pick ghost" onClick=${toToday}><${Icon} name="calendar-event" size=${16} />${t('cal.today')}</button>
      </div>
    </div>

    ${mode === 'month' ? html`<div class=${'month ' + (dir > 0 ? 'from-right' : dir < 0 ? 'from-left' : 'from-fade')} key=${monthKey(cursor)}>
      <div class="wd-row">${names.map((n) => html`<span key=${n}>${n}</span>`)}</div>
      <div class="days-grid">
        ${grid.slice(0, rows * 7).map((d) => {
          const k = ymd(d);
          const list = days[k] || [];
          // colours follow the status of the tasks (waiting = coral, not started = lavender, in progress = yellow, done = lime)
          const colors = [];
          list.forEach((a) => { if (!s.tasks[a.task_id]) return; const c = STATUS_ICON_COLOR[badgeStatus(a)]; if (!colors.includes(c)) colors.push(c); });
          const counts = {}, sts = {};
          list.forEach((a) => { counts[a.task_id] = (counts[a.task_id] || 0) + 1; (sts[a.task_id] = sts[a.task_id] || []).push(badgeStatus(a)); });
          const worst = (arr) => ['waiting', 'todo', 'doing', 'done'].find((x) => arr.includes(x));
          const groups = Object.entries(counts).map(([id, n]) => [s.tasks[id], n, STATUS_ICON_COLOR[worst(sts[id])]]).filter(([tk]) => tk);
          const out = d.getMonth() !== cursor.getMonth();
          return html`<button key=${k} class=${'day' + (out ? ' out' : '') + (k === today ? ' today' : '') + (list.length ? ' has' : '')}
            onClick=${() => setOpenDay(k)} aria-label=${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}>
            <span class="day-n">${d.getDate()}</span>
            <span class="day-chips">${groups.slice(0, 3).map(([tk, n, col]) => html`<i style=${`--c:${col}`}>${tk.name}${n > 1 ? ' ×' + n : ''}</i>`)}${groups.length > 3 ? html`<b>+${groups.length - 3}</b>` : null}</span>
            <span class="dots">${colors.slice(0, 3).map((c) => html`<i style=${`--c:${c}`}></i>`)}${colors.length > 3 ? html`<b>+</b>` : null}</span>
          </button>`;
        })}
      </div>
    </div>` : html`<div class=${'weekview ' + (dir > 0 ? 'from-right' : dir < 0 ? 'from-left' : 'from-fade')} key=${ymd(wStart)}>
      ${week.map((d, i) => {
        const k = ymd(d);
        const list = days[k] || [];
        return html`<section key=${k} class=${'wday' + (k === today ? ' today' : '')}>
          <button class="wday-head" onClick=${() => setOpenDay(k)}>
            <span class="wday-n">${d.getDate()}</span><span class="wday-name">${names[i]}</span>
            <span class="wday-count">${list.length ? list.length : ''}</span><${Icon} name="caret-right" size=${16} class="chev" />
          </button>
          ${list.length ? html`<div class="list tight">${list.map((a) => html`<${AssignmentRow} key=${a.id} a=${a} onOpen=${setOpenA} showPerson=${true} />`)}</div>`
            : html`<p class="wday-empty">${t('cal.nothing')}</p>`}
        </section>`;
      })}
    </div>`}

    ${sup ? html`<button class="fab float pop" aria-label=${t('assign.title')} onClick=${() => setAssigning(todayYmd())}><${Icon} name="plus" size=${26} /></button>` : null}

    ${openDay ? html`<${DaySheet} day=${openDay} who=${who} onClose=${() => setOpenDay(null)} onOpen=${setOpenA} onAssign=${setAssigning} />` : null}
    ${openA ? html`<${AssignmentSheet} id=${openA} onClose=${() => setOpenA(null)} />` : null}
    ${assigning ? html`<${AssignSheet} day=${assigning} onClose=${() => setAssigning(null)} />` : null}
  </div>`;
}

// ---- One day, hour by hour ----
export function DaySheet({ day: startDay, who: initialWho, onClose, onOpen, onAssign }) {
  const s = useStore();
  const me = s.profile;
  const sup = isSupervisor(me);
  const [who, setWho] = useState(initialWho || 'all');
  const [day, setDay] = useState(startDay);
  const d = parseYmd(day);
  useEffect(() => { ensureMonth(monthKey(parseYmd(day))).catch(() => {}); }, [day]);
  const counts = {};
  Object.values(s.assignments).forEach((a) => { if (s.tasks[a.task_id] && (who !== 'mine' || a.assignee === me.id)) counts[a.day] = (counts[a.day] || 0) + 1; });
  const all = Object.values(s.assignments).filter((a) => a.day === day && s.tasks[a.task_id])
    .sort((x, y) => timeKey(x) - timeKey(y));
  const list = who === 'mine' ? all.filter((a) => a.assignee === me.id) : all;

  // totals: supervisors see everybody's planned time, everybody else only their own
  const totals = {};
  all.forEach((a) => {
    if (!a.assignee) return;
    const row = (totals[a.assignee] = totals[a.assignee] || { min: 0, n: 0, done: 0 });
    row.min += taskGoal(s.tasks[a.task_id], a); row.n += 1; if (a.status === 'done') row.done += 1;
  });
  const shown = Object.entries(totals).filter(([id]) => sup || id === me.id);

  return html`<${Sheet} title=${fmt(d, { weekday: 'long' })} kicker=${fmt(d, { day: 'numeric', month: 'long', year: 'numeric' })} onClose=${onClose}>
    <${DateStrip} value=${day} onPick=${setDay} counts=${counts} />
    <div class="cal-tools">
      <div class="chips">
        <button class=${'pick' + (who === 'all' ? ' on' : '')} onClick=${() => setWho('all')}><${Icon} name="user" size=${16} />${t('cal.everyone')}</button>
        <button class=${'pick' + (who === 'mine' ? ' on' : '')} onClick=${() => setWho('mine')}><${Icon} name="star" size=${16} />${t('cal.mine')}</button>
      </div>
      ${sup ? html`<button class="btn small auto" onClick=${() => onAssign(day)}><${Icon} name="plus" size=${18} />${t('assign.title')}</button>` : null}
    </div>

    ${shown.length ? html`<div class="totals">
      ${shown.map(([id, v]) => html`<span class="total" key=${id}>
        <${Avatar} profile=${s.profiles[id]} size=${30} />
        <span><b>${id === me.id ? t('team.you') : (s.profiles[id] ? s.profiles[id].display_name.split(' ')[0] : '')}</b>
        <small>${dur(v.min)} · ${v.done}/${v.n}</small></span></span>`)}
    </div>` : null}

    ${list.length ? html`<${Schedule} list=${list} day=${day} onOpen=${onOpen} />` : null}
    ${!list.length ? html`<${Empty} icon="calendar-event" text=${t('cal.emptyDay')} />` : null}
  <//>`;
}

// ---- Vertical timeline: one card per task, stacked in start-time order (never side by side) ----
function Schedule({ list, day, onOpen }) {
  const s = useStore();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const isToday = day === todayYmd();
  const timed = list.filter(hasTime), anytime = list.filter((a) => !hasTime(a));
  const stream = [...anytime, ...timed]; // "anytime" tasks first, then by start time (list is already sorted)
  return html`<ol class="vt" aria-label=${t('cal.today')}>
    ${stream.map((a, i) => {
      const tk = s.tasks[a.task_id], who = s.profiles[a.assignee], area = areaOf(tk.area_id);
      const st = badgeStatus(a);
      const live = a.status === 'doing' || (isToday && hasTime(a) && a.status !== 'done' && toMin(a.start_time) <= nowMin && nowMin < toMin(a.end_time));
      const sub = [area ? areaName(area) : '', a.note || ''].filter(Boolean).join(' · ');
      return html`<li key=${a.id} class=${'vt-item ' + st + (live ? ' live' : '')} style=${`--sc:${STATUS_ICON_COLOR[st]}`}>
        <span class="vt-node" aria-hidden="true"></span>
        <button type="button" class="vt-card" onClick=${() => onOpen(a.id)}>
          <span class="vt-top"><b class="vt-title">${itemName(a)}</b>
            <span class="vt-time">${hasTime(a) ? hhmm(a.start_time) + ' – ' + hhmm(a.end_time) : t('cal.anytime')}</span></span>
          ${sub ? html`<span class="vt-sub">${sub}</span>` : null}
          <span class="vt-foot">
            <span class="vt-who">${who ? html`<${Avatar} profile=${who} size=${30} ring=${false} /><span>${who.display_name.split(' ')[0]}</span>`
              : html`<${Icon} name="help-circle" size=${20} /><span>${t('task.waiting')}</span>`}</span>
            <span class=${'vt-pill ' + st}><${Icon} name=${a.status === 'done' ? 'circle-check' : a.status === 'doing' ? 'hourglass' : 'clock'} size=${15} />${t('status.' + a.status)}</span>
          </span>
        </button>
      </li>`;
    })}
  </ol>`;
}

// ---- The week strip at the top of a day: tap a day to see its schedule ----
function DateStrip({ value, onPick, counts }) {
  const names = weekdayNames('short');
  const start = startOfWeek(parseYmd(value));
  const week = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = todayYmd();
  return html`<div class="ds" role="group" aria-label=${t('cal.week')}>
    <button type="button" class="icon-btn ds-nav" aria-label="previous week" onClick=${() => onPick(ymd(addDays(parseYmd(value), -7)))}><${Icon} name="caret-left" size=${18} /></button>
    <div class="ds-days">${week.map((d, i) => {
      const k = ymd(d);
      return html`<button type="button" key=${k} class=${'ds-day' + (k === value ? ' on' : '') + (k === today ? ' today' : '')} aria-pressed=${k === value}
        aria-label=${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })} onClick=${() => onPick(k)}>
        <small>${names[i]}</small><b>${d.getDate()}</b><i class=${counts[k] ? 'has' : ''}></i></button>`;
    })}</div>
    <button type="button" class="icon-btn ds-nav" aria-label="next week" onClick=${() => onPick(ymd(addDays(parseYmd(value), 7)))}><${Icon} name="caret-right" size=${18} /></button>
  </div>`;
}
