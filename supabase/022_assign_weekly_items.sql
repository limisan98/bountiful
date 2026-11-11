-- ============================================================
-- BOUNTIFUL · Step 22 · The supervisor (or a delegate) can give items of a day's weekly checklist to a specific person,
-- also one day ahead (e.g. on Wednesday: Thursday's items to Lucília). Needs 021 (can_assign) applied first.
-- weekly_checks.status gets a third value: 'assigned' (planned for that person, not started).
-- ============================================================
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.weekly_checks'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.weekly_checks drop constraint %I', c);
  end loop;
end $$;
alter table public.weekly_checks add constraint weekly_checks_status_check check (status in ('assigned', 'doing', 'done'));

-- p_user null = take the assignment away again (only while it is still 'assigned').
create or replace function public.assign_weekly_check(p_week date, p_item text, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare cur public.weekly_checks;
begin
  if not public.can_assign() then raise exception 'Only a supervisor can do this.'; end if;
  select * into cur from public.weekly_checks where week = p_week and item = p_item;
  if p_user is null then
    if found and cur.status = 'assigned' then delete from public.weekly_checks where week = p_week and item = p_item; end if;
    return;
  end if;
  if not exists (select 1 from public.profiles where id = p_user and active) then raise exception 'not allowed'; end if;
  if found and cur.status in ('doing', 'done') then return; end if;   -- somebody already started it: leave it alone
  insert into public.weekly_checks (week, item, status, user_id) values (p_week, p_item, 'assigned', p_user)
  on conflict (week, item) do update set status = 'assigned', user_id = excluded.user_id, updated_at = now();
end $$;
revoke execute on function public.assign_weekly_check(date, text, uuid) from public, anon;
grant execute on function public.assign_weekly_check(date, text, uuid) to authenticated;
