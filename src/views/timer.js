import { html, useState, useEffect } from '../../assets/vendor/htm-preact.js';
import { t } from '../i18n.js';
import { Icon, Sheet, TaskBadge, useSheetControl } from '../ui.js';
import { dur } from '../time.js';

const two = (n) => String(n).padStart(2, '0');
// 3725 seconds -> "1:02:05", 125 -> "02:05"
export function clock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

// Seconds since `startedAt` (a time stamp), ticking every second
export function useElapsed(startedAt) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return startedAt ? Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000)) : 0;
}

// A small running clock, e.g. on a row or a card
export function LiveClock({ startedAt }) {
  return html`<span class="live-clock">${clock(useElapsed(startedAt))}</span>`;
}

// The "task in process" window: a big running timer, the goal, and (for tasks) the steps to tick
export function TimerSheet({ title, icon, color, startedAt, goal, steps, stepsDone, onStep, finishLabel, onFinish, onClose }) {
  const ctl = useSheetControl();
  const sec = useElapsed(startedAt);
  const goalSec = Math.max(1, goal) * 60;
  const over = sec > goalSec;
  const pct = Math.min(1, sec / goalSec);
  const R = 96, C = 2 * Math.PI * R;
  const left = Math.abs(goalSec - sec);
  const note = over ? t('timer.over', { time: dur(Math.ceil(left / 60)) }) : t('timer.left', { time: dur(Math.ceil(left / 60)) });

  return html`<${Sheet} title=${title} kicker=${t('timer.inProgress')} onClose=${onClose} control=${ctl}>
    <div class=${'timer' + (over ? ' over' : '')} style=${`--c:${color}`}>
      <div class="timer-ring">
        <svg viewBox="0 0 220 220" aria-hidden="true">
          <circle class="trk" cx="110" cy="110" r=${R} />
          <circle class="bar" cx="110" cy="110" r=${R} stroke-dasharray=${C} stroke-dashoffset=${C * (1 - pct)} />
        </svg>
        <div class="timer-mid">
          <${TaskBadge} icon=${icon} status="doing" size=${44} />
          <b class="timer-clock" role="timer">${clock(sec)}</b>
          <span class="timer-goal">${t('timer.goal', { time: dur(goal) })}</span>
        </div>
      </div>
      <p class=${'timer-note' + (over ? ' over' : '')}>${note}</p>
    </div>

    ${steps && steps.length ? html`<div class="field"><span class="field-label">${t('task.steps')}<span class="count">${(stepsDone || []).filter((i) => i < steps.length).length}/${steps.length}</span></span>
      <div class="checklist">
        ${steps.map((st, i) => {
          const on = (stepsDone || []).includes(i);
          return html`<button type="button" key=${i} class=${'check-row' + (on ? ' on' : '')} onClick=${() => onStep(i)}>
            <span class="check-box"><${Icon} name="check" size=${16} /></span>
            <span class="check-text"><b>${st.title}</b>${st.description ? html`<span>${st.description}</span>` : null}</span>
          </button>`;
        })}
      </div></div>` : null}

    <div class="stack-form">
      <button class="btn" onClick=${onFinish}><${Icon} name="circle-check" size=${20} />${finishLabel}</button>
      <button class="btn soft" onClick=${ctl.close}>${t('timer.keep')}</button>
    </div>
  <//>`;
}
