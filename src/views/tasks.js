import { html, useState } from '../../assets/vendor/htm-preact.js';
import { TimeField } from '../pickers.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, TaskBadge, Segmented, Field, Sheet, IconPicker, ColorPicker, Empty, useSheetControl } from '../ui.js';
import { saveTask, archiveTask, areaName, areaOf } from '../data.js';
import { TASK_ICONS, PALETTE } from '../config.js';
import { hhmm, toMin, dur, taskGoal, weekdayNames, todayYmd, addDays, parseYmd, ymd } from '../time.js';
import { colorStyle } from '../color.js';
import { PRIORITIES, priorityOf } from '../shifts.js';

// the small High / Medium / Low label: always icon + word (never colour alone)
export function PriorityChip({ task }) {
  const p = priorityOf(task);
  return html`<span class=${'chip prio ' + p}><${Icon} name=${PRIORITIES[p].icon} size=${14} />${t('prio.' + p)}</span>`;
}

export function freqText(task) {
  if (task.frequency === 'daily') return t('task.everyDay');
  if (task.frequency === 'monthly') return t('task.monthDay', { n: task.month_day || 1 });
  const names = weekdayNames('short');
  const days = [...(task.weekdays || [])].sort((a, b) => a - b);
  return days.length ? days.map((d) => names[d - 1]).join(', ') : t('task.noDays');
}
export const windowText = (task) => (task.kind === 'room' ? t('task.roomKind') : `${hhmm(task.start_time)}–${hhmm(task.end_time)}`);
export const goalText = (task) => dur(taskGoal(task));

// The supervisor's library of tasks (what can be planned). The day-by-day board is in board.js.
export function LibraryView() {
  const s = useStore();
  const [editing, setEditing] = useState(null); // null | 'new' | task
  const [goals, setGoals] = useState(false);
  const list = Object.values(s.tasks).filter((x) => !x.deleted).sort((a, b) => a.name.localeCompare(b.name));
  const groups = [...s.areas.map((a) => ({ key: a.id, area: a, items: list.filter((x) => x.area_id === a.id) })),
    { key: 'none', area: null, items: list.filter((x) => !x.area_id || !areaOf(x.area_id)) }].filter((g) => g.items.length);

  return html`<div class="stack">
    <p class="page-sub">${t('tasks.sub')}</p>
    <button class="fab float pop" onClick=${() => setEditing('new')} aria-label=${t('tasks.new')}><${Icon} name="plus" size=${26} /></button>
    <button class="btn soft small auto goals-btn" onClick=${() => setGoals(true)}><${Icon} name="alarm" size=${18} />${t('goals.title')}</button>
    ${!list.length ? html`<${Empty} icon="list-check" text=${t('tasks.empty')} />` : null}
    ${groups.map((g) => html`<section key=${g.key} class="rise">
      <h3 class="section-title">${g.area ? html`<span class="title-ic" style=${colorStyle(g.area.color)}><${Icon} name=${g.area.icon} size=${16} /></span>${areaName(g.area)}` : t('tasks.noArea')}
        <span class="count">${g.items.length}</span></h3>
      <div class="list grid">
        ${g.items.map((x) => html`<button class="person task-row" key=${x.id} onClick=${() => setEditing(x)}>
          <${TaskBadge} icon=${x.icon} color=${x.color} size=${50} />
          <span class="person-main">
            <span class="person-name">${x.name}</span>
            <span class="person-mail">${windowText(x)} · ${goalText(x)}</span>
            ${x.kind === 'room' ? null : html`<span class="person-mail">${freqText(x)}</span>`}
            <span class="chips tight-chips"><${PriorityChip} task=${x} />${x.auto ? html`<span class="chip auto-chip"><${Icon} name="bolt" size=${14} />${t('task.autoShort')}</span>` : null}</span>
          </span>
          <${Icon} name="pencil" size=${18} class="chev" />
        </button>`)}
      </div>
    </section>`)}
    ${goals ? html`<${TimeGoals} onClose=${() => setGoals(false)} />` : null}
    ${editing && html`<${TaskEditor} task=${editing === 'new' ? null : editing} onClose=${() => setEditing(null)} />`}
  </div>`;
}

export function TaskEditor({ task, onClose, onSaved }) {
  const s = useStore();
  const ctl = useSheetControl();
  const close = ctl.close;
  const [f, setF] = useState(() => task ? {
    name: task.name, description: task.description || '', icon: task.icon, color: task.color, area_id: task.area_id || null,
    start_time: hhmm(task.start_time), end_time: hhmm(task.end_time), frequency: task.frequency, weekdays: task.weekdays || [],
    steps: (task.steps || []).map((x) => ({ title: x.title || '', description: x.description || '' })),
    goal: task.goal_minutes || '', kind: task.kind || 'task',
    priority: priorityOf(task), auto: !!task.auto, month_day: task.month_day || 1,
  } : {
    name: '', description: '', icon: 'sparkles', color: PALETTE[0], area_id: s.areas[0] ? s.areas[0].id : null,
    start_time: '09:00', end_time: '10:00', frequency: 'daily', weekdays: [1, 2, 3, 4, 5], steps: [], goal: '', kind: 'task', priority: 'medium', auto: false, month_day: 1,
  });
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const up = (patch) => setF((x) => ({ ...x, ...patch }));
  const room = f.kind === 'room';
  const valid = f.name.trim() && (room || (toMin(f.end_time) > toMin(f.start_time) && (f.frequency !== 'weekdays' || f.weekdays.length)));

  // Templates: anything planned before (even tasks that were removed since). Typing a name suggests matching ones.
  const past = (() => {
    const seen = new Set();
    return Object.values(s.tasks).sort((a, b) => (a.deleted ? 1 : 0) - (b.deleted ? 1 : 0) || a.name.localeCompare(b.name))
      .filter((x) => { const k = x.name.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  })();
  const q = f.name.trim().toLowerCase();
  const suggestions = task || !q ? [] : past.filter((x) => x.name.toLowerCase().includes(q) && x.name.toLowerCase() !== q).slice(0, 4);
  const [showAll, setShowAll] = useState(false);
  const useTemplate = (x) => {
    setF({
      name: x.name, description: x.description || '', icon: x.icon, color: x.color, area_id: x.area_id || null,
      start_time: hhmm(x.start_time), end_time: hhmm(x.end_time), frequency: x.frequency, weekdays: x.weekdays || [],
      steps: (x.steps || []).map((st) => ({ title: st.title || '', description: st.description || '' })),
      goal: x.goal_minutes || '', kind: x.kind || 'task',
      priority: priorityOf(x), auto: !!x.auto, month_day: x.month_day || 1,
    });
    setShowAll(false);
  };

  const setStep = (i, patch) => up({ steps: f.steps.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const moveStep = (i, d) => {
    const a = [...f.steps]; const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]]; up({ steps: a });
  };
  const toggleDay = (d) => up({ weekdays: f.weekdays.includes(d) ? f.weekdays.filter((x) => x !== d) : [...f.weekdays, d].sort() });

  async function save(e) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const row = await saveTask({
        ...(task ? { id: task.id } : {}),
        name: f.name.trim(), description: f.description.trim(), icon: f.icon, color: f.color, area_id: f.area_id, kind: f.kind,
        start_time: room ? '08:00' : f.start_time, end_time: room ? '17:00' : f.end_time,
        goal_minutes: Number(f.goal) > 0 ? Math.min(1440, Math.round(Number(f.goal))) : null,
        frequency: room ? 'weekdays' : f.frequency,
        weekdays: room || f.frequency !== 'weekdays' ? [] : f.weekdays,
        priority: f.priority, auto: room ? false : f.auto, month_day: !room && f.frequency === 'monthly' ? f.month_day : null,
        steps: f.steps.map((x) => ({ title: x.title.trim(), description: x.description.trim() })).filter((x) => x.title),
      });
      toast(t('tasks.saved'));
      if (onSaved) onSaved(row);
      close();
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }
  async function remove() {
    if (!sure) { setSure(true); return; }
    setBusy(true);
    try { await archiveTask(task.id, ymd(addDays(parseYmd(todayYmd()), 1))); toast(t('tasks.deleted')); close(); }
    catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }

  const names = weekdayNames('short');
  const goal = toMin(f.end_time) - toMin(f.start_time);

  return html`<${Sheet} title=${task ? t('tasks.edit') : t('tasks.new')} onClose=${onClose} control=${ctl}>
    <form class="stack-form" onSubmit=${save}>
      ${!task && past.length ? html`<div class="field"><span class="field-label">${t('tasks.template')}</span>
        <div class="chips">${(showAll ? past : past.slice(0, 6)).map((x) => html`<button type="button" key=${x.id} class="pick tpl" style=${colorStyle(x.color)} onClick=${() => useTemplate(x)}>
          <${Icon} name=${x.icon} size=${16} />${x.name}</button>`)}
          ${past.length > 6 && !showAll ? html`<button type="button" class="pick ghost" onClick=${() => setShowAll(true)}>${t('tasks.templateMore', { n: past.length - 6 })}</button>` : null}</div>
        <span class="field-hint">${t('tasks.templateHint')}</span></div>` : null}

      <div class="editor-head">
        <${TaskBadge} icon=${f.icon} color=${f.color} size=${64} />
        <${Field} label=${t('task.name')}><input class="input" value=${f.name} required maxlength="80" onInput=${(e) => up({ name: e.target.value })} /><//>
      </div>
      ${suggestions.length ? html`<div class="chips pop suggest"><span class="mini-label">${t('tasks.suggest')}</span>${suggestions.map((x) => html`<button type="button" key=${x.id} class="pick tpl" style=${colorStyle(x.color)} onClick=${() => useTemplate(x)}>
        <${Icon} name=${x.icon} size=${16} />${x.name}</button>`)}</div>` : null}

      <div class="field"><span class="field-label">${t('task.kind')}</span>
        <${Segmented} value=${f.kind} onChange=${(v) => up({ kind: v })} options=${[
          { value: 'task', label: t('task.kindTask'), icon: 'list-check' }, { value: 'room', label: t('task.kindRoom'), icon: 'bed' }]} />
        ${room ? html`<span class="field-hint pop">${t('task.kindRoomHint')}</span>` : null}
      </div>

      <div class="field"><span class="field-label">${t('task.icon')}</span>
        <${IconPicker} value=${f.icon} onChange=${(v) => up({ icon: v })} icons=${TASK_ICONS} color=${f.color} /></div>
      <div class="field"><span class="field-label">${t('task.color')}</span><${ColorPicker} value=${f.color} onChange=${(v) => up({ color: v })} /></div>

      <div class="field"><span class="field-label">${t('task.area')}</span>
        <div class="chips">
          ${s.areas.map((a) => html`<button type="button" key=${a.id} class=${'pick' + (f.area_id === a.id ? ' on' : '')} style=${colorStyle(a.color)}
            onClick=${() => up({ area_id: a.id })}><${Icon} name=${a.icon} size=${16} />${areaName(a)}</button>`)}
          <button type="button" class=${'pick' + (!f.area_id ? ' on' : '')} onClick=${() => up({ area_id: null })}>${t('tasks.noArea')}</button>
        </div></div>

      <${Field} label=${t('task.description')}>
        <textarea class="input area" rows="3" maxlength="1000" value=${f.description} onInput=${(e) => up({ description: e.target.value })}></textarea>
      <//>

      ${room ? null : html`<div class="field"><span class="field-label">${t('task.window')}</span>
        <div class="time-row">
          <${TimeField} value=${f.start_time} label=${t('task.from')} onChange=${(v) => up({ start_time: v })} />
          <span class="muted">–</span>
          <${TimeField} value=${f.end_time} label=${t('task.to')} onChange=${(v) => up({ end_time: v })} />
        </div>
        <span class=${'field-hint' + (goal <= 0 ? ' bad' : '')}>${goal > 0 ? t('task.windowLen', { time: dur(goal) }) : t('task.badWindow')}</span>
      </div>`}

      <div class="field"><span class="field-label">${t('task.goalLabel')}</span>
        <div class="stepper">
          <button type="button" class="mini big" aria-label="-5" onClick=${() => up({ goal: Math.max(0, (Number(f.goal) || Math.max(goal, 0)) - 5) || '' })}>−5</button>
          <label class="stepper-val"><input type="number" inputmode="numeric" min="1" max="1440" value=${f.goal} placeholder=${!room && goal > 0 ? String(goal) : '30'}
            onInput=${(e) => up({ goal: e.target.value === '' ? '' : Math.max(0, Math.min(1440, Number(e.target.value))) })} /><span>min</span></label>
          <button type="button" class="mini big" aria-label="+5" onClick=${() => up({ goal: Math.min(1440, (Number(f.goal) || Math.max(goal, 0)) + 5) })}>+5</button>
        </div>
        <span class="field-hint">${t('task.goalHint')}</span>
      </div>

      <div class="field"><span class="field-label">${t('task.priority')}</span>
        <div class="prio-pick" role="radiogroup" aria-label=${t('task.priority')}>
          ${Object.keys(PRIORITIES).map((p) => html`<button type="button" key=${p} role="radio" aria-checked=${f.priority === p} class=${'prio-opt ' + p + (f.priority === p ? ' on' : '')} onClick=${() => up({ priority: p })}>
            <${Icon} name=${PRIORITIES[p].icon} size=${24} />${t('prio.' + p)}</button>`)}
        </div>
        <span class="field-hint">${t('task.priorityHint')}</span>
      </div>

      ${room ? null : html`<div class="field"><span class="field-label">${t('task.frequency')}</span>
        <${Segmented} value=${f.frequency} onChange=${(v) => up({ frequency: v })} options=${[
          { value: 'daily', label: t('task.everyDay') }, { value: 'weekdays', label: t('task.weekly') }, { value: 'monthly', label: t('task.monthly') }]} />
        ${f.frequency === 'weekdays' ? html`<div class="days pop">
          ${names.map((n, i) => html`<button type="button" key=${i} class=${'day-opt' + (f.weekdays.includes(i + 1) ? ' on' : '')}
            onClick=${() => toggleDay(i + 1)}>${n}</button>`)}
        </div>` : null}
        ${f.frequency === 'monthly' ? html`<div class="pop"><span class="mini-label">${t('task.monthOn')}</span>
          <div class="stepper">
            <button type="button" class="mini big" aria-label="-1" onClick=${() => up({ month_day: Math.max(1, f.month_day - 1) })}>−</button>
            <label class="stepper-val"><input type="number" inputmode="numeric" min="1" max="31" value=${f.month_day}
              onInput=${(e) => up({ month_day: Math.max(1, Math.min(31, Number(e.target.value) || 1)) })} /><span>${t('task.dayOfMonth')}</span></label>
            <button type="button" class="mini big" aria-label="+1" onClick=${() => up({ month_day: Math.min(31, f.month_day + 1) })}>+</button>
          </div>
          ${f.month_day > 28 ? html`<span class="field-hint">${t('task.monthShort')}</span>` : null}
        </div>` : null}
      </div>

      <button type="button" class="switch-row" onClick=${() => up({ auto: !f.auto })}>
        <span><b>${t('task.auto')}</b><br /><span class="muted small-text">${t('task.autoHint')}</span></span>
        <span class=${'switch' + (f.auto ? ' on' : '')} role="switch" aria-checked=${f.auto}><span class="knob"></span></span>
      </button>`}

      <div class="field"><span class="field-label">${t('task.steps')}</span>
        <div class="steps-edit">
          ${f.steps.map((st, i) => html`<div class="step-edit pop" key=${i}>
            <span class="step-n">${i + 1}</span>
            <div class="step-fields">
              <input class="input slim" value=${st.title} maxlength="120" placeholder=${t('task.stepTitle')} onInput=${(e) => setStep(i, { title: e.target.value })} />
              <input class="input slim" value=${st.description} maxlength="300" placeholder=${t('task.stepDesc')} onInput=${(e) => setStep(i, { description: e.target.value })} />
            </div>
            <div class="step-tools">
              <button type="button" class="mini" aria-label="up" disabled=${i === 0} onClick=${() => moveStep(i, -1)}><${Icon} name="caret-up" size=${16} /></button>
              <button type="button" class="mini" aria-label="down" disabled=${i === f.steps.length - 1} onClick=${() => moveStep(i, 1)}><${Icon} name="caret-down" size=${16} /></button>
              <button type="button" class="mini bad" aria-label=${t('common.remove')} onClick=${() => up({ steps: f.steps.filter((_, k) => k !== i) })}><${Icon} name="x" size=${16} /></button>
            </div>
          </div>`)}
          <button type="button" class="btn soft" onClick=${() => up({ steps: [...f.steps, { title: '', description: '' }] })}>
            <${Icon} name="plus" size=${18} />${t('task.addStep')}</button>
        </div>
      </div>

      <button class="btn" type="submit" disabled=${busy || !valid}><${Icon} name="check" size=${20} />${t('team.save')}</button>
      ${task ? html`<button type="button" class=${'btn danger' + (sure ? ' sure' : '')} onClick=${remove} disabled=${busy}>
        <${Icon} name="trash" size=${18} />${sure ? t('tasks.deleteSure') : t('tasks.delete')}</button>` : null}
    </form>
  <//>`;
}

// ---- Supervisor: how long should each task take? (room tasks too: the time for one room) ----
export function TimeGoals({ onClose }) {
  const s = useStore();
  const ctl = useSheetControl();
  const list = Object.values(s.tasks).filter((x) => !x.deleted).sort((a, b) => a.name.localeCompare(b.name));
  const [vals, setVals] = useState(() => Object.fromEntries(list.map((x) => [x.id, taskGoal(x)])));
  const [busy, setBusy] = useState(false);
  const set1 = (id, v) => setVals((x) => ({ ...x, [id]: v === '' ? '' : Math.max(0, Math.min(1440, Number(v))) }));
  const bump = (id, d) => set1(id, Math.max(1, (Number(vals[id]) || 0) + d));
  const changed = list.filter((x) => Number(vals[x.id]) > 0 && Number(vals[x.id]) !== taskGoal(x));
  const n = changed.length;

  async function save() {
    setBusy(true);
    try {
      for (const x of changed) await saveTask({ id: x.id, goal_minutes: Math.round(Number(vals[x.id])) });
      toast(t('goals.saved'));
      ctl.close();
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }
  const stepper = (id) => html`<div class="stepper small">
    <button type="button" class="mini big" aria-label="-5" onClick=${() => bump(id, -5)}>−5</button>
    <label class="stepper-val"><input type="number" inputmode="numeric" min="1" max="1440" value=${vals[id]} onInput=${(e) => set1(id, e.target.value)} /><span>min</span></label>
    <button type="button" class="mini big" aria-label="+5" onClick=${() => bump(id, 5)}>+5</button>
  </div>`;

  return html`<${Sheet} title=${t('goals.title')} onClose=${onClose} control=${ctl}>
    <p class="muted small-text">${t('goals.sub')}</p>
    <div class="list tight">
      ${list.map((x) => html`<div class="goal-row" key=${x.id}><${TaskBadge} icon=${x.icon} color=${x.color} size=${42} />
        <span class="goal-main"><b>${x.name}</b><small>${windowText(x)}</small></span>${stepper(x.id)}</div>`)}
    </div>
    <button class="btn" disabled=${busy || !n} onClick=${save}><${Icon} name="check" size=${20} />${n ? t('goals.saveN', { n }) : t('team.save')}</button>
  <//>`;
}
