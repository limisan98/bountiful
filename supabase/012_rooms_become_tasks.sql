-- =========================================================
-- BOUNTIFUL · Step 11 · Rooms become tasks, comments on tasks, better notifications
-- - a "room task" is a task (kind 'room') planned for a day with a room number (assignments.title)
-- - a task can wait for somebody (assignee empty); Reception asks for rooms this way
-- - people can write comments on their tasks (assignment_comments)
-- - phone notifications now also cover re-assignments, "started", "done", comments
-- =========================================================

-- 1) Tasks: a kind
alter table public.tasks add column kind text not null default 'task' check (kind in ('task', 'room'));

-- 2) Planned tasks: a title (room number), who asked, may wait for somebody, may have no clock time
alter table public.assignments add column kind text not null default 'task' check (kind in ('task', 'room'));
alter table public.assignments add column title text not null default '' check (char_length(title) <= 40);
alter table public.assignments add column requested_by uuid references public.profiles (id) on delete set null;
alter table public.assignments alter column assignee drop not null;
alter table public.assignments alter column start_time drop not null;
alter table public.assignments alter column end_time drop not null;
alter table public.assignments add check ((start_time is null) = (end_time is null));

-- 3) The standard room task (its time goal is the old "room goal")
insert into public.tasks (name, description, icon, color, start_time, end_time, frequency, weekdays, steps, goal_minutes, kind)
values ('Room cleaning', 'Clean one guest room.', 'bed', '#FFDD94', '08:00', '17:00', 'weekdays', '{}',
        '[{"title":"Strip and make the bed","description":""},{"title":"Dust and vacuum","description":""},{"title":"Bathroom","description":""},{"title":"Restock towels and soap","description":""}]'::jsonb,
        coalesce((select nullif(value, '')::int from public.app_settings where key = 'room_goal_minutes'), 30), 'room');

-- 4) Move every existing room into the planned tasks, then retire the old table
-- (no phone notifications for old rooms while they are copied over)
alter table public.assignments disable trigger push_assignment;
insert into public.assignments (task_id, assignee, day, start_time, end_time, note, status, started_at, completed_at, created_by, created_at,
                                kind, title, requested_by)
select (select id from public.tasks where kind = 'room' order by created_at limit 1), q.assignee, q.day, null, null, q.note, q.status,
       q.started_at, q.done_at, q.requested_by, q.created_at, 'room', q.room, q.requested_by
from public.room_requests q;

insert into public.assignment_reports (assignment_id, minutes_spent, goal_minutes, completed_at)
select a.id, q.minutes_spent, coalesce((select goal_minutes from public.tasks where id = a.task_id), 30), coalesce(q.done_at, now())
from public.room_requests q
join public.assignments a on a.kind = 'room' and a.title = q.room and a.day = q.day and a.created_at = q.created_at
where q.status = 'done' and q.minutes_spent is not null
on conflict (assignment_id) do nothing;
alter table public.assignments enable trigger push_assignment;

drop trigger if exists push_room on public.room_requests;
drop function if exists public.push_on_room();
drop function if exists public.assign_rooms(uuid[], uuid);
drop function if exists public.set_room_status(uuid, text);
drop function if exists public.edit_room(uuid, text, date, text);
drop function if exists public.set_room_goal(int);
do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'room_requests') then
    alter publication supabase_realtime drop table public.room_requests;
  end if;
end $$;
alter table public.room_requests rename to room_requests_archive;
revoke all on public.room_requests_archive from anon, authenticated;

-- 5) Reception (and supervisors) ask for rooms: they wait for the supervisor to give them to somebody
create function public.request_rooms(p_day date, p_rooms text[], p_note text)
returns setof public.assignments language plpgsql security definer set search_path = public as $$
declare tid uuid; r text; nm text; made uuid[] := '{}'; new_id uuid;
begin
  if not public.is_active() then raise exception 'Your account is not active.'; end if;
  if not (public.is_supervisor() or public.my_department() = 'reception') then raise exception 'Only Reception and the supervisor can ask for rooms.'; end if;
  select id into tid from public.tasks where kind = 'room' and not deleted order by created_at limit 1;
  if tid is null then raise exception 'There is no room task yet. Ask the supervisor to create one.'; end if;
  foreach r in array coalesce(p_rooms, '{}') loop
    nm := left(btrim(r), 40);
    if nm <> '' then
      insert into public.assignments (task_id, assignee, day, start_time, end_time, note, kind, title, requested_by, created_by)
      values (tid, null, p_day, null, null, left(btrim(coalesce(p_note, '')), 500), 'room', nm, auth.uid(), auth.uid())
      returning id into new_id;
      made := made || new_id;
    end if;
  end loop;
  return query select * from public.assignments where id = any (made);
end;
$$;

-- The person who asked can change their request until it is done
create function public.edit_room_request(p_id uuid, p_title text, p_day date, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active() then raise exception 'Your account is not active.'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 40 then raise exception 'Please give a room name.'; end if;
  update public.assignments
     set title = btrim(p_title), day = p_day, note = left(btrim(coalesce(p_note, '')), 500)
   where id = p_id and requested_by = auth.uid() and kind = 'room' and status <> 'done';
  if not found then raise exception 'You cannot change this room.'; end if;
end;
$$;

-- Reception can withdraw a request that nobody has taken yet
create policy "Reception withdraws own requests" on public.assignments for delete to authenticated
  using (requested_by = auth.uid() and assignee is null and public.is_active());

-- 6) Comments on a task (the person doing it and the supervisors)
create table public.assignment_comments (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  author        uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body          text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at    timestamptz not null default now()
);
create index assignment_comments_idx on public.assignment_comments (assignment_id, created_at);
alter table public.assignment_comments enable row level security;
revoke all on public.assignment_comments from anon, authenticated;
grant select, insert, delete on public.assignment_comments to authenticated;
revoke insert on public.assignment_comments from authenticated;
grant insert (assignment_id, body) on public.assignment_comments to authenticated;

create policy "Read comments of my tasks" on public.assignment_comments for select to authenticated
  using (public.is_active() and (public.is_supervisor() or exists (select 1 from public.assignments a where a.id = assignment_id and a.assignee = auth.uid())));
create policy "Comment on my tasks" on public.assignment_comments for insert to authenticated
  with check (public.is_active() and author = auth.uid() and (public.is_supervisor() or exists (select 1 from public.assignments a where a.id = assignment_id and a.assignee = auth.uid())));
create policy "Delete my comments" on public.assignment_comments for delete to authenticated
  using (author = auth.uid() or public.is_supervisor());
alter publication supabase_realtime add table public.assignment_comments;

-- 7) Supervisor: remind someone of a task they already have
create function public.renotify_assignment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.assignments; tname text;
begin
  if not (public.is_active() and public.is_supervisor()) then raise exception 'Only the supervisor can do this.'; end if;
  select * into a from public.assignments where id = p_id;
  if not found or a.assignee is null then return; end if;
  select name into tname from public.tasks where id = a.task_id;
  if public.push_wants(a.assignee, 'assigned', true) then
    perform public.push_send(array[a.assignee], 'assigned',
      jsonb_build_object('body', coalesce(tname, '') || coalesce(' · ' || nullif(a.title, ''), '') || ' · ' || to_char(a.day, 'DD.MM.')), './#/tasks', 'asg-' || a.id);
  end if;
end;
$$;

-- 8) Reports: rooms are tasks now
create or replace function public.build_report(p_custodian uuid, p_from date, p_to date, p_detail boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'planned', (select count(*) from assignments a where a.assignee = p_custodian and a.day between p_from and p_to),
    'done',    (select count(*) from assignments a where a.assignee = p_custodian and a.day between p_from and p_to and a.status = 'done'),
    'minutes', coalesce((select sum(r.minutes_spent) from assignments a join assignment_reports r on r.assignment_id = a.id
                         where a.assignee = p_custodian and a.day between p_from and p_to), 0),
    'over',    (select count(*) from assignments a join assignment_reports r on r.assignment_id = a.id
                where a.assignee = p_custodian and a.day between p_from and p_to and r.minutes_spent > r.goal_minutes),
    'tasks',   coalesce((select jsonb_agg(jsonb_build_object('task', x.name, 'count', x.n, 'minutes', x.m) order by x.name)
                         from (select t.name, count(*) n, coalesce(sum(r.minutes_spent), 0) m
                               from assignments a join tasks t on t.id = a.task_id
                               left join assignment_reports r on r.assignment_id = a.id
                               where a.assignee = p_custodian and a.day between p_from and p_to and a.status = 'done'
                               group by t.name) x), '[]'::jsonb),
    'items',   coalesce((select jsonb_agg(jsonb_build_object('day', a.day, 'task', t.name || coalesce(' · ' || nullif(a.title, ''), ''), 'minutes', r.minutes_spent,
                                                              'goal', r.goal_minutes, 'comment', r.comment, 'delay', r.delay_reason)
                                          order by a.day, a.start_time nulls last, a.created_at)
                         from assignments a join tasks t on t.id = a.task_id
                         left join assignment_reports r on r.assignment_id = a.id
                         where a.assignee = p_custodian and a.day between p_from and p_to and a.status = 'done'
                           and (p_detail or coalesce(r.comment, '') <> '' or coalesce(r.delay_reason, '') <> '')), '[]'::jsonb),
    'open',    case when p_detail then coalesce((select jsonb_agg(jsonb_build_object('day', a.day, 'task', t.name || coalesce(' · ' || nullif(a.title, ''), ''))
                                                                  order by a.day, a.start_time nulls last, a.created_at)
                         from assignments a join tasks t on t.id = a.task_id
                         where a.assignee = p_custodian and a.day between p_from and p_to and a.status <> 'done'), '[]'::jsonb)
               else '[]'::jsonb end,
    'rooms',   '[]'::jsonb
  );
$$;

create or replace function public.put_report(p_kind text, p_from date, p_to date, p_custodian uuid)
returns int language plpgsql security definer set search_path = public as $$
declare s jsonb; n int;
begin
  s := public.build_report(p_custodian, p_from, p_to, p_kind = 'day');
  if (s ->> 'planned')::int = 0 then return 0; end if;
  insert into public.custodian_reports (kind, period_start, period_end, custodian, summary)
  values (p_kind, p_from, p_to, p_custodian, s)
  on conflict (kind, period_end, custodian) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 9) The task time goal in the report also works for tasks without a clock time
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
                   (extract(epoch from (a.end_time - a.start_time)) / 60)::int,
                   (select (extract(epoch from (t.end_time - t.start_time)) / 60)::int from public.tasks t where t.id = a.task_id), 30);

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

-- 10) Phone notifications for everything that happens to a planned task
create function public.push_done_wanted(p_user uuid, p_area uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_array_length(u.raw_user_meta_data #> '{notif,doneAreas}') = 0
                          or (u.raw_user_meta_data #> '{notif,doneAreas}') ? p_area::text
                   from auth.users u where u.id = p_user), true);
$$;

create or replace function public.push_on_assignment() returns trigger language plpgsql security definer set search_path = public as $$
declare
  tname text; tarea uuid; label text; wh text; actor uuid := auth.uid(); who text;
begin
  select name, area_id into tname, tarea from public.tasks where id = new.task_id;
  label := coalesce(tname, '') || coalesce(' · ' || nullif(new.title, ''), '');
  wh := to_char(new.day, 'DD.MM.') || coalesce(' ' || to_char(new.start_time, 'HH24:MI'), '');

  if tg_op = 'INSERT' then
    if new.assignee is not null then
      if new.assignee is distinct from actor and public.push_wants(new.assignee, 'assigned', true) then
        perform public.push_send(array[new.assignee], 'assigned', jsonb_build_object('body', label || ' · ' || wh), './#/tasks', 'asg-' || new.id);
      end if;
    elsif new.kind = 'room' then
      perform public.push_send(public.push_supervisors(new.requested_by, 'rooms', true), 'rooms',
        jsonb_build_object('name', public.push_name(new.requested_by), 'body', label || ' · ' || wh), './#/tasks', 'rooms-new');
    end if;
    return null;
  end if;

  -- given (or given again) to somebody
  if new.assignee is not null and new.assignee is distinct from old.assignee then
    if new.assignee is distinct from actor and public.push_wants(new.assignee, 'assigned', true) then
      perform public.push_send(array[new.assignee], 'assigned', jsonb_build_object('body', label || ' · ' || wh), './#/tasks', 'asg-' || new.id);
    end if;
  elsif new.assignee is not null and (old.day, old.start_time, old.end_time) is distinct from (new.day, new.start_time, new.end_time)
        and new.assignee is distinct from actor and public.push_wants(new.assignee, 'assigned', true) then
    perform public.push_send(array[new.assignee], 'changed', jsonb_build_object('body', label || ' · ' || wh), './#/tasks', 'asg-' || new.id);
  end if;

  -- a room request edited by the person who asked
  if new.kind = 'room' and (old.title, old.day, old.note) is distinct from (new.title, new.day, new.note) and actor is not distinct from new.requested_by then
    perform public.push_send(public.push_supervisors(new.requested_by, 'rooms', true), 'roomsEdited',
      jsonb_build_object('name', public.push_name(new.requested_by), 'body', label || ' · ' || wh || case when new.note <> '' then ' · ' || new.note else '' end), './#/tasks', 'rooms-edit-' || new.id);
    if new.assignee is not null and new.assignee is distinct from actor and public.push_wants(new.assignee, 'assigned', true) then
      perform public.push_send(array[new.assignee], 'roomEdited', jsonb_build_object('body', label || ' · ' || wh), './#/tasks', 'rooms-edit-' || new.id);
    end if;
  end if;

  -- started / finished
  if new.status is distinct from old.status and new.assignee is not null then
    who := public.push_name(new.assignee);
    if new.status = 'doing' then
      perform public.push_send(public.push_supervisors(new.assignee, 'started', false), 'started', jsonb_build_object('name', who, 'body', label), './#/calendar', 'started-' || new.id);
    elsif new.status = 'done' then
      perform public.push_send(array(select u from unnest(public.push_supervisors(new.assignee, 'done', true)) u where public.push_done_wanted(u, tarea)),
        'done', jsonb_build_object('name', who, 'body', label), './#/calendar', 'done-' || new.id);
      if new.kind = 'room' and new.requested_by is not null and new.requested_by is distinct from new.assignee and public.push_wants(new.requested_by, 'roomsDone', true) then
        perform public.push_send(array[new.requested_by], 'roomDone', jsonb_build_object('name', who, 'body', label), './#/tasks', 'rooms-done');
      end if;
    end if;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

-- comments: the supervisors hear about a custodian's comment, the custodian about a supervisor's
create function public.push_on_comment() returns trigger language plpgsql security definer set search_path = public as $$
declare a public.assignments; tname text; sup boolean; label text;
begin
  select * into a from public.assignments where id = new.assignment_id;
  if not found then return null; end if;
  select name into tname from public.tasks where id = a.task_id;
  label := coalesce(tname, '') || coalesce(' · ' || nullif(a.title, ''), '');
  select r.is_supervisor into sup from public.profiles p join public.roles r on r.id = p.role where p.id = new.author;
  if coalesce(sup, false) then
    if a.assignee is not null and a.assignee <> new.author and public.push_wants(a.assignee, 'comment', true) then
      perform public.push_send(array[a.assignee], 'comment', jsonb_build_object('name', public.push_name(new.author), 'body', label || ': ' || left(new.body, 120)), './#/tasks', 'comment-' || a.id);
    end if;
  else
    perform public.push_send(public.push_supervisors(new.author, 'comment', true), 'comment',
      jsonb_build_object('name', public.push_name(new.author), 'body', label || ': ' || left(new.body, 120)), './#/tasks', 'comment-' || a.id);
  end if;
  return null;
exception when others then
  return null;
end;
$$;
create trigger push_comment after insert on public.assignment_comments for each row execute function public.push_on_comment();

revoke execute on function public.push_done_wanted(uuid, uuid), public.push_on_comment() from public, anon, authenticated;
revoke execute on function public.request_rooms(date, text[], text), public.edit_room_request(uuid, text, date, text),
  public.renotify_assignment(uuid) from public, anon;
grant execute on function public.request_rooms(date, text[], text), public.edit_room_request(uuid, text, date, text),
  public.renotify_assignment(uuid) to authenticated;
