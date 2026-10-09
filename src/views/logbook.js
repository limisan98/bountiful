import { html, useState, useEffect } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Avatar, Field, Sheet, Empty, useSheetControl } from '../ui.js';
import { isSupervisor } from '../roles.js';
import { colorStyle } from '../color.js';
import { logbookOn, ensureLogbook, addLogEntry, resolveLogEntry, removeLogEntry, areaName } from '../data.js';
import { ymd, parseYmd, addDays, todayYmd, fmt, fmtTimeOfDay } from '../time.js';
import { shiftOf } from '../shifts.js';

// The shared logbook: what the morning shift leaves for the afternoon, and the afternoon for the evening.
// Big text, three clear parts (morning / afternoon / evening), and "needs follow-up" notes stay on top until somebody ticks them.
export const LOG_BLOCKS = [
  { key: 'morning', icon: 'sun-high' },
  { key: 'afternoon', icon: 'sunset' },
  { key: 'evening', icon: 'moon' },
];

// which part of the day to write in: by my shift today, otherwise by the clock
export function defaultLogBlock(uid) {
  const sh = uid ? shiftOf(uid, todayYmd()) : null;
  if (sh) return sh.block === '14:00' ? 'afternoon' : sh.block === '18:30' ? 'evening' : 'morning';
  const m = new Date().getHours() * 60 + new Date().getMinutes();
  return m < 14 * 60 ? 'morning' : m < 18 * 60 + 30 ? 'afternoon' : 'evening';
}

export function LogbookView() {
  const s = useStore();
  const me = s.profile;
  const sup = isSupervisor(me);
  const today = todayYmd();
  const [day, setDay] = useState(today);
  const [writing, setWriting] = useState(null); // block key
  const date = parseYmd(day);

  useEffect(() => { ensureLogbook(day, day).catch(() => {}); }, [day]);

  const entries = logbookOn(day);
  const open = Object.values(s.logbook).filter((e) => e.follow_up && !e.resolved_at && e.day <= today && e.day !== day)
    .sort((a, b) => a.day.localeCompare(b.day) || a.created_at.localeCompare(b.created_at));
  const go = (n) => setDay(ymd(addDays(date, n)));
  const label = day === today ? t('chat.today') : day === ymd(addDays(new Date(), -1)) ? t('log.yesterday') : fmt(date, { weekday: 'long' });
  const nowBlock = defaultLogBlock(me.id);

  return html`<div class="stack logbook-page">
    <div class="page-head"><div><h2 class="page-title">${t('nav.logbook')}</h2><p class="page-sub">${t('log.sub')}</p></div></div>

    <button class="btn big-btn" onClick=${() => setWriting(nowBlock)}><${Icon} name="writing" size=${24} />${t('log.write')}</button>

    ${open.length ? html`<section class="rise log-open" aria-label=${t('log.open')}>
      <h3 class="section-title">${t('log.open')}<span class="count">${open.length}</span></h3>
      <p class="field-hint">${t('log.openHint')}</p>
      <div class="list tight">${open.map((e) => html`<${LogEntry} key=${e.id} e=${e} me=${me} sup=${sup} showDay=${true} />`)}</div>
    </section>` : null}

    <div class="cal-head">
      <div class="rooms-day" key=${day}>
        <h3 class="cal-title">${label}</h3>
        <span class="muted">${fmt(date, { day: 'numeric', month: 'long', year: 'numeric' })}</span>
      </div>
      <div class="cal-nav">
        <button class="icon-btn big" aria-label=${t('log.prevDay')} onClick=${() => go(-1)}><${Icon} name="caret-left" size=${22} /></button>
        <button class="icon-btn big" aria-label=${t('log.nextDay')} disabled=${day >= ymd(addDays(new Date(), 1))} onClick=${() => go(1)}><${Icon} name="caret-right" size=${22} /></button>
      </div>
    </div>

    ${LOG_BLOCKS.map((b) => {
      const list = entries.filter((e) => e.block === b.key);
      const now = day === today && b.key === nowBlock;
      return html`<section class=${'log-block ' + b.key + (now ? ' is-now' : '')} key=${b.key}>
        <header>
          <span class="log-block-ic"><${Icon} name=${b.icon} size=${26} /></span>
          <h3>${t('log.' + b.key)}</h3>
          ${now ? html`<span class="log-now">${t('log.now')}</span>` : null}
          <button type="button" class="pick" onClick=${() => setWriting(b.key)}><${Icon} name="plus" size=${16} />${t('log.add')}</button>
        </header>
        ${list.length ? html`<div class="list tight">${list.map((e) => html`<${LogEntry} key=${e.id} e=${e} me=${me} sup=${sup} />`)}</div>`
          : html`<p class="log-empty">${t('log.empty')}</p>`}
      </section>`;
    })}

    ${writing ? html`<${WriteSheet} day=${day} block=${writing} onClose=${() => setWriting(null)} />` : null}
  </div>`;
}

function LogEntry({ e, me, sup, showDay }) {
  const s = useStore();
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const who = s.profiles[e.author];
  const area = e.area_id ? s.areas.find((a) => a.id === e.area_id) : null;
  const resolver = e.resolved_by ? s.profiles[e.resolved_by] : null;
  const canDelete = e.author === me.id || sup;
  async function tick() {
    setBusy(true);
    try { await resolveLogEntry(e.id, !e.resolved_at); } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }
  async function del() {
    if (!sure) { setSure(true); setTimeout(() => setSure(false), 3500); return; }
    try { await removeLogEntry(e.id); } catch (ex) { toast(friendlyError(ex), 'bad'); }
  }
  return html`<article class=${'log-entry' + (e.follow_up && !e.resolved_at ? ' follow' : '') + (e.resolved_at ? ' resolved' : '')}>
    <div class="log-head">
      <${Avatar} profile=${who} size=${40} />
      <div class="log-who"><b>${who ? who.display_name : '—'}</b>
        <span>${showDay ? fmt(parseYmd(e.day), { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + t('log.' + e.block) + ' · ' : ''}${fmtTimeOfDay(e.created_at)}</span></div>
      ${area ? html`<span class="chip log-area" style=${colorStyle(area.color)}><${Icon} name=${area.icon || 'home'} size=${14} />${areaName(area)}</span>` : null}
    </div>
    <p class="log-body">${e.body}</p>
    ${e.follow_up ? html`<div class="log-follow">
      <span class=${'log-flag' + (e.resolved_at ? ' ok' : '')}><${Icon} name=${e.resolved_at ? 'circle-check' : 'flag'} size=${18} />${e.resolved_at
        ? t('log.resolvedBy', { name: resolver ? resolver.display_name.split(' ')[0] : '—' }) : t('log.needsFollow')}</span>
      <button type="button" class=${'btn small auto' + (e.resolved_at ? ' soft' : '')} disabled=${busy} onClick=${tick}>
        <${Icon} name=${e.resolved_at ? 'clock' : 'circle-check'} size=${18} />${e.resolved_at ? t('log.reopen') : t('log.markDone')}</button>
    </div>` : null}
    ${canDelete ? html`<button type="button" class=${'pick danger log-del' + (sure ? ' sure' : '')} onClick=${del}><${Icon} name="trash" size=${16} />${sure ? t('log.sure') : t('common.remove')}</button>` : null}
  </article>`;
}

export function WriteSheet({ day, block: first, onClose }) {
  const s = useStore();
  const ctl = useSheetControl();
  const [block, setBlock] = useState(first);
  const [body, setBody] = useState('');
  const [area, setArea] = useState(null);
  const [follow, setFollow] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(ev) {
    ev.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await addLogEntry({ day, block, body: body.trim(), area_id: area, follow_up: follow });
      toast(t('log.saved'));
      ctl.close();
    } catch (ex) { toast(friendlyError(ex), 'bad'); setBusy(false); }
  }
  return html`<${Sheet} title=${t('log.write')} kicker=${fmt(parseYmd(day), { weekday: 'long', day: 'numeric', month: 'long' })} onClose=${onClose} control=${ctl}>
    <form class="stack-form" onSubmit=${save}>
      <div class="field"><span class="field-label">${t('log.part')}</span>
        <div class="block-chips three" role="group" aria-label=${t('log.part')}>
          ${LOG_BLOCKS.map((b) => html`<button type="button" key=${b.key} class=${'block-chip' + (block === b.key ? ' on' : '')} aria-pressed=${block === b.key} onClick=${() => setBlock(b.key)}>
            <${Icon} name=${b.icon} size=${20} />${t('log.' + b.key)}</button>`)}
        </div>
      </div>
      <${Field} label=${t('log.text')}>
        <textarea class="input area big-text" rows="5" maxlength="2000" required autofocus value=${body} placeholder=${t('log.placeholder')} onInput=${(e) => setBody(e.target.value)}></textarea>
      <//>
      <div class="field"><span class="field-label">${t('log.where')} <small>(${t('assign.whoOptional')})</small></span>
        <div class="chips">
          ${s.areas.map((a) => html`<button type="button" key=${a.id} class=${'pick' + (area === a.id ? ' on' : '')} style=${colorStyle(a.color)} aria-pressed=${area === a.id} onClick=${() => setArea(area === a.id ? null : a.id)}>
            <${Icon} name=${a.icon || 'home'} size=${16} />${areaName(a)}</button>`)}
        </div>
      </div>
      <button type="button" class="switch-row" onClick=${() => setFollow(!follow)}>
        <span><b>${t('log.followUp')}</b><br /><span class="muted small-text">${t('log.followUpHint')}</span></span>
        <span class=${'switch' + (follow ? ' on' : '')} role="switch" aria-checked=${follow}><span class="knob"></span></span>
      </button>
      <button class="btn big-btn" type="submit" disabled=${!body.trim() || busy}><${Icon} name="circle-check" size=${22} />${t('log.save')}</button>
    </form>
  <//>`;
}
