import { html, useState, useEffect, useRef } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Avatar, Segmented } from '../ui.js';
import { isSupervisor } from '../roles.js';
import { WEEKLY } from '../weeklydata.js';
import { WEEKLY_TEXT } from '../weeklytext.js';
import { todayYmd, parseYmd, startOfWeek, addDays, ymd, isoWeekday, fmt } from '../time.js';
import { ensureWeekly, weeklyOf, setWeeklyItem } from '../data.js';

// The Monday-to-Saturday cleaning checklist, shared by the whole custodian team (supervisor included).
// Tap an item: "I'm doing it" (yellow, with my picture) -> tap again: done (green, with my name) -> tap again: clear.
// Somebody else's item can only be changed by them or by the supervisor.
// Text of a checklist line / section title in the current language (English if there is no translation)
const FLAT = {}; // "day.section.index" -> position in the translated list
{ let n = 0; WEEKLY.forEach((d) => d.sections.forEach((sec, si) => sec.items.forEach((_, ii) => { FLAT[`${d.day}.${si}.${ii}`] = n++; }))); }
const TITLES = ['Temple', 'Rooms', 'On Monday everything in the rooms must be cleaned', 'Morning', 'Afternoon'];
const itemText = (id, en, lang) => { const tr = WEEKLY_TEXT[lang]; return (tr && tr.items[FLAT[id]]) || en; };
const titleText = (en, lang) => { const tr = WEEKLY_TEXT[lang]; const i = TITLES.indexOf(en); return (tr && i >= 0 && tr.titles[i]) || en; };

export const weekStart = () => ymd(startOfWeek(parseYmd(todayYmd())));
export const todayWeekday = () => { const w = isoWeekday(new Date()); return w === 7 ? 0 : w; }; // 0 = Sunday: nothing planned

export function WeeklyList({ day, compact }) {
  const s = useStore();
  const me = s.profile;
  const sup = isSupervisor(me);
  const wk = weekStart();
  const lang = s.lang;
  const [busy, setBusy] = useState(null);
  useEffect(() => { ensureWeekly(wk).catch(() => {}); }, [wk]);

  const d = WEEKLY.find((x) => x.day === day);
  if (!d) return null;
  const id = (si, ii) => `${day}.${si}.${ii}`;
  const items = d.sections.flatMap((sec, si) => sec.items.map((_, ii) => id(si, ii)));
  const done = items.filter((i) => { const r = weeklyOf(wk, i); return r && r.status === 'done'; }).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;

  async function tap(i) {
    if (busy) return;
    const r = weeklyOf(wk, i);
    if (r && r.user_id !== me.id && !sup) {
      const p = s.profiles[r.user_id];
      toast(t('weekly.taken', { name: p ? p.display_name.split(' ')[0] : '' }), 'bad');
      return;
    }
    const next = !r ? 'doing' : r.status === 'doing' ? 'done' : null;
    setBusy(i);
    try { await setWeeklyItem(wk, i, next); } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(null);
  }

  return html`<div class=${'weekly-list' + (compact ? ' compact' : '')}>
    <div class="weekly-prog"><div class="weekly-bar" role="progressbar" aria-valuenow=${pct} aria-valuemin="0" aria-valuemax="100"><span style=${`width:${pct}%`}></span></div>
      <b>${t('weekly.progress', { done, total: items.length })}</b></div>
    ${d.sections.map((sec, si) => html`<section class="weekly-sec" key=${day + '-' + si}>
      ${sec.title ? html`<h4 class="weekly-sec-title">${titleText(sec.title, lang)}</h4>` : null}
      ${sec.note ? html`<p class="field-hint">${titleText(sec.note, lang)}</p>` : null}
      <div class="checklist">${sec.items.map((txt, ii) => {
        const r = weeklyOf(wk, id(si, ii));
        const p = r ? s.profiles[r.user_id] : null;
        const st = r ? r.status : '';
        return html`<button type="button" key=${ii} class=${'check-row weekly-row ' + st + (st === 'done' ? ' on' : '')} aria-pressed=${st === 'done'} disabled=${busy === id(si, ii)} onClick=${() => tap(id(si, ii))}>
          <span class="check-box">${st === 'doing' ? html`<${Icon} name="hourglass" size=${16} />` : html`<${Icon} name="check" size=${18} />`}</span>
          <span class="check-text"><b>${itemText(id(si, ii), txt, lang)}</b>
            ${r ? html`<span class="weekly-who"><${Avatar} profile=${p} name=${p ? p.display_name : ''} size=${22} ring=${false} />${p ? p.display_name.split(' ')[0] : ''} · ${r.status === 'done' ? t('status.done') : t('weekly.doing')}</span>` : null}
          </span>
        </button>`;
      })}</div>
    </section>`)}
  </div>`;
}

// The full screen: day tabs + the list
export function WeeklyView() {
  const monday = parseYmd(weekStart());
  const wd = todayWeekday();
  const [day, setDay] = useState(wd || 1);
  const dayName = (n, style) => fmt(addDays(monday, n - 1), { weekday: style });
  return html`<div class="stack weekly-page">
    <div class="page-head"><div><h2 class="page-title">${t('nav.weekly')}</h2><p class="page-sub">${t('weekly.sub')}</p></div></div>
    <${Segmented} label=${t('nav.weekly')} value=${day} onChange=${setDay}
      options=${WEEKLY.map((x) => ({ value: x.day, label: dayName(x.day, 'short') }))} />
    <div class="cal-head"><div class="rooms-day" key=${day}>
      <h3 class="cal-title">${dayName(day, 'long')}${day === wd ? html` <span class="log-now">${t('chat.today')}</span>` : null}</h3>
    </div></div>
    <${WeeklyList} day=${day} />
  </div>`;
}

// Card for the home screens: today's list, folded open
export function WeeklyToday() {
  const wd = todayWeekday();
  if (!wd) return null;
  const [open, setOpen] = useState(true);
  return html`<section class="rise weekly-card" aria-label=${t('nav.weekly')}>
    <button type="button" class="weekly-card-head" aria-expanded=${open} onClick=${() => setOpen(!open)}>
      <span class="weekly-card-ic"><${Icon} name="clipboard-check" size=${24} /></span>
      <span><b>${t('weekly.today')}</b><small>${fmt(new Date(), { weekday: 'long' })}</small></span>
      <${Icon} name=${open ? 'caret-up' : 'caret-down'} size=${20} />
    </button>
    ${open ? html`<${WeeklyList} day=${wd} compact=${true} />` : null}
    <a class="section-link weekly-all" href="#/weekly">${t('weekly.week')}</a>
  </section>`;
}
