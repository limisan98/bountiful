import { html, useState } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Avatar, RoleChip, Field, Sheet, Empty, useSheetControl } from '../ui.js';
import { isSupervisor } from '../roles.js';
import { requestMeeting, answerMeeting, cancelMeeting, activePeople } from '../data.js';
import { DateField, TimeField } from '../pickers.js';
import { ymd, parseYmd, addDays, todayYmd, fmt, hhmm } from '../time.js';

// Meetings. Anyone who is not a supervisor can ask a supervisor for a meeting (day, time, topic);
// the supervisor accepts or declines. Only the two people involved can see a request.
const when = (m) => `${fmt(parseYmd(m.day), { weekday: 'long', day: 'numeric', month: 'long' })} · ${hhmm(m.start_time)}`;
const STATUS_ICON = { pending: 'hourglass', accepted: 'circle-check', declined: 'circle-x', canceled: 'forbid' };

export function MeetingsView() {
  const s = useStore();
  const me = s.profile;
  const sup = isSupervisor(me);
  const [asking, setAsking] = useState(false);
  const today = todayYmd();
  const key = (m) => m.day + m.start_time;

  const mine = Object.values(s.meetings).filter((m) => (sup ? m.supervisor === me.id : m.requester === me.id));
  const waiting = mine.filter((m) => m.status === 'pending' && m.day >= today).sort((a, b) => key(a).localeCompare(key(b)));
  const upcoming = mine.filter((m) => m.status === 'accepted' && m.day >= today).sort((a, b) => key(a).localeCompare(key(b)));
  const earlier = mine.filter((m) => !waiting.includes(m) && !upcoming.includes(m)).sort((a, b) => key(b).localeCompare(key(a)));
  const card = (m) => html`<${MeetingCard} key=${m.id} m=${m} sup=${sup} taken=${upcoming} />`;

  return html`<div class="stack meetings">
    <div class="page-head"><div>
      <h2 class="page-title">${t('meetings.title')}</h2>
      <p class="page-sub">${sup ? t('meetings.subSup') : t('meetings.subAsk')}</p>
    </div></div>

    ${!mine.length ? html`<${Empty} icon="calendar-event" text=${sup ? t('meetings.emptySup') : t('meetings.emptyAsk')} />` : null}

    ${waiting.length ? html`<section class="rise"><h3 class="section-title">${sup ? t('meetings.waitingSup') : t('meetings.waitingAsk')}<span class="count">${waiting.length}</span></h3>
      <div class="list">${waiting.map(card)}</div></section>` : null}
    ${upcoming.length ? html`<section class="rise"><h3 class="section-title">${t('meetings.upcoming')}</h3>
      <div class="list">${upcoming.map(card)}</div></section>` : null}
    ${earlier.length ? html`<section class="rise"><h3 class="section-title">${t('meetings.earlier')}</h3>
      <div class="list">${earlier.slice(0, 20).map(card)}</div></section>` : null}

    ${!sup ? html`<button class="fab float pop" aria-label=${t('meetings.ask')} onClick=${() => setAsking(true)}><${Icon} name="plus" size=${26} /></button>` : null}
    ${asking ? html`<${AskSheet} onClose=${() => setAsking(false)} />` : null}
  </div>`;
}

function MeetingCard({ m, sup, taken }) {
  const s = useStore();
  const who = s.profiles[sup ? m.requester : m.supervisor];
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [sure, setSure] = useState(false);
  const clash = sup && m.status === 'pending' && taken.some((x) => x.day === m.day && x.start_time === m.start_time);
  const live = m.day >= todayYmd();

  async function run(fn, msg) {
    if (busy) return;
    setBusy(true);
    try { await fn(); if (msg) toast(msg); } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }

  return html`<article class=${'meeting-card ' + m.status}>
    <header class="mc-head">
      <${Avatar} profile=${who} size=${46} />
      <span class="mc-who"><b>${who ? who.display_name : t('chat.former')}</b>${who ? html`<${RoleChip} role=${who.role} small />` : null}</span>
      <span class=${'inv-status ' + m.status}><${Icon} name=${STATUS_ICON[m.status]} size=${15} />${t('meetings.status.' + m.status)}</span>
    </header>
    <div class="mc-when"><${Icon} name="calendar-event" size=${18} />${when(m)}</div>
    <p class="mc-topic">${m.topic}</p>
    ${m.reply ? html`<p class="mc-reply"><b>${t('meetings.reply')}</b> ${m.reply}</p>` : null}
    ${clash ? html`<p class="mc-clash"><${Icon} name="alert-triangle" size=${16} />${t('meetings.clash')}</p>` : null}

    ${sup && m.status === 'pending' && live && !declining ? html`<div class="inv-actions">
      <button class="btn small" disabled=${busy} onClick=${() => run(() => answerMeeting(m.id, true, ''), t('meetings.acceptedToast'))}><${Icon} name="check" size=${18} />${t('invite.accept')}</button>
      <button class="btn small soft" disabled=${busy} onClick=${() => setDeclining(true)}><${Icon} name="x" size=${18} />${t('invite.decline')}</button>
    </div>` : null}
    ${declining ? html`<div class="mc-decline pop">
      <input class="input slim" type="text" maxlength="300" placeholder=${t('meetings.reason')} value=${reason} onInput=${(e) => setReason(e.target.value)} />
      <div class="inv-actions">
        <button class="btn small soft" onClick=${() => setDeclining(false)}>${t('meetings.back')}</button>
        <button class="btn small" disabled=${busy} onClick=${() => run(() => answerMeeting(m.id, false, reason), t('meetings.declinedToast'))}>${t('meetings.declineSend')}</button>
      </div></div>` : null}

    ${!sup && live && (m.status === 'pending' || m.status === 'accepted') ? html`<div class="inv-actions">
      <button class=${'btn small soft' + (sure ? ' sure' : '')} disabled=${busy}
        onClick=${() => { if (!sure) { setSure(true); setTimeout(() => setSure(false), 3000); return; } run(() => cancelMeeting(m.id), t('meetings.canceledToast')); }}>
        ${sure ? t('team.removeSure') : t('meetings.cancel')}</button>
    </div>` : null}
  </article>`;
}

function AskSheet({ onClose }) {
  const s = useStore();
  const ctl = useSheetControl();
  const sups = activePeople().filter((p) => isSupervisor(p) && p.id !== s.profile.id);
  const [who, setWho] = useState(sups[0] ? sups[0].id : null);
  const [day, setDay] = useState(ymd(addDays(new Date(), 1)));
  const [time, setTime] = useState('10:00');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(e) {
    e.preventDefault();
    if (!who || !topic.trim() || busy) return;
    setBusy(true);
    try {
      await requestMeeting(who, day, time, topic.trim());
      toast(t('meetings.sent', { name: s.profiles[who].display_name.split(' ')[0] }));
      ctl.close();
    } catch (ex) { toast(friendlyError(ex), 'bad'); setBusy(false); }
  }

  return html`<${Sheet} title=${t('meetings.ask')} onClose=${onClose} control=${ctl}>
    <form class="stack-form" onSubmit=${send}>
      <div class="field"><span class="field-label">${t('meetings.with')}</span>
        ${!sups.length ? html`<p class="muted small-text">${t('meetings.noSup')}</p>` : null}
        <div class="people-pick">${sups.map((p) => html`<button type="button" key=${p.id} class=${'pp' + (who === p.id ? ' on' : '')} onClick=${() => setWho(p.id)}>
          <${Avatar} profile=${p} size=${30} ring=${false} /><span>${p.display_name}</span></button>`)}</div>
      </div>
      <div class="grid2">
        <${Field} label=${t('meetings.day')}><${DateField} value=${day} label=${t('meetings.day')} onChange=${setDay} /><//>
        <${Field} label=${t('meetings.time')}><${TimeField} value=${time} label=${t('meetings.time')} onChange=${setTime} /><//>
      </div>
      <${Field} label=${t('meetings.topic')} hint=${t('meetings.topicHint')}>
        <textarea class="input area" rows="3" maxlength="200" required value=${topic} onInput=${(e) => setTopic(e.target.value)}></textarea>
      <//>
      <button class="btn" type="submit" disabled=${!who || !topic.trim() || busy}><${Icon} name="send" size=${18} />${t('meetings.send')}</button>
    </form>
  <//>`;
}
