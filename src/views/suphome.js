import { html, useState, useEffect } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, currentLocale, friendlyError } from '../i18n.js';
import { Icon, Avatar, Empty, TaskBadge, Sheet } from '../ui.js';
import { colorStyle } from '../color.js';
import { isSupervisor } from '../roles.js';
import { assignmentsOn, giveTasks, distribute, ensureMonth, itemName } from '../data.js';
import { todayYmd, addDays, ymd, parseYmd, fmt, dur, hhmm, toMin, monthKey } from '../time.js';
import { dayPlanned, shiftOf, capacityOf, loadOf, goalOf, crewPeople, problem } from '../shifts.js';
import { AssignmentSheet, AssignmentRow, GiveSheet } from './assign.js';
import { QuickAssignSheet } from './quick.js';
import { MoreLinks } from './more.js';

const FLOW_TIME = { checkout: '10:00', checkin: '14:00' };

// The supervisor's overview: requests from Reception, how the day is going, who is working, and one big "Quick assign".
export function SupervisorHome() {
  const s = useStore();
  const today = todayYmd();
  const loc = currentLocale();
  const [now, setNow] = useState(new Date());
  const [quick, setQuick] = useState(false);
  const [open, setOpen] = useState(null);
  const [person, setPerson] = useState(null);
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(i); }, []);
  useEffect(() => { ensureMonth(monthKey(new Date())).catch(() => {}); }, []);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const todays = assignmentsOn(today).filter((a) => s.tasks[a.task_id]);
  const stat = { done: 0, doing: 0, todo: 0, waiting: 0 };
  todays.forEach((a) => { if (a.status === 'done') stat.done += 1; else if (!a.assignee) stat.waiting += 1; else if (a.status === 'doing') stat.doing += 1; else stat.todo += 1; });
  const total = todays.length;
  const pct = total ? Math.round((stat.done / total) * 100) : 0;

  // requests from Reception that nobody has taken yet, grouped by day, kind of cleaning and person
  const groups = {};
  Object.values(s.assignments).filter((a) => a.kind === 'room' && a.requested_by && !a.assignee && a.status !== 'done' && a.day >= today && s.tasks[a.task_id])
    .forEach((a) => { const k = a.day + '|' + a.task_id + '|' + a.requested_by; (groups[k] = groups[k] || { key: k, day: a.day, task: s.tasks[a.task_id], by: a.requested_by, items: [] }).items.push(a); });
  const feed = Object.values(groups).sort((x, y) => x.day.localeCompare(y.day) || (x.task.room_flow === 'checkout' ? 0 : 1) - (y.task.room_flow === 'checkout' ? 0 : 1));
  const roomsWaiting = feed.reduce((n, g) => n + g.items.length, 0);

  // who is working now (or still to come today)
  const planned = dayPlanned(today);
  const team = crewPeople().map((p) => ({ p, sh: shiftOf(p.id, today) })).filter((x) => x.sh && nowMin < toMin(x.sh.end_time))
    .sort((a, b) => toMin(a.sh.start_time) - toMin(b.sh.start_time) || a.p.display_name.localeCompare(b.p.display_name));

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
      <h2 class="my-title">${t('sup.title')}</h2>
    </header>

    <button type="button" class="btn big-btn quick-btn" onClick=${() => setQuick(true)}><${Icon} name="bolt" size=${26} />${t('quick.button')}<span>${t('quick.buttonSub')}</span></button>

    ${feed.length ? html`<section class="req-banner rise" aria-label=${t('sup.requests')}>
      <header><span class="req-bell"><${Icon} name="bell-ringing" size=${26} /></span>
        <div><b>${t('sup.requests')}</b><span>${t('sup.requestsN', { n: roomsWaiting })}</span></div></header>
      <div class="req-groups">${feed.map((g) => html`<${RequestGroup} key=${g.key} g=${g} onOpen=${setOpen} />`)}</div>
    </section>` : html`<div class="req-calm rise"><${Icon} name="circle-check" size=${22} />${t('sup.requestsNone')}</div>`}

    <section class="rise sum-card" aria-label=${t('sup.progress')}>
      <h3 class="section-title">${t('sup.progress')}</h3>
      ${total ? html`<div class="sum-body">
        <div class="sum-ring" role="img" aria-label=${t('sup.percent', { n: pct }) + ': ' + legend.map((l) => l[1] + ' ' + l[2]).join(', ')} ><svg viewBox="0 0 100 100" aria-hidden="true">${arcs}</svg><span><b>${pct}%</b><small>${t('status.done')}</small></span></div>
        <ul class="ring-legend">${legend.map(([k, label, n]) => html`<li key=${k}><i class=${'lg-' + k}></i><span>${label}</span><b>${n}</b></li>`)}</ul>
      </div>` : html`<${Empty} icon="calendar-event" text=${t('home.teamEmpty')} />`}
    </section>

    <section class="rise">
      <h3 class="section-title">${t('sup.team')}${team.length ? html`<span class="count">${team.length}</span>` : null}<a class="section-link" href="#/shifts">${t('sup.allShifts')}</a></h3>
      ${team.length ? html`<div class="team-list">${team.map(({ p }) => html`<${TeamRow} key=${p.id} p=${p} day=${today} onPick=${() => setPerson(p.id)} />`)}</div>`
        : html`<${Empty} icon="clock" text=${planned ? t('shift.nobody') : t('shift.notPlanned')} />`}
    </section>

    ${updates.length ? html`<section class="rise">
      <h3 class="section-title">${t('home.updates')}</h3>
      <div class="list tight">${updates.map(({ r, a }) => {
        const tk = s.tasks[a.task_id], who = s.profiles[a.assignee];
        return html`<button class="update" key=${a.id} onClick=${() => setOpen(a.id)} style=${colorStyle(tk.color)}>
          <${TaskBadge} icon=${tk.icon} color=${tk.color} size=${40} />
          <span class="update-main"><b>${itemName(a)}</b><small>${who ? who.display_name.split(' ')[0] : ''} · ${dur(r.minutes_spent)} <em class=${r.minutes_spent > r.goal_minutes ? 'over' : ''}>/ ${dur(r.goal_minutes)}</em></small></span>
        </button>`;
      })}</div></section>` : null}

    <${MoreLinks} routes=${['tasks', 'calendar', 'shifts', 'logbook', 'reports', 'meetings', 'team']} />

    ${person ? html`<${PersonDaySheet} id=${person} day=${today} now=${now} onClose=${() => setPerson(null)} />` : null}
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

const tasksOf = (s, id, day) => assignmentsOn(day).filter((a) => a.assignee === id && s.tasks[a.task_id])
  .sort((x, y) => (x.start_time || '99').localeCompare(y.start_time || '99') || itemName(x).localeCompare(itemName(y)));

// One compact line per worker: picture, name, progress, done/total and planned time. Tap = that person's tasks of the day.
function TeamRow({ p, day, onPick }) {
  const s = useStore();
  const mine = tasksOf(s, p.id, day);
  const done = mine.filter((a) => a.status === 'done').length;
  const pct = mine.length ? Math.round((done / mine.length) * 100) : 0;
  const planned = mine.reduce((n, a) => n + goalOf(a), 0);
  return html`<button type="button" class="team-row" onClick=${onPick} aria-label=${p.display_name + ': ' + done + '/' + mine.length}>
    <${Avatar} profile=${p} size=${48} />
    <span class="team-main"><b>${p.display_name}</b>
      <span class="load-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${pct}><i style=${`width:${pct}%`}></i></span></span>
    <span class="team-num"><b>${done}/${mine.length}</b><small>${planned ? dur(planned) : ''}</small></span>
  </button>`;
}

// The supervisor taps a worker and sees everything planned for that person today (tap a task for its details).
function PersonDaySheet({ id, day, now, onClose }) {
  const s = useStore();
  const p = s.profiles[id];
  const [view, setView] = useState(null);
  const [give, setGive] = useState(false);
  if (!p) return null;
  const mine = tasksOf(s, id, day);
  const sh = shiftOf(id, day);
  const ended = sh && now.getHours() * 60 + now.getMinutes() >= toMin(sh.end_time);
  return html`<${Sheet} title=${p.display_name} kicker=${sh ? hhmm(sh.start_time) + '–' + hhmm(sh.end_time) : ''} onClose=${onClose}>
    <div class="stack">
      ${mine.length ? html`<div class="list">${mine.map((a) => html`<${AssignmentRow} key=${a.id} a=${a} onOpen=${setView} />`)}</div>`
        : html`<${Empty} icon="list-check" text=${t('shift.noTasksYet')} />`}
      ${!ended ? html`<button type="button" class="btn soft" onClick=${() => setGive(true)}><${Icon} name="bolt" size=${20} />${t('quick.giveTask')}</button>` : null}
    </div>
    ${give ? html`<${QuickAssignSheet} day=${day} person=${id} onClose=${() => setGive(false)} />` : null}
    ${view && s.assignments[view] ? html`<${AssignmentSheet} id=${view} onClose=${() => setView(null)} />` : null}
  <//>`;
}
