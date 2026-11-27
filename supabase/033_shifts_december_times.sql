-- 033: shift times as the temple works them now (2026-11-27)
--  - afternoon starts 14:30 (was 14:00), Fridays 15:00 (was 14:30); the end times stay (22:30 / 23:00)
--  - new: Saturday short shift 11:00-15:00 (counts as "full" for 8-hour people, capacity 240)
--  - new: Friday evening part shift 19:00-23:00
update public.shifts set start_time = '14:30', end_time = '22:30' where key = 'afternoon_full';
update public.shifts set start_time = '15:00', end_time = '23:00' where key = 'afternoon_full_fri';
insert into public.shifts (key, kind, block, start_time, end_time, weekdays, capacity_minutes, sort) values
  ('saturday_short', 'full', '08:00', '11:00', '15:00', '{6}', 240, 7),
  ('evening_part_fri', 'part', '18:30', '19:00', '23:00', '{5}', 240, 8);
