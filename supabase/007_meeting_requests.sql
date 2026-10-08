-- ============================================================
-- BOUNTIFUL · Step 6 · Meeting requests: anyone asks the supervisor for a meeting (day, time, topic); the supervisor accepts or declines
-- ============================================================

create table public.meeting_requests (
  id          uuid primary key default gen_random_uuid(),
  requester   uuid not null references public.profiles (id) on delete cascade,
  supervisor  uuid not null references public.profiles (id) on delete cascade,
  day         date not null,
  start_time  time not null,
  topic       text not null check (char_length(btrim(topic)) between 1 and 200),
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'canceled')),
  reply       text not null default '' check (char_length(reply) <= 300),
  created_at  timestamptz not null default now(),
  answered_at timestamptz
);
create index meeting_requests_supervisor_idx on public.meeting_requests (supervisor, day);
create index meeting_requests_requester_idx on public.meeting_requests (requester, day);

alter table public.meeting_requests enable row level security;
revoke all on public.meeting_requests from anon, authenticated;
grant select on public.meeting_requests to authenticated;
-- Only the two people involved can see a request
create policy "See my meetings" on public.meeting_requests for select to authenticated
  using (public.is_active() and (requester = auth.uid() or supervisor = auth.uid()));

create function public.request_meeting(p_supervisor uuid, p_day date, p_time time, p_topic text)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); id uuid;
begin
  if not public.is_active() then raise exception 'Your account is not active.'; end if;
  if public.is_supervisor() then raise exception 'Supervisors do not need to ask for meetings.'; end if;
  if not exists (select 1 from public.profiles p join public.roles r on r.id = p.role
                 where p.id = p_supervisor and p.active and r.is_supervisor) then
    raise exception 'Choose a supervisor.';
  end if;
  if p_day < public.local_today() then raise exception 'Choose today or a later day.'; end if;
  if char_length(btrim(coalesce(p_topic, ''))) = 0 then raise exception 'Please write what the meeting is about.'; end if;
  if (select count(*) from public.meeting_requests where requester = me and status = 'pending') >= 5 then
    raise exception 'You already have 5 requests waiting for an answer.';
  end if;
  insert into public.meeting_requests (requester, supervisor, day, start_time, topic)
  values (me, p_supervisor, p_day, p_time, left(btrim(p_topic), 200)) returning meeting_requests.id into id;
  return id;
end;
$$;

create function public.answer_meeting(p_id uuid, p_accept boolean, p_reply text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.meeting_requests
     set status = case when p_accept then 'accepted' else 'declined' end,
         reply = left(btrim(coalesce(p_reply, '')), 300), answered_at = now()
   where id = p_id and supervisor = auth.uid() and status = 'pending';
  if not found then raise exception 'This request cannot be answered.'; end if;
end;
$$;

create function public.cancel_meeting(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.meeting_requests set status = 'canceled', answered_at = now()
   where id = p_id and requester = auth.uid() and status in ('pending', 'accepted');
  if not found then raise exception 'This request cannot be canceled.'; end if;
end;
$$;

revoke execute on function public.request_meeting(uuid, date, time, text), public.answer_meeting(uuid, boolean, text),
  public.cancel_meeting(uuid) from public, anon;
grant execute on function public.request_meeting(uuid, date, time, text), public.answer_meeting(uuid, boolean, text),
  public.cancel_meeting(uuid) to authenticated;

alter publication supabase_realtime add table public.meeting_requests;
