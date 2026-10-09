import { html, useState, useEffect } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Avatar, Segmented, Sheet, Empty, useSheetControl } from '../ui.js';
import { isSupervisor } from '../roles.js';
import { assignmentsOn, areaOf, areaName, itemName, ensureMonth, setShiftCell, copyShiftWeek, setContract, autoAllocate } from '../data.js';
import { ymd, parseYmd, addDays, startOfWeek, monthKey, todayYmd, fmt, hhmm, toMin, dur, weekdayNames, isoWeekday, timeKey, fmtTimeOfDay } from '../time.js';
import { AssignmentSheet } from './assign.js';
import { QuickAssignSheet } from './quick.js';
import { ImportSheet } from './shiftimport.js';
import { BLOCKS, shiftList, shiftOf, planOf, dayPlanned, contractOf, capacityOf, loadOf, goalOf, currentBlock, shiftName, crewPeople, contractLabel, problem } from '../shifts.js';

const BLOCK_ICON = { '07:00': 'sun-high', '08:00': 'sun', '14:00': 'sunset', '18:30': 'moon' };
const STATUS_ICON = { todo: 'clock', doing: 'hourglass', done: 'circle-check' };
const range = (s) => `${hhmm(s.start_time)}–${hhmm(s.end_time)}`;

// Shifts: who is on duty right now (by shift block), and the plan for the week (supervisors edit it).
export function ShiftsView() {
  const s = useStore();
  const sup = isSupervisor(s.profile);
  const [tab, setTab] = useState('now');
  return html`<div class="stack shifts-page">
    <div class="page-head"><div><h2 class="page-title">${t('nav.shifts')}</h2><p class="page-sub">${t(sup ? 'shift.subSup' : 'shift.sub')}</p></div></div>
    <${Segmented} value=${tab} onChange=${setTab} options=${[
      { value: 'now', label: t('shift.tabNow'), icon: 'clock' }, { value: 'plan', label: t('shift.tabPlan'), icon: 'calendar-week' }]} />
    ${tab === 'now' ? html`<${OnDuty} sup=${sup} goPlan=${() => setTab('plan')} />` : html`<${WeekPlan} sup=${sup} />`}
  </div>`;
}

// ---------------------------------------------------------------- on duty now
function OnDuty({ sup, goPlan }) {
  const s = useStore();
  const [block, setBlock] = useState(currentBlock());
  const [now, setNow] = useState(new Date());
  const [busy, setBusy] = useState(false);
  const today = todayYmd();
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(i); }, []);
  useEffect(() => { ensureMonth(monthKey(new Date())).catch(() => {}); }, []);

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const planned = dayPlanned(today);
  const all = crewPeople().map((p) => ({ p, sh: shiftOf(p.id, today) })).filter((x) => x.sh);
  const onDutyNow = all.filter((x) => toMin(x.sh.start_time) <= nowMin && nowMin < toMin(x.sh.end_time));
  const list = (block === 'all' ? all : all.filter((x) => x.sh.block === block))
    .sort((a, b) => toMin(a.sh.start_time) - toMin(b.sh.start_time) || a.p.display_name.localeCompare(b.p.display_name));
  const waiting = assignmentsOn(today).filter((a) => !a.assignee && a.status !== 'done' && s.tasks[a.task_id]);

  async function give() {
    setBusy(true);
    try {
      const n = await autoAllocate(today);
      toast(n ? t('shift.allocated', { n }) : t('shift.allocatedNone'), n ? 'ok' : 'bad');
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }

  return html`<div class="stack">
    <div class="duty-now" role="status">
      <span class="duty-dot"></span>
      <div><b>${t('shift.nowOn', { n: onDutyNow.length })}</b>
        <span class="muted">${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${fmt(now, { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
    </div>

    <div class="field"><span class="field-label">${t('shift.block')}</span>
      <div class="block-chips" role="group" aria-label=${t('shift.block')}>
        <button type="button" class=${'block-chip' + (block === 'all' ? ' on' : '')} aria-pressed=${block === 'all'} onClick=${() => setBlock('all')}>${t('shift.all')}</button>
        ${BLOCKS.map((b) => html`<button type="button" key=${b} class=${'block-chip' + (block === b ? ' on' : '')} aria-pressed=${block === b} onClick=${() => setBlock(b)}>
          <${Icon} name=${BLOCK_ICON[b]} size=${20} />${b}</button>`)}
      </div>
    </div>

    ${!planned ? html`<div class="card slim note-soft"><${Icon} name="info-circle" size=${24} /><span>${t('shift.notPlanned')}</span></div>
      ${sup ? html`<button class="btn" onClick=${goPlan}><${Icon} name="calendar-week" size=${22} />${t('shift.planNow')}</button>` : null}` : null}

    ${planned && !list.length ? html`<${Empty} icon="clock" text=${t('shift.nobody')} />` : null}

    <div class="list">
      ${list.map(({ p, sh }) => html`<${DutyCard} key=${p.id} p=${p} sh=${sh} day=${today} now=${now} sup=${sup} />`)}
    </div>

    ${sup && planned && waiting.length ? html`<div class="card waiting-give">
      <p><b>${t('shift.waitingN', { n: waiting.length })}</b><br /><span class="muted">${t('shift.waitingHint')}</span></p>
      <button class="btn" disabled=${busy} onClick=${give}><${Icon} name="bolt" size=${22} />${t('shift.giveOut')}</button>
    </div>` : null}
  </div>`;
}

// One person's progress card: shift, status, a bar of finished tasks, and (tap to open) every task of the day.
export function DutyCard({ p, sh, day, now, sup }) {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const [give, setGive] = useState(false);
  const [view, setView] = useState(null); // assignment id shown in the details sheet
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const start = toMin(sh.start_time), end = toMin(sh.end_time), len = end - start;
  const state = nowMin >= end ? 'done' : nowMin >= start ? 'now' : 'soon';
  const elapsed = Math.max(0, Math.min(len, nowMin - start));
  const mine = assignmentsOn(day).filter((a) => a.assignee === p.id && s.tasks[a.task_id])
    .sort((x, y) => timeKey(x) - timeKey(y) || itemName(x).localeCompare(itemName(y)));
  const finished = mine.filter((a) => a.status === 'done').length;
  const pct = mine.length ? Math.round((finished / mine.length) * 100) : 0;
  const status = state === 'now' ? t('shift.onDuty') : state === 'soon' ? t('shift.startsIn', { time: dur(start - nowMin) }) : t('shift.ended');
  const sub = `${t('shift.elapsed', { done: dur(elapsed), total: dur(len) })} · ${mine.length ? t('shift.tasksDone', { done: finished, total: mine.length }) : t('shift.noTasks')}`;
  const panel = 'duty-tasks-' + p.id;

  return html`<article class=${'duty-card st-' + state + (open ? ' open' : '')}>
    <button type="button" class="duty-head" aria-expanded=${open} aria-controls=${panel} onClick=${() => setOpen(!open)}>
      <${Avatar} profile=${p} size=${60} />
      <span class="duty-main">
        <span class="duty-name"><span class="duty-title">${p.display_name}</span><span class="contract-chip">${contractLabel(contractOf(p.id))}</span></span>
        <span class="duty-shift"><${Icon} name=${BLOCK_ICON[sh.block]} size=${18} />${shiftName(sh)} · <b>${range(sh)}</b></span>
        <span class=${'duty-state st-' + state}>${status}</span>
        <span class="duty-progress">
          <span class="load-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${pct} aria-label=${t('shift.pct', { n: pct })}><i style=${`width:${pct}%`}></i></span>
          <b>${pct}%</b>
        </span>
        <span class="duty-load">${sub}</span>
      </span>
      <span class="duty-caret" aria-hidden="true"><${Icon} name="chevron-down" size=${22} /></span>
    </button>
    ${open ? html`<div class="duty-tasks" id=${panel}>
      <h4>${t('shift.breakdown')}</h4>
      ${mine.length ? html`<ul>${mine.map((a) => html`<${DutyTask} key=${a.id} a=${a} now=${now} onOpen=${() => setView(a.id)} />`)}</ul>`
        : html`<p class="muted">${t('shift.noTasksYet')}</p>`}
    </div>` : null}
    ${sup && state !== 'done' ? html`<div class="duty-act"><button type="button" class="btn small soft" onClick=${() => setGive(true)}><${Icon} name="bolt" size=${18} />${t('quick.giveTask')}</button></div>` : null}
    ${give ? html`<${QuickAssignSheet} day=${day} person=${p.id} onClose=${() => setGive(false)} />` : null}
    ${view && s.assignments[view] ? html`<${AssignmentSheet} id=${view} onClose=${() => setView(null)} />` : null}
  </article>`;
}

function DutyTask({ a, now, onOpen }) {
  const s = useStore();
  const tk = s.tasks[a.task_id];
  const area = areaOf(tk.area_id);
  const report = s.reports[a.id];
  const goal = goalOf(a);
  const running = a.status === 'doing' && a.started_at ? Math.max(0, Math.round((now.getTime() - Date.parse(a.started_at)) / 60000)) : null;
  const actual = report ? report.minutes_spent : running;
  const slow = actual !== null && actual > goal;
  const doneAt = a.completed_at || (report && report.completed_at);
  return html`<li><button type="button" class=${'duty-task ' + a.status} onClick=${onOpen}>
    <span class=${'arow-state ' + a.status}><${Icon} name=${STATUS_ICON[a.status]} size=${20} /></span>
    <span class="dt-main">
      <b>${itemName(a)}</b>
      <span class="dt-sub">${area ? areaName(area) + ' · ' : ''}${t('shift.estimated', { time: dur(goal) })} · <span class=${slow ? 'slow' : ''}>${actual !== null ? t('shift.actual', { time: dur(actual) }) : t('shift.actualNone')}</span></span>
    </span>
    <span class=${'chip status-chip ' + a.status}>${t('status.' + a.status)}${a.status === 'done' && doneAt ? ' · ' + fmtTimeOfDay(doneAt) : ''}</span>
  </button></li>`;
}

// ---------------------------------------------------------------- week plan
function WeekPlan({ sup }) {
  const s = useStore();
  const [cursor, setCursor] = useState(() => startOfWeek(new Date()));
  const [pick, setPick] = useState(null);        // { person, day }
  const [contract, setContractFor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const days = Array.from({ length: 7 }, (_, i) => addDays(cursor, i));
  const names = weekdayNames('short');
  const today = todayYmd();
  const people = crewPeople();

  useEffect(() => {
    new Set([monthKey(days[0]), monthKey(days[6])]).forEach((k) => ensureMonth(k).catch((e) => toast(friendlyError(e), 'bad')));
  }, [ymd(cursor)]);

  async function copy() {
    setBusy(true);
    try {
      const n = await copyShiftWeek(addDays(cursor, -7));
      toast(n ? t('shift.copied', { n }) : t('shift.copiedNone'), n ? 'ok' : 'bad');
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }

  return html`<div class="stack">
    <div class="cal-head">
      <h3 class="cal-title" key=${ymd(cursor)}>${fmt(days[0], { day: 'numeric', month: 'short' })} – ${fmt(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}</h3>
      <div class="cal-nav">
        <button class="icon-btn big" aria-label=${t('shift.prevWeek')} onClick=${() => setCursor(addDays(cursor, -7))}><${Icon} name="caret-left" size=${22} /></button>
        <button class="icon-btn big" aria-label=${t('shift.nextWeek')} onClick=${() => setCursor(addDays(cursor, 7))}><${Icon} name="caret-right" size=${22} /></button>
      </div>
    </div>
    ${sup ? html`<div class="chips"><button class="pick" disabled=${busy} onClick=${copy}><${Icon} name="copy" size=${18} />${t('shift.copyWeek')}</button>
      <button class="pick" onClick=${() => setImporting(true)}><${Icon} name="arrow-badge-down" size=${18} />${t('imp.button')}</button></div>
      <p class="field-hint">${t('shift.tapHint')}</p>` : null}

    <section class="shift-legend" aria-label=${t('shift.legend')}>
      ${shiftList().map((x) => html`<span class=${'legend-item b' + x.block.replace(':', '')} key=${x.id}><i></i>${shiftName(x)} <b>${range(x)}</b>${x.weekdays.length < 7 ? html`<em>${x.weekdays.map((d) => names[d - 1]).join(' ')}</em>` : null}</span>`)}
    </section>

    <div class="list">
      ${people.map((p) => html`<article class="plan-card" key=${p.id}>
        <header>
          <${Avatar} profile=${p} size=${48} />
          <h3>${p.display_name}</h3>
          ${sup ? html`<button type="button" class="contract-chip tap" aria-label=${t('shift.contract')} onClick=${() => setContractFor(p.id)}>${contractLabel(contractOf(p.id))}<${Icon} name="pencil" size=${14} /></button>`
            : html`<span class="contract-chip">${contractLabel(contractOf(p.id))}</span>`}
        </header>
        <div class="plan-days">
          ${days.map((d, i) => {
            const k = ymd(d);
            const sh = shiftOf(p.id, k);
            const over = sh && k >= today && loadOf(p.id, k) > capacityOf(p.id, k);
            const cell = html`<span class="pd-name">${names[i]}</span><span class="pd-num">${d.getDate()}</span>
              <span class="pd-shift">${sh ? hhmm(sh.start_time) : '–'}</span>${over ? html`<span class="pd-over" title=${t('shift.over')}>!</span>` : null}`;
            const cls = 'plan-day' + (sh ? ' has b' + sh.block.replace(':', '') : '') + (k === today ? ' today' : '') + (over ? ' over' : '');
            const label = `${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}: ${sh ? shiftName(sh) + ' ' + range(sh) : t('shift.off')}`;
            return sup ? html`<button type="button" key=${k} class=${cls} aria-label=${label} onClick=${() => setPick({ person: p.id, day: k })}>${cell}</button>`
              : html`<div key=${k} class=${cls} role="img" aria-label=${label}>${cell}</div>`;
          })}
        </div>
      </article>`)}
      ${!people.length ? html`<${Empty} icon="user" text=${t('shift.noCrew')} />` : null}
    </div>

    ${importing ? html`<${ImportSheet} onClose=${() => setImporting(false)} />` : null}
    ${pick ? html`<${ShiftPicker} person=${pick.person} day=${pick.day} onClose=${() => setPick(null)} />` : null}
    ${contract ? html`<${ContractSheet} person=${contract} onClose=${() => setContractFor(null)} />` : null}
  </div>`;
}

// ---- choose the shift of one person on one day ----
function ShiftPicker({ person, day, onClose }) {
  const s = useStore();
  const ctl = useSheetControl();
  const [busy, setBusy] = useState(false);
  const p = s.profiles[person];
  const d = parseYmd(day);
  const minutes = contractOf(person);
  const options = shiftList().filter((x) => (x.kind === 'part') === (minutes === 240) && x.weekdays.includes(isoWeekday(d)));
  const current = planOf(person, day);
  const mine = assignmentsOn(day).filter((a) => a.assignee === person && s.tasks[a.task_id]);
  const load = loadOf(person, day);

  async function choose(id) {
    setBusy(true);
    try { await setShiftCell(person, day, id); ctl.close(); } catch (ex) { toast(friendlyError(ex), 'bad'); setBusy(false); }
  }
  // would this shift hold the tasks the person already has that day?
  const fits = (x) => load <= Math.min(minutes, x.capacity_minutes) && mine.every((a) => {
    if (!a.start_time || !a.end_time) return true;
    const ov = Math.min(toMin(a.end_time), toMin(x.end_time)) - Math.max(toMin(a.start_time), toMin(x.start_time));
    return ov >= Math.min(goalOf(a), toMin(a.end_time) - toMin(a.start_time));
  });

  return html`<${Sheet} title=${p ? p.display_name : ''} kicker=${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })} onClose=${onClose} control=${ctl}>
    <p class="muted">${t('shift.pickHint', { hours: contractLabel(minutes) })}</p>
    <div class="list">
      ${options.map((x) => html`<button type="button" key=${x.id} class=${'shift-opt b' + x.block.replace(':', '') + (current && current.shift_id === x.id ? ' on' : '')} disabled=${busy} onClick=${() => choose(x.id)}>
        <span class="shift-opt-ic"><${Icon} name=${BLOCK_ICON[x.block]} size=${28} /></span>
        <span class="shift-opt-main"><b>${shiftName(x)}</b><span>${range(x)} · ${dur(Math.min(minutes, x.capacity_minutes))}</span>
          ${mine.length && !fits(x) ? html`<span class="warn"><${Icon} name="alert-triangle" size=${16} />${t('shift.wontFit')}</span>` : null}</span>
        ${current && current.shift_id === x.id ? html`<${Icon} name="circle-check" size=${26} />` : null}
      </button>`)}
      <button type="button" class=${'shift-opt off' + (!current ? ' on' : '')} disabled=${busy} onClick=${() => choose(null)}>
        <span class="shift-opt-ic"><${Icon} name="moon" size=${28} /></span>
        <span class="shift-opt-main"><b>${t('shift.off')}</b><span>${t('shift.offHint')}</span>${mine.length ? html`<span class="warn"><${Icon} name="alert-triangle" size=${16} />${t('shift.hasTasks', { n: mine.length })}</span>` : null}</span>
        ${!current ? html`<${Icon} name="circle-check" size=${26} />` : null}
      </button>
    </div>
  <//>`;
}

// ---- 4-hour or 8-hour contract ----
function ContractSheet({ person, onClose }) {
  const s = useStore();
  const ctl = useSheetControl();
  const [busy, setBusy] = useState(false);
  const p = s.profiles[person];
  const cur = contractOf(person);
  async function save(minutes) {
    if (minutes === cur) { ctl.close(); return; }
    setBusy(true);
    try { await setContract(person, minutes); toast(t('shift.contractSaved')); ctl.close(); } catch (ex) { toast(friendlyError(ex), 'bad'); setBusy(false); }
  }
  return html`<${Sheet} title=${t('shift.contract')} kicker=${p ? p.display_name : ''} onClose=${onClose} control=${ctl}>
    <div class="list">
      ${[[240, '4h', t('shift.contract4')], [480, '8h', t('shift.contract8')]].map(([m, lab, text]) => html`<button type="button" key=${m} class=${'shift-opt' + (cur === m ? ' on' : '')} disabled=${busy} onClick=${() => save(m)}>
        <span class="shift-opt-ic big">${lab}</span>
        <span class="shift-opt-main"><b>${t('shift.contractHours', { h: m / 60 })}</b><span>${text}</span></span>
        ${cur === m ? html`<${Icon} name="circle-check" size=${26} />` : null}
      </button>`)}
    </div>
    <p class="muted small-text">${t('shift.contractNote')}</p>
  <//>`;
}
