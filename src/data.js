// Loading, live updates and the small "selectors" the screens use. All database calls go through api.js.
import { api } from './api.js';
import { state, set } from './store.js';
import { addMonths, monthKey, lastOfMonth, toMin, timeKey, ymd, addDays } from './time.js';
import { departmentOf, isSupervisor } from './roles.js';
import { t } from './i18n.js';
import { notifyLive } from './notify.js';
import { problem, ratioOf, byImportance } from './shifts.js';

const byId = (rows, key = 'id') => Object.fromEntries(rows.map((r) => [r[key], r]));
const months = new Set();

export function resetData() {
  months.clear();
  set({ roles: {}, areas: [], tasks: {}, presets: {}, assignments: {}, reports: {}, messages: {}, chatOpen: null, person: null, comments: {}, shifts: {}, shiftPlan: {}, contracts: {}, logbook: {}, digests: {}, invites: {}, meetings: {}, settings: {} });
}

// ---- loading ----
export async function loadCore() {
  const me = state.profile;
  const [roles, areas, tasks, presets, digests, invites, meetings, recent, settings, shifts, contracts, logs] = await Promise.all([
    api.loadRoles(), api.loadAreas(), api.loadTasks(), api.loadPresets().catch(() => []),
    isSupervisor(me) ? api.loadDigests() : [],
    departmentOf(me) === 'custodian' ? api.loadInvites(addDays(new Date(), -60).toISOString()) : [],
    api.loadMeetings(ymd(addDays(new Date(), -30))),
    inCrew(me) ? api.loadRecentMessages(300) : [],
    api.loadSettings().catch(() => ({})),
    api.loadShifts().catch(() => []),
    api.loadContracts().catch(() => []),
    inCrew(me) ? api.loadLogbook(ymd(addDays(new Date(), -7)), ymd(addDays(new Date(), 1))).catch(() => []) : [],
  ]);
  const messages = {};
  recent.forEach((m) => { (messages[m.channel] = messages[m.channel] || { list: [], more: true, loaded: false }).list.push(m); });
  Object.values(messages).forEach((c) => c.list.reverse());
  set({ roles: byId(roles), areas, tasks: byId(tasks), presets: byId(presets), digests: byId(digests), invites: byId(invites), meetings: byId(meetings), settings, messages, chatSeen: loadSeen(messages),
    shifts: byId(shifts), contracts: byId(contracts, 'user_id'), logbook: byId(logs) });
  const now = new Date();
  await Promise.all([monthKey(now), monthKey(addMonths(now, -1)), monthKey(addMonths(now, 1))].map(ensureMonth));
}

export async function ensureMonth(key) {
  if (months.has(key)) return;
  months.add(key);
  try {
    const from = key + '-01', to = lastOfMonth(key);
    const [a, r, sp] = await Promise.all([api.loadAssignments(from, to), api.loadReports(from, to), api.loadShiftPlan(from, to).catch(() => [])]);
    set({ assignments: { ...state.assignments, ...byId(a) }, reports: { ...state.reports, ...byId(r, 'assignment_id') }, shiftPlan: { ...state.shiftPlan, ...byId(sp) } });
  } catch (e) { months.delete(key); throw e; }
}

// ---- small helpers the screens use ----
export const task = (id) => state.tasks[id];
export const person = (id) => state.profiles[id];
export const assignmentsOn = (day) => Object.values(state.assignments)
  .filter((a) => a.day === day)
  .sort((x, y) => timeKey(x) - timeKey(y) || (x.created_at || '').localeCompare(y.created_at || ''));
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

// ---- the name of a planned task: "Room cleaning · 12" (rooms carry their room number in the title) ----
// ---- ready-made area checklists ("presets", supabase/014): one per area and cleaning depth ----
export const presetsOfArea = (areaId) => Object.values(state.presets).filter((p) => p.area_id === areaId).sort((a, b) => a.level - b.level);
export const presetLang = (p) => (p.steps && p.steps[state.lang] ? state.lang : 'en');
export const presetSteps = (p) => (p.steps && p.steps[presetLang(p)]) || [];
export const presetName = (p) => areaName(areaOf(p.area_id)) + ' · ' + t('preset.level' + p.level);
// The first time a preset is used it becomes a normal library task (so timers, goals, reports and shift rules just work).
// After that the same library task is used again. One per language, because the checklist is saved in the supervisor's language.
export async function taskForPreset(p) {
  const lang = presetLang(p);
  const have = Object.values(state.tasks).find((x) => x.preset_id === p.id && x.preset_lang === lang && !x.deleted);
  if (have) return have;
  const area = areaOf(p.area_id);
  return saveTask({
    name: presetName(p), description: '', icon: area.icon || 'sparkles', color: area.color, area_id: area.id,
    start_time: '07:00', end_time: '22:30', frequency: 'weekdays', weekdays: [], steps: presetSteps(p).map((x) => ({ title: x.title, description: '' })),
    goal_minutes: p.goal_minutes, kind: 'task', priority: 'medium', auto: false, preset_id: p.id, preset_lang: lang,
  });
}

export const itemName = (a) => {
  const tk = state.tasks[a.task_id];
  return (tk ? tk.name : '') + (a.title ? (tk ? ' · ' : '') + a.title : '');
};

// Give planned tasks to people. One person: they take it over. Several people: each of them gets the task
// (or, with `share`, the tasks are shared out between them one by one). No people: take it back.
export async function giveTasks(ids, people, share) {
  const items = ids.map((id) => state.assignments[id]).filter((a) => a && a.status !== 'done');
  if (!people.length) {
    for (const a of items) await editAssignment(a.id, { assignee: null, status: 'todo', started_at: null, steps_done: [] });
    return { placed: items.length, skipped: 0 };
  }
  if (share && people.length > 1 && items.length > 1) {
    const r = await distribute(items.map((a) => a.id), people);
    return { placed: r.placed, skipped: r.left };
  }
  // everybody chosen gets the task: the first person takes the row, the others get a copy (only when the shift rules allow it)
  let placed = 0, skipped = 0;
  for (const a of items) {
    let first = true;
    for (const p of people) {
      if (problem(p, a.day, a, a.id)) { skipped += 1; continue; }
      if (first) {
        await editAssignment(a.id, a.assignee === p ? { assignee: p } : { assignee: p, status: 'todo', started_at: null, steps_done: [] });
        first = false;
      } else {
        await planAssignments([{ task_id: a.task_id, assignee: p, day: a.day, start_time: a.start_time, end_time: a.end_time, note: a.note, kind: a.kind, title: a.title, requested_by: a.requested_by }]);
      }
      placed += 1;
    }
  }
  return { placed, skipped };
}
export async function askRooms(day, rooms, note) {
  const made = await api.requestRooms(day, rooms, note);
  set({ assignments: { ...state.assignments, ...byId(made) } });
  return made;
}
export async function editRoomRequest(id, title, day, note) { putAssignment(await api.editRoomRequest(id, title, day, note)); }

// ---- comments on a task ----
export const commentsOf = (id) => state.comments[id] || null;
const mergeComments = (old, more) => {
  const m = new Map((old || []).map((x) => [x.id, x]));
  more.forEach((x) => m.set(x.id, x));
  return [...m.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
};
export async function loadComments(id) { set({ comments: { ...state.comments, [id]: mergeComments(state.comments[id], await api.loadComments(id)) } }); }
export async function addComment(id, body) {
  const row = await api.addComment(id, body);
  set({ comments: { ...state.comments, [id]: mergeComments(state.comments[id], [row]) } });
}
export async function removeComment(assignmentId, id) {
  await api.deleteComment(id);
  set({ comments: { ...state.comments, [assignmentId]: (state.comments[assignmentId] || []).filter((c) => c.id !== id) } });
}

// ---- shifts ----
export async function setShiftCell(user, day, shiftId) {
  const row = await api.setShift(user, day, shiftId);
  const shiftPlan = Object.fromEntries(Object.entries(state.shiftPlan).filter(([, p]) => !(p.user_id === user && p.day === day)));
  if (row) shiftPlan[row.id] = row;
  set({ shiftPlan });
}
export async function copyShiftWeek(fromMonday, days = 7) {
  // repeat last week's shifts on the same weekdays of the week after (keeps what is already planned there)
  const from = ymd(fromMonday), to = ymd(addDays(fromMonday, days - 1));
  const have = new Set(Object.values(state.shiftPlan).map((p) => p.user_id + p.day));
  const rows = Object.values(state.shiftPlan).filter((p) => p.day >= from && p.day <= to)
    .map((p) => ({ user_id: p.user_id, day: ymd(addDays(new Date(p.day + 'T00:00:00'), 7)), shift_id: p.shift_id }))
    .filter((r) => !have.has(r.user_id + r.day));
  if (!rows.length) return 0;
  const made = await api.setShifts(rows);
  set({ shiftPlan: { ...state.shiftPlan, ...byId(made) } });
  return made.length;
}
// Teams import: write many planned shifts at once. All together first; if the database refuses one, row by row so the rest still go in.
export async function importShiftPlan(rows) {
  let made = [];
  const failed = [];
  try { made = await api.setShifts(rows); }
  catch (_) {
    for (const r of rows) {
      try { made.push(...(await api.setShifts([r]))); } catch (ex) { failed.push({ row: r, error: ex }); }
    }
  }
  const replaced = new Set(made.map((m) => m.user_id + '|' + m.day));
  const shiftPlan = Object.fromEntries(Object.entries(state.shiftPlan).filter(([, p]) => !replaced.has(p.user_id + '|' + p.day)));
  made.forEach((m) => { shiftPlan[m.id] = m; });
  set({ shiftPlan });
  return { saved: made.length, failed };
}
export async function setContract(user, minutes) {
  await api.setContract(user, minutes);
  const today = ymd(new Date());
  const shiftPlan = Object.fromEntries(Object.entries(state.shiftPlan).filter(([, p]) => {
    if (p.user_id !== user || p.day < today) return true;
    const s = state.shifts[p.shift_id];
    return s && (s.kind === 'part') === (minutes === 240);
  }));
  set({ contracts: { ...state.contracts, [user]: { user_id: user, minutes } }, shiftPlan });
}

// Give a group of tasks to the people (who can take them) with the most room left: the most important first, never outside
// a shift and never over anyone's capacity. Returns how many were placed and how many are still waiting.
export async function distribute(ids, peopleIds) {
  const items = ids.map((id) => state.assignments[id]).filter((a) => a && a.status !== 'done').sort(byImportance);
  let placed = 0;
  for (const a of items) {
    const can = peopleIds.filter((p) => !problem(p, a.day, a, a.id))
      .sort((p, q) => ratioOf(p, a.day) - ratioOf(q, a.day) || (state.profiles[p].display_name || '').localeCompare(state.profiles[q].display_name || ''));
    if (!can.length) continue;
    const p = can[0];
    await editAssignment(a.id, a.assignee === p ? { assignee: p } : { assignee: p, status: 'todo', started_at: null, steps_done: [] });
    placed += 1;
  }
  return { placed, left: items.length - placed };
}
// The supervisor's "Give out the waiting tasks": the database does it (same rules as the shift guard)
export async function autoAllocate(day) {
  const placed = await api.allocateWaiting(day, null);
  const rows = await api.loadAssignments(day, day);
  set({ assignments: { ...state.assignments, ...byId(rows) } });
  return placed;
}

// ---- the handover logbook ----
export const logbookOn = (day) => Object.values(state.logbook).filter((e) => e.day === day).sort((a, b) => a.created_at.localeCompare(b.created_at));
export async function ensureLogbook(from, to) {
  const rows = await api.loadLogbook(from, to);
  set({ logbook: { ...state.logbook, ...byId(rows) } });
}
export async function addLogEntry(row) { const e = await api.addLogEntry(row); set({ logbook: { ...state.logbook, [e.id]: e } }); }
export async function resolveLogEntry(id, done) { const e = await api.resolveLog(id, done); set({ logbook: { ...state.logbook, [e.id]: e } }); }
export async function removeLogEntry(id) {
  await api.deleteLogEntry(id);
  const logbook = { ...state.logbook }; delete logbook[id]; set({ logbook });
}

// Come back up to date (after the phone slept, or the connection dropped): reload what is on screen
let refreshing = false;
export async function refresh() {
  if (refreshing || !state.profile || state.demo) return;
  refreshing = true;
  try {
    const parts = await Promise.all([...months].map(async (k) => {
      const from = k + '-01', to = lastOfMonth(k);
      const [a, r, sp] = await Promise.all([api.loadAssignments(from, to), api.loadReports(from, to), api.loadShiftPlan(from, to).catch(() => [])]);
      return { a, r, sp };
    }));
    const assignments = {}, reports = {}, shiftPlan = {};
    parts.forEach((p) => { p.a.forEach((x) => { assignments[x.id] = x; }); p.r.forEach((x) => { reports[x.assignment_id] = x; }); p.sp.forEach((x) => { shiftPlan[x.id] = x; }); });
    const patch = { assignments, reports, shiftPlan, tasks: byId(await api.loadTasks()) };
    if (inCrew(state.profile)) {
      const logs = await api.loadLogbook(ymd(addDays(new Date(), -7)), ymd(addDays(new Date(), 1)));
      patch.logbook = { ...state.logbook, ...byId(logs) };
    }
    set(patch);
  } catch (_) { /* try again next time */ } finally { refreshing = false; }
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
    } else if (table === 'assignment_comments') {
      const aid = rec.assignment_id;
      if (del) { if (aid && state.comments[aid]) set({ comments: { ...state.comments, [aid]: state.comments[aid].filter((c) => c.id !== id) } }); }
      else if (state.comments[aid]) set({ comments: { ...state.comments, [aid]: mergeComments(state.comments[aid], [row]) } });
    } else if (table === 'shift_plan') {
      const shiftPlan = { ...state.shiftPlan };
      if (del) delete shiftPlan[id]; else shiftPlan[id] = row;
      set({ shiftPlan });
    } else if (table === 'staff_contracts') {
      const contracts = { ...state.contracts };
      const uid = rec.user_id;
      if (del) { if (uid) delete contracts[uid]; } else contracts[uid] = row;
      set({ contracts });
    } else if (table === 'logbook_entries') {
      const logbook = { ...state.logbook };
      if (del) delete logbook[id]; else logbook[id] = row;
      set({ logbook });
    } else if (table === 'messages') {
      if (del) { dropMessage(id); return; }
      const cur = chat(row.channel);
      set({ messages: { ...state.messages, [row.channel]: { ...cur, list: mergeMsgs(cur.list, [row]) } } });
    }
  });
}
export function stopLive() { if (stop) { stop(); stop = null; } }
