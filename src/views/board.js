import { html, useState, useEffect } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Segmented, Field, Sheet, Empty, useSheetControl } from '../ui.js';
import { colorStyle } from '../color.js';
import { isSupervisor, departmentOf } from '../roles.js';
import { assignmentsOn, askRooms, ensureMonth, startAssignment, autoAllocate, areaOf, areaName } from '../data.js';
import { dayPlanned, byImportance } from '../shifts.js';
import { DateField } from '../pickers.js';
import { ymd, parseYmd, addDays, todayYmd, fmt, monthKey } from '../time.js';
import { AssignmentRow, AssignmentSheet, AssignSheet, GiveSheet } from './assign.js';
import { LibraryView, TimeGoals } from './tasks.js';

// The Tasks tab: every task and every room to clean, day by day.
// Supervisors plan tasks, give them to people (one or several) and keep the task library; custodians do their tasks;
// reception lists rooms and watches them get cleaned.
export function TasksView() {
  const s = useStore();
  const sup = isSupervisor(s.profile);
  const rec = departmentOf(s.profile) === 'reception';
  const [tab, setTab] = useState('board');
  const lib = sup && tab === 'library';
  return html`<div class="stack tasks-page">
    <div class="page-head">
      <div>
        <h2 class="page-title">${t('tasks.title')}</h2>
        <p class="page-sub">${sup ? t('board.subSup') : rec ? t('board.subRec') : t('board.subCus')}</p>
      </div>
    </div>
    ${sup ? html`<${Segmented} value=${tab} onChange=${setTab} options=${[
      { value: 'board', label: t('tasks.viewBoard'), icon: 'calendar-event' }, { value: 'library', label: t('tasks.viewLibrary'), icon: 'list-check' }]} />` : null}
    ${lib ? html`<${LibraryView} />` : html`<${Board} sup=${sup} rec=${rec} />`}
  </div>`;
}

function Board({ sup, rec }) {
  const s = useStore();
  const me = s.profile;
  const [who, setWho] = useState(sup ? 'all' : 'mine');
  const [day, setDay] = useState(() => {
    // open on today, or on the nearest day that has something for you when today is empty
    const today = todayYmd();
    const mineDays = Object.values(s.assignments).filter((a) => (rec ? a.requested_by === me.id : a.assignee === me.id)).map((a) => a.day).sort();
    return sup || mineDays.includes(today) ? today : mineDays.find((d) => d > today) || today;
  });
  const [sel, setSel] = useState([]);
  const [adding, setAdding] = useState(false);
  const [giving, setGiving] = useState(false);
  const [goals, setGoals] = useState(false);
  const [open, setOpen] = useState(null); // { id, timer }
  const [group, setGroup] = useState('time'); // 'time' | 'area' (area checklists)
  const [alloc, setAlloc] = useState(false);

  useEffect(() => { ensureMonth(monthKey(parseYmd(day))).catch((e) => toast(friendlyError(e), 'bad')); }, [day]);

  const date = parseYmd(day);
  const visible = (a) => (rec ? a.requested_by === me.id : who === 'all' || a.assignee === me.id);
  const list = assignmentsOn(day).filter((a) => s.tasks[a.task_id] && visible(a));
  const go = (n) => { setDay(ymd(addDays(date, n))); setSel([]); };
  const label = day === todayYmd() ? t('chat.today') : day === ymd(addDays(new Date(), 1)) ? t('rooms.tomorrow') : fmt(date, { weekday: 'long' });
  const toggle = (id) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  const waiting = list.filter((a) => !a.assignee).sort(byImportance);
  const planned = list.filter((a) => a.assignee);
  async function giveOut() {
    setAlloc(true);
    try {
      const n = await autoAllocate(day);
      toast(n ? t('shift.allocated', { n }) : t('shift.allocatedNone'), n ? 'ok' : 'bad');
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setAlloc(false);
  }
  // area checklists: every area with its tasks, how many are done and how many steps are ticked
  const areaGroups = (() => {
    const map = new Map();
    list.forEach((a) => {
      const tk = s.tasks[a.task_id];
      const key = tk.area_id && areaOf(tk.area_id) ? tk.area_id : 'none';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(a);
    });
    const order = [...s.areas.map((x) => x.id), 'none'];
    return order.filter((k) => map.has(k)).map((k) => {
      const rows = map.get(k).sort(byImportance);
      const steps = rows.reduce((n, a) => n + (s.tasks[a.task_id].steps || []).length, 0);
      const ticked = rows.reduce((n, a) => n + (a.status === 'done' ? (s.tasks[a.task_id].steps || []).length : (a.steps_done || []).filter((i) => i < (s.tasks[a.task_id].steps || []).length).length), 0);
      return { key: k, area: k === 'none' ? null : areaOf(k), rows, done: rows.filter((a) => a.status === 'done').length, steps, ticked };
    });
  })();
  const done = list.filter((a) => a.status === 'done').length;
  const chosen = sel.filter((id) => s.assignments[id] && s.assignments[id].day === day);

  const row = (a) => {
    const mine = a.assignee === me.id;
    const extra = mine && a.status !== 'done'
      ? html`<button type="button" class=${'start-btn' + (a.status === 'doing' ? ' on' : '')} aria-label=${a.status === 'doing' ? t('timer.open') : t('act.start')}
          onClick=${async () => { try { if (a.status === 'todo') await startAssignment(a.id); setOpen({ id: a.id, timer: true }); } catch (ex) { toast(friendlyError(ex), 'bad'); } }}>
          <${Icon} name=${a.status === 'doing' ? 'hourglass' : 'player-play'} size=${18} /></button>` : null;
    return html`<${AssignmentRow} key=${a.id} a=${a} onOpen=${(id) => setOpen({ id })} showPerson=${who === 'all' || rec}
      selectable=${sup && a.status !== 'done'} selected=${chosen.includes(a.id)} onToggle=${() => toggle(a.id)} extra=${extra} />`;
  };

  return html`<div class="stack board">
    <div class="cal-head">
      <div class="rooms-day" key=${day}>
        <h3 class="cal-title">${label}</h3>
        <span class="muted">${fmt(date, { day: 'numeric', month: 'long' })}${list.length ? ` · ${t('rooms.progress', { done, total: list.length })}` : ''}</span>
      </div>
      <div class="cal-nav">
        <button class="icon-btn" aria-label="previous" onClick=${() => go(-1)}><${Icon} name="caret-left" size=${20} /></button>
        <button class="icon-btn" aria-label="next" onClick=${() => go(1)}><${Icon} name="caret-right" size=${20} /></button>
      </div>
    </div>

    ${rec ? null : html`<div class="cal-tools"><div class="chips">
      <button class=${'pick' + (who === 'all' ? ' on' : '')} onClick=${() => setWho('all')}><${Icon} name="user" size=${16} />${t('cal.everyone')}</button>
      <button class=${'pick' + (who === 'mine' ? ' on' : '')} onClick=${() => setWho('mine')}><${Icon} name="star" size=${16} />${t('cal.mine')}</button>
      ${sup ? html`<button class="pick ghost" onClick=${() => setGoals(true)}><${Icon} name="alarm" size=${16} />${t('goals.title')}</button>` : null}
    </div></div>`}
    ${list.length ? html`<${Segmented} value=${group} onChange=${setGroup} label=${t('board.group')} options=${[
      { value: 'time', label: t('board.byTime'), icon: 'clock' }, { value: 'area', label: t('board.byArea'), icon: 'home' }]} />` : null}

    <${DayOverview} day=${day} who=${who} sup=${sup} rec=${rec} onPick=${(d) => { setDay(d); setSel([]); }} />

    ${!list.length ? html`<${Empty} icon="list-check" text=${rec ? t('board.noneRec') : t('board.none')} />` : null}

    ${sup && waiting.length ? html`<div class="card waiting-give">
      <p><b>${t('shift.waitingN', { n: waiting.length })}</b><br /><span class="muted">${dayPlanned(day) ? t('shift.waitingHint') : t('board.noShiftsHint')}</span></p>
      ${dayPlanned(day) ? html`<button class="btn" disabled=${alloc} onClick=${giveOut}><${Icon} name="bolt" size=${22} />${t('shift.giveOut')}</button>`
        : html`<a class="btn soft" href="#/shifts"><${Icon} name="clock" size=${20} />${t('shift.planNow')}</a>`}
    </div>` : null}

    ${group === 'time' ? html`${waiting.length ? html`<section class="rise">
      <h3 class="section-title">${t('rooms.waiting')}<span class="count">${waiting.length}</span></h3>
      ${sup ? html`<p class="field-hint">${t('board.selectHint')}</p>` : null}
      <div class="list tight">${waiting.map(row)}</div>
    </section>` : null}

    ${planned.length ? html`<section class="rise">
      ${waiting.length ? html`<h3 class="section-title">${t('tasks.title')}<span class="count">${planned.length}</span></h3>` : null}
      <div class="list tight">${planned.map(row)}</div>
    </section>` : null}`
    : areaGroups.map((g) => html`<section class="rise area-group" key=${g.key} style=${g.area ? colorStyle(g.area.color) : ''}>
      <h3 class="section-title">${g.area ? html`<span class="title-ic" style=${colorStyle(g.area.color)}><${Icon} name=${g.area.icon} size=${16} /></span>${areaName(g.area)}` : t('tasks.noArea')}
        <span class="count">${g.done}/${g.rows.length}</span></h3>
      <div class="progress slim" role="img" aria-label=${t('board.areaProgress', { done: g.done, total: g.rows.length })}><i style=${`width:${Math.round((g.done / g.rows.length) * 100)}%`}></i></div>
      ${g.steps ? html`<p class="field-hint">${t('board.stepsTicked', { done: g.ticked, total: g.steps })}</p>` : null}
      <div class="list tight">${g.rows.map(row)}</div>
    </section>`)}

    ${sup || rec ? html`<button class="fab float pop" aria-label=${sup ? t('assign.title') : t('rooms.add')} onClick=${() => setAdding(true)}><${Icon} name="plus" size=${26} /></button>` : null}

    ${sup && chosen.length ? html`<div class="room-bar pop">
      <span><b>${t('rooms.selected', { n: chosen.length })}</b></span>
      <button class="btn small auto soft" onClick=${() => setSel([])}>${t('common.cancel')}</button>
      <button class="btn small auto" onClick=${() => setGiving(true)}><${Icon} name="user" size=${16} />${t('rooms.giveTo')}</button>
    </div>` : null}

    ${adding && sup ? html`<${AssignSheet} day=${day} onClose=${() => setAdding(false)} />` : null}
    ${adding && rec ? html`<${AddRooms} day=${day} onDay=${setDay} onClose=${() => setAdding(false)} />` : null}
    ${giving ? html`<${GiveSheet} ids=${chosen} onClose=${() => setGiving(false)} onDone=${() => setSel([])} />` : null}
    ${goals ? html`<${TimeGoals} onClose=${() => setGoals(false)} />` : null}
    ${open ? html`<${AssignmentSheet} id=${open.id} openTimer=${open.timer} onClose=${() => setOpen(null)} />` : null}
  </div>`;
}

// A strip of day cards above the list: what is planned on which day, and how far along it is.
// The supervisor also sees who has how many. Tap a card to open that day.
function DayOverview({ day, who, sup, rec, onPick }) {
  const s = useStore();
  const me = s.profile;
  const today = todayYmd();
  const from = ymd(addDays(new Date(), -2)), to = ymd(addDays(new Date(), 14));
  const mine = Object.values(s.assignments).filter((a) => s.tasks[a.task_id] && a.day >= from && a.day <= to
    && (rec ? a.requested_by === me.id : who === 'all' || a.assignee === me.id));
  if (!mine.length) return null;
  const byDay = {};
  mine.forEach((a) => { (byDay[a.day] = byDay[a.day] || []).push(a); });
  const days = Object.keys(byDay).sort((a, b) => ((a >= today) === (b >= today) ? (a >= today ? a.localeCompare(b) : b.localeCompare(a)) : a >= today ? -1 : 1));
  const n = (rows, f) => rows.filter(f).length;
  const chips = (rows) => {
    const out = [];
    const wait = n(rows, (a) => !a.assignee);
    if (wait) out.push(['waiting', t('board.sum.waiting', { n: wait })]);
    ['todo', 'doing', 'done'].forEach((k) => {
      const c = n(rows, (a) => a.assignee && a.status === k);
      if (c) out.push([k, t('board.sum.' + k, { n: c })]);
    });
    return out;
  };
  const dayName = (d) => (d === today ? t('chat.today') : d === ymd(addDays(new Date(), 1)) ? t('rooms.tomorrow') : fmt(parseYmd(d), { weekday: 'short', day: 'numeric', month: 'short' }));
  return html`<section class="rise my-requests">
    <h3 class="section-title">${t('board.overview')}</h3>
    <div class="req-list">${days.map((d) => html`<button type="button" key=${d} class=${'req-day' + (d === day ? ' on' : '') + (d < today ? ' past' : '')} onClick=${() => onPick(d)}>
      <span class="req-top"><b>${dayName(d)}</b><span class="muted">${t('board.count', { n: byDay[d].length })}</span></span>
      <span class="req-chips">${chips(byDay[d]).map(([k, label]) => html`<span key=${label} class=${'req-chip ' + k}>${label}</span>`)}</span>
    </button>`)}</div>
  </section>`;
}

// ---- Reception: list the rooms that need cleaning ----
function AddRooms({ day, onDay, onClose }) {
  const ctl = useSheetControl();
  const [date, setDate] = useState(day === todayYmd() ? ymd(addDays(new Date(), 1)) : day);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const rooms = [...new Set(text.split(/[,;\n]/).map((x) => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 40);

  async function save(e) {
    e.preventDefault();
    if (!rooms.length || busy) return;
    setBusy(true);
    try {
      await ensureMonth(monthKey(parseYmd(date)));
      await askRooms(date, rooms, note.trim());
      toast(t('rooms.sent', { n: rooms.length }));
      onDay(date);
      ctl.close();
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }
  return html`<${Sheet} title=${t('rooms.addTitle')} onClose=${onClose} control=${ctl}>
    <form class="stack-form" onSubmit=${save}>
      <${Field} label=${t('rooms.day')}><${DateField} value=${date} label=${t('rooms.day')} onChange=${setDate} /><//>
      <${Field} label=${t('rooms.list')} hint=${t('rooms.listHint')}>
        <textarea class="input area" rows="2" maxlength="400" required value=${text} placeholder="4, 7, 12" onInput=${(e) => setText(e.target.value)}></textarea>
      <//>
      ${rooms.length ? html`<div class="chips pop">${rooms.map((r) => html`<span class="chip role" key=${r} style="--c:var(--mint);--soft:var(--brand-soft);--ink:var(--brand-ink)">${r}</span>`)}</div>` : null}
      <${Field} label=${t('rooms.note')}>
        <input class="input" type="text" maxlength="300" value=${note} onInput=${(e) => setNote(e.target.value)} />
      <//>
      <button class="btn" type="submit" disabled=${!rooms.length || busy}><${Icon} name="send" size=${18} />${rooms.length > 1 ? t('rooms.sendN', { n: rooms.length }) : t('rooms.send')}</button>
    </form>
  <//>`;
}
