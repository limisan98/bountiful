import { html, useState } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Avatar, TaskBadge, Field, Sheet, RoleChip, useSheetControl } from '../ui.js';
import { isSupervisor, departmentOf } from '../roles.js';
import { colorStyle } from '../color.js';
import { sendInvite, answerInvite, cancelInvite, activePeople, ensureMonth } from '../data.js';
import { hhmm, parseYmd, fmt, todayYmd, monthKey, addMonths } from '../time.js';

// Can this person hand tasks over to colleagues? (custodians, not supervisors: supervisors plan work in the calendar)
export const canInvite = (p) => !!p && departmentOf(p) === 'custodian' && !isSupervisor(p);

const dayText = (a) => `${fmt(parseYmd(a.day), { weekday: 'short', day: 'numeric', month: 'short' })} · ${hhmm(a.start_time)}–${hhmm(a.end_time)}`;

// ---- The invitation as it appears in the chat ----
export function InviteCard({ inv, m, mine }) {
  const s = useStore();
  const me = s.profile;
  const from = s.profiles[inv.from_user], to = s.profiles[inv.to_user];
  const a = s.assignments[inv.assignment_id];
  const tk = a && s.tasks[a.task_id];
  const [busy, setBusy] = useState(false);
  const pending = inv.status === 'pending';

  async function run(fn, ok) {
    if (busy) return;
    setBusy(true);
    try { const r = await fn(); if (ok) ok(r); } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }
  const answer = (yes) => run(() => answerInvite(inv.id, yes), (r) => {
    if (r === 'unavailable') toast(t('invite.unavailable'), 'bad');
    else toast(yes ? t('invite.nowYours') : t('invite.declinedToast'));
  });

  return html`<div class=${'bubble invite ' + inv.status}>
    <div class="inv-top"><span class="inv-ic"><${Icon} name="replace" size=${18} /></span>
      <span>${t('invite.title', { from: from ? from.display_name.split(' ')[0] : t('chat.former'), to: to ? to.display_name.split(' ')[0] : t('chat.former') })}</span></div>
    <div class="inv-task" style=${tk ? colorStyle(tk.color) : ''}>
      ${tk ? html`<${TaskBadge} icon=${tk.icon} size=${44} />` : null}
      <span class="inv-task-main"><b>${tk ? tk.name : m.body}</b>${a ? html`<small>${dayText(a)}</small>` : null}</span>
    </div>
    ${inv.note ? html`<p class="inv-note">${inv.note}</p>` : null}
    <div class="inv-foot">
      <span class=${'inv-status ' + inv.status}><${Icon} name=${{ pending: 'hourglass', accepted: 'circle-check', declined: 'circle-x', canceled: 'forbid' }[inv.status]} size=${15} />${t('invite.status.' + inv.status)}</span>
      <time>${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
    </div>
    ${pending && inv.to_user === me.id ? html`<div class="inv-actions">
      <button class="btn small" disabled=${busy} onClick=${() => answer(true)}><${Icon} name="check" size=${18} />${t('invite.accept')}</button>
      <button class="btn small soft" disabled=${busy} onClick=${() => answer(false)}><${Icon} name="x" size=${18} />${t('invite.decline')}</button>
    </div>` : null}
    ${pending && inv.from_user === me.id ? html`<div class="inv-actions">
      <button class="btn small soft" disabled=${busy} onClick=${() => run(() => cancelInvite(inv.id), () => toast(t('invite.canceledToast')))}>${t('invite.cancel')}</button>
    </div>` : null}
  </div>`;
}

// ---- Pick one of my tasks and a colleague, send the invitation to the chat ----
export function InviteSheet({ onClose }) {
  const s = useStore();
  const me = s.profile;
  const ctl = useSheetControl();
  const [asg, setAsg] = useState(null);
  const [who, setWho] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // make sure this month and next month are loaded, so every upcoming task is in the list
  useState(() => { const now = new Date(); [monthKey(now), monthKey(addMonths(now, 1))].forEach((k) => ensureMonth(k).catch(() => {})); });

  const pendingFor = new Set(Object.values(s.invites).filter((i) => i.status === 'pending').map((i) => i.assignment_id));
  const mine = Object.values(s.assignments)
    .filter((a) => a.assignee === me.id && a.status === 'todo' && a.day >= todayYmd() && !pendingFor.has(a.id) && s.tasks[a.task_id])
    .sort((x, y) => x.day.localeCompare(y.day) || x.start_time.localeCompare(y.start_time));
  const crew = activePeople().filter((p) => canInvite(p) && p.id !== me.id).sort((a, b) => a.display_name.localeCompare(b.display_name));

  async function send(e) {
    e.preventDefault();
    if (!asg || !who || busy) return;
    setBusy(true);
    try { await sendInvite(asg, who, note.trim()); toast(t('invite.sent')); ctl.close(); }
    catch (ex) { toast(friendlyError(ex), 'bad'); setBusy(false); }
  }

  return html`<${Sheet} title=${t('invite.sheetTitle')} onClose=${onClose} control=${ctl}>
    <p class="muted small-text">${t('invite.sheetHelp')}</p>
    <form class="stack-form" onSubmit=${send}>
      <div class="field"><span class="field-label">${t('invite.pickTask')}</span>
        ${!mine.length ? html`<p class="muted small-text">${t('invite.noTasks')}</p>` : null}
        <div class="invite-tasks">${mine.map((a) => { const tk = s.tasks[a.task_id]; return html`<button type="button" key=${a.id} class=${'task-pick' + (asg === a.id ? ' on' : '')}
          style=${colorStyle(tk.color)} onClick=${() => setAsg(a.id)}>
          <${TaskBadge} icon=${tk.icon} size=${40} />
          <span><b>${tk.name}</b><small>${dayText(a)}</small></span></button>`; })}</div>
      </div>
      <div class="field"><span class="field-label">${t('invite.pickPerson')}</span>
        ${!crew.length ? html`<p class="muted small-text">${t('invite.noCrew')}</p>` : null}
        <div class="people-pick">${crew.map((p) => html`<button type="button" key=${p.id} class=${'pp' + (who === p.id ? ' on' : '')} onClick=${() => setWho(p.id)}>
          <${Avatar} profile=${p} size=${30} ring=${false} /><span>${p.display_name}</span></button>`)}</div>
      </div>
      <${Field} label=${t('invite.note')}><input class="input" type="text" maxlength="300" value=${note} onInput=${(e) => setNote(e.target.value)} /><//>
      <button class="btn" type="submit" disabled=${!asg || !who || busy}><${Icon} name="send" size=${18} />${t('invite.send')}</button>
    </form>
  <//>`;
}
