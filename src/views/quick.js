import { html, useState, useMemo } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Avatar, Sheet, Field, useSheetControl } from '../ui.js';
import { colorStyle } from '../color.js';
import { areaName, presetsOfArea, presetSteps, taskForPreset, saveTask, planAssignments } from '../data.js';
import { parseYmd, todayYmd, fmt, hhmm, toMin, dur } from '../time.js';
import { dayPlanned, shiftOf, capacityOf, loadOf, crewPeople, shiftName, problemText } from '../shifts.js';

const BLOCK_ICON = { '07:00': 'sun-high', '08:00': 'sun', '14:00': 'sunset', '18:30': 'moon' };
const LEVEL_ICON = { 1: 'sparkles', 2: 'sparkles-2', 3: 'sparkles' };
const MINUTES = [15, 30, 45, 60, 90, 120];

// Quick assign: who -> where -> how deep -> assign. The checklist and the time estimate come with the preset.
// "+ Create custom task" is for the unexpected: type a task from scratch.
export function QuickAssignSheet({ day, person: first, onClose }) {
  const s = useStore();
  const ctl = useSheetControl();
  const [who, setWho] = useState(first || null);
  const [custom, setCustom] = useState(false);
  const [areaId, setAreaId] = useState(null);
  const [level, setLevel] = useState(1);
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [where, setWhere] = useState(null);
  const [lines, setLines] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);
  const today = todayYmd();

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const planned = dayPlanned(day);
  const workers = useMemo(() => {
    const all = crewPeople().map((p) => ({ p, sh: shiftOf(p.id, day) }));
    const list = planned ? all.filter((x) => x.sh) : all;
    const live = (x) => day === today && x.sh && toMin(x.sh.start_time) <= nowMin && nowMin < toMin(x.sh.end_time);
    return list.sort((a, b) => (live(b) ? 1 : 0) - (live(a) ? 1 : 0) || (a.sh ? toMin(a.sh.start_time) : 9999) - (b.sh ? toMin(b.sh.start_time) : 9999) || a.p.display_name.localeCompare(b.p.display_name))
      .map((x) => ({ ...x, live: live(x) }));
  }, [s.profiles, s.shiftPlan, s.contracts, day]);

  const areas = s.areas.filter((a) => presetsOfArea(a.id).length);
  const levels = areaId ? presetsOfArea(areaId) : [];
  const preset = levels.find((p) => p.level === level) || levels[0] || null;
  const area = s.areas.find((a) => a.id === areaId);
  const goal = custom ? minutes : preset ? preset.goal_minutes : 0;

  // the shift rules, early warning (the database checks the same): working that day, and the day's goals still fit
  const fits = (uid) => {
    if (!planned) return null;
    if (!shiftOf(uid, day)) return 'noshift';
    return goal && loadOf(uid, day) + goal > capacityOf(uid, day) ? 'capacity' : null;
  };
  const issue = who && goal ? fits(who) : null;
  const ready = who && goal && !issue && (custom ? name.trim().length > 0 : !!preset) && !busy;
  const person = who ? s.profiles[who] : null;
  const steps = custom ? lines.split('\n').map((x) => x.trim()).filter(Boolean) : preset ? presetSteps(preset) : [];

  async function assign() {
    if (!ready) return;
    setBusy(true);
    try {
      let tk;
      if (custom) {
        const a = areas.find((x) => x.id === where) || s.areas.find((x) => x.id === where);
        tk = await saveTask({
          name: name.trim().slice(0, 80), description: '', icon: a ? a.icon : 'sparkles', color: a ? a.color : '#86E3CE', area_id: a ? a.id : null,
          start_time: '07:00', end_time: '22:30', frequency: 'weekdays', weekdays: [], steps: steps.map((x) => ({ title: x.slice(0, 120), description: '' })),
          goal_minutes: minutes, kind: 'task', priority: 'medium', auto: false,
        });
      } else tk = await taskForPreset(preset);
      await planAssignments([{ task_id: tk.id, assignee: who, day, start_time: null, end_time: null, note: '', kind: 'task', title: '' }]);
      setLast({ who: person.display_name.split(' ')[0], task: tk.name });
      setAreaId(null); setLevel(1); setName(''); setLines(''); setWhere(null); setMinutes(30);
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }

  const kicker = (day === today ? t('chat.today') + ' · ' : '') + fmt(parseYmd(day), { weekday: 'long', day: 'numeric', month: 'long' });
  const stepHead = (n, text) => html`<h3 class="qa-step"><span class="qa-n">${n}</span>${text}</h3>`;

  return html`<${Sheet} title=${t('quick.title')} kicker=${kicker} onClose=${onClose} control=${ctl}>
    <div class="qa stack-form">
      <p class="field-hint">${t('quick.hint')}</p>

      ${last ? html`<div class="qa-done" role="status"><${Icon} name="circle-check" size=${26} /><div><b>${t('quick.assigned', { name: last.who })}</b><span>${last.task}</span></div></div>` : null}

      <section class="qa-sec" aria-label=${t('quick.step1')}>
        ${stepHead(1, t('quick.step1'))}
        ${!planned ? html`<p class="field-hint">${t('quick.noShifts')}</p>` : null}
        ${planned && !workers.length ? html`<p class="muted">${t('quick.nobody')}</p>` : null}
        <div class="qa-workers" role="radiogroup" aria-label=${t('quick.step1')}>
          ${workers.map(({ p, sh, live }) => {
            const bad = goal ? fits(p.id) : null;
            const free = sh ? capacityOf(p.id, day) - loadOf(p.id, day) : null;
            return html`<button type="button" role="radio" aria-checked=${who === p.id} key=${p.id} class=${'qa-worker' + (who === p.id ? ' on' : '') + (bad ? ' blocked' : '')} disabled=${!!bad && who !== p.id} onClick=${() => setWho(p.id)}>
              <${Avatar} profile=${p} size=${44} />
              <span class="qa-w-main"><b>${p.display_name}</b>
                ${sh ? html`<span class="qa-w-sub"><${Icon} name=${BLOCK_ICON[sh.block]} size=${15} />${shiftName(sh)} · ${hhmm(sh.start_time)}–${hhmm(sh.end_time)}</span>` : null}
                ${live ? html`<span class="qa-w-live">${t('shift.onDuty')}</span>` : null}
                ${bad ? html`<span class="qa-w-bad">${problemText(bad)}</span>` : free !== null ? html`<span class="qa-w-sub">${t('quick.free', { time: dur(Math.max(0, free)) })}</span>` : null}
              </span>
            </button>`;
          })}
        </div>
      </section>

      <button type="button" class=${'qa-custom' + (custom ? ' on' : '')} aria-pressed=${custom} onClick=${() => setCustom(!custom)}>
        <${Icon} name=${custom ? 'arrow-badge-left' : 'plus'} size=${20} />${custom ? t('quick.backToList') : t('quick.custom')}
      </button>

      ${!custom ? html`
        <section class="qa-sec" aria-label=${t('quick.step2')}>
          ${stepHead(2, t('quick.step2'))}
          <div class="qa-areas">
            ${areas.map((a) => html`<button type="button" key=${a.id} class=${'qa-area' + (areaId === a.id ? ' on' : '')} aria-pressed=${areaId === a.id} style=${colorStyle(a.color)} onClick=${() => { setAreaId(a.id); setLevel(1); }}>
              <span class="qa-area-ic"><${Icon} name=${a.icon || 'home'} size=${22} /></span><span>${areaName(a)}</span></button>`)}
          </div>
        </section>

        ${areaId ? html`<section class="qa-sec" aria-label=${t('quick.step3')}>
          ${stepHead(3, t('quick.step3'))}
          <div class="qa-levels" role="radiogroup" aria-label=${t('quick.step3')}>
            ${levels.map((p) => html`<button type="button" role="radio" aria-checked=${preset && preset.level === p.level} key=${p.id} class=${'qa-level' + (preset && preset.level === p.level ? ' on' : '')} onClick=${() => setLevel(p.level)}>
              <span class="qa-level-top"><${Icon} name=${LEVEL_ICON[p.level]} size=${22} /><b>${t('preset.level' + p.level)}</b></span>
              <span class="qa-level-hint">${t('quick.level' + p.level + 'Hint')}</span>
              <span class="qa-level-time"><${Icon} name="clock" size=${16} />${dur(p.goal_minutes)}</span>
            </button>`)}
          </div>
          ${preset ? html`<div class="qa-check">
            <p class="qa-check-head"><b>${t('quick.checklist')}</b><span>${t('quick.estimated', { time: dur(preset.goal_minutes) })} · ${t('quick.stepsN', { n: steps.length })}</span></p>
            <ol>${steps.map((x, i) => html`<li key=${i}><span class="qa-n sm">${i + 1}</span>${x.title}</li>`)}</ol>
          </div>` : null}
        </section>` : null}` : html`
        <section class="qa-sec" aria-label=${t('quick.step2custom')}>
          ${stepHead(2, t('quick.step2custom'))}
          <${Field} label=${t('quick.name')}>
            <input class="input" maxlength="80" value=${name} placeholder=${t('quick.namePh')} onInput=${(e) => setName(e.target.value)} />
          <//>
          <div class="field"><span class="field-label">${t('quick.minutes')}: <b>${dur(minutes)}</b></span>
            <div class="chips">
              ${MINUTES.map((m) => html`<button type="button" key=${m} class=${'pick' + (minutes === m ? ' on' : '')} aria-pressed=${minutes === m} onClick=${() => setMinutes(m)}>${dur(m)}</button>`)}
              <button type="button" class="pick" aria-label="−5" onClick=${() => setMinutes(Math.max(5, minutes - 5))}>−5</button>
              <button type="button" class="pick" aria-label="+5" onClick=${() => setMinutes(Math.min(480, minutes + 5))}>+5</button>
            </div>
          </div>
          <div class="field"><span class="field-label">${t('quick.where')}</span>
            <div class="chips">
              ${s.areas.map((a) => html`<button type="button" key=${a.id} class=${'pick' + (where === a.id ? ' on' : '')} style=${colorStyle(a.color)} aria-pressed=${where === a.id} onClick=${() => setWhere(where === a.id ? null : a.id)}>
                <${Icon} name=${a.icon || 'home'} size=${16} />${areaName(a)}</button>`)}
            </div>
          </div>
          <${Field} label=${t('quick.stepsLabel')}>
            <textarea class="input area" rows="4" value=${lines} placeholder=${t('quick.stepsPh')} onInput=${(e) => setLines(e.target.value)}></textarea>
          <//>
        </section>`}

      <div class="qa-foot">
        ${issue ? html`<p class="qa-warn" role="alert"><${Icon} name="alert-triangle" size=${18} />${problemText(issue)}</p>` : null}
        <div class="qa-sum">${stepHead(4, t('quick.step4'))}
          <span>${person ? person.display_name : t('quick.pickWorker')}${goal && (custom ? name.trim() : preset) ? ' · ' + (custom ? name.trim() : area ? areaName(area) + ' · ' + t('preset.level' + preset.level) : '') + ' · ' + dur(goal) : ''}</span></div>
        <button class="btn big-btn" type="button" disabled=${!ready} onClick=${assign}><${Icon} name="bolt" size=${22} />${t('quick.assignBtn')}</button>
        ${last ? html`<button class="btn soft" type="button" onClick=${() => ctl.close()}>${t('quick.finish')}</button>` : null}
      </div>
    </div>
  <//>`;
}
