import { html, useState, useEffect } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Avatar, TaskBadge, Segmented, Field, Sheet, PersonLine, Empty, useSheetControl } from '../ui.js';
import { isSupervisor, roleInfo } from '../roles.js';
import { colorStyle } from '../color.js';
import { startAssignment, saveSteps, finishAssignment, reopenAssignment, removeAssignment, editAssignment, planAssignments,
  ensureMonth, areaOf, areaName, activePeople } from '../data.js';
import { hhmm, toMin, fromMin, dur, goalMin, taskGoal, fmt, parseYmd, ymd, addDays, isoWeekday, appliesOn, monthKey, todayYmd } from '../time.js';
import { DateField, TimeField } from '../pickers.js';
import { TaskEditor, freqText } from './tasks.js';
import { DEPARTMENTS, ROLE_ORDER } from '../config.js';
import { TimerSheet, LiveClock } from './timer.js';

const STATUS_ICON = { todo: 'clock', doing: 'hourglass', done: 'circle-check' };

// ---- One line in a list: "Clean the temple · 10:00–14:00" ----
export function AssignmentRow({ a, onOpen, showPerson }) {
  const s = useStore();
  const tk = s.tasks[a.task_id];
  if (!tk) return null;
  const who = s.profiles[a.assignee];
  return html`<button class=${'arow ' + a.status} key=${a.id} onClick=${() => onOpen(a.id)} style=${colorStyle(tk.color)}>
    <${TaskBadge} icon=${tk.icon} color=${tk.color} size=${46} />
    <span class="arow-main">
      <span class="arow-name">${tk.name}</span>
      <span class="arow-sub"><${Icon} name="clock" size=${13} />${hhmm(a.start_time)}–${hhmm(a.end_time)}
        ${showPerson && who ? html`<span class="dot-sep">·</span><${Avatar} profile=${who} size=${18} ring=${false} /><span class="arow-who">${who.display_name.split(' ')[0]}</span>` : null}</span>
    </span>
    <span class=${'arow-state ' + a.status}><${Icon} name=${STATUS_ICON[a.status]} size=${20} /></span>
  </button>`;
}

// ---- Task details: do it, tick steps, finish, read the report ----
export function AssignmentSheet({ id, onClose }) {
  const s = useStore();
  const a = s.assignments[id];
  const gone = !a || !s.tasks[a.task_id];
  useEffect(() => { if (gone) onClose(); }, [gone]);
  if (gone) return null;
  return html`<${DetailBody} id=${id} onClose=${onClose} />`;
}

function DetailBody({ id, onClose }) {
  const ctl = useSheetControl();
  const s = useStore();
  const a = s.assignments[id];
  const tk = s.tasks[a.task_id];
  const me = s.profile;
  const sup = isSupervisor(me);
  const mine = a.assignee === me.id;
  const who = s.profiles[a.assignee];
  const report = s.reports[id];
  const area = areaOf(tk.area_id);
  const steps = tk.steps || [];
  const [finishing, setFinishing] = useState(false);
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const canSee = mine || sup;

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) toast(ok); } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  };
  const toggleStep = (i) => {
    if (!mine || a.status === 'done') return;
    const cur = a.steps_done || [];
    const next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort((x, y) => x - y);
    saveSteps(id, next).catch((ex) => toast(friendlyError(ex), 'bad'));
  };
  const date = parseYmd(a.day);
  const statusTxt = t('status.' + a.status);
  const over = report && report.minutes_spent > report.goal_minutes;
  const goal = taskGoal(tk, a);

  return html`<${Sheet} title=${tk.name} kicker=${fmt(date, { weekday: 'long', day: 'numeric', month: 'long' })} onClose=${onClose} control=${ctl}>
    <div class="detail-top" style=${colorStyle(tk.color)}>
      <${TaskBadge} icon=${tk.icon} color=${tk.color} size=${72} />
      <div class="detail-chips">
        <span class=${'chip status-chip ' + a.status}><${Icon} name=${STATUS_ICON[a.status]} size=${15} />${statusTxt}</span>
        ${area ? html`<span class="chip tint" style=${colorStyle(area.color)}><${Icon} name=${area.icon} size=${15} />${areaName(area)}</span>` : null}
        <span class="chip"><${Icon} name="clock" size=${15} />${hhmm(a.start_time)}–${hhmm(a.end_time)}</span>
        <span class="chip"><${Icon} name="alarm" size=${15} />${t('task.goal', { time: dur(goal) })}</span>
      </div>
    </div>

    ${a.status === 'doing' ? html`<button type="button" class=${'timer-card' + (mine ? '' : ' ro')} onClick=${() => mine && setRunning(true)}>
      <span class="timer-card-ic"><${Icon} name="hourglass" size=${22} /></span>
      <span class="timer-card-main"><b>${t('timer.inProgress')}</b><small>${t('timer.goal', { time: dur(goal) })}</small></span>
      <${LiveClock} startedAt=${a.started_at} />
    </button>` : null}

    ${who ? html`<div class="card slim"><${PersonLine} profile=${who} size=${44} /></div>` : null}

    ${a.note ? html`<div class="note-card"><${Icon} name="message-circle" size=${20} /><p>${a.note}</p></div>` : null}
    ${tk.description ? html`<div class="field"><span class="field-label">${t('task.description')}</span><p class="body-text">${tk.description}</p></div>` : null}

    ${steps.length ? html`<div class="field"><span class="field-label">${t('task.steps')}<span class="count">${(a.steps_done || []).filter((i) => i < steps.length).length}/${steps.length}</span></span>
      <div class="checklist">
        ${steps.map((st, i) => {
          const on = (a.steps_done || []).includes(i);
          const can = mine && a.status !== 'done';
          return html`<button type="button" key=${i} class=${'check-row' + (on ? ' on' : '') + (can ? '' : ' ro')} onClick=${() => toggleStep(i)}>
            <span class="check-box"><${Icon} name="check" size=${16} /></span>
            <span class="check-text"><b>${st.title}</b>${st.description ? html`<span>${st.description}</span>` : null}</span>
          </button>`;
        })}
      </div></div>` : null}

    ${a.status === 'done' && canSee && report ? html`<div class="report">
      <div class=${'report-top' + (over ? ' over' : '')}>
        <${Icon} name=${over ? 'hourglass' : 'circle-check'} size=${22} />
        <div><b>${t('report.time', { time: dur(report.minutes_spent) })}</b><span>${t('task.goal', { time: dur(report.goal_minutes) })}</span></div>
      </div>
      ${report.delay_reason ? html`<div class="report-block"><span class="field-label">${t('report.delay')}</span><p>${report.delay_reason}</p></div>` : null}
      ${report.comment ? html`<div class="report-block"><span class="field-label">${t('report.comment')}</span><p>${report.comment}</p></div>` : null}
    </div>` : null}
    ${a.status === 'done' && !canSee ? html`<p class="muted center small-text">${t('status.doneBy', { name: who ? who.display_name : '' })}</p>` : null}

    ${finishing && mine ? html`<${FinishPanel} a=${a} tk=${tk} report=${report} onDone=${() => setFinishing(false)} />` : null}
    ${running && mine && a.status === 'doing' ? html`<${TimerSheet} title=${tk.name} icon=${tk.icon} color=${tk.color} startedAt=${a.started_at} goal=${goal}
      steps=${steps} stepsDone=${a.steps_done} onStep=${toggleStep} finishLabel=${t('act.finish')}
      onFinish=${() => { setRunning(false); setFinishing(true); }} onClose=${() => setRunning(false)} />` : null}

    ${mine && !finishing ? html`<div class="stack-form">
      ${a.status === 'todo' ? html`<button class="btn" disabled=${busy} onClick=${() => run(async () => { await startAssignment(id); setRunning(true); })}>
        <${Icon} name="arrow-badge-right" size=${20} />${t('act.start')}</button>` : null}
      ${a.status !== 'done' ? html`<button class=${'btn' + (a.status === 'todo' ? ' soft' : '')} disabled=${busy} onClick=${() => setFinishing(true)}>
        <${Icon} name="circle-check" size=${20} />${t('act.finish')}</button>` : null}
      ${a.status === 'done' ? html`<button class="btn soft" onClick=${() => setFinishing(true)}><${Icon} name="pencil" size=${18} />${t('act.editReport')}</button>` : null}
      ${a.status !== 'todo' ? html`<button class="btn ghost" disabled=${busy} onClick=${() => run(() => reopenAssignment(id), t('act.reopened'))}>${t('act.reopen')}</button>` : null}
    </div>` : null}

    ${sup && !finishing ? html`<div class="stack-form sup-actions">
      ${!mine && a.status === 'done' ? html`<button class="btn ghost" disabled=${busy} onClick=${() => run(() => reopenAssignment(id), t('act.reopened'))}>${t('act.reopen')}</button>` : null}
      <div class="row-btns">
        <button class="btn soft" onClick=${() => setEditing(true)}><${Icon} name="pencil" size=${18} />${t('act.edit')}</button>
        <button class=${'btn danger' + (sure ? ' sure' : '')} disabled=${busy}
          onClick=${() => { if (!sure) { setSure(true); return; } run(async () => { await removeAssignment(id); }, t('act.removed')); }}>
          <${Icon} name="trash" size=${18} />${sure ? t('act.removeSure') : t('act.remove')}</button>
      </div>
    </div>` : null}

    ${editing ? html`<${AssignSheet} edit=${a} onClose=${() => setEditing(false)} />` : null}
  <//>`;
}

// ---- "Finish": how long did it take? (and the kind "what made it longer?" question) ----
function FinishPanel({ a, tk, report, onDone }) {
  const goal = taskGoal(tk, a);
  const start = () => {
    if (report) return report.minutes_spent;
    if (a.started_at) { const m = Math.round((Date.now() - Date.parse(a.started_at)) / 60000); if (m >= 1) return Math.min(m, 1440); }
    return goal;
  };
  const [minutes, setMinutes] = useState(start);
  const [comment, setComment] = useState(report ? report.comment : '');
  const [delay, setDelay] = useState(report ? report.delay_reason : '');
  const [busy, setBusy] = useState(false);
  const over = minutes > goal;
  const bump = (d) => setMinutes((m) => Math.max(0, Math.min(1440, (Number(m) || 0) + d)));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await finishAssignment(a.id, Number(minutes) || 0, comment.trim(), over ? delay.trim() : '');
      toast(t('finish.done'));
      onDone();
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }

  return html`<form class="finish pop" onSubmit=${submit}>
    <h3>${t('finish.title')}</h3>
    <div class="field"><span class="field-label">${t('finish.howLong')}</span>
      <div class="stepper">
        <button type="button" class="mini big" aria-label="-5" onClick=${() => bump(-5)}>−5</button>
        <label class="stepper-val"><input type="number" inputmode="numeric" min="0" max="1440" value=${minutes}
          onInput=${(e) => setMinutes(e.target.value === '' ? '' : Math.max(0, Math.min(1440, Number(e.target.value))))} /><span>min</span></label>
        <button type="button" class="mini big" aria-label="+5" onClick=${() => bump(5)}>+5</button>
      </div>
      <span class="field-hint">${t('task.goal', { time: dur(goal) })}${minutes !== '' ? ' · ' + dur(Number(minutes) || 0) : ''}</span>
    </div>
    ${over ? html`<div class="kind pop"><${Icon} name="mood-smile" size=${22} />
      <div><p>${t('finish.overText')}</p>
        <textarea class="input area" rows="3" maxlength="1000" placeholder=${t('finish.overPlaceholder')} value=${delay}
          onInput=${(e) => setDelay(e.target.value)}></textarea></div></div>` : html`<p class="muted small-text pop">${t('finish.onTime')}</p>`}
    <${Field} label=${t('finish.comment')}>
      <textarea class="input area" rows="3" maxlength="1000" placeholder=${t('finish.commentPlaceholder')} value=${comment}
        onInput=${(e) => setComment(e.target.value)}></textarea>
    <//>
    <div class="row-btns">
      <button type="button" class="btn soft" onClick=${onDone}>${t('common.cancel')}</button>
      <button class="btn" type="submit" disabled=${busy}><${Icon} name="check" size=${20} />${report ? t('act.saveReport') : t('act.markDone')}</button>
    </div>
  </form>`;
}

// ---- Supervisor: plan a task for one or more people (or edit one planned task) ----
export function AssignSheet({ day, edit, onClose }) {
  const s = useStore();
  const ctl = useSheetControl();
  const close = ctl.close;
  const initialDay = edit ? edit.day : day || todayYmd();
  const [taskId, setTaskId] = useState(edit ? edit.task_id : null);
  const [people, setPeople] = useState(edit ? [edit.assignee] : []);
  const [date, setDate] = useState(initialDay);
  const [start, setStart] = useState(edit ? hhmm(edit.start_time) : '09:00');
  const [end, setEnd] = useState(edit ? hhmm(edit.end_time) : '10:00');
  const [note, setNote] = useState(edit ? edit.note : '');
  const [repeat, setRepeat] = useState('day');
  const [touched, setTouched] = useState(!!edit);
  const [busy, setBusy] = useState(false);
  const [newTask, setNewTask] = useState(false);

  const d = parseYmd(date || initialDay);
  const tasks = Object.values(s.tasks).filter((x) => !x.deleted);
  const due = tasks.filter((x) => appliesOn(x, d)).sort((a, b) => a.start_time.localeCompare(b.start_time));
  const others = tasks.filter((x) => !appliesOn(x, d)).sort((a, b) => a.name.localeCompare(b.name));
  const team = activePeople();

  const pickTask = (tk) => {
    setTaskId(tk.id);
    if (!touched) {
      setStart(hhmm(tk.start_time));
      setEnd(tk.goal_minutes ? fromMin(Math.min(1439, toMin(tk.start_time) + tk.goal_minutes)) : hhmm(tk.end_time));
    }
  };
  const togglePerson = (id) => {
    if (edit) { setPeople([id]); return; }
    setPeople((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  const valid = taskId && people.length && date && toMin(end) > toMin(start);

  async function save(e) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      if (edit) {
        await ensureMonth(monthKey(parseYmd(date)));
        await editAssignment(edit.id, { assignee: people[0], day: date, start_time: start, end_time: end, note: note.trim() });
        toast(t('assign.updated'));
        close();
      } else {
        const tk = s.tasks[taskId];
        const days = [d];
        if (repeat === 'week') for (let x = addDays(d, 1); isoWeekday(x) !== 1; x = addDays(x, 1)) if (appliesOn(tk, x)) days.push(x);
        const keys = [...new Set(days.map(monthKey))];
        await Promise.all(keys.map(ensureMonth));
        const have = new Set(Object.values(s.assignments).filter((x) => x.task_id === taskId).map((x) => x.assignee + x.day));
        const rows = [];
        let skipped = 0;
        days.forEach((x) => people.forEach((p) => {
          if (have.has(p + ymd(x))) skipped += 1;
          else rows.push({ task_id: taskId, assignee: p, day: ymd(x), start_time: start, end_time: end, note: note.trim() });
        }));
        if (rows.length) await planAssignments(rows);
        toast(rows.length ? t('assign.planned', { n: rows.length }) + (skipped ? ' · ' + t('assign.skipped', { n: skipped }) : '') : t('assign.nothing'));
        if (rows.length) close();
      }
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }

  const taskCard = (tk) => html`<button type="button" key=${tk.id} class=${'task-pick' + (taskId === tk.id ? ' on' : '')} style=${colorStyle(tk.color)}
    onClick=${() => pickTask(tk)} disabled=${!!edit && taskId !== tk.id}>
    <${TaskBadge} icon=${tk.icon} color=${tk.color} size=${40} />
    <span><b>${tk.name}</b><small>${hhmm(tk.start_time)}–${hhmm(tk.end_time)}</small></span>
  </button>`;

  return html`<${Sheet} title=${edit ? t('assign.editTitle') : t('assign.title')} onClose=${onClose} control=${ctl}>
    <form class="stack-form" onSubmit=${save}>
      <div class="field"><span class="field-label">${t('assign.task')}</span>
        ${!tasks.length ? html`<p class="muted small-text">${t('assign.noTasks')}</p>` : null}
        ${due.length ? html`<span class="mini-label">${t('assign.dueThatDay')}</span>` : null}
        <div class="task-grid">${due.map(taskCard)}</div>
        ${others.length ? html`<span class="mini-label">${t('assign.otherTasks')}</span>` : null}
        <div class="task-grid">${others.map(taskCard)}</div>
        ${!edit ? html`<button type="button" class="btn soft" onClick=${() => setNewTask(true)}><${Icon} name="plus" size=${18} />${t('tasks.new')}</button>` : null}
      </div>

      <div class="field"><span class="field-label">${t('assign.who')}</span>
        ${DEPARTMENTS.map((dep) => {
          const list = team.filter((p) => roleInfo(p.role).department === dep).sort((x, y) => ROLE_ORDER.indexOf(x.role) - ROLE_ORDER.indexOf(y.role));
          if (!list.length) return null;
          return html`<div key=${dep}><span class="mini-label">${t('dept.' + dep)}</span>
            <div class="people-pick">${list.map((p) => html`<button type="button" key=${p.id} class=${'pp' + (people.includes(p.id) ? ' on' : '')}
              style=${`--c:${roleInfo(p.role).color}`} onClick=${() => togglePerson(p.id)}>
              <${Avatar} profile=${p} size=${30} ring=${false} /><span>${p.display_name.split(' ')[0]}</span>
              <${Icon} name="check" size=${14} class="pp-tick" /></button>`)}</div></div>`;
        })}
      </div>

      <div class="grid2">
        <${Field} label=${t('assign.date')}><${DateField} value=${date} label=${t('assign.date')} onChange=${setDate} /><//>
        <div class="field"><span class="field-label">${t('task.window')}</span>
          <div class="time-row">
            <${TimeField} value=${start} label=${t('task.from')} onChange=${(v) => { setTouched(true); setStart(v); }} />
            <span class="muted">–</span>
            <${TimeField} value=${end} label=${t('task.to')} onChange=${(v) => { setTouched(true); setEnd(v); }} />
          </div></div>
      </div>

      ${!edit ? html`<div class="field"><span class="field-label">${t('assign.repeat')}</span>
        <${Segmented} value=${repeat} onChange=${setRepeat} options=${[
          { value: 'day', label: t('assign.thisDay') }, { value: 'week', label: t('assign.restOfWeek') }]} />
        ${repeat === 'week' && taskId ? html`<span class="field-hint pop">${t('assign.weekHint', { days: freqText(s.tasks[taskId]) })}</span>` : null}</div>` : null}

      <${Field} label=${t('assign.note')} hint=${t('assign.noteHint')}>
        <textarea class="input area" rows="2" maxlength="500" value=${note} onInput=${(e) => setNote(e.target.value)}></textarea>
      <//>

      <button class="btn" type="submit" disabled=${busy || !valid}><${Icon} name="check" size=${20} />${edit ? t('team.save') : t('assign.save')}</button>
    </form>
    ${newTask ? html`<${TaskEditor} task=${null} onClose=${() => setNewTask(false)} onSaved=${(row) => pickTask(row)} />` : null}
  <//>`;
}
