-- =========================================================
-- BOUNTIFUL · Step 10 · Time goals and timers
-- - every task can have a time goal (minutes) set by the supervisor (empty = the length of its time window)
-- - rooms get a time goal too (one number for all rooms, set by the supervisor) and remember when cleaning started / how long it took
-- =========================================================

alter table public.tasks add column goal_minutes int check (goal_minutes between 1 and 1440);

insert into public.app_settings (key, value) values ('room_goal_minutes', '30') on conflict (key) do nothing;

alter table public.room_requests add column started_at timestamptz;
alter table public.room_requests add column minutes_spent int check (minutes_spent between 0 and 1440);

-- The supervisor changes the goal for cleaning one room
create function public.set_room_goal(p_minutes int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_active() and public.is_supervisor()) then raise exception 'Only the supervisor can change time goals.'; end if;
  if p_minutes is null or p_minutes not between 1 and 600 then raise exception 'Please give a goal between 1 and 600 minutes.'; end if;
  update public.app_settings set value = p_minutes::text where key = 'room_goal_minutes';
end;
$$;
revoke execute on function public.set_room_goal(int) from public, anon;
grant execute on function public.set_room_goal(int) to authenticated;

-- Rooms: remember the start, and work out how long the cleaning took
create or replace function public.set_room_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active() then raise exception 'Your account is not active.'; end if;
  if p_status not in ('todo', 'doing', 'done') then raise exception 'Unknown status.'; end if;
  update public.room_requests
     set started_at = case p_status when 'todo' then null
                                     when 'doing' then (case when status = 'doing' then started_at else now() end)
                                     else started_at end,
         minutes_spent = case when p_status = 'done' and status = 'doing' and started_at is not null
                              then least(1440, round(extract(epoch from (now() - started_at)) / 60)::int) else null end,
         status = p_status,
         done_at = case when p_status = 'done' then now() else null end
   where id = p_id and (assignee = auth.uid() or public.is_supervisor());
  if not found then raise exception 'You cannot change this room.'; end if;
end;
$$;

-- Tasks: the goal in the report is the task's time goal (or its window when none is set)
create or replace function public.complete_assignment(p_id uuid, p_minutes int, p_comment text, p_delay text)
returns void language plpgsql security definer set search_path = public as $$
declare
  a public.assignments;
  goal int;
  mins int;
begin
  if not public.is_active() then raise exception 'Your account is not active.'; end if;
  select * into a from public.assignments where id = p_id and assignee = auth.uid() for update;
  if not found then raise exception 'This task is not assigned to you.'; end if;

  mins := greatest(0, least(coalesce(p_minutes, 0), 1440));
  goal := coalesce((select t.goal_minutes from public.tasks t where t.id = a.task_id),
                   (extract(epoch from (a.end_time - a.start_time)) / 60)::int);

  update public.assignments
     set status = 'done', completed_at = now(),
         started_at = coalesce(started_at, now() - make_interval(mins => mins))
   where id = p_id;

  insert into public.assignment_reports (assignment_id, minutes_spent, goal_minutes, comment, delay_reason)
  values (p_id, mins, goal, left(btrim(coalesce(p_comment, '')), 1000), left(btrim(coalesce(p_delay, '')), 1000))
  on conflict (assignment_id) do update
    set minutes_spent = excluded.minutes_spent, goal_minutes = excluded.goal_minutes,
        comment = excluded.comment, delay_reason = excluded.delay_reason, completed_at = now();
end;
$$;
