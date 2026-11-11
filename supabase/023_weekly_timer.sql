-- ============================================================
-- BOUNTIFUL · Step 23 · Weekly checklist items get a start time and a finish time, so the time they took can be calculated
-- (and a running timer keeps going even if the app is closed: it is computed from started_at).
-- ============================================================
alter table public.weekly_checks add column if not exists started_at timestamptz;   -- when "doing" began
alter table public.weekly_checks add column if not exists done_at timestamptz;      -- when it was marked done

create or replace function public.set_weekly_check(p_week date, p_item text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare cur public.weekly_checks;
begin
  if not (public.is_active() and public.my_department() = 'custodian') then raise exception 'not allowed'; end if;
  if p_status is not null and p_status not in ('doing', 'done') then raise exception 'bad status'; end if;
  select * into cur from public.weekly_checks where week = p_week and item = p_item;
  if found and cur.user_id <> auth.uid() and not public.is_supervisor() then raise exception 'someone else is on this item'; end if;
  if p_status is null then
    delete from public.weekly_checks where week = p_week and item = p_item;
  else
    insert into public.weekly_checks (week, item, status, user_id, started_at, done_at)
    values (p_week, p_item, p_status, auth.uid(), case when p_status = 'doing' then now() end, case when p_status = 'done' then now() end)
    on conflict (week, item) do update set
      status = excluded.status,
      started_at = case when excluded.status = 'doing' then coalesce(public.weekly_checks.started_at, now()) else public.weekly_checks.started_at end,
      done_at = case when excluded.status = 'done' then now() else null end,
      updated_at = now();
  end if;
end $$;
