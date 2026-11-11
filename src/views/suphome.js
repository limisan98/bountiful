import { html, useState, useEffect, useRef } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, currentLocale, friendlyError } from '../i18n.js';
import { Icon, Avatar, Empty, TaskBadge, Sheet, badgeStatus } from '../ui.js';
import { colorStyle } from '../color.js';
import { isSupervisor } from '../roles.js';
import { assignmentsOn, giveTasks, distribute, ensureMonth, ensureWeekly, itemName } from '../data.js';
import { todayYmd, addDays, ymd, parseYmd, fmt, dur, hhmm, toMin, monthKey } from '../time.js';
import { dayPlanned, shiftOf, capacityOf, loadOf, goalOf, crewPeople, problem } from '../shifts.js';
import { AssignmentSheet, AssignmentRow, GiveSheet } from './assign.js';
import { QuickAssignSheet } from './quick.js';
import { MoreLinks } from './more.js';
import { WeeklyToday, dayProgressItems, weekStart } from './weekly.js';
import { RoomImportSheet } from './roomimport.js';
import { RECEPTION_ON } from '../config.js';

const FLOW_TIME = { checkout: '10:00', checkin: '14:00' };

// The supervisor's overview: requests from Reception, how the day is going, who is working, and one big "Quick assign".
export function SupervisorHome() {
  const s = useStore();
  const today = todayYmd();
  const loc = currentLocale();
  const [now, setNow] = useState(new Date());
  const [quick, setQuick] = useState(false);
  const [roomImp, setRoomImp] = useState(false);
  const [open, setOpen] = useState(null);
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(i); }, []);
  useEffect(() => { ensureMonth(monthKey(new Date())).catch(() => {}); ensureWeekly(weekStart()).catch(() => {}); }, []);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // progress = everything designated for today: the weekday's checklist, the rooms and the other tasks given out (updates live with the ticks)
  const items = dayProgressItems(s, today);
  const stat = { done: 0, doing: 0, todo: 0, waiting: 0 };
  items.forEach((i) => { stat[i.state] += 1; });
  const [openProg, setOpenProg] = useState(false);
  const total = items.length;
  const pct = total ? Math.round((stat.done / total) * 100) : 0;

  const since = ymd(addDays(new Date(), -3));
  const updates = Object.values(s.reports).map((r) => ({ r, a: s.assignments[r.assignment_id] }))
    .filter((x) => x.a && x.a.day >= since && s.tasks[x.a.task_id]).sort((x, y) => y.r.completed_at.localeCompare(x.r.completed_at)).slice(0, 4);

  // progress ring drawn as round-ended arcs (palette colours only)
  const R = 40, C = 2 * Math.PI * R, SW = 13, GAP = 5;
  const parts = [[stat.done, 'var(--mint)'], [stat.doing, 'var(--yellow)'], [stat.todo, 'var(--lavender)'], [stat.waiting, 'var(--coral)']].filter(([n]) => n > 0);
  let offset = 0;
  const arcs = parts.map(([n, color]) => {
    const part = (n / total) * C;
    const len = parts.length === 1 ? 0.01 : Math.max(0.01, part - GAP - SW); // round caps add SW to each arc
    const arc = html`<circle key=${color} cx="50" cy="50" r=${R} fill="none" stroke=${color} stroke-width=${SW} stroke-linecap="round" stroke-dasharray=${len + ' ' + C} stroke-dashoffset=${-(offset + (parts.length === 1 ? 0 : (GAP + SW) / 2))} />`;
    offset += part;
    return arc;
  });
  const legend = [['done', t('status.done'), stat.done], ['doing', t('status.doing'), stat.doing], ['todo', t('status.todo'), stat.todo], ['waiting', t('sup.waiting'), stat.waiting]];

  return html`<div class="stack sup-home">
    <header class="my-head">
      <p class="my-date">${now.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    </header>

    <button type="button" class="btn soft" onClick=${() => setRoomImp(true)}><${Icon} name="bed" size=${22} />${t('rimp.button')}</button>

    <section class="rise sum-card" aria-label=${t('sup.progress')}>
      <button type="button" class="prog-head" aria-expanded=${openProg} disabled=${!total} onClick=${() => setOpenProg(!openProg)}>
        <h3 class="section-title">${t('sup.progress')}</h3>${total ? html`<${Icon} name=${openProg ? 'caret-up' : 'caret-down'} size=${22} />` : null}
      </button>
      ${total ? html`<div class="sum-body">
        <div class="sum-ring" role="img" aria-label=${t('sup.percent', { n: pct }) + ': ' + legend.map((l) => l[1] + ' ' + l[2]).join(', ')} ><svg viewBox="0 0 100 100" aria-hidden="true">${arcs}</svg><span><b>${pct}%</b><small>${t('status.done')}</small></span></div>
        <ul class="ring-legend">${legend.map(([k, label, n]) => html`<li key=${k}><i class=${'lg-' + k}></i><span>${label}</span><b>${n}</b></li>`)}</ul>
      </div>` : html`<${Empty} icon="calendar-event" text=${t('home.teamEmpty')} />`}
      ${openProg && total ? html`<${ProgressDetail} items=${items} />` : null}
    </section>

    ${updates.length ? html`<section class="rise">
      <h3 class="section-title">${t('home.updates')}</h3>
      <div class="list tight">${updates.map(({ r, a }) => {
        const tk = s.tasks[a.task_id], who = s.profiles[a.assignee];
        return html`<button class="update" key=${a.id} onClick=${() => setOpen(a.id)} style=${colorStyle(tk.color)}>
          <${TaskBadge} icon=${tk.icon} status=${badgeStatus(a)} size=${40} />
          <span class="update-main"><b>${itemName(a)}</b><small>${who ? who.display_name.split(' ')[0] : ''} · ${dur(r.minutes_spent)} <em class=${r.minutes_spent > r.goal_minutes ? 'over' : ''}>/ ${dur(r.goal_minutes)}</em></small></span>
        </button>`;
      })}</div></section>` : null}

    <${WeeklyToday} />

    <${MoreLinks} routes=${['weekly', 'tasks', 'calendar', 'shifts', 'logbook', 'reports', 'meetings', 'team']} />

    <${QuickFab} onOpen=${() => setQuick(true)} />
    ${roomImp ? html`<${RoomImportSheet} onClose=${() => setRoomImp(false)} />` : null}
    ${quick ? html`<${QuickAssignSheet} day=${today} onClose=${() => setQuick(false)} />` : null}
    ${open ? html`<${AssignmentSheet} id=${open} onClose=${() => setOpen(null)} />` : null}
  </div>`;
}

// One request from Reception: who asked, what kind of cleaning, which rooms - and who can take it, one tap each.
function RequestGroup({ g }) {
  const s = useStore();
  const [busy, setBusy] = useState(false);
  const [choose, setChoose] = useState(false);
  const who = s.profiles[g.by];
  const day = g.day, today = todayYmd();
  const sum = g.items.reduce((n, a) => n + goalOf(a), 0);
  const planned = dayPlanned(day);
  const ids = g.items.map((a) => a.id);
  const note = (g.items.find((a) => a.note) || {}).note;
  const people = crewPeople().filter((p) => !isSupervisor(p)).map((p) => {
    const sh = shiftOf(p.id, day);
    if (planned && !sh) return null;
    const free = sh ? capacityOf(p.id, day) - loadOf(p.id, day) : null;
    const reason = !planned ? null : g.items.some((a) => problem(p.id, day, a, a.id) === 'window') ? 'window' : free < sum ? 'capacity' : null;
    return { p, free, reason };
  }).filter(Boolean).sort((a, b) => (a.reason ? 1 : 0) - (b.reason ? 1 : 0) || (b.free || 0) - (a.free || 0));
  const flow = g.task.room_flow;
  const dayLabel = day === today ? t('chat.today') : day === ymd(addDays(new Date(), 1)) ? t('rooms.tomorrow') : fmt(parseYmd(day), { weekday: 'short', day: 'numeric', month: 'short' });

  async function give(list) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await giveTasks(ids, list, false);
      const name = list.length === 1 && s.profiles[list[0]] ? s.profiles[list[0]].display_name.split(' ')[0] : '';
      toast(r.skipped ? t('task.givenSome', { n: r.placed, m: r.skipped }) : t('sup.given', { n: r.placed, name }), r.placed ? 'ok' : 'bad');
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }
  async function share() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await distribute(ids, people.map((x) => x.p.id));
      toast(r.left ? t('task.givenSome', { n: r.placed, m: r.left }) : t('task.given', { n: r.placed }), r.placed ? 'ok' : 'bad');
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }

  return html`<article class=${'req-group ' + (flow || '')}>
    <div class="req-who">
      <${Avatar} profile=${who} size=${40} />
      <div><b>${who ? who.display_name : ''}</b>
        <span><${Icon} name=${flow === 'checkin' ? 'key' : 'sparkles-2'} size=${15} />${flow ? t('flow.' + flow) + ' · ' + FLOW_TIME[flow] : t('sup.roomsGeneric')} · ${dayLabel}</span></div>
    </div>
    <div class="chips req-rooms">${g.items.map((a) => html`<span class="chip role" key=${a.id} style="--c:var(--mint);--soft:#fff;--ink:var(--ink)">${a.title}</span>`)}</div>
    ${note ? html`<p class="req-note">${note}</p>` : null}
    <p class="req-giveto">${t('sup.giveTo')} · <span>${t('sup.needs', { time: dur(sum) })}</span></p>
    ${people.length ? html`<div class="req-people">${people.map(({ p, free, reason }) => html`<button type="button" key=${p.id} class=${'req-person' + (reason ? ' no' : '')} disabled=${busy || !!reason}
      title=${reason ? t('shift.problem.' + reason) : ''} onClick=${() => give([p.id])}>
      <${Avatar} profile=${p} size=${30} ring=${false} />
      <span><b>${p.display_name.split(' ')[0]}</b><small>${reason ? t('shift.problem.' + reason) : free === null ? '' : t('quick.free', { time: dur(Math.max(0, free)) })}</small></span>
    </button>`)}</div>` : html`<p class="muted">${t('sup.noOne')}</p>`}
    <div class="req-actions">
      <button type="button" class="btn small soft" disabled=${busy || !people.length} onClick=${share}><${Icon} name="bolt" size=${18} />${t('sup.shareOut')}</button>
      <button type="button" class="btn small choose-btn" disabled=${busy} onClick=${() => setChoose(true)}><${Icon} name="user" size=${18} />${t('sup.choose')}</button>
    </div>
    ${choose ? html`<${GiveSheet} ids=${ids} onClose=${() => setChoose(false)} onDone=${() => {}} />` : null}
  </article>`;
}

// The bell in the top right corner (supervisor): count badge + the inbox with Reception requests and meeting requests.
export function SupBell() {
  const s = useStore();
  const today = todayYmd();
  const [inbox, setInbox] = useState(false);
  // requests from Reception that nobody has taken yet, grouped by day, kind of cleaning and person
  const groups = {};
  Object.values(s.assignments).filter((a) => a.kind === 'room' && a.requested_by && !a.assignee && a.status !== 'done' && a.day >= today && s.tasks[a.task_id])
    .forEach((a) => { const k = a.day + '|' + a.task_id + '|' + a.requested_by; (groups[k] = groups[k] || { key: k, day: a.day, task: s.tasks[a.task_id], by: a.requested_by, items: [] }).items.push(a); });
  const feed = !RECEPTION_ON ? [] : Object.values(groups).sort((x, y) => x.day.localeCompare(y.day) || (x.task.room_flow === 'checkout' ? 0 : 1) - (y.task.room_flow === 'checkout' ? 0 : 1));
  const roomsWaiting = feed.reduce((n, g) => n + g.items.length, 0);
  const meetingsWaiting = Object.values(s.meetings).filter((m) => m.status === 'pending' && m.day >= today).length;
  const alerts = roomsWaiting + meetingsWaiting;


  return html`<button type="button" class=${'bell-btn' + (alerts ? ' has' : '')} aria-label=${t('notif.title') + (alerts ? ': ' + alerts : '')} onClick=${() => setInbox(true)}>
      <${Icon} name=${alerts ? 'bell-ringing' : 'bell'} size=${26} />${alerts ? html`<span class="bell-badge">${alerts}</span>` : null}
    </button>
    ${inbox ? html`<${InboxSheet} feed=${feed} meetings=${meetingsWaiting} onClose=${() => setInbox(false)} />` : null}`;
}

// The inbox behind the bell: Reception requests (give them out right here) and meeting requests waiting for an answer.
function InboxSheet({ feed, meetings, onClose }) {
  const rooms = feed.reduce((n, g) => n + g.items.length, 0);
  return html`<${Sheet} title=${t('notif.title')} onClose=${onClose}>
    <div class="stack">
      ${feed.length ? html`<section class="req-banner" aria-label=${t('sup.requests')}>
        <header><span class="req-bell"><${Icon} name="bell-ringing" size=${26} /></span>
          <div><b>${t('sup.requests')}</b><span>${t('sup.requestsN', { n: rooms })}</span></div></header>
        <div class="req-groups">${feed.map((g) => html`<${RequestGroup} key=${g.key} g=${g} />`)}</div>
      </section>` : null}
      ${meetings ? html`<a class="more-link inbox-link" href="#/meetings" onClick=${onClose}><${Icon} name="calendar-month" size=${24} />${t('sup.meetingsN', { n: meetings })}</a>` : null}
      ${!feed.length && !meetings ? html`<div class="req-calm"><${Icon} name="circle-check" size=${22} />${t('sup.requestsNone')}</div>` : null}
    </div>
  <//>`;
}

// Quick assign as a small round button that floats over the screen: a person with a lightning bolt = "give a task, fast".
// Drag it anywhere (it remembers the place on this device); a tap opens the quick assign sheet.
const FAB = 64;
const FAB_KEY = 'bountiful.quickFab';
const clampPos = (x, y) => ({ x: Math.min(Math.max(8, x), window.innerWidth - FAB - 8), y: Math.min(Math.max(8, y), window.innerHeight - FAB - 8) });
function QuickFab({ onOpen }) {
  const el = useRef(null);
  const drag = useRef(null);
  const skip = useRef(false);
  const [pos, setPos] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem(FAB_KEY) || 'null'); if (v && typeof v.fx === 'number') return clampPos(v.fx * (window.innerWidth - FAB), v.fy * (window.innerHeight - FAB)); } catch { /* no saved place */ }
    return null; // default place (CSS)
  });
  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clampPos(p.x, p.y) : p));
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);
  const down = (e) => {
    const r = el.current.getBoundingClientRect();
    drag.current = { sx: e.clientX, sy: e.clientY, x: r.left, y: r.top, moved: false };
    el.current.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    setPos(clampPos(d.x + dx, d.y + dy));
  };
  const up = (e) => {
    const d = drag.current;
    drag.current = null;
    try { el.current.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (d && d.moved) {
      skip.current = true; setTimeout(() => { skip.current = false; }, 0); // the click that follows a drag must not open the sheet
      const p = clampPos(d.x + (e.clientX - d.sx), d.y + (e.clientY - d.sy));
      try { localStorage.setItem(FAB_KEY, JSON.stringify({ fx: p.x / (window.innerWidth - FAB), fy: p.y / (window.innerHeight - FAB) })); } catch { /* private mode */ }
    }
  };
  return html`<button type="button" ref=${el} class=${'quick-fab' + (pos ? ' placed' : '')} style=${pos ? `left:${pos.x}px;top:${pos.y}px` : ''}
    aria-label=${t('quick.button')} title=${t('quick.button')}
    onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}
    onClick=${() => { if (!skip.current) onOpen(); }}>
    <${Icon} name="user" size=${30} /><span class="quick-fab-bolt"><${Icon} name="bolt" size=${16} /></span>
  </button>`;
}

// What was designated for today, state by state (opens under the progress ring)
const STATE_ORDER = [['done', 'status.done'], ['doing', 'status.doing'], ['waiting', 'sup.waiting'], ['todo', 'status.todo']];
function ProgressDetail({ items }) {
  const s = useStore();
  const first = (id) => ((s.profiles[id] || {}).display_name || '').split(' ')[0];
  const lines = items.filter((i) => i.kind === 'line'), rooms = items.filter((i) => i.kind === 'room'), tasks = items.filter((i) => i.kind === 'task');
  const hh = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
  const stateLabel = { done: t('status.done'), doing: t('status.doing'), waiting: t('sup.waiting'), todo: t('status.todo') };
  // a small table: what, how it is going (+ the time), who
  const table = (list) => html`<table class="prog-table"><thead><tr><th>${t('px.item')}</th><th>${t('px.status')}</th><th>${t('rx.person')}</th></tr></thead>
    <tbody>${list.map((i, k) => html`<tr key=${k}>
      <td class="pt-item">${i.label}</td>
      <td><span class=${'pt-state ' + i.state}>${stateLabel[i.state]}</span>${i.at && (i.state === 'done' || i.state === 'doing') ? html`<small>${hh(i.at)}</small>` : null}</td>
      <td class="pt-who">${i.who ? html`<${Avatar} profile=${s.profiles[i.who]} size=${22} ring=${false} />${first(i.who)}` : '–'}</td></tr>`)}</tbody></table>`;
  return html`<div class="prog-detail">
    <p class="field-hint">${t('sup.progressWhat')}</p>
    ${lines.length ? html`<h4>${t('sup.progressList')} <span class="count">${lines.filter((i) => i.state === 'done').length}/${lines.length}</span></h4>
      ${table(lines)}` : null}
    ${tasks.length ? html`<h4>${t('sup.progressTasks')} <span class="count">${tasks.filter((i) => i.state === 'done').length}/${tasks.length}</span></h4>
      ${table(tasks)}` : null}
    ${rooms.length ? html`<h4>${t('sup.progressRooms')} <span class="count">${rooms.filter((i) => i.state === 'done').length}/${rooms.length}</span></h4>
      ${STATE_ORDER.map(([st, label]) => { const list = rooms.filter((i) => i.state === st); return list.length ? html`<div class="prog-rooms" key=${st}>
        <span class=${'prog-state ' + st}>${t(label)} · ${list.length}</span>
        <div class="rimp-chips">${list.map((i) => html`<span class=${'prog-chip ' + st} key=${i.label} title=${i.who ? first(i.who) : ''}>${i.label}</span>`)}</div></div>` : null; })}` : null}
  </div>`;
}
