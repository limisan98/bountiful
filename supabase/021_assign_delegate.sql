-- ============================================================
-- BOUNTIFUL · Step 21 · The supervisor can let another custodian hand out tasks while they are away
-- A "delegate" can plan/give tasks, edit the task library and see the task comments and times.
-- A delegate can NOT: manage the team / roles / invitations, read the automatic reports, plan shifts, or answer meetings.
-- ============================================================
alter table public.profiles add column if not exists can_assign boolean not null default false;
alter table public.profiles add column if not exists assign_until date;   -- empty = until the supervisor switches it off

-- 1) Who may hand out tasks: the supervisor, or an active delegate whose end date has not passed
create or replace function public.can_assign()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_supervisor() or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.can_assign
      and (p.assign_until is null or p.assign_until >= public.local_today())
  );
$$;
revoke execute on function public.can_assign() from public, anon;
grant execute on function public.can_assign() to authenticated;

-- 2) Only the supervisor switches a delegate on / off
create or replace function public.set_assign_delegate(p_id uuid, p_on boolean, p_until date default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_supervisor() then raise exception 'Only a supervisor can do this.'; end if;
  if p_id = auth.uid() then raise exception 'You cannot change your own role.'; end if;
  update public.profiles
     set can_assign = p_on, assign_until = case when p_on then p_until else null end
   where id = p_id and active;
end;
$$;
revoke execute on function public.set_assign_delegate(uuid, boolean, date) from public, anon;
grant execute on function public.set_assign_delegate(uuid, boolean, date) to authenticated;

-- 3) The task-handing-out rules now say can_assign() instead of is_supervisor() (functions and policies are rewritten in place)
do $$
declare r record; d text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'
             and p.proname in ('allocate_waiting', 'renotify_assignment', 'reopen_assignment', 'request_room_cleaning', 'request_rooms')
  loop
    d := pg_get_functiondef(r.oid);
    d := replace(d, 'is_supervisor()', 'can_assign()');
    execute d;
  end loop;

  for r in select schemaname, tablename, policyname, qual, with_check from pg_policies
           where schemaname = 'public'
             and (tablename, policyname) in (
               ('assignments', 'Supervisors plan work'), ('tasks', 'Supervisors add tasks'), ('tasks', 'Supervisors edit tasks'),
               ('assignment_reports', 'Reports: the person and supervisors'),
               ('assignment_comments', 'Read comments of my tasks'), ('assignment_comments', 'Comment on my tasks'), ('assignment_comments', 'Delete my comments'))
  loop
    execute format('alter policy %I on %I.%I %s %s', r.policyname, r.schemaname, r.tablename,
      case when r.qual is not null then 'using (' || replace(r.qual, 'is_supervisor()', 'can_assign()') || ')' else '' end,
      case when r.with_check is not null then 'with check (' || replace(r.with_check, 'is_supervisor()', 'can_assign()') || ')' else '' end);
  end loop;
end $$;
