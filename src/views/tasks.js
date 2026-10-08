import { html, useState } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, TaskBadge, Segmented, Field, Sheet, IconPicker, ColorPicker, Empty, useSheetControl } from '../ui.js';
import { saveTask, archiveTask, areaName, areaOf } from '../data.js';
import { TASK_ICONS, PALETTE } from '../config.js';
import { hhmm, toMin, dur, weekdayNames, todayYmd, addDays, parseYmd, ymd } from '../time.js';
import { colorStyle } from '../color.js';

export function freqText(task) {
  if (task.frequency === 'daily') return t('task.everyDay');
  const names = weekdayNames('short');
  const days = [...(task.weekdays || [])].sort((a, b) => a - b);
  return days.length ? days.map((d) => names[d - 1]).join(', ') : t('task.noDays');
}
export const windowText = (task) => `${hhmm(task.start_time)}–${hhmm(task.end_time)}`;
export const goalText = (task) => dur(toMin(task.end_time) - toMin(task.start_time));

export function TasksView() {
  const s = useStore();
  const [editing, setEditing] = useState(null); // null | 'new' | task
  const list = Object.values(s.tasks).filter((x) => !x.deleted).sort((a, b) => a.name.localeCompare(b.name));
  const groups = [...s.areas.map((a) => ({ key: a.id, area: a, items: list.filter((x) => x.area_id === a.id) })),
    { key: 'none', area: null, items: list.filter((x) => !x.area_id || !areaOf(x.area_id)) }].filter((g) => g.items.length);

  return html`<div class="stack">
    <div class="page-head">
      <div><h2 class="page-title">${t('tasks.title')}</h2><p class="page-sub">${t('tasks.sub')}</p></div>
      <button class="fab pop" onClick=${() => setEditing('new')} aria-label=${t('tasks.new')}><${Icon} name="plus" size=${26} /></button>
    </div>
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
            <span class="person-mail">${freqText(x)}</span>
          </span>
          <${Icon} name="pencil" size=${18} class="chev" />
        </button>`)}
      </div>
    </section>`)}
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
  } : {
    name: '', description: '', icon: 'sparkles', color: PALETTE[0], area_id: s.areas[0] ? s.areas[0].id : null,
    start_time: '09:00', end_time: '10:00', frequency: 'daily', weekdays: [1, 2, 3, 4, 5], steps: [],
  });
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const up = (patch) => setF((x) => ({ ...x, ...patch }));
  const valid = f.name.trim() && toMin(f.end_time) > toMin(f.start_time) && (f.frequency === 'daily' || f.weekdays.length);

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
        name: f.name.trim(), description: f.description.trim(), icon: f.icon, color: f.color, area_id: f.area_id,
        start_time: f.start_time, end_time: f.end_time, frequency: f.frequency,
        weekdays: f.frequency === 'daily' ? [] : f.weekdays,
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
      <div class="editor-head">
        <${TaskBadge} icon=${f.icon} color=${f.color} size=${64} />
        <${Field} label=${t('task.name')}><input class="input" value=${f.name} required maxlength="80" onInput=${(e) => up({ name: e.target.value })} /><//>
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

      <div class="field"><span class="field-label">${t('task.window')}</span>
        <div class="time-row">
          <input class="input" type="time" value=${f.start_time} required onInput=${(e) => up({ start_time: e.target.value })} aria-label=${t('task.from')} />
          <span class="muted">–</span>
          <input class="input" type="time" value=${f.end_time} required onInput=${(e) => up({ end_time: e.target.value })} aria-label=${t('task.to')} />
        </div>
        <span class=${'field-hint' + (goal <= 0 ? ' bad' : '')}>${goal > 0 ? t('task.goal', { time: dur(goal) }) : t('task.badWindow')}</span>
      </div>

      <div class="field"><span class="field-label">${t('task.frequency')}</span>
        <${Segmented} value=${f.frequency} onChange=${(v) => up({ frequency: v })} options=${[
          { value: 'daily', label: t('task.everyDay') }, { value: 'weekdays', label: t('task.certainDays') }]} />
        ${f.frequency === 'weekdays' ? html`<div class="days pop">
          ${names.map((n, i) => html`<button type="button" key=${i} class=${'day-opt' + (f.weekdays.includes(i + 1) ? ' on' : '')}
            onClick=${() => toggleDay(i + 1)}>${n}</button>`)}
        </div>` : null}
      </div>

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
