-- 032: "ghost" accounts = placeholder colleagues who are not in the app yet (nobody can log in as them).
-- They get tasks, rooms and shifts like anybody else; only a supervisor can mark their items / tasks.
alter table public.profiles add column is_ghost boolean not null default false;
grant select (is_ghost) on public.profiles to authenticated;

-- the three first ghosts (created through the normal allowlist + auth path so the profile trigger runs)
do $$
declare nm record; code text; uid uuid; mail text;
begin
  for nm in select * from (values ('Giovanna', 240), ('Benjamín', 480), ('Henk', 480)) as v(name, minutes) loop
    uid := gen_random_uuid();
    mail := lower(translate(nm.name, 'í', 'i')) || '@ghost.bountiful.invalid';
    insert into public.allowlist (email, full_name, role) values (mail, nm.name, 'custodian') returning invite_code into code;
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', mail, extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('invite_code', code, 'ghost', true), now(), now(), '', '', '', '');
    update public.profiles set is_ghost = true where id = uid;
    insert into public.staff_contracts (user_id, minutes) values (uid, nm.minutes) on conflict (user_id) do update set minutes = excluded.minutes;
  end loop;
end $$;

create function public.is_ghost(p_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_ghost from public.profiles where id = p_id), false);
$$;
revoke execute on function public.is_ghost(uuid) from public, anon;
grant execute on function public.is_ghost(uuid) to authenticated;

-- checklist items: the owner, or a supervisor when the owner is a ghost
create or replace function public.set_weekly_check(p_week date, p_item text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare cur public.weekly_checks;
begin
  if not (public.is_active() and public.my_department() = 'custodian') then raise exception 'not allowed'; end if;
  if p_status is not null and p_status not in ('doing', 'done') then raise exception 'bad status'; end if;
  select * into cur from public.weekly_checks where week = p_week and item = p_item;
  if found and cur.user_id <> auth.uid() and not (public.is_supervisor() and public.is_ghost(cur.user_id)) then raise exception 'someone else is on this item'; end if;
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

-- tasks: the assignee, or a supervisor when the assignee is a ghost
create or replace function public.start_assignment(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active() then raise exception 'Your account is not active.'; end if;
  update public.assignments set status = 'doing', started_at = coalesce(started_at, now())
   where id = p_id and (assignee = auth.uid() or (public.is_supervisor() and public.is_ghost(assignee))) and status in ('todo', 'doing');
  if not found then raise exception 'This task cannot be started.'; end if;
end;
$$;

create or replace function public.complete_assignment(p_id uuid, p_minutes integer, p_comment text, p_delay text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.assignments; goal int; mins int;
begin
  if not public.is_active() then raise exception 'Your account is not active.'; end if;
  select * into a from public.assignments where id = p_id and (assignee = auth.uid() or (public.is_supervisor() and public.is_ghost(assignee))) for update;
  if not found then raise exception 'This task is not assigned to you.'; end if;
  mins := greatest(0, least(coalesce(p_minutes, 0), 1440));
  goal := coalesce((select t.goal_minutes from public.tasks t where t.id = a.task_id),
                   (extract(epoch from (a.end_time - a.start_time)) / 60)::int,
                   (select (extract(epoch from (t.end_time - t.start_time)) / 60)::int from public.tasks t where t.id = a.task_id), 30);
  update public.assignments set status = 'done', completed_at = now(), started_at = coalesce(started_at, now() - make_interval(mins => mins)) where id = p_id;
  insert into public.assignment_reports (assignment_id, minutes_spent, goal_minutes, comment, delay_reason)
  values (p_id, mins, goal, left(btrim(coalesce(p_comment, '')), 1000), left(btrim(coalesce(p_delay, '')), 1000))
  on conflict (assignment_id) do update
    set minutes_spent = excluded.minutes_spent, goal_minutes = excluded.goal_minutes, comment = excluded.comment, delay_reason = excluded.delay_reason, completed_at = now();
end;
$$;
