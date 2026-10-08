-- ============================================================
-- BOUNTIFUL · Step 3 · Three roles, and rooms that Reception hands to the Custodian Supervisor
-- Run once in the Supabase SQL editor.
-- ============================================================

-- 1) "Reception Supervisor" is gone: those people become Receptionists -----
update public.profiles  set role = 'receptionist' where role = 'reception_supervisor';
update public.allowlist set role = 'receptionist' where role = 'reception_supervisor';
delete from public.roles where id = 'reception_supervisor';
update public.roles set sort = 3 where id = 'receptionist';

-- 2) Test account (a Receptionist) ---------------------------------------
insert into public.allowlist (email, full_name, role)
values ('jaredartt@gmail.com', 'Jared', 'receptionist')
on conflict (email) do nothing;

-- 3) ROOMS: Reception lists rooms to clean -> the Custodian Supervisor picks who cleans them -> the custodian marks them done
create table public.room_requests (
  id           uuid primary key default gen_random_uuid(),
  day          date not null,
  room         text not null check (char_length(btrim(room)) between 1 and 40),
  note         text not null default '' check (char_length(note) <= 300),
  status       text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  requested_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  assignee     uuid references public.profiles (id) on delete set null,
  assigned_by  uuid references public.profiles (id) on delete set null,
  done_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index room_requests_day_idx on public.room_requests (day);
create index room_requests_assignee_idx on public.room_requests (assignee);

alter table public.room_requests enable row level security;
revoke all on public.room_requests from anon, authenticated;
grant select, insert, delete on public.room_requests to authenticated;

-- Supervisors and Reception see every room; a custodian sees only the rooms given to them
create policy "See the rooms that concern me" on public.room_requests for select to authenticated
  using (public.is_active() and (public.is_supervisor() or public.my_department() = 'reception' or assignee = auth.uid()));

-- Only Reception adds rooms, always unassigned
create policy "Reception adds rooms" on public.room_requests for insert to authenticated
  with check (public.is_active() and public.my_department() = 'reception'
              and requested_by = auth.uid() and status = 'todo' and assignee is null and done_at is null);

-- Reception can take back a room nobody has been given yet; supervisors can remove any
create policy "Remove rooms" on public.room_requests for delete to authenticated
  using (public.is_active() and (public.is_supervisor() or (requested_by = auth.uid() and assignee is null)));

-- Only the supervisor hands rooms to a custodian (or takes them back with p_assignee = null)
create function public.assign_rooms(p_ids uuid[], p_assignee uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_supervisor() then raise exception 'Only the Custodian Supervisor can assign rooms.'; end if;
  if p_assignee is not null and not exists (
    select 1 from public.profiles p join public.roles r on r.id = p.role
    where p.id = p_assignee and p.active and r.department = 'custodian'
  ) then raise exception 'Rooms can only be given to a custodian.'; end if;
  update public.room_requests
     set assignee = p_assignee,
         assigned_by = case when p_assignee is null then null else auth.uid() end,
         status = 'todo', done_at = null
   where id = any(p_ids) and status <> 'done';
end;
$$;

-- The custodian (or the supervisor) moves a room to todo / doing / done
create function public.set_room_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active() then raise exception 'Your account is not active.'; end if;
  if p_status not in ('todo', 'doing', 'done') then raise exception 'Unknown status.'; end if;
  update public.room_requests
     set status = p_status, done_at = case when p_status = 'done' then now() else null end
   where id = p_id and (assignee = auth.uid() or public.is_supervisor());
  if not found then raise exception 'You cannot change this room.'; end if;
end;
$$;

revoke execute on function public.assign_rooms(uuid[], uuid), public.set_room_status(uuid, text) from public, anon;
grant execute on function public.assign_rooms(uuid[], uuid), public.set_room_status(uuid, text) to authenticated;

alter publication supabase_realtime add table public.room_requests;

-- Show the invitation code of the new test account
select email, role, invite_code from public.allowlist where email = 'jaredartt@gmail.com';
