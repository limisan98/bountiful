// The shift rules in one place. A person can only be given a task when
//  - they work a shift that day,
//  - the task's planned time overlaps their shift for as long as the task needs, and
//  - the day's tasks still fit in their capacity: 4-hour contract = 240 min, 8-hour contract = 480 min
//    (never more than the shift itself allows).
// Days where no shift has been planned at all are not checked, so the app keeps working before shifts are planned.
// (The database has the same rules, see supabase/013: this file is the friendly early warning.)
import { state } from './store.js';
import { t } from './i18n.js';
import { toMin, taskGoal, timeKey } from './time.js';
import { departmentOf } from './roles.js';

export const BLOCKS = ['07:00', '08:00', '14:00', '18:30'];
export const shiftList = () => Object.values(state.shifts).sort((a, b) => a.sort - b.sort);
export const planOf = (uid, day) => Object.values(state.shiftPlan).find((p) => p.user_id === uid && p.day === day) || null;
export const shiftOf = (uid, day) => { const p = planOf(uid, day); return p ? state.shifts[p.shift_id] || null : null; };
export const dayPlanned = (day) => Object.values(state.shiftPlan).some((p) => p.day === day);
export const contractOf = (uid) => (state.contracts[uid] && state.contracts[uid].minutes) || 480;
export const capacityOf = (uid, day) => { const s = shiftOf(uid, day); return s ? Math.min(contractOf(uid), s.capacity_minutes) : 0; };
export const goalOf = (a) => taskGoal(state.tasks[a.task_id], a);
export const loadOf = (uid, day, ignoreId) => Object.values(state.assignments)
  .filter((a) => a.assignee === uid && a.day === day && a.id !== ignoreId && state.tasks[a.task_id]).reduce((n, a) => n + goalOf(a), 0);
export const ratioOf = (uid, day) => { const c = capacityOf(uid, day); return c ? loadOf(uid, day) / c : 0; };

// Can this person take this task (a planned task, or {task_id, start_time, end_time})? null = yes, else 'noshift' | 'window' | 'capacity'
export function problem(uid, day, a, ignoreId) {
  if (!uid || !dayPlanned(day)) return null;
  const s = shiftOf(uid, day);
  if (!s) return 'noshift';
  const goal = goalOf(a);
  if (a.start_time && a.end_time) {
    const overlap = Math.min(toMin(a.end_time), toMin(s.end_time)) - Math.max(toMin(a.start_time), toMin(s.start_time));
    if (overlap < Math.min(goal, toMin(a.end_time) - toMin(a.start_time))) return 'window';
  }
  if (loadOf(uid, day, ignoreId) + goal > capacityOf(uid, day)) return 'capacity';
  return null;
}
export const problemText = (p) => (p ? t('shift.problem.' + p) : '');

// the shift block (07:00 / 08:00 / 14:00 / 18:30) that is running or next up
export function currentBlock(now = new Date()) {
  const m = now.getHours() * 60 + now.getMinutes();
  return [...BLOCKS].reverse().find((b) => toMin(b) <= m) || BLOCKS[0];
}
export const shiftName = (s) => (s ? t('shift.' + s.key) : '');
export const crewPeople = () => Object.values(state.profiles).filter((p) => p.active !== false && departmentOf(p) === 'custodian')
  .sort((a, b) => a.display_name.localeCompare(b.display_name));
export const contractLabel = (min) => (min === 240 ? '4h' : '8h');

// priorities (never by colour alone: always an icon and a word as well)
export const PRIORITIES = { high: { icon: 'alert-triangle', rank: 0 }, medium: { icon: 'flag', rank: 1 }, low: { icon: 'arrow-badge-down', rank: 2 } };
export const priorityOf = (tk) => (tk && PRIORITIES[tk.priority] ? tk.priority : 'medium');
export const prioRank = (tk) => PRIORITIES[priorityOf(tk)].rank;
export const byImportance = (x, y) => prioRank(state.tasks[x.task_id]) - prioRank(state.tasks[y.task_id]) || timeKey(x) - timeKey(y) || goalOf(y) - goalOf(x);
