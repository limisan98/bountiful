// Notifications, two ways:
// 1) While the app is open (or sitting in the background), it hears about changes live and tells the person itself.
// 2) When the app is closed, the database asks the "push" function (supabase/functions/push) to send a real phone
//    notification. This file signs the phone up for that (enablePush) and signs it out again (disablePush).
import { state, toast } from './store.js';
import { SUPABASE_URL } from './config.js';
import { api } from './api.js';
import { t } from './i18n.js';
import { isSupervisor, departmentOf } from './roles.js';
import { mentionsMe } from './mentions.js';
import { areaOf, areaName, itemName } from './data.js';
import { parseYmd, fmt, hhmm, hasTime } from './time.js';

export const KEY = 'bountiful.notif';

// All kinds of notification. "only: sup" ones are offered to supervisors only.
export const TYPES = [
  { key: 'mention', icon: 'message-2', def: true, only: 'crew' },
  { key: 'dm', icon: 'message', def: true, only: 'crew' },
  { key: 'assigned', icon: 'clipboard-list', def: true },
  { key: 'reminder', icon: 'alarm', def: true },
  { key: 'done', icon: 'circle-check', def: true, sections: true },
  { key: 'invites', icon: 'replace', def: true, only: 'custodian' },
  { key: 'chat', icon: 'messages', def: false, only: 'crew' },
  { key: 'reports', icon: 'clipboard-data', def: true, only: 'sup' },
  { key: 'rooms', icon: 'bed', def: true, only: 'sup' },
  { key: 'roomsDone', icon: 'bed', def: true, only: 'reception' },
  { key: 'meetingNew', icon: 'calendar-event', def: true, only: 'sup' },
  { key: 'meetingAnswer', icon: 'calendar-event', def: true, only: 'staff' },
  { key: 'started', icon: 'player-play', def: false, only: 'sup' },
  { key: 'delay', icon: 'clock', def: true, only: 'sup' },
  { key: 'comment', icon: 'message-report', def: true },
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

// true once this phone is signed up for real push (then the server sends the "big" notifications, so the app must not repeat them)
let pushActive = false;

const keyBytes = (b64u) => {
  const s = atob((b64u + '='.repeat((4 - (b64u.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const sameKey = (buf, bytes) => !!buf && new Uint8Array(buf).length === bytes.length && new Uint8Array(buf).every((v, i) => v === bytes[i]);

// Sign this phone up for notifications that arrive even when the app is closed. Safe to call again and again.
export async function enablePush() {
  try {
    if (state.demo || !state.session || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    const r = await fetch(SUPABASE_URL + '/functions/v1/push');
    if (!r.ok) return false;
    const key = keyBytes((await r.json()).publicKey);
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub.options && sub.options.applicationServerKey, key)) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const j = sub.toJSON();
    await api.savePushSubscription(j.endpoint, j.keys.p256dh, j.keys.auth, state.lang);
    pushActive = true;
    return true;
  } catch (e) {
    console.warn('push signup failed', e);
    return false;
  }
}

// Sign this phone out of notifications (used when the person signs out, so the next person on it gets nothing).
export async function disablePush() {
  pushActive = false;
  try {
    if (state.demo || !('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (!sub) return;
    await api.dropPushSubscription(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  } catch (_) { /* ignore */ }
}

// localOnly = this kind of notification is not sent by the server, so the app shows it itself even when a push phone is signed up
function show(title, body, url, tag, localOnly) {
  if (document.visibilityState === 'visible') {
    toast(body ? `${title}: ${body}` : title);
    return;
  }
  if (pushActive && !localOnly) return; // the server already sends this one to the phone
  if (!('Notification' in window) || Notification.permission !== 'granted' || !navigator.serviceWorker) return;
  navigator.serviceWorker.getRegistration().then((reg) => {
    if (reg) reg.showNotification(title, { body: (body || '').slice(0, 140), icon: 'assets/logo/icon-192.png', data: { url: './' + url }, ...(tag ? { tag, renotify: true } : {}) });
  }).catch(() => {});
}

const nameOf = (id) => (state.profiles[id] ? state.profiles[id].display_name : t('chat.former'));
const when = (a) => fmt(parseYmd(a.day), { weekday: 'short', day: 'numeric', month: 'short' }) + (hasTime(a) ? `, ${hhmm(a.start_time)}` : '');

// Called for every live change, BEFORE the app's own copy is updated (so the old version is still around to compare).
export function notifyLive(table, type, row) {
  const me = state.profile;
  if (!me || !row || type === 'DELETE') return;
  const p = loadPrefs();
  const sup = isSupervisor(me);

  if (table === 'messages') {
    if (type !== 'INSERT' || row.sender === me.id) return;
    const name = nameOf(row.sender);
    const dm = row.channel.startsWith('dm:');
    const viewing = location.hash.startsWith('#/chat') && state.chatOpen === row.channel; // already reading it
    if (viewing) return;
    if (dm) { if (p.dm) show(name, row.body, '#/chat', 'dm-' + row.channel); }
    else if (p.mention && mentionsMe(row.body)) show(t('notify.mention', { name }), row.body, '#/chat');
    else if (p.chat) show(name, row.body, '#/chat');
    return;
  }

  if (table === 'assignments') {
    const prev = state.assignments[row.id]; // (missing when it was not on this phone yet: then it counts as new)
    const tk = state.tasks[row.task_id];
    const name = itemName(row);
    const text = `${name} · ${when(row)}`;
    const room = row.kind === 'room';
    const theirs = row.assignee === me.id;
    const wasMine = !!prev && prev.assignee === me.id;
    const tag = 'task-' + row.id;

    // a room request from reception, or one that was changed
    if (room && sup && p.rooms && row.requested_by && row.requested_by !== me.id && !row.assignee) {
      if (type === 'INSERT' || !prev) show(t('notify.rooms', { name: nameOf(row.requested_by) }), text, '#/tasks', 'rooms-new');
      else if (prev.title !== row.title || prev.day !== row.day || (prev.note || '') !== (row.note || '')) {
        show(t('notify.roomsEdited', { name: nameOf(row.requested_by) }), text + (row.note ? ' · ' + row.note : ''), '#/tasks', 'rooms-edit-' + row.id);
      }
    }
    // a task given to me. This also covers being given the SAME task again, or one that was taken away and given back.
    // (not when a colleague handed it over through an invitation I accepted, and not when I did it myself:
    // there is only one supervisor, so a supervisor who sees a task move to them did it themselves)
    const viaInvite = Object.values(state.invites).some((i) => i.assignment_id === row.id && i.to_user === me.id);
    if (theirs && !wasMine && p.assigned && !viaInvite && row.created_by !== me.id && (type === 'INSERT' || !sup)) {
      show(t(room ? 'notify.roomAssigned' : 'notify.assigned'), text, '#/tasks', tag);
    } else if (theirs && wasMine && p.assigned && row.created_by !== me.id) {
      const moved = prev.day !== row.day || prev.start_time !== row.start_time || prev.end_time !== row.end_time;
      const edited = room && (prev.title !== row.title || (prev.note || '') !== (row.note || ''));
      if (moved || edited) show(t(room ? 'notify.roomEdited' : 'notify.changed'), text, '#/tasks', tag);
    }
    if (type === 'UPDATE' && prev && prev.status !== row.status && !theirs) {
      const who = row.assignee ? nameOf(row.assignee) : '';
      if (row.status === 'done') {
        if (sup && p.done) {
          const area = tk && tk.area_id;
          if (!p.doneAreas.length || (area && p.doneAreas.includes(area))) {
            show(t('notify.done', { name: who }), [name, areaName(areaOf(area))].filter(Boolean).join(' · '), '#/tasks', 'done-' + row.id);
          }
        }
        if (room && row.requested_by === me.id && !sup && p.roomsDone) show(t('notify.roomDone', { name: who }), text, '#/tasks', 'rooms-done');
      } else if (row.status === 'doing' && sup && p.started) show(t('notify.started', { name: who }), name, '#/tasks', 'started-' + row.id);
    }
    return;
  }

  if (table === 'assignment_comments') {
    if (type !== 'INSERT' || row.author === me.id || !p.comment) return;
    const a = state.assignments[row.assignment_id];
    if (!a) return;
    const author = state.profiles[row.author];
    const fromBoss = author && isSupervisor(author);
    if ((fromBoss && a.assignee === me.id) || (!fromBoss && sup)) show(t('notify.comment', { name: nameOf(row.author) }), `${itemName(a)}: ${row.body}`, '#/tasks', 'comment-' + row.assignment_id);
    return;
  }

  if (table === 'meeting_requests') {
    const prev = state.meetings[row.id];
    const text = `${fmt(parseYmd(row.day), { weekday: 'short', day: 'numeric', month: 'short' })}, ${hhmm(row.start_time)} · ${row.topic}`;
    if (type === 'INSERT' && row.supervisor === me.id && p.meetingNew) show(t('notify.meetingNew', { name: nameOf(row.requester) }), text, '#/meetings', 'meeting-new');
    else if (type === 'UPDATE' && prev && prev.status === 'pending' && row.requester === me.id && p.meetingAnswer && (row.status === 'accepted' || row.status === 'declined')) {
      show(t('notify.meeting.' + row.status, { name: nameOf(row.supervisor) }), text, '#/meetings', 'meeting-answer');
    }
    return;
  }

  if (table === 'custodian_reports') {
    if (type === 'INSERT' && sup && p.reports) show(t('notify.report.' + row.kind, { name: nameOf(row.custodian) }), '', '#/reports', 'report-' + row.kind);
    return;
  }

  if (table === 'task_invites') {
    const prev = state.invites[row.id];
    const tk = state.tasks[(state.assignments[row.assignment_id] || {}).task_id];
    if (!p.invites) return;
    if (type === 'INSERT' && row.to_user === me.id) show(t('notify.invite', { name: nameOf(row.from_user) }), tk ? tk.name : '', '#/chat', 'invite');
    else if (type === 'UPDATE' && prev && prev.status === 'pending' && row.from_user === me.id && (row.status === 'accepted' || row.status === 'declined')) {
      show(t('notify.invite.' + row.status, { name: nameOf(row.to_user) }), tk ? tk.name : '', '#/chat', 'invite-answer');
    }
    return;
  }

  if (table === 'assignment_reports' && sup) {
    const a = state.assignments[row.assignment_id];
    if (!a || a.assignee === me.id) return;
    const prev = state.reports[row.assignment_id] || {};
    const tk = state.tasks[a.task_id];
    const name = nameOf(a.assignee);
    if (p.delay && row.delay_reason && row.delay_reason !== prev.delay_reason) show(t('notify.delay', { name }), row.delay_reason, '#/calendar', undefined, true);
    else if (p.comment && row.comment && row.comment !== prev.comment) show(t('notify.comment', { name }), `${tk ? tk.name + ': ' : ''}${row.comment}`, '#/calendar', undefined, true);
    return;
  }

  if (table === 'profiles' && type === 'INSERT' && sup && p.joined && row.id !== me.id) {
    show(t('notify.joined'), row.display_name || '', '#/team', undefined, true);
  }
}
