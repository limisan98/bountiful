-- ============================================================
-- BOUNTIFUL · Step 2 · Roles, colleagues, tasks, calendar, chat
-- Run once in the Supabase SQL editor.
-- ============================================================

-- 1) ROLES ----------------------------------------------------
-- Four fixed roles. Supervisors can rename them and change their icon and color.
-- name = null means "use the built-in translated name".
create table public.roles (
  id            text primary key,
  department    text not null check (department in ('custodian', 'reception')),
  is_supervisor boolean not null default false,
  name          text check (name is null or char_length(btrim(name)) between 1 and 30),
  icon          text not null check (icon ~ '^[a-z0-9-]+$'),
  color         text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort          int not null
);

insert into public.roles (id, department, is_supervisor, icon, color, sort) values
  ('custodian_supervisor', 'custodian', true,  'shield-check', '#86E3CE', 1),
  ('custodian',            'custodian', false, 'sparkles',     '#FFDD94', 2),
  ('reception_supervisor', 'reception', true,  'star',         '#CCABD8', 3),
  ('receptionist',         'reception', false, 'key',          '#FA897B', 4);

-- 2) Move everybody from the old 3-role list to the new 4 roles ------
drop function public.admin_update_member(uuid, public.app_role, boolean);

alter table public.allowlist alter column role drop default;
alter table public.allowlist alter column role type text using (
  case role::text when 'supervisor' then 'custodian_supervisor' when 'receptionist' then 'receptionist' else 'custodian' end);
alter table public.profiles alter column role type text using (
  case role::text when 'supervisor' then 'custodian_supervisor' when 'receptionist' then 'receptionist' else 'custodian' end);
alter table public.allowlist alter column role set default 'custodian';

alter table public.allowlist add constraint allowlist_role_fkey foreign key (role) references public.roles (id);
alter table public.profiles  add constraint profiles_role_fkey  foreign key (role) references public.roles (id);
drop type public.app_role;

-- 3) Colleagues may only see name, photo and role -------------------
-- Email and language are no longer stored on the shared profile
-- (supervisors read emails from the allowlist; language lives in each person's own login data).
alter table public.profiles drop column email;
alter table public.profiles drop column language;

-- 4) Helper functions ----------------------------------------
create or replace function public.is_supervisor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p join public.roles r on r.id = p.role
    where p.id = auth.uid() and p.active and r.is_supervisor
  );
$$;

create or replace function public.is_active()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

create or replace function public.my_department()
returns text language sql stable security definer set search_path = public as $$
  select r.department from public.profiles p join public.roles r on r.id = p.role
  where p.id = auth.uid() and p.active;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a public.allowlist;
begin
  select * into a from public.allowlist
  where email = lower(new.email)
    and invite_code = upper(trim(coalesce(new.raw_user_meta_data ->> 'invite_code', '')))
    and claimed_by is null
  for update;

  if not found then
    raise exception 'This email or invitation code is not on the Bountiful list.';
  end if;

  insert into public.profiles (id, display_name, role)
  values (new.id, left(coalesce(nullif(a.full_name, ''), split_part(a.email, '@', 1)), 40), a.role);

  update public.allowlist set claimed_by = new.id where email = a.email;
  return new;
end;
$$;

-- Only supervisors can change someone's role or switch an account on/off
create function public.admin_update_member(p_id uuid, p_role text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_supervisor() then raise exception 'Only a supervisor can do this.'; end if;
  if p_id = auth.uid() then raise exception 'You cannot change your own role.'; end if;
  update public.profiles  set role = p_role, active = p_active where id = p_id;
  update public.allowlist set role = p_role where claimed_by = p_id;
end;
$$;

-- 5) Profiles: visible to colleagues, editable only by their owner --
drop policy if exists "Signed-in people can see all profiles" on public.profiles;
create policy "Colleagues are visible"
  on public.profiles for select to authenticated
  using (active or id = auth.uid() or public.is_supervisor());

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

-- 6) Roles: everybody reads, supervisors edit name / icon / color --
alter table public.roles enable row level security;
revoke all on public.roles from anon, authenticated;
grant select on public.roles to authenticated;
grant update (name, icon, color) on public.roles to authenticated;
create policy "Everyone sees roles" on public.roles for select to authenticated using (true);
create policy "Supervisors edit roles" on public.roles for update to authenticated
  using (public.is_supervisor()) with check (public.is_supervisor());

-- 7) AREAS (temple, guesthouse, ...) ----------------------------
create table public.areas (
  id    uuid primary key default gen_random_uuid(),
  key   text unique,
  name  text check (name is null or char_length(btrim(name)) between 1 and 40),
  icon  text not null default 'home-2' check (icon ~ '^[a-z0-9-]+$'),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort  int not null default 0
);
insert into public.areas (key, icon, color, sort) values
  ('temple',     'home-2',          '#CCABD8', 1),
  ('guesthouse', 'bed',             '#86E3CE', 2),
  ('visitors',   'compass',         '#FFDD94', 3),
  ('cafeterias', 'tools-kitchen-2', '#FA897B', 4);

-- 8) TASKS ----------------------------------------------------
create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  icon        text not null default 'sparkles' check (icon ~ '^[a-z0-9-]+$'),
  color       text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  area_id     uuid references public.areas (id) on delete set null,
  start_time  time not null default '09:00',
  end_time    time not null default '10:00',
  frequency   text not null default 'daily' check (frequency in ('daily', 'weekdays')),
  weekdays    int[] not null default '{}',
  steps       jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  deleted     boolean not null default false,
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  check (end_time > start_time)
);

-- 9) ASSIGNMENTS (who does which task, when) ---------------------
create table public.assignments (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks (id) on delete cascade,
  assignee     uuid not null references public.profiles (id) on delete cascade,
  day          date not null,
  start_time   time not null,
  end_time     time not null,
  note         text not null default '' check (char_length(note) <= 500),
  status       text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  steps_done   int[] not null default '{}',
  started_at   timestamptz,
  completed_at timestamptz,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  check (end_time > start_time)
);
create index assignments_day_idx on public.assignments (day);
create index assignments_assignee_day_idx on public.assignments (assignee, day);

-- Private report of a finished task: only the person and supervisors can read it
create table public.assignment_reports (
  assignment_id uuid primary key references public.assignments (id) on delete cascade,
  minutes_spent int not null check (minutes_spent between 0 and 1440),
  goal_minutes  int not null,
  comment       text not null default '',
  delay_reason  text not null default '',
  completed_at  timestamptz not null default now()
);

-- 10) CHAT -----------------------------------------------------
create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  channel    text not null check (channel in ('all', 'custodian', 'reception')),
  sender     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index messages_channel_idx on public.messages (channel, created_at desc);

-- 11) SECURITY RULES -----------------------------------------
alter table public.areas              enable row level security;
alter table public.tasks              enable row level security;
alter table public.assignments        enable row level security;
alter table public.assignment_reports enable row level security;
alter table public.messages           enable row level security;

revoke all on public.areas, public.tasks, public.assignments, public.assignment_reports, public.messages from anon, authenticated;
grant select, insert, update, delete on public.areas       to authenticated;
grant select, insert, update         on public.tasks       to authenticated;
grant select, insert, update, delete on public.assignments to authenticated;
grant select                         on public.assignment_reports to authenticated;
grant select, insert, delete         on public.messages    to authenticated;

create policy "People see areas" on public.areas for select to authenticated using (public.is_active());
create policy "Supervisors manage areas" on public.areas for all to authenticated
  using (public.is_supervisor()) with check (public.is_supervisor());

create policy "People see tasks" on public.tasks for select to authenticated using (public.is_active());
create policy "Supervisors add tasks" on public.tasks for insert to authenticated with check (public.is_supervisor());
create policy "Supervisors edit tasks" on public.tasks for update to authenticated
  using (public.is_supervisor()) with check (public.is_supervisor());

create policy "People see who does what" on public.assignments for select to authenticated using (public.is_active());
create policy "Supervisors plan work" on public.assignments for all to authenticated
  using (public.is_supervisor()) with check (public.is_supervisor());

create policy "Reports: the person and supervisors" on public.assignment_reports for select to authenticated
  using (public.is_supervisor() or exists (
    select 1 from public.assignments a where a.id = assignment_id and a.assignee = auth.uid()));

create policy "Read the chats I belong to" on public.messages for select to authenticated
  using (public.is_active() and (channel = 'all' or channel = public.my_department()));
create policy "Write in the chats I belong to" on public.messages for insert to authenticated
  with check (sender = auth.uid() and public.is_active() and (channel = 'all' or channel = public.my_department()));
create policy "Delete my messages (supervisors moderate)" on public.messages for delete to authenticated
  using (public.is_active() and (sender = auth.uid() or public.is_supervisor()));

-- 12) What a worker can do with their OWN task (always through these safe doors)
create function public.start_assignment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active() then raise exception 'Your account is not active.'; end if;
  update public.assignments
     set status = 'doing', started_at = coalesce(started_at, now())
   where id = p_id and assignee = auth.uid() and status in ('todo', 'doing');
  if not found then raise exception 'This task cannot be started.'; end if;
end;
$$;

create function public.set_assignment_steps(p_id uuid, p_steps int[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active() then raise exception 'Your account is not active.'; end if;
  update public.assignments set steps_done = coalesce(p_steps, '{}')
   where id = p_id and assignee = auth.uid() and status <> 'done';
end;
$$;

create function public.complete_assignment(p_id uuid, p_minutes int, p_comment text, p_delay text)
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
  goal := (extract(epoch from (a.end_time - a.start_time)) / 60)::int;

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

create function public.reopen_assignment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active() then raise exception 'Your account is not active.'; end if;
  if not exists (select 1 from public.assignments where id = p_id and (assignee = auth.uid() or public.is_supervisor())) then
    raise exception 'You cannot change this task.';
  end if;
  update public.assignments set status = 'todo', started_at = null, completed_at = null, steps_done = '{}' where id = p_id;
  delete from public.assignment_reports where assignment_id = p_id;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_active(), public.my_department(),
  public.admin_update_member(uuid, text, boolean), public.start_assignment(uuid),
  public.set_assignment_steps(uuid, int[]), public.complete_assignment(uuid, int, text, text),
  public.reopen_assignment(uuid) from public, anon;
grant execute on function public.is_supervisor(), public.is_active(), public.my_department(),
  public.admin_update_member(uuid, text, boolean), public.start_assignment(uuid),
  public.set_assignment_steps(uuid, int[]), public.complete_assignment(uuid, int, text, text),
  public.reopen_assignment(uuid) to authenticated;

-- 13) Live updates ---------------------------------------------
alter publication supabase_realtime add table
  public.roles, public.areas, public.tasks, public.assignments, public.assignment_reports, public.messages;
