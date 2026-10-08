// Loading, live updates and the small "selectors" the screens use. All database calls go through api.js.
import { api } from './api.js';
import { state, set } from './store.js';
import { addMonths, monthKey, lastOfMonth, toMin, ymd, addDays } from './time.js';
import { departmentOf, isSupervisor } from './roles.js';
import { t } from './i18n.js';
import { notifyLive } from './notify.js';

const byId = (rows, key = 'id') => Object.fromEntries(rows.map((r) => [r[key], r]));
const months = new Set();

export function resetData() {
  months.clear();
  set({ roles: {}, areas: [], tasks: {}, assignments: {}, reports: {}, messages: {}, chatOpen: null, person: null, rooms: {}, digests: {}, invites: {}, meetings: {}, settings: {} });
}

// ---- loading ----
export async function loadCore() {
  const me = state.profile;
  const [roles, areas, tasks, rooms, digests, invites, meetings, recent, settings] = await Promise.all([
    api.loadRoles(), api.loadAreas(), api.loadTasks(), api.loadRooms(ymd(addDays(new Date(), -30))),
    isSupervisor(me) ? api.loadDigests() : [],
    departmentOf(me) === 'custodian' ? api.loadInvites(addDays(new Date(), -60).toISOString()) : [],
    api.loadMeetings(ymd(addDays(new Date(), -30))),
    inCrew(me) ? api.loadRecentMessages(300) : [],
    api.loadSettings().catch(() => ({})),
  ]);
  const messages = {};
  recent.forEach((m) => { (messages[m.channel] = messages[m.channel] || { list: [], more: true, loaded: false }).list.push(m); });
  Object.values(messages).forEach((c) => c.list.reverse());
  set({ roles: byId(roles), areas, tasks: byId(tasks), rooms: byId(rooms), digests: byId(digests), invites: byId(invites), meetings: byId(meetings), settings, messages, chatSeen: loadSeen(messages) });
  const now = new Date();
  await Promise.all([monthKey(now), monthKey(addMonths(now, -1)), monthKey(addMonths(now, 1))].map(ensureMonth));
}

export async function ensureMonth(key) {
  if (months.has(key)) return;
  months.add(key);
  try {
    const from = key + '-01', to = lastOfMonth(key);
    const [a, r] = await Promise.all([api.loadAssignments(from, to), api.loadReports(from, to)]);
    set({ assignments: { ...state.assignments, ...byId(a) }, reports: { ...state.reports, ...byId(r, 'assignment_id') } });
  } catch (e) { months.delete(key); throw e; }
}

// ---- small helpers the screens use ----
export const task = (id) => state.tasks[id];
export const person = (id) => state.profiles[id];
export const assignmentsOn = (day) => Object.values(state.assignments)
  .filter((a) => a.day === day)
  .sort((x, y) => toMin(x.start_time) - toMin(y.start_time) || (x.created_at || '').localeCompare(y.created_at || ''));
export const roomsOn = (day) => Object.values(state.rooms)
  .filter((r) => r.day === day)
  .sort((x, y) => x.room.localeCompare(y.room, undefined, { numeric: true }));
export const areaOf = (id) => state.areas.find((a) => a.id === id);
export const areaName = (a) => (a ? a.name || t('area.' + a.key) : '');
export const activePeople = () => Object.values(state.profiles).filter((p) => p.active !== false);
export const inCrew = (p) => !!p && departmentOf(p) === 'custodian'; // the custodian team (supervisor included): the only people in the chat
export const dmChannel = (a, b) => 'dm:' + [a, b].sort().join(':');
export const dmPartner = (channel) => channel.slice(3).split(':').find((x) => x !== (state.profile && state.profile.id));
export function openDm(personId) {
  set({ person: null, chatOpen: dmChannel(state.profile.id, personId) });
  location.hash = '#/chat';
}

function putAssignment(a) { set({ assignments: { ...state.assignments, [a.id]: a } }); }
function dropAssignment(id) {
  const assignments = { ...state.assignments }, reports = { ...state.reports };
  delete assignments[id]; delete reports[id];
  set({ assignments, reports });
}
function putFresh(id, { assignment, report }) {
  const reports = { ...state.reports };
  if (report) reports[id] = report; else delete reports[id];
  set({ assignments: { ...state.assignments, [id]: assignment }, reports });
}

// ---- changes (each one asks the database, then updates the screen) ----
export async function planAssignments(rows) {
  const made = await api.saveAssignments(rows);
  set({ assignments: { ...state.assignments, ...byId(made) } });
  return made;
}
export async function editAssignment(id, patch) { const row = await api.updateAssignment(id, patch); putAssignment(row); return row; }
export async function removeAssignment(id) { await api.deleteAssignment(id); dropAssignment(id); }
export async function startAssignment(id) { putFresh(id, await api.startAssignment(id)); }
export async function saveSteps(id, steps) {
  const a = state.assignments[id]; // show the tick at once, then confirm
  putAssignment({ ...a, steps_done: steps });
  try { putFresh(id, await api.setSteps(id, steps)); } catch (e) { putAssignment(a); throw e; }
}
export async function finishAssignment(id, minutes, comment, delay) { putFresh(id, await api.completeAssignment(id, minutes, comment, delay)); }
export async function reopenAssignment(id) { putFresh(id, await api.reopenAssignment(id)); }

export async function saveTask(t) {
  const row = await api.saveTask(t);
  set({ tasks: { ...state.tasks, [row.id]: row } });
  return row;
}
export async function archiveTask(id, fromDay) {
  const gone = await api.deleteFutureAssignments(id, fromDay);
  const row = await api.saveTask({ id, deleted: true });
  const assignments = { ...state.assignments };
  (gone || []).forEach((g) => delete assignments[g.id]);
  set({ tasks: { ...state.tasks, [id]: row }, assignments });
}
// How long cleaning one room should take (minutes). The supervisor can change it.
export const roomGoalMin = () => Number(state.settings.room_goal_minutes) || 30;
export async function setRoomGoal(minutes) {
  await api.setRoomGoal(minutes);
  set({ settings: { ...state.settings, room_goal_minutes: String(minutes) } });
}
export async function saveRole(id, patch) {
  const row = await api.updateRole(id, patch);
  set({ roles: { ...state.roles, [id]: row } });
}

// ---- chat ----
const chat = (c) => state.messages[c] || { list: [], more: true, loaded: false };
const mergeMsgs = (old, more) => {
  const m = new Map(old.map((x) => [x.id, x]));
  more.forEach((x) => m.set(x.id, x));
  return [...m.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
};
// "Unread" counters: kept on this device only. A conversation I have never opened counts as read at first start.
const SEEN = 'bountiful.chatSeen';
function loadSeen(messages) {
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(SEEN) || '{}') || {}; } catch (_) { /* ignore */ }
  const now = new Date().toISOString();
  Object.keys(messages).forEach((c) => { if (!seen[c]) seen[c] = now; });
  return seen;
}
export function markSeen(channel) {
  const seen = { ...state.chatSeen, [channel]: new Date().toISOString() };
  set({ chatSeen: seen });
  try { localStorage.setItem(SEEN, JSON.stringify(seen)); } catch (_) { /* ignore */ }
}
export const unreadOf = (channel) => {
  const c = state.messages[channel];
  const me = state.profile && state.profile.id;
  const seen = state.chatSeen[channel] || '';
  return c ? c.list.filter((m) => m.sender !== me && m.created_at > seen).length : 0;
};
// The chat list: the general chat first, then the DMs, newest first
export function conversations() {
  const dms = Object.keys(state.messages).filter((c) => c.startsWith('dm:') && state.messages[c].list.length)
    .map((c) => ({ channel: c, last: state.messages[c].list[state.messages[c].list.length - 1] }))
    .sort((a, b) => b.last.created_at.localeCompare(a.last.created_at));
  const g = state.messages.general;
  return [{ channel: 'general', last: g && g.list.length ? g.list[g.list.length - 1] : null }, ...dms];
}

export async function loadMessages(channel, older = false) {
  const cur = chat(channel);
  const before = older && cur.list.length ? cur.list[0].created_at : null;
  const rows = await api.loadMessages(channel, before, 60);
  set({ messages: { ...state.messages, [channel]: { list: mergeMsgs(cur.list, rows), more: rows.length === 60, loaded: true } } });
}
export async function sendMessage(channel, body) {
  const row = await api.sendMessage(channel, body);
  const cur = chat(channel);
  set({ messages: { ...state.messages, [channel]: { ...cur, list: mergeMsgs(cur.list, [row]) } } });
}
export async function removeMessage(id) {
  await api.deleteMessage(id);
  dropMessage(id);
}
function dropMessage(id) {
  const next = {};
  for (const [c, v] of Object.entries(state.messages)) next[c] = { ...v, list: v.list.filter((m) => m.id !== id) };
  set({ messages: next });
}

// ---- task invitations (custodian to custodian, shown in the chat) ----
const putInvite = (i) => set({ invites: { ...state.invites, [i.id]: i } });
export async function sendInvite(assignmentId, to, note) {
  const { invite, message } = await api.inviteToTask(assignmentId, to, note);
  putInvite(invite);
  const cur = chat(message.channel);
  set({ messages: { ...state.messages, [message.channel]: { ...cur, list: mergeMsgs(cur.list, [message]) } } });
}
export async function answerInvite(id, accept) {
  const r = await api.answerInvite(id, accept);
  putInvite(r.invite);
  if (r.assignment) putAssignment(r.assignment);
  return r.result;
}
export async function cancelInvite(id) { putInvite(await api.cancelInvite(id)); }
export const inviteFor = (m) => (m.invite_id ? state.invites[m.invite_id] : null);

// ---- meeting requests ----
const putMeeting = (m) => set({ meetings: { ...state.meetings, [m.id]: m } });
export async function requestMeeting(supervisor, day, time, topic) { putMeeting(await api.requestMeeting(supervisor, day, time, topic)); }
export async function answerMeeting(id, accept, reply) { putMeeting(await api.answerMeeting(id, accept, reply)); }
export async function cancelMeeting(id) { putMeeting(await api.cancelMeeting(id)); }

// ---- rooms to clean ----
function putRooms(rows) { set({ rooms: { ...state.rooms, ...byId([].concat(rows)) } }); }
export async function addRooms(rows) { putRooms(await api.addRooms(rows)); }
export async function assignRooms(ids, assignee) { putRooms(await api.assignRooms(ids, assignee)); }
export async function setRoomStatus(id, status) { putRooms(await api.setRoomStatus(id, status)); }
export async function editRoom(id, room, day, note) { putRooms(await api.editRoom(id, room, day, note)); }
export async function removeRoom(id) {
  await api.deleteRoom(id);
  const rooms = { ...state.rooms }; delete rooms[id]; set({ rooms });
}

// ---- live updates from the database (other people's changes show up at once) ----
let stop = null;
export function startLive() {
  if (stop) return;
  stop = api.subscribe((table, type, row, old) => {
    const del = type === 'DELETE';
    try { notifyLive(table, type, row); } catch (_) { /* a notification problem must never break live updates */ }
    const rec = (del ? old : row) || {};
    const id = table === 'assignment_reports' ? rec.assignment_id : rec.id;
    if (!id) return;
    if (table === 'profiles') {
      const profiles = { ...state.profiles };
      if (del) delete profiles[id]; else profiles[id] = row;
      const patch = { profiles };
      if (state.profile && state.profile.id === id && !del) patch.profile = row;
      set(patch);
    } else if (table === 'roles') {
      if (!del) set({ roles: { ...state.roles, [id]: row } });
    } else if (table === 'areas') {
      set({ areas: del ? state.areas.filter((a) => a.id !== id) : [...state.areas.filter((a) => a.id !== id), row].sort((a, b) => a.sort - b.sort) });
    } else if (table === 'tasks') {
      if (!del) set({ tasks: { ...state.tasks, [id]: row } });
    } else if (table === 'assignments') {
      if (del) dropAssignment(id); else if (months.has(row.day.slice(0, 7))) putAssignment(row);
    } else if (table === 'assignment_reports') {
      const reports = { ...state.reports };
      if (del) delete reports[id]; else reports[id] = row;
      set({ reports });
    } else if (table === 'custodian_reports') {
      const digests = { ...state.digests };
      if (del) delete digests[id]; else digests[id] = row;
      set({ digests });
    } else if (table === 'meeting_requests') {
      const meetings = { ...state.meetings };
      if (del) delete meetings[id]; else meetings[id] = row;
      set({ meetings });
    } else if (table === 'task_invites') {
      const invites = { ...state.invites };
      if (del) delete invites[id]; else invites[id] = row;
      set({ invites });
    } else if (table === 'room_requests') {
      const rooms = { ...state.rooms };
      if (del) delete rooms[id]; else rooms[id] = row;
      set({ rooms });
    } else if (table === 'messages') {
      if (del) { dropMessage(id); return; }
      const cur = chat(row.channel);
      set({ messages: { ...state.messages, [row.channel]: { ...cur, list: mergeMsgs(cur.list, [row]) } } });
    }
  });
}
export function stopLive() { if (stop) { stop(); stop = null; } }
