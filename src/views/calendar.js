import { html, useState, useEffect } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Avatar, Segmented, Sheet, Empty } from '../ui.js';
import { isSupervisor } from '../roles.js';
import { colorStyle } from '../color.js';
import { ensureMonth } from '../data.js';
import { ymd, parseYmd, addDays, addMonths, monthKey, monthGrid, startOfWeek, weekdayNames, fmt, todayYmd, toMin, hhmm, dur, goalMin, pad } from '../time.js';
import { AssignmentRow, AssignmentSheet, AssignSheet } from './assign.js';

// Group everything by day once, so the grids stay quick
function byDay(assignments, onlyMe) {
  const map = {};
  for (const a of Object.values(assignments)) {
    if (onlyMe && a.assignee !== onlyMe) continue;
    (map[a.day] = map[a.day] || []).push(a);
  }
  for (const k in map) map[k].sort((x, y) => toMin(x.start_time) - toMin(y.start_time));
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
          const colors = [];
          list.forEach((a) => { const tk = s.tasks[a.task_id]; if (tk && !colors.includes(tk.color)) colors.push(tk.color); });
          const counts = {};
          list.forEach((a) => { counts[a.task_id] = (counts[a.task_id] || 0) + 1; });
          const groups = Object.entries(counts).map(([id, n]) => [s.tasks[id], n]).filter(([tk]) => tk);
          const out = d.getMonth() !== cursor.getMonth();
          return html`<button key=${k} class=${'day' + (out ? ' out' : '') + (k === today ? ' today' : '') + (list.length ? ' has' : '')}
            onClick=${() => setOpenDay(k)} aria-label=${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}>
            <span class="day-n">${d.getDate()}</span>
            <span class="day-chips">${groups.slice(0, 3).map(([tk, n]) => html`<i style=${`--c:${tk.color}`}>${tk.name}${n > 1 ? ' ×' + n : ''}</i>`)}${groups.length > 3 ? html`<b>+${groups.length - 3}</b>` : null}</span>
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

const HOUR = 60;            // pixels per hour in the day view
const INK = '#1E2A28';

// ---- One day, hour by hour ----
export function DaySheet({ day, who: initialWho, onClose, onOpen, onAssign }) {
  const s = useStore();
  const me = s.profile;
  const sup = isSupervisor(me);
  const [who, setWho] = useState(initialWho || 'all');
  const d = parseYmd(day);
  const all = Object.values(s.assignments).filter((a) => a.day === day && s.tasks[a.task_id])
    .sort((x, y) => toMin(x.start_time) - toMin(y.start_time));
  const list = who === 'mine' ? all.filter((a) => a.assignee === me.id) : all;

  // totals: supervisors see everybody's planned time, everybody else only their own
  const totals = {};
  all.forEach((a) => {
    const row = (totals[a.assignee] = totals[a.assignee] || { min: 0, n: 0, done: 0 });
    row.min += goalMin(a); row.n += 1; if (a.status === 'done') row.done += 1;
  });
  const shown = Object.entries(totals).filter(([id]) => sup || id === me.id);

  return html`<${Sheet} title=${fmt(d, { weekday: 'long' })} kicker=${fmt(d, { day: 'numeric', month: 'long', year: 'numeric' })} onClose=${onClose}>
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

    ${list.length ? html`<${Timeline} list=${list} day=${day} onOpen=${onOpen} />`
      : html`<${Empty} icon="calendar-event" text=${t('cal.emptyDay')} />`}
  <//>`;
}

function layout(list) {
  // blocks that overlap in time sit side by side
  const items = list.map((a) => ({ a, s: toMin(a.start_time), e: toMin(a.end_time), lane: 0, lanes: 1 }));
  let cluster = [], end = -1;
  const flush = () => {
    const ends = [];
    cluster.forEach((it) => {
      let l = ends.findIndex((x) => x <= it.s);
      if (l < 0) { l = ends.length; ends.push(it.e); } else ends[l] = it.e;
      it.lane = l;
    });
    cluster.forEach((it) => { it.lanes = ends.length; });
    cluster = [];
  };
  items.forEach((it) => {
    if (cluster.length && it.s >= end) { flush(); end = -1; }
    cluster.push(it); end = Math.max(end, it.e);
  });
  flush();
  return items;
}

function Timeline({ list, day, onOpen }) {
  const s = useStore();
  const items = layout(list);
  const from = Math.min(6, Math.floor(Math.min(...items.map((i) => i.s)) / 60));
  const to = Math.max(20, Math.ceil(Math.max(...items.map((i) => i.e)) / 60));
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const isToday = day === todayYmd() && nowMin >= from * 60 && nowMin <= to * 60;
  const px = (m) => ((m - from * 60) / 60) * HOUR;

  return html`<div class="timeline" style=${`height:${(to - from) * HOUR + 20}px`}>
    ${hours.map((h) => html`<div class="hour" key=${h} style=${`top:${(h - from) * HOUR}px`}><span>${pad(h)}:00</span></div>`)}
    <div class="blocks">
      ${items.map((it) => {
        const a = it.a, tk = s.tasks[a.task_id], who = s.profiles[a.assignee];
        const h = Math.max(30, px(it.e) - px(it.s) - 3);
        const w = 100 / it.lanes;
        return html`<button key=${a.id} class=${'block ' + a.status + (h < 52 ? ' tiny' : '')} onClick=${() => onOpen(a.id)}
          style=${`${colorStyle(tk.color)};top:${px(it.s)}px;height:${h}px;left:calc(${it.lane * w}% + 1px);width:calc(${w}% - 4px)`}>
          <span class="block-ic"><${Icon} name=${a.status === 'done' ? 'circle-check' : tk.icon} size=${16} /></span>
          <span class="block-main"><b>${tk.name}</b>
            <small>${who ? html`<${Avatar} profile=${who} size=${16} ring=${false} />${who.display_name.split(' ')[0]} · ` : null}${hhmm(a.start_time)}–${hhmm(a.end_time)}</small></span>
        </button>`;
      })}
    </div>
    ${isToday ? html`<div class="now" style=${`top:${px(nowMin)}px`}><i></i></div>` : null}
  </div>`;
}
