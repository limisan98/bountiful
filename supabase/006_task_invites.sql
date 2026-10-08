-- ============================================================
-- BOUNTIFUL · Step 5 · Custodians invite each other to take over a task (shown in the chat)
-- ============================================================

create table public.task_invites (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  from_user     uuid not null references public.profiles (id) on delete cascade,
  to_user       uuid not null references public.profiles (id) on delete cascade,
  note          text not null default '' check (char_length(note) <= 300),
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'canceled')),
  created_at    timestamptz not null default now(),
  answered_at   timestamptz
);
create unique index task_invites_one_pending on public.task_invites (assignment_id) where status = 'pending';
create index task_invites_to_idx on public.task_invites (to_user);

alter table public.task_invites enable row level security;
revoke all on public.task_invites from anon, authenticated;
grant select on public.task_invites to authenticated;
create policy "Custodians see invitations" on public.task_invites for select to authenticated
  using (public.is_active() and public.my_department() = 'custodian');

-- A chat message can carry an invitation card. Nobody can attach one by hand: only the function below can.
alter table public.messages add column invite_id uuid references public.task_invites (id) on delete cascade;
revoke insert on public.messages from authenticated;
grant insert (channel, sender, body) on public.messages to authenticated;

-- Custodian (not supervisor) check, used by all three functions
create function public.is_plain_custodian(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p join public.roles r on r.id = p.role
                 where p.id = p_id and p.active and r.department = 'custodian' and not r.is_supervisor);
$$;

-- Invite a colleague to take over one of MY tasks that has not started. Nothing changes until they accept.
create function public.invite_to_task(p_assignment uuid, p_to uuid, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare a public.assignments; inv uuid; tname text; me uuid := auth.uid();
begin
  if not public.is_plain_custodian(me) then raise exception 'Only custodians can invite each other.'; end if;
  if p_to = me or not public.is_plain_custodian(p_to) then raise exception 'Choose another custodian.'; end if;
  select * into a from public.assignments where id = p_assignment and assignee = me for update;
  if not found then raise exception 'This task is not assigned to you.'; end if;
  if a.status <> 'todo' or a.day < public.local_today() then raise exception 'Only upcoming tasks that have not started can be handed over.'; end if;
  if exists (select 1 from public.task_invites where assignment_id = p_assignment and status = 'pending') then
    raise exception 'There is already a pending invitation for this task.';
  end if;
  insert into public.task_invites (assignment_id, from_user, to_user, note)
  values (p_assignment, me, p_to, left(btrim(coalesce(p_note, '')), 300)) returning id into inv;
  select name into tname from public.tasks where id = a.task_id;
  insert into public.messages (channel, sender, body, invite_id)
  values ('custodian', me, coalesce(nullif(left(btrim(coalesce(p_note, '')), 300), ''), coalesce(tname, 'Task')), inv);
  return inv;
end;
$$;

-- The invited person answers. Returns 'accepted', 'declined' or 'unavailable' (the task changed in the meantime).
create function public.answer_invite(p_id uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare i public.task_invites;
begin
  select * into i from public.task_invites where id = p_id for update;
  if not found then raise exception 'Invitation not found.'; end if;
  if i.to_user <> auth.uid() then raise exception 'Only the invited person can answer.'; end if;
  if i.status <> 'pending' then raise exception 'This invitation was already answered or canceled.'; end if;
  if not p_accept then
    update public.task_invites set status = 'declined', answered_at = now() where id = p_id;
    return 'declined';
  end if;
  update public.assignments set assignee = i.to_user
   where id = i.assignment_id and assignee = i.from_user and status = 'todo';
  if not found then
    update public.task_invites set status = 'canceled', answered_at = now() where id = p_id;
    return 'unavailable';
  end if;
  update public.task_invites set status = 'accepted', answered_at = now() where id = p_id;
  return 'accepted';
end;
$$;

-- The sender can take the invitation back while it is still pending
create function public.cancel_invite(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.task_invites set status = 'canceled', answered_at = now()
   where id = p_id and from_user = auth.uid() and status = 'pending';
  if not found then raise exception 'This invitation cannot be canceled.'; end if;
end;
$$;

revoke execute on function public.is_plain_custodian(uuid), public.invite_to_task(uuid, uuid, text),
  public.answer_invite(uuid, boolean), public.cancel_invite(uuid) from public, anon;
grant execute on function public.invite_to_task(uuid, uuid, text), public.answer_invite(uuid, boolean),
  public.cancel_invite(uuid) to authenticated;
revoke execute on function public.is_plain_custodian(uuid) from authenticated;

alter publication supabase_realtime add table public.task_invites;
