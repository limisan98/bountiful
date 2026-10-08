import { html, useState } from '../../assets/vendor/htm-preact.js';
import { useStore } from '../store.js';
import { t } from '../i18n.js';
import { Icon, Avatar, Segmented, Empty } from '../ui.js';
import { ymd, parseYmd, addDays, todayYmd, fmt, dur } from '../time.js';

// Automatic reports. The database writes them by itself (day: every day 23:30, week: Saturday 23:30,
// month: last Saturday of the month, quarter: last Saturday of Mar/Jun/Sep/Dec). Only supervisors can read them.
const KINDS = ['day', 'week', 'month', 'quarter'];
const short = (iso) => fmt(parseYmd(iso), { day: 'numeric', month: 'short' });
const first = (p) => (p ? p.display_name.split(' ')[0] : t('chat.former'));

// "today", "this week", "between Oct 4 and Oct 10" ...
function whenText(d) {
  const today = todayYmd();
  if (d.kind === 'day') {
    if (d.period_end === today) return t('reports.when.today');
    if (d.period_end === ymd(addDays(new Date(), -1))) return t('reports.when.yesterday');
    return t('reports.when.on', { a: fmt(parseYmd(d.period_end), { weekday: 'long', day: 'numeric', month: 'long' }) });
  }
  const recent = d.period_end >= ymd(addDays(new Date(), -6));
  if (recent) return t('reports.when.this.' + d.kind);
  return t('reports.when.range', { a: short(d.period_start), b: short(d.period_end) });
}

export function ReportsView() {
  const s = useStore();
  const [kind, setKind] = useState('day');
  const list = Object.values(s.digests).filter((d) => d.kind === kind);
  const ends = [...new Set(list.map((d) => d.period_end))].sort().reverse();
  const name = (d) => (s.profiles[d.custodian] || {}).display_name || '';

  return html`<div class="stack reports">
    <div class="page-head"><div>
      <h2 class="page-title">${t('reports.title')}</h2>
      <p class="page-sub">${t('reports.sub')}</p>
    </div></div>

    <${Segmented} value=${kind} onChange=${setKind} options=${KINDS.map((k) => ({ value: k, label: t('reports.kind.' + k) }))} />

    ${!list.length ? html`<${Empty} icon="clipboard-data" text=${t('reports.empty.' + kind)} />` : null}

    ${ends.map((end) => html`<section class="rise" key=${end}>
      <h3 class="section-title">${kind === 'day' ? fmt(parseYmd(end), { weekday: 'long', day: 'numeric', month: 'long' })
        : `${short(list.find((d) => d.period_end === end).period_start)} – ${short(end)}`}</h3>
      <div class="list">${list.filter((d) => d.period_end === end).sort((a, b) => name(a).localeCompare(name(b))).map((d) => html`<${ReportCard} key=${d.id} d=${d} />`)}</div>
    </section>`)}
  </div>`;
}

function ReportCard({ d }) {
  const s = useStore();
  const who = s.profiles[d.custodian];
  const sm = d.summary || {};
  const detail = d.kind === 'day';
  const items = sm.items || [];
  const tasks = sm.tasks || [];
  const open = sm.open || [];
  const rooms = sm.rooms || [];
  const notes = items.filter((x) => x.comment || x.delay);

  return html`<article class="report-card">
    <header class="report-head">
      <${Avatar} profile=${who} size=${46} />
      <p class="report-hey">${t('reports.hey', { sup: first(s.profile), name: first(who), when: whenText(d) })}</p>
    </header>

    <div class="report-stats">
      <span class="chip tint" style="--soft:var(--brand-soft)"><${Icon} name="circle-check" size=${15} />${t('reports.tasksDone', { done: sm.done || 0, total: sm.planned || 0 })}</span>
      <span class="chip tint" style="--soft:#FFF4DD"><${Icon} name="clock" size=${15} />${dur(sm.minutes || 0)}</span>
      ${sm.over ? html`<span class="chip tint" style="--soft:#FDE3DF"><${Icon} name="alert-triangle" size=${15} />${t('reports.over', { n: sm.over })}</span>` : null}
    </div>

    ${detail && items.length ? html`<ul class="report-list">${items.map((x, i) => html`<li key=${i}>
      <span class="r-ic"><${Icon} name="circle-check" size=${18} /></span>
      <span class="r-main"><b>${x.task}</b>
        <small>${dur(x.minutes || 0)}${x.goal ? ` / ${dur(x.goal)}` : ''}</small>
        ${x.delay ? html`<em>${x.delay}</em>` : null}${x.comment ? html`<em>${x.comment}</em>` : null}</span>
    </li>`)}</ul>` : null}

    ${!detail && tasks.length ? html`<ul class="report-list">${tasks.map((x, i) => html`<li key=${i}>
      <span class="r-ic"><${Icon} name="circle-check" size=${18} /></span>
      <span class="r-main"><b>${x.task}</b><small>${t('reports.times', { n: x.count })} · ${dur(x.minutes || 0)}</small></span>
    </li>`)}</ul>` : null}

    ${!detail && notes.length ? html`<div class="report-notes"><span class="mini-label">${t('reports.notes')}</span>
      ${notes.slice(0, 4).map((x, i) => html`<p key=${i}><b>${short(x.day)} · ${x.task}:</b> ${x.delay || x.comment}</p>`)}
      ${notes.length > 4 ? html`<p class="muted">${t('reports.moreNotes', { n: notes.length - 4 })}</p>` : null}</div>` : null}

    ${rooms.length ? html`<div class="report-block"><span class="r-ic bed"><${Icon} name="bed" size=${18} /></span>
      <span>${detail ? t('reports.rooms', { rooms: rooms.map((r) => r.room).join(', ') }) : t('reports.roomsN', { n: rooms.length })}</span></div>` : null}

    ${detail && open.length ? html`<div class="report-block open"><span class="r-ic"><${Icon} name="clock" size=${18} /></span>
      <span><b>${t('reports.open')}</b> ${open.map((x) => x.task).join(', ')}</span></div>` : null}

    ${!items.length && !tasks.length && !rooms.length ? html`<p class="muted">${t('reports.nothing')}</p>` : null}
  </article>`;
}
