// "My activity" in the profile: what I finished. Counts finished tasks (with their report) AND the checklist items / rooms I ticked as done,
// without counting a room twice (ticking a room tile also finishes its room task).
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// the day a weekly tick belongs to: the Monday of its week + the weekday in the item id ("3.0.1" = Wednesday)
export function weeklyDay(week, item) {
  const [y, m, d] = week.split('-').map(Number);
  const wd = Number(String(item).split('.')[0]) || 1;
  return ymd(new Date(y, m - 1, d + wd - 1));
}
// minutes between starting and finishing a tick; nothing when it was not timed or looks wrong (left open overnight)
function tickMinutes(r) {
  if (!r.started_at || !r.done_at) return 0;
  const m = Math.round((Date.parse(r.done_at) - Date.parse(r.started_at)) / 60000);
  return m > 0 && m <= 480 ? m : 0;
}
// reports: [{ day, minutes, room }] (room = the room code for room tasks, else ''), ticks: my weekly_checks rows that are done
export function combineStats(reports, ticks) {
  const out = reports.map((r) => ({ day: r.day, minutes: r.minutes }));
  const seen = new Set(reports.filter((r) => r.room).map((r) => r.day + '|' + r.room));
  ticks.forEach((r) => {
    const day = weeklyDay(r.week, r.item);
    const room = (/^\d\.r\.(.+)$/.exec(r.item) || [])[1];
    if (room && seen.has(day + '|' + room)) return;
    out.push({ day, minutes: tickMinutes(r) });
  });
  return out;
}
