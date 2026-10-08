-- ============================================================
-- BOUNTIFUL · Step 4 · Automatic reports for the Custodian Supervisor
-- Day report: every day at 23:30.  Week report: Saturday 23:30 (week = Sunday to Saturday).
-- Month report: on the LAST Saturday of the month.  Quarter report: the last Saturday of March, June, September, December.
-- (Month and quarter reports run from the day after the previous report to that Saturday, so no day is missing or counted twice.)
-- ============================================================

-- 1) One small settings table (the temple's time zone decides what "23:30" means)
create table public.app_settings (key text primary key, value text not null);
insert into public.app_settings (key, value) values ('timezone', 'Europe/Berlin');
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;
create policy "People read settings" on public.app_settings for select to authenticated using (public.is_active());

create function public.local_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone coalesce((select value from public.app_settings where key = 'timezone'), 'Europe/Berlin'))::date;
$$;
grant execute on function public.local_today() to authenticated;

-- 2) The reports themselves (only supervisors can read them)
create table public.custodian_reports (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('day', 'week', 'month', 'quarter')),
  period_start date not null,
  period_end   date not null,
  custodian    uuid not null references public.profiles (id) on delete cascade,
  summary      jsonb not null,
  created_at   timestamptz not null default now(),
  unique (kind, period_end, custodian)
);
create index custodian_reports_end_idx on public.custodian_reports (period_end desc);
alter table public.custodian_reports enable row level security;
revoke all on public.custodian_reports from anon, authenticated;
grant select on public.custodian_reports to authenticated;
create policy "Supervisors read reports" on public.custodian_reports for select to authenticated
  using (public.is_active() and public.is_supervisor());

-- 3) Last Saturday of a month
create function public.last_saturday(p_year int, p_month int)
returns date language sql immutable as $$
  select (l - ((extract(dow from l)::int + 1) % 7))::date
  from (select (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date as l) s;
$$;

-- 4) What one custodian did between two dates
create function public.build_report(p_custodian uuid, p_from date, p_to date, p_detail boolean)
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
    'items',   coalesce((select jsonb_agg(jsonb_build_object('day', a.day, 'task', t.name, 'minutes', r.minutes_spent,
                                                              'goal', r.goal_minutes, 'comment', r.comment, 'delay', r.delay_reason)
                                          order by a.day, a.start_time)
                         from assignments a join tasks t on t.id = a.task_id
                         left join assignment_reports r on r.assignment_id = a.id
                         where a.assignee = p_custodian and a.day between p_from and p_to and a.status = 'done'
                           and (p_detail or coalesce(r.comment, '') <> '' or coalesce(r.delay_reason, '') <> '')), '[]'::jsonb),
    'open',    case when p_detail then coalesce((select jsonb_agg(jsonb_build_object('day', a.day, 'task', t.name) order by a.day, a.start_time)
                         from assignments a join tasks t on t.id = a.task_id
                         where a.assignee = p_custodian and a.day between p_from and p_to and a.status <> 'done'), '[]'::jsonb)
               else '[]'::jsonb end,
    'rooms',   coalesce((select jsonb_agg(jsonb_build_object('day', q.day, 'room', q.room) order by q.day, q.room)
                         from room_requests q where q.assignee = p_custodian and q.status = 'done' and q.day between p_from and p_to), '[]'::jsonb)
  );
$$;

-- 5) Save one report (quiet days with nothing planned and nothing done are skipped)
create function public.put_report(p_kind text, p_from date, p_to date, p_custodian uuid)
returns int language plpgsql security definer set search_path = public as $$
declare s jsonb; n int;
begin
  s := public.build_report(p_custodian, p_from, p_to, p_kind = 'day');
  if (s ->> 'planned')::int = 0 and jsonb_array_length(s -> 'rooms') = 0 then return 0; end if;
  insert into public.custodian_reports (kind, period_start, period_end, custodian, summary)
  values (p_kind, p_from, p_to, p_custodian, s)
  on conflict (kind, period_end, custodian) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 6) The scheduled job: looks at today and yesterday (so a missed run catches up), creates whatever is due
create function public.generate_reports(p_at timestamp default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  nowl timestamp := coalesce(p_at, now() at time zone coalesce((select value from public.app_settings where key = 'timezone'), 'Europe/Berlin'));
  d date; c record; made int := 0; pm date; pq date; k int;
begin
  for k in 0..1 loop
    d := nowl::date - 1 + k;
    if nowl < d + time '23:30' then continue; end if;
    for c in select p.id from public.profiles p join public.roles r on r.id = p.role
             where p.active and r.department = 'custodian' and not r.is_supervisor loop
      made := made + public.put_report('day', d, d, c.id);
      if extract(dow from d) = 6 then
        made := made + public.put_report('week', d - 6, d, c.id);
        if d = public.last_saturday(extract(year from d)::int, extract(month from d)::int) then
          pm := (date_trunc('month', d) - interval '1 month')::date;
          made := made + public.put_report('month', public.last_saturday(extract(year from pm)::int, extract(month from pm)::int) + 1, d, c.id);
          if extract(month from d)::int in (3, 6, 9, 12) then
            pq := (date_trunc('month', d) - interval '3 months')::date;
            made := made + public.put_report('quarter', public.last_saturday(extract(year from pq)::int, extract(month from pq)::int) + 1, d, c.id);
          end if;
        end if;
      end if;
    end loop;
  end loop;
  return made;
end;
$$;

-- only the scheduler (the database itself) may run these
revoke execute on function public.build_report(uuid, date, date, boolean), public.put_report(text, date, date, uuid),
  public.generate_reports(timestamp), public.last_saturday(int, int) from public, anon, authenticated;

alter publication supabase_realtime add table public.custodian_reports;
