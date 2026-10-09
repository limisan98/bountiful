import { html, useState } from '../../assets/vendor/htm-preact.js';
import { useStore } from '../store.js';
import { t, currentLocale } from '../i18n.js';
import { Icon, RoleChip, Avatar, Empty, TaskBadge } from '../ui.js';
import { isSupervisor, departmentOf } from '../roles.js';
import { colorStyle } from '../color.js';
import { assignmentsOn, inCrew, itemName } from '../data.js';
import { todayYmd, addDays, ymd, parseYmd, dur, taskGoal, fmt, timeKey } from '../time.js';
import { AssignmentRow, AssignmentSheet } from './assign.js';

const TILES = [
  { route: 'calendar', icon: 'calendar-event', color: '#86E3CE', title: 'nav.calendar', sub: 'tile.calendar' },
  { route: 'tasks', icon: 'list-check', color: '#D0E6A5', title: 'nav.tasks', sub: 'tile.tasks' },
  { route: 'reports', icon: 'clipboard-data', color: '#86E3CE', title: 'nav.reports', sub: 'tile.reports', only: 'sup' },
  { route: 'meetings', icon: 'calendar-month', color: '#FA897B', title: 'nav.meetings', sub: 'tile.meetings' },
  { route: 'chat', icon: 'messages', color: '#CCABD8', title: 'nav.chat', sub: 'tile.chat', only: 'crew' },
  { route: 'team', icon: 'id', color: '#FA897B', title: 'nav.team', sub: 'tile.team' },
  { route: 'shifts', icon: 'clock', color: '#FFDD94', title: 'nav.shifts', sub: 'tile.shifts', soon: true },
];

export function HomeView() {
  const s = useStore();
  const me = s.profile;
  const sup = isSupervisor(me);
  const [open, setOpen] = useState(null);
  const now = new Date();
  const loc = currentLocale();
  const today = todayYmd();
  const rec = departmentOf(me) === 'reception';
  const isMine = (a) => (rec ? a.requested_by === me.id : a.assignee === me.id);
  const todays = assignmentsOn(today).filter((a) => s.tasks[a.task_id]);
  const mine = todays.filter(isMine);
  const done = mine.filter((a) => a.status === 'done').length;
  const planned = mine.reduce((n, a) => n + taskGoal(s.tasks[a.task_id], a), 0);
  // everything of mine that is still open from the last two weeks, and everything planned for the next week
  const all = Object.values(s.assignments).filter((a) => s.tasks[a.task_id] && isMine(a));
  const back = ymd(addDays(now, -14));
  const late = all.filter((a) => a.day < today && a.day >= back && a.status !== 'done')
    .sort((x, y) => x.day.localeCompare(y.day) || timeKey(x) - timeKey(y));
  const next = [1, 2, 3, 4, 5, 6, 7].map((n) => ymd(addDays(now, n)))
    .map((k) => ({ k, list: all.filter((a) => a.day === k).sort((x, y) => timeKey(x) - timeKey(y)) })).filter((x) => x.list.length);

  // supervisors: how the team is doing today, and the latest finished tasks
  const byPerson = {};
  todays.forEach((a) => { if (!a.assignee) return; const r = (byPerson[a.assignee] = byPerson[a.assignee] || { n: 0, done: 0, min: 0 }); r.n += 1; r.min += taskGoal(s.tasks[a.task_id], a); if (a.status === 'done') r.done += 1; });
  const since = ymd(addDays(now, -3));
  const updates = sup ? Object.values(s.reports)
    .map((r) => ({ r, a: s.assignments[r.assignment_id] })).filter((x) => x.a && x.a.day >= since && s.tasks[x.a.task_id])
    .sort((x, y) => y.r.completed_at.localeCompare(x.r.completed_at)).slice(0, 6) : [];

  const tiles = TILES.filter((x) => !x.only || (x.only === 'crew' ? inCrew(me) : sup));

  return html`<div class="stack home">
    <section class="hero rise">
      <span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span>
      <p class="hero-kicker">${t('home.today')}</p>
      <h2 class="hero-title">${now.toLocaleDateString(loc, { weekday: 'long' })}</h2>
      <p class="hero-date">${now.toLocaleDateString(loc, { day: 'numeric', month: 'long' })}</p>
      <${RoleChip} role=${me.role} />
    </section>

    <div class="home-cols">
      <div class="col">
    <section class="rise">
      <h3 class="section-title">${t('home.tasks')}${mine.length ? html`<span class="count">${done}/${mine.length}</span>` : null}</h3>
      ${mine.length ? html`<div class="progress-card">
        <div class="progress"><i style=${`width:${Math.round((done / mine.length) * 100)}%`}></i></div>
        <span>${done === mine.length ? t('home.allDone') : t('home.progress', { done, total: mine.length })} · ${dur(planned)}</span>
      </div>
      <div class="list tight">${mine.map((a) => html`<${AssignmentRow} key=${a.id} a=${a} onOpen=${setOpen} showPerson=${rec} />`)}</div>`
        : html`<${Empty} icon="clipboard-check" text=${t('home.tasksEmpty')} />`}
    </section>

    ${late.length ? html`<section class="rise">
      <h3 class="section-title">${t('home.late')}<span class="count">${late.length}</span></h3>
      <div>${late.map((a) => html`<div class="coming" key=${a.id}><span class="mini-label">${fmt(parseYmd(a.day), { weekday: 'long', day: 'numeric', month: 'short' })}</span>
        <${AssignmentRow} a=${a} onOpen=${setOpen} showPerson=${rec} /></div>`)}</div>
    </section>` : null}

      </div>
      <div class="col">
    ${next.length ? html`<section class="rise">
      <h3 class="section-title">${t('home.coming')}</h3>
      ${next.map((x) => html`<div class="coming" key=${x.k}><span class="mini-label">${fmt(parseYmd(x.k), { weekday: 'long', day: 'numeric', month: 'short' })}</span>
        <div class="list tight">${x.list.map((a) => html`<${AssignmentRow} key=${a.id} a=${a} onOpen=${setOpen} showPerson=${rec} />`)}</div></div>`)}
    </section>` : null}

    ${sup ? html`<section class="rise">
      <h3 class="section-title">${t('home.team')}</h3>
      ${Object.keys(byPerson).length ? html`<div class="team-today">
        ${Object.entries(byPerson).map(([id, v]) => html`<div class="tt-row" key=${id}>
          <${Avatar} profile=${s.profiles[id]} size=${42} />
          <div class="tt-main"><b>${s.profiles[id] ? s.profiles[id].display_name : ''}</b>
            <div class="progress slim"><i style=${`width:${Math.round((v.done / v.n) * 100)}%`}></i></div></div>
          <span class="tt-num">${v.done}/${v.n}<small>${dur(v.min)}</small></span>
        </div>`)}
      </div>` : html`<${Empty} icon="calendar-event" text=${t('home.teamEmpty')} />`}
    </section>

    ${updates.length ? html`<section class="rise">
      <h3 class="section-title">${t('home.updates')}</h3>
      <div class="list tight">
        ${updates.map(({ r, a }) => {
          const tk = s.tasks[a.task_id], who = s.profiles[a.assignee];
          const over = r.minutes_spent > r.goal_minutes;
          return html`<button class="update" key=${a.id} onClick=${() => setOpen(a.id)} style=${colorStyle(tk.color)}>
            <${TaskBadge} icon=${tk.icon} color=${tk.color} size=${40} />
            <span class="update-main">
              <b>${itemName(a)}</b>
              <small>${who ? who.display_name.split(' ')[0] : ''} · ${dur(r.minutes_spent)} <em class=${over ? 'over' : ''}>/ ${dur(r.goal_minutes)}</em></small>
              ${r.delay_reason || r.comment ? html`<span class="update-note">${r.delay_reason || r.comment}</span>` : null}
            </span>
          </button>`;
        })}
      </div></section>` : null}` : null}

      </div>
    </div>

    <section class="rise">
      <h3 class="section-title">${t('home.quick')}</h3>
      <div class="tiles">
        ${tiles.map((x) => html`<div class="tile-wrap" key=${x.route}>
          <a class="tile" href=${'#/' + x.route} style=${`--c:${x.color}`}>
            <span class="tile-icon"><${Icon} name=${x.icon} size=${26} /></span>
            <span class="tile-title">${t(x.title)}</span>
            <span class="tile-sub">${t(x.sub)}</span>
            ${x.soon ? html`<span class="tile-soon">${t('soon.badge')}</span>` : null}
          </a>
          <span class="tile-go"><${Icon} name="caret-right" size=${16} /></span>
        </div>`)}
      </div>
    </section>

    ${open ? html`<${AssignmentSheet} id=${open} onClose=${() => setOpen(null)} />` : null}
  </div>`;
}
