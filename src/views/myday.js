import { html, useState, useEffect, useRef } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, currentLocale, friendlyError } from '../i18n.js';
import { Icon, Empty } from '../ui.js';
import { colorStyle } from '../color.js';
import { assignmentsOn, itemName, areaOf, areaName, finishAssignment, reopenAssignment, ensureLogbook } from '../data.js';
import { todayYmd, addDays, ymd, parseYmd, fmt, dur, hasTime, timeText, timeKey, hhmm } from '../time.js';
import { shiftOf, shiftName, goalOf, priorityOf } from '../shifts.js';
import { AssignmentSheet } from './assign.js';
import { PriorityChip } from './tasks.js';
import { WriteSheet, defaultLogBlock } from './logbook.js';

// The custodian's whole app in one screen: today's tasks as big check buttons, and a handover note one tap away.
export function CustodianHome() {
  const s = useStore();
  const me = s.profile;
  const today = todayYmd();
  const loc = currentLocale();
  const [open, setOpen] = useState(null);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(null);
  const [undo, setUndo] = useState(null);
  const timer = useRef(null);
  useEffect(() => { ensureLogbook(today, today).catch(() => {}); return () => clearTimeout(timer.current); }, []);

  const mine = assignmentsOn(today).filter((a) => a.assignee === me.id && s.tasks[a.task_id]);
  const back = ymd(addDays(new Date(), -14));
  const earlier = Object.values(s.assignments).filter((a) => a.assignee === me.id && s.tasks[a.task_id] && a.day < today && a.day >= back && a.status !== 'done')
    .sort((x, y) => x.day.localeCompare(y.day) || timeKey(x) - timeKey(y));
  const todo = mine.filter((a) => a.status !== 'done');
  const done = mine.filter((a) => a.status === 'done');
  const pct = mine.length ? Math.round((done.length / mine.length) * 100) : 0;
  const shift = shiftOf(me.id, today);

  async function tick(a) {
    if (busy) return;
    setBusy(a.id);
    try {
      if (a.status === 'done') { await reopenAssignment(a.id); setUndo(null); } else {
        let minutes = goalOf(a);
        if (a.started_at) { const m = Math.round((Date.now() - Date.parse(a.started_at)) / 60000); if (m >= 1) minutes = Math.min(m, 1440); }
        await finishAssignment(a.id, minutes, '', '');
        setUndo({ id: a.id, name: itemName(a) });
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setUndo(null), 7000);
      }
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(null);
  }
  async function undoLast() {
    if (!undo) return;
    const id = undo.id; setUndo(null);
    try { await reopenAssignment(id); } catch (ex) { toast(friendlyError(ex), 'bad'); }
  }

  const card = (a, showDay) => {
    const tk = s.tasks[a.task_id];
    const area = areaOf(tk.area_id);
    const isDone = a.status === 'done';
    const steps = (tk.steps || []).length;
    const stepsDone = (a.steps_done || []).filter((i) => i < steps).length;
    return html`<article class=${'my-task ' + a.status + ' prio-' + priorityOf(tk)} key=${a.id}>
      <button type="button" class="my-check" role="checkbox" aria-checked=${isDone} disabled=${busy === a.id} aria-label=${t('my.markDone', { name: itemName(a) })} onClick=${() => tick(a)}>
        <${Icon} name="check" size=${34} />
      </button>
      <button type="button" class="my-body" onClick=${() => setOpen(a.id)}>
        ${showDay ? html`<span class="my-day">${fmt(parseYmd(a.day), { weekday: 'long', day: 'numeric', month: 'short' })}</span>` : null}
        <span class="my-name">${itemName(a)}</span>
        <span class="my-meta">
          ${area ? html`<span class="chip tint" style=${colorStyle(area.color)}><${Icon} name=${area.icon || 'home'} size=${16} />${areaName(area)}</span>` : null}
          ${a.status === 'doing' ? html`<span class="chip status-chip doing"><${Icon} name="hourglass" size=${15} />${t('status.doing')}</span>` : null}
          <span class="my-when"><${Icon} name="clock" size=${16} />${hasTime(a) ? timeText(a) : t('my.anytime')} · ${dur(goalOf(a))}</span>
          ${steps ? html`<span class="my-when"><${Icon} name="list-check" size=${16} />${stepsDone}/${steps}</span>` : null}
          ${priorityOf(tk) === 'high' ? html`<${PriorityChip} task=${tk} />` : null}
        </span>
        ${a.note ? html`<span class="my-note">${a.note}</span>` : null}
      </button>
    </article>`;
  };

  return html`<div class="stack my-day-page">
    <header class="my-head">
      <p class="my-date">${new Date().toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <h2 class="my-title">${t('my.title')}</h2>
      ${shift ? html`<p class="my-shift"><${Icon} name="clock" size=${18} />${shiftName(shift)} · ${hhmm(shift.start_time)}–${hhmm(shift.end_time)}</p>` : null}
    </header>

    ${mine.length ? html`<div class="my-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${pct}>
      <div class="progress"><i style=${`width:${pct}%`}></i></div>
      <b>${done.length === mine.length ? t('home.allDone') : t('home.progress', { done: done.length, total: mine.length })}</b>
    </div>` : null}

    ${earlier.length ? html`<section class="my-sec"><h3 class="section-title">${t('my.earlier')}<span class="count">${earlier.length}</span></h3>
      <div class="my-list">${earlier.map((a) => card(a, true))}</div></section>` : null}

    ${todo.length ? html`<div class="my-list">${todo.map((a) => card(a))}</div>`
      : !mine.length && !earlier.length ? html`<${Empty} icon="clipboard-check" text=${t('my.empty')} />` : null}

    ${done.length ? html`<section class="my-sec"><h3 class="section-title">${t('my.doneHeader')}<span class="count">${done.length}</span></h3>
      <div class="my-list">${done.map((a) => card(a))}</div></section>` : null}


    <div class="my-foot">
      <button type="button" class="btn big-btn" onClick=${() => setWriting(true)}><${Icon} name="writing" size=${26} />${t('my.handover')}</button>
    </div>

    ${undo ? html`<div class="my-undo" role="status"><span>${t('my.undoDone', { name: undo.name })}</span><button type="button" onClick=${undoLast}>${t('my.undo')}</button></div>` : null}
    ${open ? html`<${AssignmentSheet} id=${open} onClose=${() => setOpen(null)} />` : null}
    ${writing ? html`<${WriteSheet} day=${today} block=${defaultLogBlock(me.id)} onClose=${() => setWriting(false)} />` : null}
  </div>`;
}
