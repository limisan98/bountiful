-- 015: Reception room-cleaning requests (Check-out / Check-in) and the guest room list.
-- * guest_rooms: the rooms of House 1-4 that Reception can tick (supervisors can edit the list; the numbers seeded here are placeholders).
-- * two room tasks: "Room cleaning - Check-out" (deep clean after guests leave at 10:00) and "Room setup - Check-in" (ready before 14:00).
--   tasks.room_flow says which is which. Both are normal library tasks (goal, steps and window can be changed by the supervisor).
-- * request_room_cleaning(day, flow, rooms, note): one tap from Reception = one waiting task per room for the supervisor, with ONE phone message.

create table public.guest_rooms (
  id    uuid primary key default gen_random_uuid(),
  house int  not null check (house between 1 and 4),
  label text not null check (char_length(btrim(label)) between 1 and 20),
  sort  int  not null default 0,
  unique (house, label)
);
alter table public.guest_rooms enable row level security;
revoke all on public.guest_rooms from anon, authenticated;
grant select, insert, update, delete on public.guest_rooms to authenticated;
create policy "People read guest rooms" on public.guest_rooms for select to authenticated using (public.is_active());
create policy "Supervisors add guest rooms" on public.guest_rooms for insert to authenticated with check (public.is_supervisor());
create policy "Supervisors edit guest rooms" on public.guest_rooms for update to authenticated using (public.is_supervisor()) with check (public.is_supervisor());
create policy "Supervisors remove guest rooms" on public.guest_rooms for delete to authenticated using (public.is_supervisor());
insert into public.guest_rooms (house, label, sort)
select h, n::text, h * 100 + n from generate_series(1, 4) h, generate_series(1, 6) n;

alter table public.tasks add column room_flow text check (room_flow in ('checkout', 'checkin'));

insert into public.tasks (name, description, icon, color, start_time, end_time, frequency, weekdays, steps, goal_minutes, kind, priority, room_flow)
values
 ('Room cleaning · Check-out', 'The guests have left (check-out 10:00): deep clean the room so it is ready again.', 'sparkles-2', '#FA897B', '10:00', '14:00', 'weekdays', '{}',
  '[{"title":"Strip the bed and take the linens to the laundry","description":""},{"title":"Dust all surfaces, shelves and the headboard","description":""},{"title":"Scrub the bathroom: shower, sink, toilet, floor","description":""},{"title":"Vacuum and mop the floors","description":""},{"title":"Clean the windows and mirrors","description":""},{"title":"Check for forgotten items and report damage","description":""},{"title":"Empty the bins and restock towels and soap","description":""}]'::jsonb,
  60, 'room', 'high', 'checkout'),
 ('Room setup · Check-in', 'Guests arrive at 14:00: set the room up so it is ready for them.', 'key', '#86E3CE', '10:00', '14:00', 'weekdays', '{}',
  '[{"title":"Make the bed with fresh linens","description":""},{"title":"Put out clean towels and soap","description":""},{"title":"Quick dust and wipe the surfaces","description":""},{"title":"Check lights, heating and the bathroom","description":""},{"title":"Vacuum the floor and empty the bins","description":""},{"title":"Open the window to air the room, then close it","description":""}]'::jsonb,
  20, 'room', 'medium', 'checkin');

-- one phone message for a whole batch (the trigger skips room inserts while this switch is on)
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
    elsif new.kind = 'room' and coalesce(current_setting('app.room_batch', true), '') <> '1' then -- (a batch from Reception sends one phone message, see request_room_cleaning)
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


create function public.request_room_cleaning(p_day date, p_flow text, p_rooms text[], p_note text)
returns setof public.assignments language plpgsql security definer set search_path = public as $$
declare tk public.tasks; r text; nm text; made uuid[] := '{}'; new_id uuid; names text[] := '{}'; extra int;
begin
  if not public.is_active() then raise exception 'Your account is not active.'; end if;
  if not (public.is_supervisor() or public.my_department() = 'reception') then raise exception 'Only Reception and the supervisor can ask for rooms.'; end if;
  if p_flow not in ('checkout', 'checkin') then raise exception 'Choose Check-out or Check-in.'; end if;
  select * into tk from public.tasks where kind = 'room' and room_flow = p_flow and not deleted order by created_at limit 1;
  if tk.id is null then raise exception 'There is no room task for this yet. Ask the supervisor to create one.'; end if;
  perform set_config('app.room_batch', '1', true);
  foreach r in array coalesce(p_rooms, '{}') loop
    nm := left(btrim(r), 40);
    if nm <> '' and not exists (select 1 from public.assignments a where a.day = p_day and a.task_id = tk.id and a.title = nm and a.status <> 'done') then
      insert into public.assignments (task_id, assignee, day, start_time, end_time, note, kind, title, requested_by, created_by)
      values (tk.id, null, p_day, tk.start_time, tk.end_time, left(btrim(coalesce(p_note, '')), 500), 'room', nm, auth.uid(), auth.uid())
      returning id into new_id;
      made := made || new_id;
      names := names || nm;
    end if;
  end loop;
  perform set_config('app.room_batch', '', true);
  if cardinality(made) > 0 then
    begin
      extra := greatest(cardinality(names) - 3, 0);
      perform public.push_send(public.push_supervisors(auth.uid(), 'rooms', true), 'rooms',
        jsonb_build_object('name', public.push_name(auth.uid()),
          'body', tk.name || ' · ' || to_char(p_day, 'DD.MM.') || ' · ' || array_to_string(names[1:3], ', ') || case when extra > 0 then ' +' || extra else '' end),
        './#/home', 'rooms-new');
    exception when others then null;
    end;
  end if;
  return query select * from public.assignments where id = any (made);
end;
$$;
revoke all on function public.request_room_cleaning(date, text, text[], text) from public, anon;
grant execute on function public.request_room_cleaning(date, text, text[], text) to authenticated;
