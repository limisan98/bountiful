-- =========================================================
-- BOUNTIFUL · Step 9 · Phone notifications that also arrive when the app is closed (Web Push).
-- The database notices what happened and asks the "push" function (supabase/functions/push) to tell the right people.
-- =========================================================

create extension if not exists pg_net with schema extensions;

-- One private row: the secret that only the database and the push function know (the function adds the key pair itself on first use)
create table public.push_config (
  id          int primary key check (id = 1),
  secret      text not null default (gen_random_uuid()::text || gen_random_uuid()::text),
  public_key  text,
  private_key text
);
insert into public.push_config (id) values (1) on conflict do nothing;
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

-- Phones (browsers) that agreed to get notifications
create table public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  lang       text not null default 'en',
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_lang text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_active() then raise exception 'Not signed in.'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, lang)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, coalesce(nullif(p_lang, ''), 'en'))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang;
end;
$$;

create function public.drop_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke execute on function public.save_push_subscription(text, text, text, text), public.drop_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text), public.drop_push_subscription(text) to authenticated;

-- ---- helpers (only used inside the database) -------------------------------------------------
-- Does this person want this kind of notification? (their choices are saved in their account; missing = the default)
create function public.push_wants(p_user uuid, p_key text, p_default boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (u.raw_user_meta_data #>> array['notif', p_key])::boolean from auth.users u where u.id = p_user), p_default);
$$;

-- Ask the push function to notify these people. Never allowed to break the action that triggered it.
create function public.push_send(p_users uuid[], p_key text, p_params jsonb, p_url text, p_tag text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_users is null or cardinality(p_users) = 0 then return; end if;
  perform net.http_post(
    url := 'https://kmlvdgtxafcdbsosrsqx.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('secret', (select secret from public.push_config where id = 1),
                               'users', to_jsonb(p_users), 'key', p_key, 'params', coalesce(p_params, '{}'::jsonb),
                               'url', p_url, 'tag', p_tag));
exception when others then
  null;
end;
$$;

create function public.push_name(p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from public.profiles where id = p_id), '');
$$;

-- active supervisors (not the one who did it) who want this kind of notification
create function public.push_supervisors(p_except uuid, p_key text, p_default boolean)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.id), '{}') from public.profiles p join public.roles r on r.id = p.role
  where p.active and r.is_supervisor and p.id is distinct from p_except and public.push_wants(p.id, p_key, p_default);
$$;

revoke execute on function public.push_wants(uuid, text, boolean), public.push_send(uuid[], text, jsonb, text, text),
  public.push_name(uuid), public.push_supervisors(uuid, text, boolean) from public, anon, authenticated;

-- ---- chat ---------------------------------------------------------------------------------------
create function public.push_on_message() returns trigger language plpgsql security definer set search_path = public as $$
declare mention uuid[]; chatty uuid[]; other uuid; nm text := public.push_name(new.sender); body text := left(new.body, 140);
begin
  if new.channel = 'general' then
    select coalesce(array_agg(p.id), '{}') into mention from public.profiles p join public.roles r on r.id = p.role
     where p.active and r.department = 'custodian' and p.id <> new.sender
       and position(lower('@' || p.display_name) in lower(new.body)) > 0 and public.push_wants(p.id, 'mention', true);
    select coalesce(array_agg(p.id), '{}') into chatty from public.profiles p join public.roles r on r.id = p.role
     where p.active and r.department = 'custodian' and p.id <> new.sender and not (p.id = any (mention))
       and public.push_wants(p.id, 'chat', false);
    perform public.push_send(mention, 'mention', jsonb_build_object('name', nm, 'body', body), './#/chat', 'chat-mention');
    perform public.push_send(chatty, 'chat', jsonb_build_object('title', nm, 'body', body), './#/chat', 'chat-general');
  elsif new.channel like 'dm:%' then
    other := (case when split_part(new.channel, ':', 2)::uuid = new.sender then split_part(new.channel, ':', 3) else split_part(new.channel, ':', 2) end)::uuid;
    if public.push_wants(other, 'dm', true) then
      perform public.push_send(array[other], 'dm', jsonb_build_object('title', nm, 'body', body), './#/chat', 'dm-' || new.channel);
    end if;
  end if;
  return null;
exception when others then
  return null;
end;
$$;
create trigger push_message after insert on public.messages for each row when (new.invite_id is null) execute function public.push_on_message();

-- ---- tasks planned for someone ------------------------------------------------------------------
create function public.push_on_assignment() returns trigger language plpgsql security definer set search_path = public as $$
declare tname text; wh text;
begin
  select name into tname from public.tasks where id = new.task_id;
  wh := to_char(new.day, 'DD.MM.') || ' ' || to_char(new.start_time, 'HH24:MI');
  if tg_op = 'INSERT' then
    if new.assignee is distinct from new.created_by and public.push_wants(new.assignee, 'assigned', true) then
      perform public.push_send(array[new.assignee], 'assigned', jsonb_build_object('body', coalesce(tname, '') || ' · ' || wh), './#/home', 'asg-' || new.id);
    end if;
  elsif (old.day, old.start_time, old.end_time) is distinct from (new.day, new.start_time, new.end_time)
        and new.assignee is distinct from auth.uid() and public.push_wants(new.assignee, 'assigned', true) then
    perform public.push_send(array[new.assignee], 'changed', jsonb_build_object('body', coalesce(tname, '') || ' · ' || wh), './#/home', 'asg-' || new.id);
  end if;
  return null;
exception when others then
  return null;
end;
$$;
create trigger push_assignment after insert or update on public.assignments for each row execute function public.push_on_assignment();

-- ---- rooms ----------------------------------------------------------------------------------------
create function public.push_on_room() returns trigger language plpgsql security definer set search_path = public as $$
declare label text := new.room || ' · ' || to_char(new.day, 'DD.MM.');
begin
  if tg_op = 'INSERT' then
    perform public.push_send(public.push_supervisors(new.requested_by, 'rooms', true), 'rooms',
      jsonb_build_object('name', public.push_name(new.requested_by), 'body', label), './#/rooms', 'rooms-new');
    return null;
  end if;
  -- given to a custodian
  if new.assignee is not null and new.assignee is distinct from old.assignee and public.push_wants(new.assignee, 'assigned', true) then
    perform public.push_send(array[new.assignee], 'roomAssigned', jsonb_build_object('body', label), './#/rooms', 'rooms-assigned');
  end if;
  -- the request was edited by reception
  if (old.room, old.day, old.note) is distinct from (new.room, new.day, new.note) then
    perform public.push_send(public.push_supervisors(new.requested_by, 'rooms', true), 'roomsEdited',
      jsonb_build_object('name', public.push_name(new.requested_by), 'body', label || case when new.note <> '' then ' · ' || new.note else '' end), './#/rooms', 'rooms-edit-' || new.id);
    if new.assignee is not null and new.assignee is distinct from new.requested_by and public.push_wants(new.assignee, 'assigned', true) then
      perform public.push_send(array[new.assignee], 'roomEdited', jsonb_build_object('body', label), './#/rooms', 'rooms-edit-' || new.id);
    end if;
  end if;
  -- cleaned: tell the receptionist who asked
  if new.status = 'done' and old.status is distinct from 'done' and public.push_wants(new.requested_by, 'roomsDone', true) then
    perform public.push_send(array[new.requested_by], 'roomDone', jsonb_build_object('name', public.push_name(new.assignee), 'body', label), './#/rooms', 'rooms-done');
  end if;
  return null;
exception when others then
  return null;
end;
$$;
create trigger push_room after insert or update on public.room_requests for each row execute function public.push_on_room();

-- ---- meetings -------------------------------------------------------------------------------------
create function public.push_on_meeting() returns trigger language plpgsql security definer set search_path = public as $$
declare txt text := to_char(new.day, 'DD.MM.') || ' ' || to_char(new.start_time, 'HH24:MI') || ' · ' || new.topic;
begin
  if tg_op = 'INSERT' then
    if public.push_wants(new.supervisor, 'meetingNew', true) then
      perform public.push_send(array[new.supervisor], 'meetingNew', jsonb_build_object('name', public.push_name(new.requester), 'body', txt), './#/meetings', 'meeting-new');
    end if;
  elsif old.status = 'pending' and new.status in ('accepted', 'declined') and public.push_wants(new.requester, 'meetingAnswer', true) then
    perform public.push_send(array[new.requester], 'meeting.' || new.status, jsonb_build_object('name', public.push_name(new.supervisor), 'body', txt), './#/meetings', 'meeting-answer');
  end if;
  return null;
exception when others then
  return null;
end;
$$;
create trigger push_meeting after insert or update on public.meeting_requests for each row execute function public.push_on_meeting();

-- ---- task invitations between custodians -----------------------------------------------------------
create function public.push_on_invite() returns trigger language plpgsql security definer set search_path = public as $$
declare tname text;
begin
  select t.name into tname from public.assignments a join public.tasks t on t.id = a.task_id where a.id = new.assignment_id;
  if tg_op = 'INSERT' then
    if public.push_wants(new.to_user, 'invites', true) then
      perform public.push_send(array[new.to_user], 'invite', jsonb_build_object('name', public.push_name(new.from_user), 'body', coalesce(tname, '')), './#/chat', 'invite');
    end if;
  elsif old.status = 'pending' and new.status in ('accepted', 'declined') and public.push_wants(new.from_user, 'invites', true) then
    perform public.push_send(array[new.from_user], 'invite.' || new.status, jsonb_build_object('name', public.push_name(new.to_user), 'body', coalesce(tname, '')), './#/chat', 'invite-answer');
  end if;
  return null;
exception when others then
  return null;
end;
$$;
create trigger push_invite after insert or update on public.task_invites for each row execute function public.push_on_invite();

-- ---- automatic reports (supervisors) -----------------------------------------------------------------
create function public.push_on_report() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.push_send(public.push_supervisors(null, 'reports', true), 'report.' || new.kind,
    jsonb_build_object('name', public.push_name(new.custodian)), './#/reports', 'report-' || new.kind);
  return null;
exception when others then
  return null;
end;
$$;
create trigger push_report after insert on public.custodian_reports for each row execute function public.push_on_report();

revoke execute on function public.push_on_message(), public.push_on_assignment(), public.push_on_room(), public.push_on_meeting(),
  public.push_on_invite(), public.push_on_report() from public, anon, authenticated;
