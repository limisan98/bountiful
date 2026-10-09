// DEMO MODE: open the site with ?demo=custodian_supervisor (or custodian, receptionist)
// to look around with pretend people and pretend work. Nothing here touches the real database and nobody is really signed in.
import { state, set } from './store.js';
import { useDemoApi } from './api.js';
import { loadCore, startLive } from './data.js';
import { ROLE_DEFAULTS } from './config.js';
import { DEMO_AREAS, DEMO_PRESETS } from './demo-presets.js';
import { ymd, addDays, isoWeekday, toMin, fromMin, todayYmd, taskGoal } from './time.js';

let n = 0;
const uid = () => 'demo-' + (++n) + '-' + Math.random().toString(16).slice(2, 8);
const swatch = (bg, fg) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}"/><circle cx="50" cy="40" r="19" fill="${fg}"/><ellipse cx="50" cy="92" rx="34" ry="30" fill="${fg}"/></svg>`);

const now = () => new Date();
const iso = (dayOffset, hh, mm = 0) => { const d = addDays(now(), dayOffset); d.setHours(hh, mm, 0, 0); return d.toISOString(); };

const people = [
  { id: 'd1', email: 'anna.lane@example.org', display_name: 'Anna Lane', role: 'custodian_supervisor', active: true, avatar_url: null },
  { id: 'd2', email: 'jonas.weber@example.org', display_name: 'Jonas Weber', role: 'custodian', active: true, avatar_url: null },
  { id: 'd3', email: 'maria.santos@example.org', display_name: 'Maria Santos', role: 'custodian', active: true, avatar_url: swatch('#FFDD94', '#9A7A2E') },
  { id: 'd4', email: 'noah.lindqvist@example.org', display_name: 'Noah Lindqvist', role: 'custodian', active: true, avatar_url: null },
  { id: 'd5', email: 'elena.rossi@example.org', display_name: 'Elena Rossi', role: 'receptionist', active: true, avatar_url: swatch('#CCABD8', '#6C4A85') },
  { id: 'd6', email: 'liam.devries@example.org', display_name: 'Liam de Vries', role: 'receptionist', active: true, avatar_url: null },
].map((p) => ({ ...p, created_at: iso(-60, 9) }));
const pending = [{ email: 'sofia.berg@example.org', full_name: 'Sofia Berg', role: 'custodian', invite_code: 'K3M9Q2XA', claimed_by: null }];

const roles = Object.entries(ROLE_DEFAULTS).map(([id, r]) => ({ id, ...r, name: null }));
const areas = [
  { id: 'a1', key: 'temple', name: null, icon: 'home-2', color: '#CCABD8', sort: 1 },
  { id: 'a2', key: 'guesthouse', name: null, icon: 'bed', color: '#86E3CE', sort: 2 },
  { id: 'a3', key: 'visitors', name: null, icon: 'compass', color: '#FFDD94', sort: 3 },
  { id: 'a4', key: 'cafeterias', name: null, icon: 'tools-kitchen-2', color: '#FA897B', sort: 4 },
  { id: 'a5', key: 'offices', name: null, icon: 'briefcase', color: '#D0E6A5', sort: 5 },
  { id: 'a6', key: 'annex', name: null, icon: 'home', color: '#FA897B', sort: 6 },
];
DEMO_AREAS.forEach((a, i) => areas.push({ id: 'a' + (7 + i), name: null, ...a }));
const presets = DEMO_PRESETS.map((p, i) => ({ id: 'p' + (i + 1), area_id: areas.find((a) => a.key === p.area).id, level: p.level, goal_minutes: p.goal_minutes, steps: p.steps }));
const mk = (name, icon, color, area_id, s, e, frequency, weekdays, steps, description = '') => ({
  id: uid(), name, icon, color, area_id, start_time: s, end_time: e, frequency, weekdays, description,
  steps: steps.map((x) => ({ title: x[0], description: x[1] || '' })), deleted: false, kind: 'task', goal_minutes: null, priority: 'medium', auto: false, month_day: null, created_at: iso(-60, 9),
});
const tasks = [
  mk('Temple floors', 'sparkles', '#86E3CE', 'a1', '07:00', '11:00', 'daily', [],
    [['Sweep entrance and hallways'], ['Mop the prayer hall', 'Use the neutral cleaner only'], ['Dust the benches'], ['Check the restrooms']], 'Keep the main halls peaceful and spotless before visitors arrive.'),
  mk('Guesthouse rooms', 'bed', '#CCABD8', 'a2', '10:00', '14:00', 'daily', [],
    [['Change linens'], ['Vacuum and dust'], ['Bathroom'], ['Restock towels and soap']]),
  mk('Garden and entrance', 'flower', '#D0E6A5', 'a1', '08:00', '09:30', 'weekdays', [1, 3, 5], [['Water the plants'], ['Sweep leaves']]),
  mk('Visitors center tidy-up', 'compass', '#FFDD94', 'a3', '13:00', '15:00', 'daily', [], [['Reset the displays'], ['Refill brochures']]),
  mk('Laundry', 'shirt', '#86E3CE', 'a2', '14:30', '16:30', 'weekdays', [2, 4], [['Wash'], ['Dry and fold']]),
  mk('Cafeteria close-down', 'tools-kitchen-2', '#FA897B', 'a4', '17:00', '19:00', 'daily', [], [['Wipe tables'], ['Clean the kitchen'], ['Take out the trash']]),
  mk('Next-day room list', 'clipboard-list', '#CCABD8', 'a2', '16:00', '17:00', 'daily', [], [['Check tomorrow’s arrivals'], ['Send the list to the custodians']]),
];

tasks[0].goal_minutes = 180;
tasks[0].priority = 'high'; tasks[0].auto = true; tasks[3].priority = 'low'; tasks[4].priority = 'low'; tasks[5].priority = 'high'; tasks[5].auto = true; // (the supervisor can set a goal; tasks without one use their time window)

const assignments = [], reports = [];
const crew = ['d2', 'd3', 'd4'];
const comments = ['All good.', 'Ran out of the neutral cleaner — please reorder.', '', 'The back door was locked, had to find the key.', ''];
const delays = ['A group of visitors arrived and I waited for them to leave the hall.', 'The vacuum needed a new bag.', ''];
for (let off = -4; off <= 4; off++) {
  const d = addDays(now(), off);
  tasks.forEach((tk, ti) => {
    if (tk.frequency === 'weekdays' && !tk.weekdays.includes(isoWeekday(d))) return;
    const pool = ti === 6 ? ['d6', 'd5'] : crew;
    const who = ti === 6 ? [pool[Math.abs(off) % 2]] : [pool[(off + ti + 9) % 3], ...(ti === 0 ? [pool[(off + ti + 10) % 3]] : [])];
    who.forEach((p, wi) => {
      const a = { id: uid(), task_id: tk.id, assignee: p, day: ymd(d), start_time: tk.start_time, end_time: tk.end_time, note: ti === 1 && off === 0 && wi === 0 ? 'Rooms 4 and 7 have guests arriving tonight.' : '',
        status: 'todo', steps_done: [], started_at: null, completed_at: null, created_by: 'd1', created_at: iso(-5, 9), kind: 'task', title: '', requested_by: null };
      const goal = toMin(tk.end_time) - toMin(tk.start_time);
      const finish = (mins, c, dl) => {
        a.status = 'done'; a.steps_done = tk.steps.map((_, i) => i); a.started_at = iso(off, 7 + (ti % 2)); a.completed_at = iso(off, 9 + (ti % 3), 10 + ti * 5);
        reports.push({ assignment_id: a.id, minutes_spent: mins, goal_minutes: goal, comment: c, delay_reason: dl, completed_at: a.completed_at });
      };
      if (off < 0) finish(goal + ((ti + wi + off) % 3 === 0 ? 25 : -10), comments[(ti + wi + off + 9) % 5], (ti + wi + off) % 3 === 0 ? delays[(ti + off + 9) % 3] || delays[0] : '');
      else if (off === 0) {
        if (toMin(tk.end_time) < 12 * 60 && ti === 0) finish(goal - 5, 'Finished early.', '');
        else if (ti === 1 && wi === 0) { a.status = 'doing'; a.started_at = new Date(Date.now() - 35 * 60000).toISOString(); a.steps_done = [0]; }
      }
      assignments.push(a);
    });
  });
}

const messages = [
  { id: uid(), channel: 'general', sender: 'd1', body: 'Good morning everyone! Reminder: the stake choir visits the temple at 14:00 today.', created_at: iso(-1, 8, 40) },
  { id: uid(), channel: 'general', sender: 'd4', body: 'Thank you Anna! I will start with the chapel.', created_at: iso(-1, 8, 52) },
  { id: uid(), channel: 'general', sender: 'd1', body: 'Custodians: we are low on neutral cleaner. Please note it in your comments when you use the last bottle.', created_at: iso(-1, 16, 10) },
  { id: uid(), channel: 'general', sender: 'd4', body: 'Will do!', created_at: iso(-1, 16, 14) },
  { id: uid(), channel: 'general', sender: 'd2', body: 'Perfect, we will have everything ready. 🌿', created_at: iso(0, 7, 5) },
  { id: uid(), channel: 'general', sender: 'd3', body: 'The temple floors are done — it smells so fresh in there!', created_at: iso(0, 9, 31) },
  { id: uid(), channel: 'dm:d1:d2', sender: 'd1', body: 'Jonas, could you take the early shift on Friday?', created_at: iso(-1, 17, 5) },
  { id: uid(), channel: 'dm:d1:d2', sender: 'd2', body: 'Sure, no problem!', created_at: iso(-1, 17, 9) },
  { id: uid(), channel: 'dm:d2:d3', sender: 'd3', body: 'Do you have the key for the supply room?', created_at: iso(0, 8, 20) },
];
const dmKey = (a, b) => 'dm:' + [a, b].sort().join(':');

// (rooms are tasks: see the room task and the planned room tasks below)
const settings = {};
const taskComments = []; // comments on tasks
const invites = [];
// meeting requests (day, time, topic) from the team to the supervisor
const meetings = [];
{
  const mk = (who, off, time, topic, status = 'pending', reply = '') => meetings.push({ id: uid(), requester: who, supervisor: 'd1', day: ymd(addDays(now(), off)), start_time: time + ':00', topic, status, reply, created_at: iso(-1, 14), answered_at: status === 'pending' ? null : iso(0, 8) });
  mk('d2', 1, '10:00', 'Schedule for the temple open house week');
  mk('d3', 2, '14:30', 'Question about my hours next month');
  mk('d5', 1, '10:00', 'Rooms for the weekend group', 'pending');
  mk('d4', 3, '09:00', 'Cleaning supplies running low', 'accepted');
  mk('d6', -2, '11:00', 'Guest feedback', 'declined', 'Let’s talk at the next staff meeting.');
}
{
  const roomTask = { ...mk('Room cleaning', 'bed', '#FFDD94', null, '08:00', '17:00', 'weekdays', [],
    [['Strip and make the bed'], ['Dust and vacuum'], ['Bathroom'], ['Restock towels and soap']], 'Clean one guest room.'), kind: 'room', goal_minutes: 30 };
  tasks.push(roomTask);
  const mkRoom = (day, room, extra = {}) => assignments.push({ id: uid(), task_id: roomTask.id, assignee: null, day: ymd(addDays(now(), day)), start_time: null, end_time: null, note: '',
    status: 'todo', steps_done: [], started_at: null, completed_at: null, created_by: 'd5', created_at: iso(day - 1, 16, 30), kind: 'room', title: room, requested_by: 'd5', ...extra });
  mkRoom(0, '4', { assignee: 'd3', status: 'done', started_at: iso(0, 10, 50), completed_at: iso(0, 11, 20), created_by: 'd5' });
  reports.push({ assignment_id: assignments[assignments.length - 1].id, minutes_spent: 27, goal_minutes: 30, comment: '', delay_reason: '', completed_at: iso(0, 11, 20) });
  mkRoom(0, '7', { assignee: 'd3', status: 'doing', started_at: new Date(Date.now() - 12 * 60000).toISOString() });
  mkRoom(0, '12', { assignee: 'd2', note: 'Guests arrive at 3 pm' });
  mkRoom(0, 'Suite A');
  mkRoom(1, '3', { requested_by: 'd6', created_by: 'd6' });
  mkRoom(1, '5', { requested_by: 'd6', created_by: 'd6', note: 'Extra bed please' });
  mkRoom(1, '9', { requested_by: 'd6', created_by: 'd6' });
  taskComments.push({ id: uid(), assignment_id: assignments.find((a) => a.title === '7').id, author: 'd3', body: 'The bathroom tap is dripping.', created_at: iso(0, 10, 55) });
}
// task invitations between custodians (they also appear as messages in the custodians' chat)
{
  const mkAsg = (taskIdx, off, who) => {
    const tk = tasks[taskIdx], d = addDays(now(), off);
    const a = { id: uid(), task_id: tk.id, assignee: who, day: ymd(d), start_time: tk.start_time, end_time: tk.end_time, note: '', status: 'todo', steps_done: [], started_at: null, completed_at: null, created_by: 'd1', created_at: iso(-3, 9), kind: 'task', title: '', requested_by: null };
    assignments.push(a); return a;
  };
  const mkInv = (a, from, to, status, note, hoursAgo) => {
    const inv = { id: uid(), assignment_id: a.id, from_user: from, to_user: to, note, status, created_at: iso(0, 9 - hoursAgo), answered_at: status === 'pending' ? null : iso(0, 10) };
    invites.push(inv);
    messages.push({ id: uid(), channel: 'general', sender: from, body: note || tasks.find((x) => x.id === a.task_id).name, invite_id: inv.id, created_at: inv.created_at });
    return inv;
  };
  mkInv(mkAsg(3, 2, 'd4'), 'd4', 'd2', 'pending', 'Dentist appointment that day, could you take this one?', 2);
  const acc = mkAsg(4, 3, 'd4'); acc.assignee = 'd4'; mkInv(acc, 'd3', 'd4', 'accepted', '', 5);
  mkInv(mkAsg(3, 3, 'd3'), 'd2', 'd3', 'declined', 'Could you swap with me?', 6);
  mkInv(mkAsg(2, 4, 'd2'), 'd2', 'd4', 'pending', '', 1);
}

// automatic reports: the same numbers the database would write (see supabase/005_automatic_reports.sql)
const digests = [];
function summarize(pid, from, to, detail) {
  const tkOf = (a) => tasks.find((x) => x.id === a.task_id);
  const mine = assignments.filter((a) => a.assignee === pid && a.day >= from && a.day <= to);
  const done = mine.filter((a) => a.status === 'done');
  const rep = (a) => reports.find((r) => r.assignment_id === a.id) || {};
  const byTask = {};
  done.forEach((a) => { const n = tkOf(a).name; const b = (byTask[n] = byTask[n] || { task: n, count: 0, minutes: 0 }); b.count += 1; b.minutes += rep(a).minutes_spent || 0; });
  return {
    planned: mine.length, done: done.length, minutes: done.reduce((s, a) => s + (rep(a).minutes_spent || 0), 0),
    over: done.filter((a) => rep(a).minutes_spent > rep(a).goal_minutes).length,
    tasks: Object.values(byTask),
    items: done.filter((a) => detail || rep(a).comment || rep(a).delay_reason)
      .map((a) => ({ day: a.day, task: tkOf(a).name, minutes: rep(a).minutes_spent, goal: rep(a).goal_minutes, comment: rep(a).comment || '', delay: rep(a).delay_reason || '' })),
    open: detail ? mine.filter((a) => a.status !== 'done').map((a) => ({ day: a.day, task: tkOf(a).name })) : [],
    rooms: [],
  };
}
{
  const put = (kind, from, to, pid, hours = 23) => {
    const sm = summarize(pid, from, to, kind === 'day');
    if (sm.planned) digests.push({ id: uid(), kind, period_start: from, period_end: to, custodian: pid, summary: sm, created_at: iso(0, 0) });
  };
  ['d2', 'd3', 'd4'].forEach((pid) => {
    [-1, -2, -3].forEach((o) => put('day', ymd(addDays(now(), o)), ymd(addDays(now(), o)), pid));
    // (in the real app these close on Saturdays; the preview just ends them yesterday so there is something to read)
    const end = ymd(addDays(now(), -1));
    put('week', ymd(addDays(now(), -7)), end, pid);
    put('month', ymd(addDays(now(), -28)), end, pid);
    put('quarter', ymd(addDays(now(), -91)), end, pid);
  });
}

let handler = null;
let sentHello = false;
const me = () => people.find((p) => p.id === state.profile.id);
const isSup = () => !!(ROLE_DEFAULTS[me().role] || {}).is_supervisor;
const dept = () => (ROLE_DEFAULTS[me().role] || {}).department;
const pushProfiles = () => {
  const map = Object.fromEntries(people.map((p) => [p.id, p]));
  set({ profiles: map, profile: map[state.profile.id] });
};
const fresh = (id) => ({ assignment: assignments.find((a) => a.id === id), report: reports.find((r) => r.assignment_id === id) || null });
const clone = (x) => JSON.parse(JSON.stringify(x));
const goalOf = (a) => { const tk = tasks.find((x) => x.id === a.task_id); return (tk && tk.goal_minutes) || (a.start_time ? toMin(a.end_time) - toMin(a.start_time) : toMin(tk.end_time) - toMin(tk.start_time)) || 30; };


// ---- shifts, contracts, the shift plan and the handover logbook ----
const shifts = [
  ['morning_full', 'full', '07:00', '07:00', '15:30', [1, 2, 3, 4, 5, 6, 7], 480],
  ['morning_part_a', 'part', '08:00', '08:00', '12:00', [1, 2, 3, 4, 5, 6, 7], 240],
  ['morning_part_b', 'part', '08:00', '09:00', '13:00', [1, 2, 3, 4, 5, 6, 7], 240],
  ['afternoon_full', 'full', '14:00', '14:00', '22:30', [1, 2, 3, 4, 6, 7], 480],
  ['afternoon_full_fri', 'full', '14:00', '14:30', '23:00', [5], 480],
  ['evening_part', 'part', '18:30', '18:30', '22:30', [1, 2, 3, 4, 5, 6, 7], 240],
].map(([key, kind, block, s, e, weekdays, cap], i) => ({ id: 'sh-' + key, key, kind, block, start_time: s + ':00', end_time: e + ':00', weekdays, capacity_minutes: cap, sort: i + 1 }));
const contracts = [{ user_id: 'd1', minutes: 480 }, { user_id: 'd2', minutes: 480 }, { user_id: 'd3', minutes: 480 }, { user_id: 'd4', minutes: 240 }];
const shiftPlan = [];
{
  // everybody on the crew gets the shift that fits their tasks best (4-hour people: short shifts, 8-hour people: long ones)
  for (let off = -2; off <= 12; off++) {
    const d = addDays(now(), off), k = ymd(d), dow = isoWeekday(d);
    ['d1', 'd2', 'd3', 'd4'].forEach((uidd, pi) => {
      if (uidd === 'd1' && dow > 5) return;
      const mine = assignments.filter((a) => a.assignee === uidd && a.day === k && a.start_time);
      const kind = contracts.find((c) => c.user_id === uidd).minutes === 240 ? 'part' : 'full';
      const ok = shifts.filter((x) => x.kind === kind && x.weekdays.includes(dow));
      let best = null, bestScore = -1;
      ok.forEach((x) => {
        const score = mine.reduce((n, a) => n + Math.max(0, Math.min(toMin(a.end_time), toMin(x.end_time)) - Math.max(toMin(a.start_time), toMin(x.start_time))), 0);
        if (score > bestScore || (score === bestScore && !mine.length && (pi + off) % 2 === 0)) { best = x; bestScore = score; }
      });
      if (!mine.length && kind === 'full') best = ok.find((x) => x.block === ((pi + off + 20) % 2 ? '14:00' : '07:00')) || best;
      if (best) shiftPlan.push({ id: uid(), user_id: uidd, day: k, shift_id: best.id, created_by: 'd1', created_at: iso(-3, 9) });
    });
  }
}
{
  // the demo follows the rules too: a day that is more than someone's capacity (4 h = 240, 8 h = 480) gives its extra tasks back to "waiting"
  const goal = (a) => { const tk = tasks.find((x) => x.id === a.task_id); return taskGoal(tk, a); };
  const held = new Set(invites.map((i) => i.assignment_id));
  shiftPlan.forEach((pl) => {
    const sh = shifts.find((x) => x.id === pl.shift_id), cap = Math.min(contracts.find((c) => c.user_id === pl.user_id).minutes, sh.capacity_minutes);
    const day = assignments.filter((a) => a.assignee === pl.user_id && a.day === pl.day);
    let load = day.reduce((n, a) => n + goal(a), 0);
    day.filter((a) => a.status === 'todo' && !held.has(a.id)).sort((a, b) => goal(b) - goal(a)).forEach((a) => {
      if (load > cap) { a.assignee = null; load -= goal(a); }
    });
  });
}
const logbook = [];
{
  const mkLog = (off, block, who, body, extra = {}) => logbook.push({ id: uid(), day: ymd(addDays(now(), off)), block, body, area_id: null, follow_up: false, resolved_by: null, resolved_at: null, author: who, created_at: iso(off, block === 'morning' ? 11 : block === 'afternoon' ? 17 : 21, 10), ...extra });
  mkLog(-1, 'evening', 'd4', 'The chapel carpet by the side door is wet. A fan is running, please check it in the morning.', { follow_up: true, area_id: 'a1' });
  mkLog(-1, 'afternoon', 'd2', 'Visitors center: the brochure stand is almost empty. New ones are in the supply room.', { area_id: 'a3' });
  mkLog(0, 'morning', 'd3', 'Temple floors are finished. We ran out of neutral cleaner, one bottle left in the cart.', { area_id: 'a1', follow_up: true });
  mkLog(0, 'morning', 'd2', 'Office door key is back at the front desk.', { area_id: 'a5' });
}

const demoApi = {
  async listAllowlist() {
    return [
      ...people.map((p) => ({ email: p.email, full_name: p.display_name, role: p.role, invite_code: 'USED0000', claimed_by: p.id })),
      ...pending,
    ];
  },
  async addPerson({ email, full_name, role }) { pending.push({ email, full_name, role, invite_code: Math.random().toString(16).slice(2, 10).toUpperCase(), claimed_by: null }); },
  async updateInvite(email, patch) { Object.assign(pending.find((r) => r.email === email) || {}, patch); },
  async removeInvite(email) { const i = pending.findIndex((r) => r.email === email); if (i >= 0) pending.splice(i, 1); },
  async adminUpdateMember(id, role, active) { Object.assign(people.find((p) => p.id === id), { role, active }); pushProfiles(); },
  async loadProfiles() { return clone(people); },
  async updateMyProfile(patch) { Object.assign(me(), patch); pushProfiles(); return me(); },
  async uploadAvatar(blob) { return URL.createObjectURL(blob); },
  async changePassword() {},
  async saveLanguage() {},
  async saveNotifPrefs() {},
  async savePushSubscription() {},
  async dropPushSubscription() {},
  async loadSettings() { return { ...settings }; },
  async loadRoles() { return clone(roles); },
  async updateRole(id, patch) { Object.assign(roles.find((r) => r.id === id), patch); return clone(roles.find((r) => r.id === id)); },
  async loadAreas() { return clone(areas); },
  async loadPresets() { return clone(presets); },
  async loadTasks() { return clone(tasks); },
  async saveTask(task) {
    if (task.id) { const row = tasks.find((x) => x.id === task.id); Object.assign(row, task); return clone(row); }
    const row = { id: uid(), deleted: false, created_at: new Date().toISOString(), ...task };
    tasks.push(row); return clone(row);
  },
  async loadAssignments(from, to) { return clone(assignments.filter((a) => a.day >= from && a.day <= to)); },
  async loadReports(from, to) {
    const days = Object.fromEntries(assignments.map((a) => [a.id, a]));
    return clone(reports.filter((r) => days[r.assignment_id] && days[r.assignment_id].day >= from && days[r.assignment_id].day <= to
      && (isSup() || days[r.assignment_id].assignee === state.profile.id)));
  },
  async saveAssignments(rows) {
    const made = rows.map((r) => ({ id: uid(), note: '', status: 'todo', steps_done: [], started_at: null, completed_at: null, created_by: state.profile.id, created_at: new Date().toISOString(), kind: 'task', title: '', requested_by: null, ...r }));
    assignments.push(...made); return clone(made);
  },
  async updateAssignment(id, patch) { const a = assignments.find((x) => x.id === id); Object.assign(a, patch); return clone(a); },
  async deleteAssignment(id) { const i = assignments.findIndex((x) => x.id === id); if (i >= 0) assignments.splice(i, 1); },
  async deleteFutureAssignments(taskId, fromDay) {
    const gone = assignments.filter((a) => a.task_id === taskId && a.day >= fromDay && a.status === 'todo');
    gone.forEach((g) => assignments.splice(assignments.indexOf(g), 1));
    return gone.map((g) => ({ id: g.id }));
  },
  async startAssignment(id) { const a = assignments.find((x) => x.id === id); a.status = 'doing'; a.started_at = a.started_at || new Date().toISOString(); return clone(fresh(id)); },
  async setSteps(id, steps) { assignments.find((x) => x.id === id).steps_done = steps; return clone(fresh(id)); },
  async completeAssignment(id, minutes, comment, delay) {
    const a = assignments.find((x) => x.id === id);
    a.status = 'done'; a.completed_at = new Date().toISOString(); a.started_at = a.started_at || a.completed_at;
    const old = reports.findIndex((r) => r.assignment_id === id);
    if (old >= 0) reports.splice(old, 1);
    reports.push({ assignment_id: id, minutes_spent: minutes, goal_minutes: goalOf(a), comment, delay_reason: delay, completed_at: a.completed_at });
    return clone(fresh(id));
  },
  async reopenAssignment(id) {
    const a = assignments.find((x) => x.id === id);
    Object.assign(a, { status: 'todo', started_at: null, completed_at: null, steps_done: [] });
    const i = reports.findIndex((r) => r.assignment_id === id); if (i >= 0) reports.splice(i, 1);
    return clone(fresh(id));
  },
  async loadDigests() { return isSup() ? clone(digests.sort((a, b) => b.period_end.localeCompare(a.period_end))) : []; },
  async loadMeetings(since) {
    const me = state.profile.id;
    return clone(meetings.filter((m) => m.day >= since && (m.requester === me || m.supervisor === me)));
  },
  async requestMeeting(supervisor, day, time, topic) {
    const m = { id: uid(), requester: state.profile.id, supervisor, day, start_time: time.length === 5 ? time + ':00' : time, topic, status: 'pending', reply: '', created_at: new Date().toISOString(), answered_at: null };
    meetings.push(m);
    // the supervisor answers after a moment, to show how live updates look
    if (handler) setTimeout(() => {
      if (m.status !== 'pending') return;
      Object.assign(m, { status: 'accepted', answered_at: new Date().toISOString() });
      handler('meeting_requests', 'UPDATE', clone(m), null);
    }, 5000);
    return clone(m);
  },
  async answerMeeting(id, accept, reply) {
    const m = meetings.find((x) => x.id === id);
    Object.assign(m, { status: accept ? 'accepted' : 'declined', reply: reply || '', answered_at: new Date().toISOString() });
    return clone(m);
  },
  async cancelMeeting(id) { const m = meetings.find((x) => x.id === id); m.status = 'canceled'; m.answered_at = new Date().toISOString(); return clone(m); },
  async loadInvites() { return clone(invites); },
  async inviteToTask(assignmentId, to, note) {
    const a = assignments.find((x) => x.id === assignmentId);
    const inv = { id: uid(), assignment_id: assignmentId, from_user: state.profile.id, to_user: to, note, status: 'pending', created_at: new Date().toISOString(), answered_at: null };
    invites.push(inv);
    const message = { id: uid(), channel: 'general', sender: state.profile.id, body: note || tasks.find((x) => x.id === a.task_id).name, invite_id: inv.id, created_at: inv.created_at };
    messages.push(message);
    // the invited colleague answers after a moment, to show how live updates look
    if (handler) setTimeout(() => {
      if (inv.status !== 'pending') return;
      Object.assign(inv, { status: 'accepted', answered_at: new Date().toISOString() }); a.assignee = to;
      handler('task_invites', 'UPDATE', clone(inv), null); handler('assignments', 'UPDATE', clone(a), null);
    }, 4000);
    return clone({ invite: inv, message });
  },
  async answerInvite(id, accept) {
    const inv = invites.find((i) => i.id === id), a = assignments.find((x) => x.id === inv.assignment_id);
    let result = accept ? 'accepted' : 'declined';
    if (accept && (a.assignee !== inv.from_user || a.status !== 'todo')) result = 'unavailable';
    inv.status = result === 'unavailable' ? 'canceled' : result; inv.answered_at = new Date().toISOString();
    if (result === 'accepted') a.assignee = inv.to_user;
    return clone({ result, invite: inv, assignment: a });
  },
  async cancelInvite(id) { const inv = invites.find((i) => i.id === id); inv.status = 'canceled'; inv.answered_at = new Date().toISOString(); return clone(inv); },
  async requestRooms(day, rooms, note) {
    const tk = tasks.find((x) => x.kind === 'room' && !x.deleted);
    const made = rooms.map((room) => ({ id: uid(), task_id: tk.id, assignee: null, day, start_time: null, end_time: null, note: note || '', status: 'todo', steps_done: [],
      started_at: null, completed_at: null, created_by: state.profile.id, created_at: new Date().toISOString(), kind: 'room', title: room, requested_by: state.profile.id }));
    assignments.push(...made); return clone(made);
  },
  async editRoomRequest(id, title, day, note) {
    const r = assignments.find((x) => x.id === id);
    Object.assign(r, { title: title.trim(), day, note: (note || '').trim() });
    return clone(r);
  },
  async renotifyAssignment() {},
  async loadComments(id) { return clone(taskComments.filter((c) => c.assignment_id === id)); },
  async addComment(assignmentId, body) {
    const row = { id: uid(), assignment_id: assignmentId, author: state.profile.id, body, created_at: new Date().toISOString() };
    taskComments.push(row); return clone(row);
  },
  async deleteComment(id) { const i = taskComments.findIndex((c) => c.id === id); if (i >= 0) taskComments.splice(i, 1); },
  async loadShifts() { return clone(shifts); },
  async loadContracts() { return clone(contracts); },
  async loadShiftPlan(from, to) { return clone(shiftPlan.filter((p) => p.day >= from && p.day <= to)); },
  async setShift(user, day, shiftId) {
    const i = shiftPlan.findIndex((p) => p.user_id === user && p.day === day);
    if (i >= 0) shiftPlan.splice(i, 1);
    if (!shiftId) return null;
    const row = { id: uid(), user_id: user, day, shift_id: shiftId, created_by: state.profile.id, created_at: new Date().toISOString() };
    shiftPlan.push(row); return clone(row);
  },
  async setShifts(rows) {
    const made = rows.map((r) => ({ id: uid(), created_by: state.profile.id, created_at: new Date().toISOString(), ...r }));
    made.forEach((r) => { const i = shiftPlan.findIndex((p) => p.user_id === r.user_id && p.day === r.day); if (i >= 0) shiftPlan.splice(i, 1); shiftPlan.push(r); });
    return clone(made);
  },
  async setContract(user, minutes) {
    const c = contracts.find((x) => x.user_id === user);
    if (c) c.minutes = minutes; else contracts.push({ user_id: user, minutes });
    const today = ymd(now());
    for (let i = shiftPlan.length - 1; i >= 0; i--) {
      const p = shiftPlan[i], sh = shifts.find((x) => x.id === p.shift_id);
      if (p.user_id === user && p.day >= today && (sh.kind === 'part') !== (minutes === 240)) shiftPlan.splice(i, 1);
    }
  },
  async allocateWaiting(day) {
    const { distribute } = await import('./data.js');
    const { crewPeople } = await import('./shifts.js');
    const ids = assignments.filter((a) => a.day === day && !a.assignee && a.status !== 'done').map((a) => a.id);
    const r = await distribute(ids, crewPeople().map((p) => p.id));
    return r.placed;
  },
  async loadLogbook(from, to) { return clone(logbook.filter((e) => e.day >= from && e.day <= to)); },
  async addLogEntry(row) {
    const e = { id: uid(), area_id: null, follow_up: false, resolved_by: null, resolved_at: null, author: state.profile.id, created_at: new Date().toISOString(), ...row };
    logbook.push(e); return clone(e);
  },
  async resolveLog(id, done) {
    const e = logbook.find((x) => x.id === id);
    e.resolved_by = done ? state.profile.id : null; e.resolved_at = done ? new Date().toISOString() : null;
    return clone(e);
  },
  async deleteLogEntry(id) { const i = logbook.findIndex((x) => x.id === id); if (i >= 0) logbook.splice(i, 1); },
  async loadMyStats(since) {
    const mine = Object.fromEntries(assignments.filter((a) => a.assignee === state.profile.id && a.day >= since).map((a) => [a.id, a]));
    return reports.filter((r) => mine[r.assignment_id]).map((r) => ({ day: mine[r.assignment_id].day, minutes: r.minutes_spent }));
  },
  async loadMessages(channel, before, limit = 60) {
    return clone(messages.filter((m) => m.channel === channel && (!before || m.created_at < before))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit));
  },
  async loadRecentMessages() {
    if (!(state.profile && ['custodian_supervisor', 'custodian'].includes(state.profile.role))) return [];
    const me = state.profile.id;
    return clone(messages.filter((m) => m.channel === 'general' || m.channel.split(':').includes(me))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)));
  },
  async sendMessage(channel, body) {
    const row = { id: uid(), channel, sender: state.profile.id, body, created_at: new Date().toISOString() };
    messages.push(row);
    // a pretend colleague answers once, to show how live updates look
    if (!sentHello && handler) {
      sentHello = true;
      setTimeout(() => {
        const other = channel.startsWith('dm:') ? channel.slice(3).split(':').find((x) => x !== state.profile.id) : (state.profile.id === 'd2' ? 'd3' : 'd2');
        const reply = { id: uid(), channel, sender: other, body: 'Got it, thank you! 🙌', created_at: new Date().toISOString() };
        messages.push(reply); handler('messages', 'INSERT', reply, null);
      }, 2200);
    }
    return clone(row);
  },
  async deleteMessage(id) { const i = messages.findIndex((m) => m.id === id); if (i >= 0) messages.splice(i, 1); },
  subscribe(h) { handler = h; return () => { handler = null; }; },
};

export async function startDemo(role) {
  const wanted = { supervisor: 'custodian_supervisor', reception: 'receptionist' }[role] || role;
  const who = people.find((p) => p.role === wanted) || people[0];
  useDemoApi(demoApi);
  const map = Object.fromEntries(people.map((p) => [p.id, p]));
  set({ demo: true, ready: true, session: { user: { id: who.id, email: who.email } }, profile: who, profiles: map });
  await loadCore();
  startLive();
}
