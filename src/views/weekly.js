import { html, useState, useEffect } from '../../assets/vendor/htm-preact.js';
import { t } from '../i18n.js';
import { Icon, Segmented } from '../ui.js';
import { WEEKLY } from '../weeklydata.js';
import { todayYmd, parseYmd, startOfWeek, addDays, ymd, isoWeekday, fmt } from '../time.js';

// The Monday-to-Saturday cleaning checklist, same for custodians and the supervisor.
// Ticks are kept on this device only and start fresh every week.
const key = (wk) => 'bountiful.weekly.' + wk;
function load(wk) { try { return JSON.parse(localStorage.getItem(key(wk)) || '{}'); } catch { return {}; } }
function save(wk, v) { try { localStorage.setItem(key(wk), JSON.stringify(v)); } catch { /* private mode */ } }

export function WeeklyView() {
  const monday = startOfWeek(parseYmd(todayYmd()));
  const wk = ymd(monday);
  const wd = isoWeekday(new Date());
  const [day, setDay] = useState(wd === 7 ? 1 : wd);
  const [ticks, setTicks] = useState(() => load(wk));
  useEffect(() => { save(wk, ticks); }, [ticks]);

  const d = WEEKLY.find((x) => x.day === day);
  const id = (si, ii) => `${day}.${si}.${ii}`;
  const items = d.sections.flatMap((s, si) => s.items.map((_, ii) => id(si, ii)));
  const done = items.filter((i) => ticks[i]).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const toggle = (i) => setTicks((o) => { const n = { ...o }; if (n[i]) delete n[i]; else n[i] = 1; return n; });
  const clearDay = () => setTicks((o) => { const n = { ...o }; items.forEach((i) => delete n[i]); return n; });
  const dayName = (n, style) => fmt(addDays(monday, n - 1), { weekday: style });

  return html`<div class="stack weekly-page">
    <div class="page-head"><div><h2 class="page-title">${t('nav.weekly')}</h2><p class="page-sub">${t('weekly.sub')}</p></div></div>
    <${Segmented} label=${t('nav.weekly')} value=${day} onChange=${setDay}
      options=${WEEKLY.map((x) => ({ value: x.day, label: dayName(x.day, 'short') }))} />
    <div class="cal-head">
      <div class="rooms-day" key=${day}>
        <h3 class="cal-title">${dayName(day, 'long')}${day === wd ? html` <span class="log-now">${t('chat.today')}</span>` : null}</h3>
        <span class="muted">${t('weekly.progress', { done, total: items.length })}</span>
      </div>
    </div>
    <div class="weekly-bar" role="progressbar" aria-valuenow=${pct} aria-valuemin="0" aria-valuemax="100"><span style=${`width:${pct}%`}></span></div>
    ${d.sections.map((s, si) => html`<section class="weekly-sec" key=${day + '-' + si}>
      ${s.title ? html`<h3 class="section-title">${s.title}</h3>` : null}
      ${s.note ? html`<p class="field-hint">${s.note}</p>` : null}
      <div class="checklist">${s.items.map((txt, ii) => {
        const on = !!ticks[id(si, ii)];
        return html`<button type="button" key=${ii} class=${'check-row' + (on ? ' on' : '')} aria-pressed=${on} onClick=${() => toggle(id(si, ii))}>
          <span class="check-box"><${Icon} name="check" size=${18} /></span><span class="check-text"><b>${txt}</b></span>
        </button>`;
      })}</div>
    </section>`)}
    ${done ? html`<button class="btn soft" onClick=${clearDay}><${Icon} name="x" size=${20} />${t('weekly.reset')}</button>` : null}
  </div>`;
}
