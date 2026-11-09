// The performance report for the supervisor, as an Excel file: who did what, how long it took, what was (not) finished,
// and what is cleaned rarely. Built from the live data of the chosen period (assignments, their reports, the weekly checklist ticks).
import { state } from './store.js';
import { api } from './api.js';
import { t } from './i18n.js';
import { itemName, areaOf, areaName } from './data.js';
import { checklistLines } from './views/weekly.js';
import { goalOf } from './shifts.js';
import { ymd, parseYmd, addDays, startOfWeek, todayYmd } from './time.js';
import { makeXlsx } from './xlsxwrite.js';

export function periodRange(kind) {
  const today = parseYmd(todayYmd()), mon = startOfWeek(today);
  if (kind === 'lastWeek') return { from: ymd(addDays(mon, -7)), to: ymd(addDays(mon, -1)) };
  if (kind === 'weeks4') return { from: ymd(addDays(mon, -21)), to: ymd(addDays(mon, 6)) };
  if (kind === 'month') return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(new Date(today.getFullYear(), today.getMonth() + 1, 0)) };
  return { from: ymd(mon), to: ymd(addDays(mon, 6)) };
}

const hhmm = (iso) => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
const statusText = (st) => t('status.' + (st === 'done' ? 'done' : st === 'doing' ? 'doing' : 'todo'));

export async function buildPerformance(range, lang) {
  const { from, to } = range;
  const today = todayYmd(), upTo = to < today ? to : today; // "days since" counts up to today
  // load week by week (a month in one request could pass the 1000-row limit)
  const mondays = []; for (let m = startOfWeek(parseYmd(from)); ymd(m) <= to; m = addDays(m, 7)) mondays.push(ymd(m));
  const parts = await Promise.all(mondays.map(async (mon) => {
    const end = ymd(addDays(parseYmd(mon), 6));
    const [a, r, w] = await Promise.all([api.loadAssignments(mon, end), api.loadReports(mon, end), api.loadWeekly(mon).catch(() => [])]);
    return { a, r, w };
  }));
  const assignments = parts.flatMap((p) => p.a).filter((a) => a.day >= from && a.day <= to && state.tasks[a.task_id]);
  const report = {}; parts.forEach((p) => p.r.forEach((r) => { report[r.assignment_id] = r; }));
  const ticks = parts.flatMap((p) => p.w).filter((w) => { const day = ymd(new Date(w.updated_at)); return day >= from && day <= to; });

  const nameOf = (id) => (state.profiles[id] || {}).display_name || (id ? t('chat.former') : t('rx.unassigned'));
  const lines = {}; checklistLines(lang).forEach((l) => { lines[l.id] = l; });
  const roomCode = (item) => (/^\d\.r\.(\d+)$/.exec(item) || [])[1];

  // ---- one flat list of "things people did or were given", used by every sheet
  const events = [];
  assignments.forEach((a) => {
    const r = report[a.id], tk = state.tasks[a.task_id], room = a.kind === 'room';
    events.push({ src: 'assign', kind: room ? 'room' : 'task', who: a.assignee, day: a.day, item: room ? a.title : itemName(a), taskId: a.task_id, status: a.status, planned: r ? r.goal_minutes : goalOf(a), actual: r ? r.minutes_spent : '', doneAt: r ? hhmm(r.completed_at) : '',
      notes: [a.note, r && r.delay_reason, r && r.comment].filter(Boolean).join(' · '), area: tk.area_id, over: !!r && r.minutes_spent > r.goal_minutes });
  });
  ticks.forEach((w) => {
    const code = roomCode(w.item), l = lines[w.item];
    if (!code && !l) return;
    events.push({ src: 'list', kind: code ? 'room' : 'list', who: w.user_id, day: ymd(new Date(w.updated_at)), item: code || l.text, section: l ? `${l.section ? l.section + ' · ' : ''}${l.text}` : '', lineId: l ? w.item : '', status: w.status, planned: '', actual: '', doneAt: w.status === 'done' ? hhmm(w.updated_at) : '', notes: t('rx.fromList') });
  });
  const isDone = (e) => e.status === 'done';

  // ---- sheet 1: per person
  const people = [...new Set(events.map((e) => e.who || ''))].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const sum = (arr, f) => arr.reduce((n, e) => n + (Number(f(e)) || 0), 0);
  const peopleRows = [[t('rx.person'), t('px.roomsDone'), t('px.roomNums'), t('px.roomsNot'), t('px.tasksDone'), t('px.tasksNot'), t('px.listDone'), t('px.listOpen'), t('rx.minutes'), t('px.minRooms'), t('px.minTasks'), t('px.avgRoom'), t('px.pct'), t('rx.over')]];
  people.forEach((id) => {
    const mine = events.filter((e) => (e.who || '') === id);
    const rooms = mine.filter((e) => e.kind === 'room'), tasks = mine.filter((e) => e.kind === 'task'), list = mine.filter((e) => e.kind === 'list');
    const roomsDone = rooms.filter(isDone), tasksDone = tasks.filter(isDone);
    const assigned = mine.filter((e) => e.src === 'assign'), doneAssigned = assigned.filter(isDone);
    const minRooms = sum(roomsDone.filter((e) => e.src === 'assign'), (e) => e.actual), minTasks = sum(tasksDone, (e) => e.actual);
    const roomAssignDone = roomsDone.filter((e) => e.src === 'assign' && e.actual !== '');
    peopleRows.push([nameOf(id), roomsDone.length, [...new Set(roomsDone.map((e) => e.item))].sort().join(', '), rooms.filter((e) => !isDone(e)).length, tasksDone.length, tasks.filter((e) => !isDone(e)).length,
      list.filter(isDone).length, list.filter((e) => !isDone(e)).length, minRooms + minTasks, minRooms, minTasks, roomAssignDone.length ? Math.round(minRooms / roomAssignDone.length) : '',
      assigned.length ? Math.round((doneAssigned.length / assigned.length) * 100) : '', assigned.filter((e) => e.over).length]);
  });

  // ---- sheet 2: every line
  const kindName = { room: t('rx.kindRoom'), task: t('rx.kindTask'), list: t('rx.kindList') };
  const detailRows = [[t('rx.day'), t('rx.person'), t('px.kind'), t('px.item'), t('px.status'), t('px.planned'), t('px.actual'), t('px.doneAt'), t('px.notes')]];
  [...events].sort((a, b) => a.day.localeCompare(b.day) || nameOf(a.who).localeCompare(nameOf(b.who)) || String(a.item).localeCompare(String(b.item)))
    .forEach((e) => detailRows.push([{ date: e.day }, nameOf(e.who), kindName[e.kind], e.item, statusText(e.status), e.planned, e.actual, e.doneAt, e.notes]));

  // ---- sheet 3: every guest room - how often it was cleaned (rarely cleaned first)
  const roomEv = {}; events.filter((e) => e.kind === 'room').forEach((e) => { (roomEv[e.item] = roomEv[e.item] || []).push(e); });
  const roomRows = state.guestRooms.map((r) => {
    const ev = roomEv[r.label] || [];
    const seen = new Set(); // a room finished in the task AND ticked in the list on the same day counts once
    const done = ev.filter(isDone).sort((a, b) => b.day.localeCompare(a.day) || String(b.doneAt).localeCompare(String(a.doneAt))).filter((e) => !seen.has(e.day) && seen.add(e.day));
    return { r, n: done.length, last: done[0] ? done[0].day : '', by: done[0] ? nameOf(done[0].who) : '', asked: ev.filter((e) => e.src === 'assign').length };
  }).sort((a, b) => a.n - b.n || (a.last || '').localeCompare(b.last || '') || a.r.label.localeCompare(b.r.label));
  const roomsSheet = [[t('px.room'), t('px.house'), t('px.floor'), t('px.timesCleaned'), t('px.lastCleaned'), t('px.daysSince'), t('px.lastBy'), t('px.asked')],
    ...roomRows.map((x) => [x.r.label, x.r.house, x.r.floor, x.n, x.last ? { date: x.last } : '', x.last ? daysBetween(x.last, upTo) : '', x.by, x.asked])];

  // ---- sheet 4: other tasks - how often they are given and finished
  const byTask = {};
  events.filter((e) => e.kind === 'task').forEach((e) => { (byTask[e.taskId] = byTask[e.taskId] || []).push(e); });
  const taskRows = Object.entries(byTask).map(([id, ev]) => {
    const tk = state.tasks[id], done = ev.filter(isDone).sort((a, b) => b.day.localeCompare(a.day));
    return { name: tk.name, area: areaName(areaOf(tk.area_id)), n: ev.length, done: done.length, last: done[0] ? done[0].day : '', min: sum(done, (e) => e.actual) };
  }).sort((a, b) => a.done - b.done || (a.last || '').localeCompare(b.last || '') || a.name.localeCompare(b.name));
  const tasksSheet = [[t('rx.task'), t('px.area'), t('px.assigned'), t('rx.done'), t('px.notDone'), t('px.lastDone'), t('px.daysSince'), t('rx.minutes'), t('px.avgMin')],
    ...taskRows.map((x) => [x.name, x.area, x.n, x.done, x.n - x.done, x.last ? { date: x.last } : '', x.last ? daysBetween(x.last, upTo) : '', x.min, x.done ? Math.round(x.min / x.done) : ''])];

  // ---- sheet 5: the weekly checklist lines (temple, cafeteria…) - what is done and what is skipped
  const listEv = {}; events.filter((e) => e.kind === 'list').forEach((e) => { (listEv[e.lineId] = listEv[e.lineId] || []).push(e); });
  const listRows = Object.values(lines).map((l) => {
    const done = (listEv[l.id] || []).filter(isDone).sort((a, b) => b.day.localeCompare(a.day));
    return { l, n: done.length, last: done[0] ? done[0].day : '', by: done[0] ? nameOf(done[0].who) : '' };
  }).sort((a, b) => a.n - b.n || a.l.day - b.l.day || a.l.id.localeCompare(b.l.id));
  const dayNames = [1, 2, 3, 4, 5, 6].map((n) => new Date(2026, 10, 1 + n).toLocaleDateString(undefined, { weekday: 'long' })); // Mon..Sat
  const listSheet = [[t('rx.day'), t('px.section'), t('px.item'), t('px.timesDone'), t('px.lastDone'), t('px.lastBy'), t('px.daysSince')],
    ...listRows.map((x) => [dayNames[x.l.day - 1] || '', x.l.section, x.l.text, x.n, x.last ? { date: x.last } : '', x.by, x.last ? daysBetween(x.last, upTo) : ''])];

  return makeXlsx([
    { name: t('px.s.people'), widths: [24, 10, 34, 10, 10, 10, 10, 10, 10, 10, 10, 12, 10, 12], rows: peopleRows },
    { name: t('px.s.detail'), widths: [12, 24, 14, 40, 14, 10, 10, 10, 50], rows: detailRows },
    { name: t('px.s.rooms'), widths: [9, 8, 8, 12, 14, 14, 24, 12], rows: roomsSheet },
    { name: t('px.s.tasks'), widths: [36, 22, 10, 8, 10, 14, 14, 10, 12], rows: tasksSheet },
    { name: t('px.s.list'), widths: [14, 14, 60, 10, 14, 24, 14], rows: listSheet },
  ]);
}
