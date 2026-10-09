-- =========================================================
-- BOUNTIFUL · Step 12 · Shifts, contracts (4h / 8h), routines made automatically, priorities, handover logbook
-- 1) shifts + who works which shift on which day + each person's contract (240 or 480 minutes a day)
-- 2) a guard: nobody can be given a task outside their shift, or more than their daily capacity
-- 3) tasks: priority, "create automatically at the start of the shift", monthly routines, two more areas
-- 4) the routine generator (runs every 5 minutes through pg_cron) and the allocation of waiting tasks
-- 5) the shared logbook for shift handovers
-- =========================================================

-- 1) SHIFTS ------------------------------------------------
create table public.shifts (
  id               uuid primary key default gen_random_uuid(),
  key              text not null unique,
  kind             text not null check (kind in ('full', 'part')),
  block            text not null check (block in ('07:00', '08:00', '14:00', '18:30')),   -- the shift block it belongs to
  start_time       time not null,
  end_time         time not null,
  weekdays         int[] not null default '{1,2,3,4,5,6,7}',                               -- 1 = Monday ... 7 = Sunday
  capacity_minutes int not null check (capacity_minutes in (240, 480)),
  sort             int not null default 0,
  check (end_time > start_time)
);
insert into public.shifts (key, kind, block, start_time, end_time, weekdays, capacity_minutes, sort) values
  ('morning_full',       'full', '07:00', '07:00', '15:30', '{1,2,3,4,5,6,7}', 480, 1),
  ('morning_part_a',     'part', '08:00', '08:00', '12:00', '{1,2,3,4,5,6,7}', 240, 2),
  ('morning_part_b',     'part', '08:00', '09:00', '13:00', '{1,2,3,4,5,6,7}', 240, 3),
  ('afternoon_full',     'full', '14:00', '14:00', '22:30', '{1,2,3,4,6,7}',   480, 4),
  ('afternoon_full_fri', 'full', '14:00', '14:30', '23:00', '{5}',             480, 5),
  ('evening_part',       'part', '18:30', '18:30', '22:30', '{1,2,3,4,5,6,7}', 240, 6);

create table public.staff_contracts (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  minutes    int not null check (minutes in (240, 480)),
  updated_at timestamptz not null default now()
);

create table public.shift_plan (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  day        date not null,
  shift_id   uuid not null references public.shifts (id),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, day)
);
create index shift_plan_day_idx on public.shift_plan (day);

alter table public.shifts enable row level security;
alter table public.staff_contracts enable row level security;
alter table public.shift_plan enable row level security;
revoke all on public.shifts, public.staff_contracts, public.shift_plan from anon, authenticated;
grant select on public.shifts, public.staff_contracts to authenticated;
grant select, insert, update, delete on public.shift_plan to authenticated;
create policy "People see shifts" on public.shifts for select to authenticated using (public.is_active());
create policy "People see contracts" on public.staff_contracts for select to authenticated using (public.is_active());
create policy "People see the shift plan" on public.shift_plan for select to authenticated using (public.is_active());
create policy "Supervisors plan shifts" on public.shift_plan for all to authenticated
  using (public.is_active() and public.is_supervisor()) with check (public.is_active() and public.is_supervisor());

-- a shift must run on that weekday, only custodians work in shifts, and 4-hour workers take the short shifts
create function public.check_shift_plan() returns trigger language plpgsql security definer set search_path = public as $$
declare s public.shifts; c int; dept text;
begin
  select * into s from public.shifts where id = new.shift_id;
  select r.department into dept from public.profiles p join public.roles r on r.id = p.role where p.id = new.user_id;
  if dept is distinct from 'custodian' then raise exception 'Only the custodian team works in shifts.'; end if;
  if not (extract(isodow from new.day)::int = any (s.weekdays)) then raise exception 'This shift does not run on that day.'; end if;
  c := coalesce((select minutes from public.staff_contracts where user_id = new.user_id), 480);
  if (c = 240) <> (s.kind = 'part') then raise exception 'A 4-hour worker takes the short shifts and an 8-hour worker the long ones.'; end if;
  return new;
end;
$$;
create trigger check_shift_plan before insert or update on public.shift_plan for each row execute function public.check_shift_plan();

-- Supervisor: set somebody's contract (4 h = 240, 8 h = 480). Future shifts of the wrong length are removed.
create function public.set_contract(p_user uuid, p_minutes int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_active() and public.is_supervisor()) then raise exception 'Only a supervisor can do this.'; end if;
  if p_minutes not in (240, 480) then raise exception 'Contracts are 4 or 8 hours.'; end if;
  insert into public.staff_contracts (user_id, minutes) values (p_user, p_minutes)
  on conflict (user_id) do update set minutes = excluded.minutes, updated_at = now();
  delete from public.shift_plan sp using public.shifts s
   where sp.shift_id = s.id and sp.user_id = p_user and sp.day >= current_date and (s.kind = 'part') <> (p_minutes = 240);
end;
$$;

-- 2) THE GUARD ---------------------------------------------
-- how long a planned task should take (same rule as the app: task goal, else planned window, else task window, else 30)
create function public.assignment_goal(a public.assignments) returns int language sql stable security definer set search_path = public as $$
  select coalesce(t.goal_minutes,
                  nullif((extract(epoch from (a.end_time - a.start_time)) / 60)::int, 0),
                  nullif((extract(epoch from (t.end_time - t.start_time)) / 60)::int, 0), 30)
  from public.tasks t where t.id = a.task_id;
$$;

-- null = fine; otherwise 'noshift' | 'window' | 'capacity'.
-- Days without any shift plan are not checked (so the app keeps working until shifts are planned).
create function public.shift_problem(p_user uuid, p_day date, p_start time, p_end time, p_goal int, p_ignore uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare s public.shifts; cap int; load int; ov int; need int;
begin
  if p_user is null then return null; end if;
  if not exists (select 1 from public.shift_plan where day = p_day) then return null; end if;
  select sh.* into s from public.shift_plan sp join public.shifts sh on sh.id = sp.shift_id where sp.user_id = p_user and sp.day = p_day;
  if not found then return 'noshift'; end if;
  cap := least(coalesce((select minutes from public.staff_contracts where user_id = p_user), 480), s.capacity_minutes);
  if p_start is not null and p_end is not null then
    -- the planned window must overlap the shift for as long as the task needs
    ov := (extract(epoch from (least(p_end, s.end_time) - greatest(p_start, s.start_time))) / 60)::int;
    need := least(p_goal, (extract(epoch from (p_end - p_start)) / 60)::int);
    if ov < need then return 'window'; end if;
  end if;
  select coalesce(sum(public.assignment_goal(a)), 0) into load from public.assignments a
   where a.assignee = p_user and a.day = p_day and (p_ignore is null or a.id <> p_ignore);
  if load + p_goal > cap then return 'capacity'; end if;
  return null;
end;
$$;

-- how full is somebody's day (0 = empty, 1 = full)
create function public.shift_ratio(p_user uuid, p_day date) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(sum(public.assignment_goal(a)), 0)::numeric from public.assignments a where a.assignee = p_user and a.day = p_day)
         / nullif((select least(coalesce((select minutes from public.staff_contracts where user_id = p_user), 480), sh.capacity_minutes)
                     from public.shift_plan sp join public.shifts sh on sh.id = sp.shift_id where sp.user_id = p_user and sp.day = p_day), 0), 1);
$$;

create function public.guard_assignment_shift() returns trigger language plpgsql security definer set search_path = public as $$
declare prob text;
begin
  if new.assignee is null or new.status = 'done' then return new; end if;
  if tg_op = 'UPDATE' and old.assignee is not distinct from new.assignee and old.day = new.day
     and old.start_time is not distinct from new.start_time and old.end_time is not distinct from new.end_time then return new; end if;
  prob := public.shift_problem(new.assignee, new.day, new.start_time, new.end_time, public.assignment_goal(new), case when tg_op = 'UPDATE' then new.id end);
  if prob = 'noshift' then raise exception 'This person has no shift on that day.'; end if;
  if prob = 'window' then raise exception 'This task does not fit the time of that shift.'; end if;
  if prob = 'capacity' then raise exception 'This would be over the daily capacity of that person.'; end if;
  return new;
end;
$$;
create trigger guard_assignment_shift before insert or update on public.assignments for each row execute function public.guard_assignment_shift();

-- 3) TASKS: priority, automatic routines, monthly, more areas -----------
alter table public.tasks add column priority text not null default 'medium' check (priority in ('high', 'medium', 'low'));
alter table public.tasks add column auto boolean not null default false;         -- create it automatically at the start of the shift
alter table public.tasks add column month_day int check (month_day between 1 and 31);
alter table public.assignments add column auto boolean not null default false;   -- made by the routine generator
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.tasks'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%frequency%' loop
    execute format('alter table public.tasks drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.tasks add constraint tasks_frequency_check check (frequency in ('daily', 'weekdays', 'monthly'));

insert into public.areas (key, icon, color, sort) values
  ('offices', 'briefcase', '#D0E6A5', 5),
  ('annex',   'home',      '#FA897B', 6)
on conflict (key) do nothing;

-- 4) ROUTINES ----------------------------------------------
create function public.task_due(t public.tasks, d date) returns boolean language sql immutable as $$
  select case t.frequency
    when 'daily' then true
    when 'weekdays' then extract(isodow from d)::int = any (t.weekdays)
    when 'monthly' then extract(day from d)::int = least(coalesce(t.month_day, 1), extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int)
    else false end;
$$;

-- a routine is made at the start of the shift block it belongs to (07:00, 08:00, 14:00 or 18:30)
create function public.routine_block(p_start time) returns time language sql stable as $$
  select coalesce((select max(block::time) from public.shifts where block::time <= p_start), (select min(block::time) from public.shifts));
$$;

-- Give the waiting tasks of a day to the people on shift: most important first, longest first, always to the person with the
-- most room left, never outside a shift and never over the capacity (4 h = 240 min, 8 h = 480 min).
create function public.allocate_waiting(p_day date, p_ids uuid[], p_only_auto boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare a public.assignments; best uuid; placed int := 0;
begin
  if auth.uid() is not null and not (public.is_active() and public.is_supervisor()) then raise exception 'Only a supervisor can do this.'; end if;
  if not exists (select 1 from public.shift_plan where day = p_day) then return 0; end if;
  for a in
    select x.* from public.assignments x join public.tasks t on t.id = x.task_id
     where x.day = p_day and x.assignee is null and x.status <> 'done'
       and (p_ids is null or x.id = any (p_ids)) and (not p_only_auto or x.auto)
     order by case t.priority when 'high' then 0 when 'medium' then 1 else 2 end, x.start_time nulls last, public.assignment_goal(x) desc, x.created_at
  loop
    best := null;
    select sp.user_id into best
      from public.shift_plan sp join public.profiles p on p.id = sp.user_id and p.active
     where sp.day = p_day and public.shift_problem(sp.user_id, p_day, a.start_time, a.end_time, public.assignment_goal(a), a.id) is null
     order by public.shift_ratio(sp.user_id, p_day), p.display_name
     limit 1;
    if best is not null then
      update public.assignments set assignee = best where id = a.id;
      placed := placed + 1;
    end if;
  end loop;
  return placed;
end;
$$;

-- Made by the scheduler every 5 minutes: at the start of each shift block, every automatic routine that is due today and not
-- planned yet is created and given to the people on shift. (Tasks nobody can take yet are tried again on the next run.)
create function public.generate_routines(p_at timestamp default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  nowl timestamp := coalesce(p_at, now() at time zone coalesce((select value from public.app_settings where key = 'timezone'), 'Europe/Berlin'));
  today date := nowl::date; tk public.tasks; made int := 0;
begin
  for tk in select t.* from public.tasks t
             where t.auto and not t.deleted and t.kind = 'task' and public.task_due(t, today)
               and nowl::time >= public.routine_block(t.start_time)
               and not exists (select 1 from public.assignments a where a.task_id = t.id and a.day = today) loop
    insert into public.assignments (task_id, assignee, day, start_time, end_time, kind, auto, created_by)
    values (tk.id, null, today, tk.start_time, tk.end_time, 'task', true, null);
    made := made + 1;
  end loop;
  perform public.allocate_waiting(today, null, true);
  return made;
end;
$$;
revoke execute on function public.generate_routines(timestamp), public.check_shift_plan(), public.guard_assignment_shift() from public, anon, authenticated;
revoke execute on function public.assignment_goal(public.assignments), public.shift_problem(uuid, date, time, time, int, uuid), public.shift_ratio(uuid, date) from public, anon;
grant execute on function public.assignment_goal(public.assignments), public.shift_problem(uuid, date, time, time, int, uuid), public.shift_ratio(uuid, date) to authenticated;
revoke execute on function public.set_contract(uuid, int), public.allocate_waiting(date, uuid[], boolean) from public, anon;
grant execute on function public.set_contract(uuid, int), public.allocate_waiting(date, uuid[], boolean) to authenticated;

do $$
begin
  perform cron.schedule('bountiful-routines', '*/5 * * * *', 'select public.generate_routines()');
exception when others then
  raise notice 'Could not schedule bountiful-routines (%). Schedule it by hand: select cron.schedule(''bountiful-routines'', ''*/5 * * * *'', ''select public.generate_routines()'');', sqlerrm;
end $$;

-- 5) THE LOGBOOK -------------------------------------------
create table public.logbook_entries (
  id          uuid primary key default gen_random_uuid(),
  day         date not null,
  block       text not null check (block in ('morning', 'afternoon', 'evening')),
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  area_id     uuid references public.areas (id) on delete set null,
  follow_up   boolean not null default false,             -- "the next shift needs to do something"
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  author      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index logbook_day_idx on public.logbook_entries (day, created_at);
alter table public.logbook_entries enable row level security;
revoke all on public.logbook_entries from anon, authenticated;
grant select, delete on public.logbook_entries to authenticated;
grant insert (day, block, body, area_id, follow_up) on public.logbook_entries to authenticated;
create policy "The custodian team reads the logbook" on public.logbook_entries for select to authenticated
  using (public.is_active() and public.my_department() = 'custodian');
create policy "The custodian team writes in the logbook" on public.logbook_entries for insert to authenticated
  with check (public.is_active() and public.my_department() = 'custodian' and author = auth.uid());
create policy "Delete my entries (supervisors moderate)" on public.logbook_entries for delete to authenticated
  using (public.is_active() and public.my_department() = 'custodian' and (author = auth.uid() or public.is_supervisor()));

-- anybody on the team can tick a follow-up as done (or undo it)
create function public.resolve_logbook(p_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_active() and public.my_department() = 'custodian') then raise exception 'Only the custodian team can do this.'; end if;
  update public.logbook_entries
     set resolved_by = case when p_done then auth.uid() end, resolved_at = case when p_done then now() end
   where id = p_id and follow_up;
end;
$$;
revoke execute on function public.resolve_logbook(uuid, boolean) from public, anon;
grant execute on function public.resolve_logbook(uuid, boolean) to authenticated;

alter publication supabase_realtime add table public.shift_plan, public.staff_contracts, public.logbook_entries;
