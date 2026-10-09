import { html, useState, useEffect } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Avatar, TaskBadge, Segmented, Field, Sheet, PersonLine, Empty, useSheetControl } from '../ui.js';
import { isSupervisor, roleInfo } from '../roles.js';
import { colorStyle } from '../color.js';
import { startAssignment, saveSteps, finishAssignment, reopenAssignment, removeAssignment, editAssignment, planAssignments,
  ensureMonth, areaOf, areaName, activePeople, itemName, loadComments, addComment, removeComment, editRoomRequest, giveTasks, distribute } from '../data.js';
import { api } from '../api.js';
import { hhmm, toMin, fromMin, dur, hasTime, timeText, taskGoal, fmt, parseYmd, ymd, addDays, isoWeekday, appliesOn, monthKey, todayYmd } from '../time.js';
import { DateField, TimeField } from '../pickers.js';
import { TaskEditor, freqText, PriorityChip } from './tasks.js';
import { problem, problemText, priorityOf, PRIORITIES, capacityOf, loadOf, contractLabel, contractOf, shiftOf, dayPlanned, goalOf } from '../shifts.js';
import { DEPARTMENTS, ROLE_ORDER } from '../config.js';
import { TimerSheet, LiveClock } from './timer.js';

const STATUS_ICON = { todo: 'clock', doing: 'hourglass', done: 'circle-check' };

// ---- One line in a list: the task, when, and WHO (picture + name) ----
export function AssignmentRow({ a, onOpen, showPerson, selectable, selected, onToggle, extra }) {
  const s = useStore();
  const tk = s.tasks[a.task_id];
  if (!tk) return null;
  const who = s.profiles[a.assignee];
  const person = a.assignee
    ? (who ? html`<span class="arow-person"><${Avatar} profile=${who} size=${22} ring=${false} /><span class="arow-who">${who.display_name}</span></span>` : null)
    : html`<span class="arow-person waiting"><${Icon} name="help-circle" size=${16} /><span class="arow-who">${t('task.waiting')}</span></span>`;
  const body = html`<${TaskBadge} icon=${tk.icon} color=${tk.color} size=${46} />
    <span class="arow-main">
      <span class="arow-name">${itemName(a)}</span>
      ${showPerson ? person : null}
      <span class="arow-sub"><${PriorityChip} task=${tk} />${a.note ? html`<span class="arow-note">${a.note}</span>` : null}</span>
    </span>
    <span class=${'arow-state ' + a.status}><${Icon} name=${STATUS_ICON[a.status]} size=${20} /></span>`;
  return html`<div class=${'arow-wrap ' + a.status + (selected ? ' selected' : '')} key=${a.id}>
    ${selectable ? html`<button type="button" class=${'room-check' + (selected ? ' on' : '')} aria-pressed=${!!selected} aria-label=${t('task.select')} onClick=${onToggle}><${Icon} name="check" size=${16} /></button>` : null}
    <button class=${'arow ' + a.status + ' prio-' + priorityOf(tk)} onClick=${() => onOpen(a.id)} style=${colorStyle(tk.color)}>${body}</button>
    ${extra || null}
  </div>`;
}

// ---- Task details: do it, tick steps, comment, finish, read the report ----
export function AssignmentSheet({ id, onClose, openTimer }) {
  const s = useStore();
  const a = s.assignments[id];
  const gone = !a || !s.tasks[a.task_id];
  useEffect(() => { if (gone) onClose(); }, [gone]);
  if (gone) return null;
  return html`<${DetailBody} id=${id} onClose=${onClose} openTimer=${openTimer} />`;
}

function DetailBody({ id, onClose, openTimer }) {
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
  const [running, setRunning] = useState(!!openTimer && mine && a.status === 'doing');
  const [editing, setEditing] = useState(false);
  const [giving, setGiving] = useState(false);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const canSee = mine || sup;
  const asked = a.requested_by === me.id && a.kind === 'room'; // Reception asked for this room
  const canEditAsk = asked && a.status !== 'done';
  const canWithdraw = asked && !a.assignee;

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
  const over = report && report.minutes_spent > report.goal_minutes;
  const goal = taskGoal(tk, a);
  const del = () => {
    if (!sure) { setSure(true); return; }
    run(async () => { await removeAssignment(id); ctl.close(); }, t('act.removed'));
  };

  return html`<${Sheet} title=${itemName(a)} kicker=${fmt(date, { weekday: 'long', day: 'numeric', month: 'long' })} onClose=${onClose} control=${ctl}>
    <div class="detail-top" style=${colorStyle(tk.color)}>
      <${TaskBadge} icon=${tk.icon} color=${tk.color} size=${72} />
      <div class="detail-chips">
        <${PriorityChip} task=${tk} />
        <span class=${'chip status-chip ' + a.status}><${Icon} name=${STATUS_ICON[a.status]} size=${15} />${t('status.' + a.status)}</span>
        ${area ? html`<span class="chip tint" style=${colorStyle(area.color)}><${Icon} name=${area.icon} size=${15} />${areaName(area)}</span>` : null}
        ${hasTime(a) ? html`<span class="chip"><${Icon} name="clock" size=${15} />${timeText(a)}</span>` : null}
        <span class="chip"><${Icon} name="alarm" size=${15} />${t('task.goal', { time: dur(goal) })}</span>
      </div>
    </div>

    ${a.status === 'doing' ? html`<button type="button" class=${'timer-card' + (mine ? '' : ' ro')} onClick=${() => mine && setRunning(true)}>
      <span class="timer-card-ic"><${Icon} name="hourglass" size=${22} /></span>
      <span class="timer-card-main"><b>${t('timer.inProgress')}</b><small>${t('timer.goal', { time: dur(goal) })}</small></span>
      <${LiveClock} startedAt=${a.started_at} />
    </button>` : null}

    ${who ? html`<div class="card slim"><${PersonLine} profile=${who} size=${44} /></div>`
      : html`<div class="card slim waiting-card"><${Icon} name="help-circle" size=${24} /><span>${t('task.waitingLong')}</span></div>`}

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

    ${canSee && a.assignee ? html`<${Comments} a=${a} />` : null}

    ${finishing && mine ? html`<${FinishPanel} a=${a} tk=${tk} report=${report} onDone=${() => setFinishing(false)} />` : null}
    ${running && mine && a.status === 'doing' ? html`<${TimerSheet} title=${itemName(a)} icon=${tk.icon} color=${tk.color} startedAt=${a.started_at} goal=${goal}
      steps=${steps} stepsDone=${a.steps_done} onStep=${toggleStep} finishLabel=${t('act.finish')}
      onFinish=${() => { setRunning(false); setFinishing(true); }} onClose=${() => setRunning(false)} />` : null}

    ${mine && !finishing ? html`<div class="stack-form">
      ${a.status === 'todo' ? html`<button class="btn" disabled=${busy} onClick=${() => run(async () => { await startAssignment(id); setRunning(true); })}>
        <${Icon} name="arrow-badge-right" size=${20} />${t('act.start')}</button>` : null}
      ${a.status === 'doing' ? html`<button class="btn soft" onClick=${() => setRunning(true)}><${Icon} name="hourglass" size=${20} />${t('timer.open')}</button>` : null}
      ${a.status !== 'done' ? html`<button class=${'btn' + (a.status === 'todo' ? ' soft' : '')} disabled=${busy} onClick=${() => setFinishing(true)}>
        <${Icon} name="circle-check" size=${20} />${t('act.finish')}</button>` : null}
      ${a.status === 'done' ? html`<button class="btn soft" onClick=${() => setFinishing(true)}><${Icon} name="pencil" size=${18} />${t('act.editReport')}</button>` : null}
      ${a.status !== 'todo' ? html`<button class="btn ghost" disabled=${busy} onClick=${() => run(() => reopenAssignment(id), t('act.reopened'))}>${t('act.reopen')}</button>` : null}
    </div>` : null}

    ${sup && !finishing ? html`<div class="stack-form sup-actions">
      ${!mine && a.status === 'done' ? html`<button class="btn ghost" disabled=${busy} onClick=${() => run(() => reopenAssignment(id), t('act.reopened'))}>${t('act.reopen')}</button>` : null}
      ${a.status !== 'done' ? html`<button class="btn soft" onClick=${() => setGiving(true)}><${Icon} name="user" size=${18} />${a.assignee ? t('task.giveElse') : t('task.give')}</button>` : null}
      <div class="row-btns">
        <button class="btn soft" onClick=${() => setEditing(true)}><${Icon} name="pencil" size=${18} />${t('act.edit')}</button>
        <button class=${'btn danger' + (sure ? ' sure' : '')} disabled=${busy} onClick=${del}>
          <${Icon} name="trash" size=${18} />${sure ? t('act.removeSure') : t('act.remove')}</button>
      </div>
    </div>` : null}

    ${!sup && (canEditAsk || canWithdraw) ? html`<div class="stack-form sup-actions"><div class="row-btns">
      ${canEditAsk ? html`<button class="btn soft" onClick=${() => setEditing(true)}><${Icon} name="pencil" size=${18} />${t('act.edit')}</button>` : null}
      ${canWithdraw ? html`<button class=${'btn danger' + (sure ? ' sure' : '')} disabled=${busy} onClick=${del}><${Icon} name="trash" size=${18} />${sure ? t('act.removeSure') : t('act.remove')}</button>` : null}
    </div></div>` : null}

    ${editing && sup ? html`<${AssignSheet} edit=${a} onClose=${() => setEditing(false)} />` : null}
    ${editing && !sup ? html`<${EditRequest} a=${a} onClose=${() => setEditing(false)} />` : null}
    ${giving ? html`<${GiveSheet} ids=${[id]} onClose=${() => setGiving(false)} onDone=${() => {}} />` : null}
  <//>`;
}

// ---- Comments on a task: the person doing it and the supervisors talk here ----
function Comments({ a }) {
  const s = useStore();
  const me = s.profile;
  const list = s.comments[a.id];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadComments(a.id).catch(() => {}); }, [a.id]);
  async function send(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try { await addComment(a.id, body); setText(''); } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }
  return html`<div class="field comments"><span class="field-label">${t('comment.title')}${list && list.length ? html`<span class="count">${list.length}</span>` : null}</span>
    ${list && list.length ? html`<div class="comment-list">${list.map((c) => {
      const au = s.profiles[c.author];
      return html`<div class=${'comment' + (c.author === me.id ? ' mine' : '')} key=${c.id}>
        <${Avatar} profile=${au} size=${30} ring=${false} />
        <div class="comment-body"><div class="comment-head"><b>${au ? (c.author === me.id ? t('team.you') : au.display_name.split(' ')[0]) : t('chat.former')}</b>
          <small>${new Date(c.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
          ${c.author === me.id || isSupervisor(me) ? html`<button type="button" class="comment-del" aria-label=${t('act.remove')} onClick=${() => removeComment(a.id, c.id).catch((ex) => toast(friendlyError(ex), 'bad'))}><${Icon} name="x" size=${14} /></button>` : null}</div>
          <p>${c.body}</p></div>
      </div>`;
    })}</div>` : html`<p class="muted small-text">${t('comment.none')}</p>`}
    <form class="comment-form" onSubmit=${send}>
      <input class="input" type="text" maxlength="1000" placeholder=${t('comment.placeholder')} value=${text} onInput=${(e) => setText(e.target.value)} />
      <button class="send" type="submit" disabled=${!text.trim() || busy} aria-label=${t('comment.send')}><${Icon} name="send" size=${20} /></button>
    </form>
  </div>`;
}

// ---- Reception: change a room you asked for ----
function EditRequest({ a, onClose }) {
  const ctl = useSheetControl();
  const [room, setRoom] = useState(a.title);
  const [date, setDate] = useState(a.day);
  const [note, setNote] = useState(a.note || '');
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    if (!room.trim() || busy) return;
    setBusy(true);
    try { await editRoomRequest(a.id, room.trim().slice(0, 40), date, note.trim()); toast(t('rooms.saved')); ctl.close(); }
    catch (ex) { toast(friendlyError(ex), 'bad'); setBusy(false); }
  }
  return html`<${Sheet} title=${t('rooms.editTitle')} onClose=${onClose} control=${ctl}>
    <form class="stack-form" onSubmit=${save}>
      <${Field} label=${t('rooms.roomName')}><input class="input" type="text" maxlength="40" required value=${room} onInput=${(e) => setRoom(e.target.value)} /><//>
      <${Field} label=${t('rooms.day')}><${DateField} value=${date} label=${t('rooms.day')} onChange=${setDate} /><//>
      <${Field} label=${t('rooms.note')}><input class="input" type="text" maxlength="300" value=${note} onInput=${(e) => setNote(e.target.value)} /><//>
      <button class="btn" type="submit" disabled=${!room.trim() || busy}><${Icon} name="check" size=${18} />${t('rooms.save')}</button>
    </form>
  <//>`;
}

// ---- Supervisor: give tasks to one or more people (or take them back) ----
export function GiveSheet({ ids, onClose, onDone }) {
  const s = useStore();
  const ctl = useSheetControl();
  const [people, setPeople] = useState([]);
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const crew = activePeople().filter((p) => roleInfo(p.role).department === 'custodian')
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.display_name.localeCompare(b.display_name));
  const items = ids.map((i) => s.assignments[i]).filter(Boolean);
  const day = items[0] ? items[0].day : todayYmd();
  const load = (id) => Object.values(s.assignments).filter((a) => a.day === day && a.assignee === id && a.status !== 'done').length;
  const anyAssigned = items.some((a) => a.assignee);
  const toggle = (id) => setPeople((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  // how many of the chosen tasks this person cannot take (no shift that day / time does not fit / over their capacity)
  const issues = (pid) => items.filter((a) => problem(pid, a.day, a, a.id)).length;
  const firstIssue = (pid) => { const a = items.find((x) => problem(pid, x.day, x, x.id)); return a ? problem(pid, a.day, a, a.id) : null; };

  async function go(list) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await giveTasks(ids, list, share && list.length > 1 && ids.length > 1);
      if (!list.length) toast(t('task.takenBack'));
      else if (r.skipped) toast(t('task.givenSome', { n: r.placed, m: r.skipped }), r.placed ? 'ok' : 'bad');
      else toast(t('task.given', { n: r.placed }));
      if (r.placed || !list.length) { onDone(); ctl.close(); } else setBusy(false);
    } catch (ex) { toast(friendlyError(ex), 'bad'); setBusy(false); }
  }
  return html`<${Sheet} title=${t('task.giveTitle')} kicker=${t('rooms.selected', { n: ids.length })} onClose=${onClose} control=${ctl}>
    <p class="muted small-text">${t('task.giveHint')}</p>
    <div class="list tight">
      ${crew.map((p) => {
        const bad = issues(p.id);
        const fi = firstIssue(p.id);
        const sh = shiftOf(p.id, day);
        return html`<button type="button" class=${'person pick-person' + (people.includes(p.id) ? ' on' : '') + (bad === items.length && bad ? ' blocked' : '')} key=${p.id} aria-pressed=${people.includes(p.id)} disabled=${bad === items.length && bad > 0 && !people.includes(p.id)} onClick=${() => toggle(p.id)}>
        <span class="give-col"><${PersonLine} profile=${p} size=${44} /><span class="give-extra">
          ${dayPlanned(day) ? html`<span class="muted small-text">${sh ? `${hhmm(sh.start_time)}–${hhmm(sh.end_time)} · ${contractLabel(contractOf(p.id))} · ${t('shift.load', { load: dur(loadOf(p.id, day)), cap: dur(capacityOf(p.id, day)) })}` : t('shift.off')}</span>` : load(p.id) ? html`<span class="count">${t('rooms.load', { n: load(p.id) })}</span>` : null}
          ${bad ? html`<span class="pp-note"><${Icon} name="alert-triangle" size=${12} />${bad === items.length ? problemText(fi) : t('task.cannotN', { n: bad })}</span>` : null}</span></span>
        <span class=${'room-check' + (people.includes(p.id) ? ' on' : '')}><${Icon} name="check" size=${16} /></span>
      </button>`; })}
      ${!crew.length ? html`<p class="muted">${t('rooms.noCrew')}</p>` : null}
    </div>
    ${people.length > 1 && ids.length > 1 ? html`<${Segmented} value=${share ? 'share' : 'each'} onChange=${(v) => setShare(v === 'share')} options=${[
      { value: 'each', label: t('task.eachDoes') }, { value: 'share', label: t('task.shareOut') }]} />` : null}
    <button class="btn" disabled=${busy || !people.length} onClick=${() => go(people)}><${Icon} name="check" size=${20} />${t('task.giveGo', { n: people.length })}</button>
    ${anyAssigned ? html`<button class="btn soft" disabled=${busy} onClick=${() => go([])}>${t('rooms.takeBack')}</button>` : null}
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

// ---- Supervisor: plan a task for one or more people (or edit one planned task). Room tasks take room numbers. ----
export function AssignSheet({ day, edit, onClose, presetTask }) {
  const s = useStore();
  const ctl = useSheetControl();
  const close = ctl.close;
  const initialDay = edit ? edit.day : day || todayYmd();
  const [taskId, setTaskId] = useState(edit ? edit.task_id : presetTask || null);
  const [people, setPeople] = useState(edit ? (edit.assignee ? [edit.assignee] : []) : []);
  const [date, setDate] = useState(initialDay);
  const [timed, setTimed] = useState(edit ? hasTime(edit) : true);
  const [start, setStart] = useState(edit && hasTime(edit) ? hhmm(edit.start_time) : '09:00');
  const [end, setEnd] = useState(edit && hasTime(edit) ? hhmm(edit.end_time) : '10:00');
  const [note, setNote] = useState(edit ? edit.note : '');
  const [title, setTitle] = useState(edit ? edit.title || '' : '');
  const [roomsText, setRoomsText] = useState('');
  const [repeat, setRepeat] = useState('day');
  const [touched, setTouched] = useState(!!edit);
  const [busy, setBusy] = useState(false);
  const [newTask, setNewTask] = useState(false);

  const d = parseYmd(date || initialDay);
  const tasks = Object.values(s.tasks).filter((x) => !x.deleted);
  const normal = tasks.filter((x) => x.kind !== 'room');
  const roomTasks = tasks.filter((x) => x.kind === 'room').sort((a, b) => a.name.localeCompare(b.name));
  const due = normal.filter((x) => appliesOn(x, d)).sort((a, b) => a.start_time.localeCompare(b.start_time));
  const others = normal.filter((x) => !appliesOn(x, d)).sort((a, b) => a.name.localeCompare(b.name));
  const team = activePeople();
  const tk = taskId ? s.tasks[taskId] : null;
  const isRoom = !!tk && tk.kind === 'room';
  const rooms = isRoom && !edit ? [...new Set(roomsText.split(/[,;\n]/).map((x) => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 40) : [];

  // "Same as last time": who did this task the last time it was planned
  const lastTime = (() => {
    if (!taskId || isRoom || edit) return [];
    const rows = Object.values(s.assignments).filter((x) => x.task_id === taskId && x.assignee && x.day < date).sort((a, b) => b.day.localeCompare(a.day));
    if (!rows.length) return [];
    return [...new Set(rows.filter((x) => x.day === rows[0].day).map((x) => x.assignee))].filter((id) => s.profiles[id] && s.profiles[id].active !== false);
  })();

  const pickTask = (x) => {
    setTaskId(x.id);
    if (x.kind === 'room') { if (!touched) setTimed(false); return; }
    if (!touched) {
      setTimed(true);
      setStart(hhmm(x.start_time));
      setEnd(x.goal_minutes ? fromMin(Math.min(1439, toMin(x.start_time) + x.goal_minutes)) : hhmm(x.end_time));
    }
  };
  useEffect(() => { if (presetTask && s.tasks[presetTask]) pickTask(s.tasks[presetTask]); }, []);
  const togglePerson = (id) => {
    if (edit) { setPeople((p) => (p.includes(id) ? [] : [id])); return; }
    setPeople((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  const timeOk = !timed || toMin(end) > toMin(start);
  // can this person take it? (works that day, the time fits their shift, and still has room in their day: 4 h or 8 h contract)
  const cand = { task_id: taskId, start_time: timed && timeOk ? start : null, end_time: timed && timeOk ? end : null };
  const probOf = (pid) => (taskId && roleInfo(s.profiles[pid].role).department === 'custodian' ? problem(pid, date || initialDay, cand, edit ? edit.id : undefined) : null);
  const valid = taskId && date && timeOk && (isRoom ? (edit ? title.trim() : rooms.length) : people.length);

  async function save(e) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const times = timed ? { start_time: start, end_time: end } : { start_time: null, end_time: null };
      if (edit) {
        await ensureMonth(monthKey(parseYmd(date)));
        const who = people[0] || null;
        if (who && who !== edit.assignee && probOf(who)) { toast(problemText(probOf(who)), 'bad'); setBusy(false); return; }
        const patch = { day: date, ...times, note: note.trim() };
        if (edit.kind === 'room') patch.title = title.trim().slice(0, 40);
        if (who !== edit.assignee) { patch.assignee = who; patch.status = 'todo'; patch.started_at = null; patch.steps_done = []; }
        await editAssignment(edit.id, patch);
        toast(t('assign.updated'));
        close();
      } else {
        const days = [d];
        if (repeat === 'week' && !isRoom) for (let x = addDays(d, 1); isoWeekday(x) !== 1; x = addDays(x, 1)) if (appliesOn(tk, x)) days.push(x);
        await Promise.all([...new Set(days.map(monthKey))].map(ensureMonth));
        const base = { task_id: taskId, kind: isRoom ? 'room' : 'task', note: note.trim(), ...times };
        const rows = [];
        let again = 0;
        let skipped = 0, left = 0;
        const okPeople = people.filter((p) => !probOf(p));
        skipped = people.length - okPeople.length;
        if (isRoom) {
          // every room number is its own task. With people chosen the rooms are shared out between them (most room left first)
          rooms.forEach((r) => rows.push({ ...base, assignee: null, day: ymd(d), title: r }));
        } else {
          const have = new Map(Object.values(s.assignments).filter((x) => x.task_id === taskId && x.assignee).map((x) => [x.assignee + x.day, x]));
          const remind = [];
          days.forEach((x) => okPeople.forEach((p) => {
            const old = have.get(p + ymd(x));
            if (old) { if (old.status !== 'done') remind.push(old.id); again += 1; } // already planned: remind them instead of silently skipping
            else rows.push({ ...base, assignee: p, day: ymd(x), title: '' });
          }));
          for (const id of remind) await api.renotifyAssignment(id).catch(() => {});
        }
        let made = [];
        if (rows.length) made = await planAssignments(rows);
        if (isRoom && okPeople.length && made.length) left = (await distribute(made.map((x) => x.id), okPeople)).left;
        const extra = (again ? ' · ' + t('assign.reminded', { n: again }) : '') + (skipped ? ' · ' + t('assign.skippedRules', { n: skipped }) : '') + (left ? ' · ' + t('assign.leftWaiting', { n: left }) : '');
        toast(rows.length ? t('assign.planned', { n: rows.length }) + extra : again ? t('assign.reminded', { n: again }) + extra : skipped ? t('assign.skippedRules', { n: skipped }) : t('assign.nothing'), rows.length || again ? 'ok' : 'bad');
        if (rows.length || again) close();
      }
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }

  const taskCard = (x) => html`<button type="button" key=${x.id} class=${'task-pick' + (taskId === x.id ? ' on' : '')} style=${colorStyle(x.color)}
    onClick=${() => pickTask(x)} disabled=${!!edit && taskId !== x.id}>
    <${TaskBadge} icon=${x.icon} color=${x.color} size=${40} />
    <span><b>${x.name}</b><small>${x.kind === 'room' ? t('task.roomKind') : hhmm(x.start_time) + '–' + hhmm(x.end_time)}</small></span>
  </button>`;

  return html`<${Sheet} title=${edit ? t('assign.editTitle') : t('assign.title')} onClose=${onClose} control=${ctl}>
    <form class="stack-form" onSubmit=${save}>
      <div class="field"><span class="field-label">${t('assign.task')}</span>
        ${!tasks.length ? html`<p class="muted small-text">${t('assign.noTasks')}</p>` : null}
        ${roomTasks.length ? html`<span class="mini-label">${t('assign.roomTasks')}</span><div class="task-grid">${roomTasks.map(taskCard)}</div>` : null}
        ${due.length ? html`<span class="mini-label">${t('assign.dueThatDay')}</span>` : null}
        <div class="task-grid">${due.map(taskCard)}</div>
        ${others.length ? html`<span class="mini-label">${t('assign.otherTasks')}</span>` : null}
        <div class="task-grid">${others.map(taskCard)}</div>
        ${!edit ? html`<button type="button" class="btn soft" onClick=${() => setNewTask(true)}><${Icon} name="plus" size=${18} />${t('tasks.new')}</button>` : null}
      </div>

      ${isRoom && !edit ? html`<${Field} label=${t('rooms.list')} hint=${t('rooms.listHint')}>
          <textarea class="input area" rows="2" maxlength="400" value=${roomsText} placeholder="4, 7, 12" onInput=${(e) => setRoomsText(e.target.value)}></textarea>
        <//>
        ${rooms.length ? html`<div class="chips pop">${rooms.map((r) => html`<span class="chip role" key=${r} style="--c:var(--mint);--soft:var(--brand-soft);--ink:var(--brand-ink)">${r}</span>`)}</div>` : null}` : null}
      ${isRoom && edit ? html`<${Field} label=${t('rooms.roomName')}><input class="input" type="text" maxlength="40" required value=${title} onInput=${(e) => setTitle(e.target.value)} /><//>` : null}

      <div class="field"><span class="field-label">${t('assign.who')}${isRoom ? html`<span class="muted"> · ${t('assign.whoOptional')}</span>` : null}</span>
        ${lastTime.length ? html`<button type="button" class="pick" onClick=${() => setPeople(lastTime)}><${Icon} name="clock" size=${16} />${t('assign.sameAsLast')}</button>` : null}
        ${DEPARTMENTS.map((dep) => {
          const list = team.filter((p) => roleInfo(p.role).department === dep).sort((x, y) => ROLE_ORDER.indexOf(x.role) - ROLE_ORDER.indexOf(y.role));
          if (!list.length) return null;
          return html`<div key=${dep}><span class="mini-label">${t('dept.' + dep)}</span>
            <div class="people-pick">${list.map((p) => {
              const pr = probOf(p.id);
              return html`<button type="button" key=${p.id} class=${'pp' + (people.includes(p.id) ? ' on' : '') + (pr ? ' blocked' : '')}
                style=${`--c:${roleInfo(p.role).color}`} disabled=${!!pr && !people.includes(p.id)} onClick=${() => togglePerson(p.id)}>
                <${Avatar} profile=${p} size=${30} ring=${false} /><span>${p.display_name.split(' ')[0]}</span>
                ${pr ? html`<small class="pp-note"><${Icon} name="alert-triangle" size=${12} />${problemText(pr)}</small>` : null}
                <${Icon} name="check" size=${14} class="pp-tick" /></button>`;
            })}</div></div>`;
        })}
        ${people.length > 1 && isRoom ? html`<span class="field-hint pop">${t('assign.shareRooms')}</span>` : people.length > 1 ? html`<span class="field-hint pop">${t('assign.manyHint')}</span>` : null}
        ${taskId && dayPlanned(date || initialDay) ? html`<span class="field-hint">${t('assign.shiftRules')}</span>` : null}
      </div>

      <${Field} label=${t('assign.date')}><${DateField} value=${date} label=${t('assign.date')} onChange=${setDate} /><//>

      <div class="field"><span class="field-label">${t('task.window')}</span>
        <${Segmented} value=${timed ? 'at' : 'any'} onChange=${(v) => { setTouched(true); setTimed(v === 'at'); }} options=${[
          { value: 'any', label: t('assign.anytime') }, { value: 'at', label: t('assign.atTime') }]} />
        ${timed ? html`<div class="time-row pop">
          <${TimeField} value=${start} label=${t('task.from')} onChange=${(v) => { setTouched(true); setStart(v); }} />
          <span class="muted">–</span>
          <${TimeField} value=${end} label=${t('task.to')} onChange=${(v) => { setTouched(true); setEnd(v); }} />
        </div>` : null}
        ${timed && !timeOk ? html`<span class="field-hint bad">${t('task.badWindow')}</span>` : null}
      </div>

      ${!edit && !isRoom ? html`<div class="field"><span class="field-label">${t('assign.repeat')}</span>
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
