-- ============================================================
-- BOUNTIFUL · Step 18 · Weekly checklist: who is doing / finished each item (shared by the custodian team)
-- One row per item per week. status: 'doing' (someone is on it) or 'done'. No row = not started.
-- week = the Monday of that week; item = "<weekday>.<section>.<index>" from src/weeklydata.js
-- ============================================================
create table public.weekly_checks (
  week       date not null,
  item       text not null check (char_length(item) between 1 and 20),
  status     text not null check (status in ('doing', 'done')),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (week, item)
);
alter table public.weekly_checks enable row level security;
revoke all on public.weekly_checks from anon, authenticated;
grant select on public.weekly_checks to authenticated;
create policy "The custodian team reads the weekly checklist" on public.weekly_checks for select to authenticated
  using (public.is_active() and public.my_department() = 'custodian');

-- p_status null = clear the item. Free items can be taken by anybody in the team; an item somebody else is on
-- (or finished) can only be changed by that person or by the supervisor (who keeps the original name on it).
create function public.set_weekly_check(p_week date, p_item text, p_status text)
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
    insert into public.weekly_checks (week, item, status, user_id) values (p_week, p_item, p_status, auth.uid())
    on conflict (week, item) do update set status = excluded.status, updated_at = now();
  end if;
end $$;
revoke execute on function public.set_weekly_check(date, text, text) from public, anon;
grant execute on function public.set_weekly_check(date, text, text) to authenticated;

alter publication supabase_realtime add table public.weekly_checks;
