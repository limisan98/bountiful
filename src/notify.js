// Notifications that Bountiful can show by itself: while the app is open (or sitting in the background of the phone),
// it hears about changes live and tells the person. Reaching a phone that has the app fully closed needs the
// notification service (a server), which is a later step.
import { state, toast } from './store.js';
import { t } from './i18n.js';
import { isSupervisor } from './roles.js';
import { mentionsMe } from './mentions.js';
import { areaOf, areaName } from './data.js';
import { parseYmd, fmt, hhmm } from './time.js';

export const KEY = 'bountiful.notif';

// All kinds of notification. "only: sup" ones are offered to supervisors only.
export const TYPES = [
  { key: 'mention', icon: 'message-2', def: true },
  { key: 'assigned', icon: 'clipboard-list', def: true },
  { key: 'reminder', icon: 'alarm', def: true },
  { key: 'done', icon: 'circle-check', def: true, sections: true },
  { key: 'chat', icon: 'messages', def: false },
  { key: 'started', icon: 'player-play', def: false, only: 'sup' },
  { key: 'delay', icon: 'clock', def: true, only: 'sup' },
  { key: 'comment', icon: 'message-report', def: true, only: 'sup' },
  { key: 'joined', icon: 'circle-plus', def: true, only: 'sup' },
  { key: 'daily', icon: 'report-analytics', def: false, only: 'sup' },
];

export function loadPrefs() {
  const meta = state.session && state.session.user && state.session.user.user_metadata;
  let local = null;
  try { local = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { /* ignore */ }
  const defaults = Object.fromEntries(TYPES.map((x) => [x.key, x.def]));
  return { ...defaults, doneAreas: [], ...(local || {}), ...((meta && meta.notif) || {}) };
}

function show(title, body, url) {
  if (document.visibilityState === 'visible') {
    if (url === '#/chat' && location.hash.startsWith('#/chat')) return; // already looking at it
    toast(body ? `${title}: ${body}` : title);
    return;
  }
  if (!('Notification' in window) || Notification.permission !== 'granted' || !navigator.serviceWorker) return;
  navigator.serviceWorker.getRegistration().then((reg) => {
    if (reg) reg.showNotification(title, { body: (body || '').slice(0, 140), icon: 'assets/logo/icon-192.png', data: { url: './' + url } });
  }).catch(() => {});
}

const nameOf = (id) => (state.profiles[id] ? state.profiles[id].display_name : t('chat.former'));
const when = (a) => `${fmt(parseYmd(a.day), { weekday: 'short', day: 'numeric', month: 'short' })}, ${hhmm(a.start_time)}`;

// Called for every live change, BEFORE the app's own copy is updated (so the old version is still around to compare).
export function notifyLive(table, type, row) {
  const me = state.profile;
  if (!me || !row || type === 'DELETE') return;
  const p = loadPrefs();
  const sup = isSupervisor(me);

  if (table === 'messages') {
    if (type !== 'INSERT' || row.sender === me.id) return;
    const name = nameOf(row.sender);
    if (p.mention && mentionsMe(row.body)) show(t('notify.mention', { name }), row.body, '#/chat');
    else if (p.chat) show(name, row.body, '#/chat');
    return;
  }

  if (table === 'assignments') {
    const prev = state.assignments[row.id];
    const tk = state.tasks[row.task_id];
    const tname = tk ? tk.name : '';
    if (row.assignee === me.id && row.created_by !== me.id && p.assigned) {
      if (type === 'INSERT') show(t('notify.assigned'), `${tname} · ${when(row)}`, '#/home');
      else if (prev && (prev.day !== row.day || prev.start_time !== row.start_time || prev.end_time !== row.end_time)) show(t('notify.changed'), `${tname} · ${when(row)}`, '#/home');
    }
    if (type === 'UPDATE' && prev && prev.status !== row.status && row.assignee !== me.id) {
      const name = nameOf(row.assignee);
      if (row.status === 'done' && p.done) {
        const area = tk && tk.area_id;
        if (!p.doneAreas.length || (area && p.doneAreas.includes(area))) {
          show(t('notify.done', { name }), [tname, areaName(areaOf(area))].filter(Boolean).join(' · '), '#/calendar');
        }
      } else if (row.status === 'doing' && sup && p.started) show(t('notify.started', { name }), tname, '#/calendar');
    }
    return;
  }

  if (table === 'assignment_reports' && sup) {
    const a = state.assignments[row.assignment_id];
    if (!a || a.assignee === me.id) return;
    const prev = state.reports[row.assignment_id] || {};
    const tk = state.tasks[a.task_id];
    const name = nameOf(a.assignee);
    if (p.delay && row.delay_reason && row.delay_reason !== prev.delay_reason) show(t('notify.delay', { name }), row.delay_reason, '#/calendar');
    else if (p.comment && row.comment && row.comment !== prev.comment) show(t('notify.comment', { name }), `${tk ? tk.name + ': ' : ''}${row.comment}`, '#/calendar');
    return;
  }

  if (table === 'profiles' && type === 'INSERT' && sup && p.joined && row.id !== me.id) {
    show(t('notify.joined'), row.display_name || '', '#/team');
  }
}
