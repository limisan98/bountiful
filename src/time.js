import { currentLocale } from './i18n.js';

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
export const todayYmd = () => ymd(new Date());
export const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const isoWeekday = (d) => (d.getDay() === 0 ? 7 : d.getDay()); // 1 = Monday ... 7 = Sunday
export const startOfWeek = (d) => addDays(d, 1 - isoWeekday(d));
export const lastOfMonth = (key) => { const [y, m] = key.split('-').map(Number); return ymd(new Date(y, m, 0)); };

export const hhmm = (s) => (s || '').slice(0, 5);
export const toMin = (s) => { if (!s) return 0; const [h, m] = hhmm(s).split(':').map(Number); return h * 60 + (m || 0); };
export const fromMin = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
export const goalMin = (a) => (a.start_time && a.end_time ? toMin(a.end_time) - toMin(a.start_time) : 0);
export const hasTime = (a) => !!(a.start_time && a.end_time);
export const timeKey = (a) => (a.start_time ? toMin(a.start_time) : 1440); // tasks without a clock time go last
export const timeText = (a) => (hasTime(a) ? `${hhmm(a.start_time)}–${hhmm(a.end_time)}` : '');
// The time goal of a task: the one the supervisor set, otherwise the length of the planned window
export const taskGoal = (tk, a) => (tk && tk.goal_minutes) || (a && goalMin(a)) || (tk ? toMin(tk.end_time) - toMin(tk.start_time) : 0) || 30;

// 80 -> "1h 20m"
export function dur(min) {
  min = Math.max(0, Math.round(min));
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

// Does a task normally happen on this day? (every day, or only some weekdays)
export function appliesOn(task, date) {
  if (!task) return false;
  if (task.frequency === 'daily') return true;
  return (task.weekdays || []).includes(isoWeekday(date));
}

// 6 rows x 7 columns, Monday first, for the month that contains `date`
export function monthGrid(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function weekdayNames(style = 'short') {
  const loc = currentLocale();
  return Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(loc, { weekday: style }));
}
export const fmt = (date, opts) => date.toLocaleDateString(currentLocale(), opts);
export const fmtTimeOfDay = (iso) => new Date(iso).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' });
