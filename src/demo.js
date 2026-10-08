// DEMO MODE: open the site with ?demo=custodian_supervisor (or custodian, receptionist)
// to look around with pretend people and pretend work. Nothing here touches the real database and nobody is really signed in.
import { state, set } from './store.js';
import { useDemoApi } from './api.js';
import { loadCore, startLive } from './data.js';
import { ROLE_DEFAULTS } from './config.js';
import { ymd, addDays, isoWeekday, toMin, fromMin, todayYmd } from './time.js';

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
];
const mk = (name, icon, color, area_id, s, e, frequency, weekdays, steps, description = '') => ({
  id: uid(), name, icon, color, area_id, start_time: s, end_time: e, frequency, weekdays, description,
  steps: steps.map((x) => ({ title: x[0], description: x[1] || '' })), deleted: false, created_at: iso(-60, 9),
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
        status: 'todo', steps_done: [], started_at: null, completed_at: null, created_by: 'd1', created_at: iso(-5, 9) };
      const goal = toMin(tk.end_time) - toMin(tk.start_time);
      const finish = (mins, c, dl) => {
        a.status = 'done'; a.steps_done = tk.steps.map((_, i) => i); a.started_at = d.toISOString(); a.completed_at = d.toISOString();
        reports.push({ assignment_id: a.id, minutes_spent: mins, goal_minutes: goal, comment: c, delay_reason: dl, completed_at: iso(off, 12 + (ti % 5)) });
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
  { id: uid(), channel: 'all', sender: 'd1', body: 'Good morning everyone! Reminder: the stake choir visits the temple at 14:00 today.', created_at: iso(-1, 8, 40) },
  { id: uid(), channel: 'all', sender: 'd5', body: 'Thank you Anna! Two arrivals tonight in the guesthouse — rooms 4 and 7.', created_at: iso(-1, 8, 52) },
  { id: uid(), channel: 'all', sender: 'd5', body: 'I will send the cleaning list as soon as they confirm.', created_at: iso(-1, 8, 53) },
  { id: uid(), channel: 'all', sender: 'd2', body: 'Perfect, we will have everything ready. 🌿', created_at: iso(0, 7, 5) },
  { id: uid(), channel: 'all', sender: 'd3', body: 'The temple floors are done — it smells so fresh in there!', created_at: iso(0, 9, 31) },
  { id: uid(), channel: 'custodian', sender: 'd1', body: 'Custodians: we are low on neutral cleaner. Please note it in your comments when you use the last bottle.', created_at: iso(-1, 16, 10) },
  { id: uid(), channel: 'custodian', sender: 'd4', body: 'Will do!', created_at: iso(-1, 16, 14) },
  { id: uid(), channel: 'reception', sender: 'd5', body: 'Reception: welcome pack stock is fine until Friday.', created_at: iso(-1, 15, 0) },
];

// rooms to clean: Reception lists them, the supervisor hands them to a custodian
const rooms = [];
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
  const mkRoom = (day, room, extra = {}) => rooms.push({ id: uid(), day: ymd(addDays(now(), day)), room, note: '', status: 'todo', requested_by: 'd5', assignee: null, assigned_by: null, done_at: null, created_at: iso(day - 1, 16, 30), ...extra });
  mkRoom(0, '4', { assignee: 'd3', assigned_by: 'd1', status: 'done', done_at: iso(0, 11, 20) });
  mkRoom(0, '7', { assignee: 'd3', assigned_by: 'd1', status: 'doing' });
  mkRoom(0, '12', { assignee: 'd2', assigned_by: 'd1', note: 'Guests arrive at 3 pm' });
  mkRoom(0, 'Suite A');
  mkRoom(1, '3', { requested_by: 'd6' });
  mkRoom(1, '5', { requested_by: 'd6', note: 'Extra bed please' });
  mkRoom(1, '9', { requested_by: 'd6' });
}
// task invitations between custodians (they also appear as messages in the custodians' chat)
{
  const mkAsg = (taskIdx, off, who) => {
    const tk = tasks[taskIdx], d = addDays(now(), off);
    const a = { id: uid(), task_id: tk.id, assignee: who, day: ymd(d), start_time: tk.start_time, end_time: tk.end_time, note: '', status: 'todo', steps_done: [], started_at: null, completed_at: null, created_by: 'd1', created_at: iso(-3, 9) };
    assignments.push(a); return a;
  };
  const mkInv = (a, from, to, status, note, hoursAgo) => {
    const inv = { id: uid(), assignment_id: a.id, from_user: from, to_user: to, note, status, created_at: iso(0, 9 - hoursAgo), answered_at: status === 'pending' ? null : iso(0, 10) };
    invites.push(inv);
    messages.push({ id: uid(), channel: 'custodian', sender: from, body: note || tasks.find((x) => x.id === a.task_id).name, invite_id: inv.id, created_at: inv.created_at });
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
    rooms: rooms.filter((r) => r.assignee === pid && r.status === 'done' && r.day >= from && r.day <= to).map((r) => ({ day: r.day, room: r.room })),
  };
}
{
  const put = (kind, from, to, pid, hours = 23) => {
    const sm = summarize(pid, from, to, kind === 'day');
    if (sm.planned || sm.rooms.length) digests.push({ id: uid(), kind, period_start: from, period_end: to, custodian: pid, summary: sm, created_at: iso(0, 0) });
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
const goalOf = (a) => toMin(a.end_time) - toMin(a.start_time);

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
  async loadRoles() { return clone(roles); },
  async updateRole(id, patch) { Object.assign(roles.find((r) => r.id === id), patch); return clone(roles.find((r) => r.id === id)); },
  async loadAreas() { return clone(areas); },
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
    const made = rows.map((r) => ({ id: uid(), note: '', status: 'todo', steps_done: [], started_at: null, completed_at: null, created_by: state.profile.id, created_at: new Date().toISOString(), ...r }));
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
    const message = { id: uid(), channel: 'custodian', sender: state.profile.id, body: note || tasks.find((x) => x.id === a.task_id).name, invite_id: inv.id, created_at: inv.created_at };
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
  async loadRooms(from) {
    const mineOnly = !isSup() && dept() !== 'reception';
    return clone(rooms.filter((r) => r.day >= from && (!mineOnly || r.assignee === state.profile.id)));
  },
  async addRooms(rows) {
    const made = rows.map((r) => ({ id: uid(), note: '', status: 'todo', requested_by: state.profile.id, assignee: null, assigned_by: null, done_at: null, created_at: new Date().toISOString(), ...r }));
    rooms.push(...made); return clone(made);
  },
  async assignRooms(ids, assignee) {
    rooms.filter((r) => ids.includes(r.id) && r.status !== 'done').forEach((r) => Object.assign(r, { assignee, assigned_by: assignee ? state.profile.id : null, status: 'todo', done_at: null }));
    return clone(rooms.filter((r) => ids.includes(r.id)));
  },
  async editRoom(id, room, day, note) {
    const r = rooms.find((x) => x.id === id);
    Object.assign(r, { room: room.trim(), day, note: (note || '').trim() });
    return clone(r);
  },
  async setRoomStatus(id, status) {
    const r = rooms.find((x) => x.id === id);
    Object.assign(r, { status, done_at: status === 'done' ? new Date().toISOString() : null });
    return clone(r);
  },
  async deleteRoom(id) { const i = rooms.findIndex((r) => r.id === id); if (i >= 0) rooms.splice(i, 1); },
  async loadMyStats(since) {
    const mine = Object.fromEntries(assignments.filter((a) => a.assignee === state.profile.id && a.day >= since).map((a) => [a.id, a]));
    return reports.filter((r) => mine[r.assignment_id]).map((r) => ({ day: mine[r.assignment_id].day, minutes: r.minutes_spent }));
  },
  async loadMessages(channel, before, limit = 60) {
    return clone(messages.filter((m) => m.channel === channel && (!before || m.created_at < before))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit));
  },
  async sendMessage(channel, body) {
    const row = { id: uid(), channel, sender: state.profile.id, body, created_at: new Date().toISOString() };
    messages.push(row);
    // a pretend colleague answers once, to show how live updates look
    if (!sentHello && handler) {
      sentHello = true;
      setTimeout(() => {
        const reply = { id: uid(), channel, sender: state.profile.id === 'd2' ? 'd3' : 'd2', body: 'Got it, thank you! 🙌', created_at: new Date().toISOString() };
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
