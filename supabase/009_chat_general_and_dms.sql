-- =========================================================
-- BOUNTIFUL · Step 8 · One team chat for the custodian team ("general") + direct messages.
-- Receptionists are not part of the chat any more.
-- Channel names: 'general', or 'dm:<smaller user id>:<bigger user id>'.
-- =========================================================

-- Old channels become the one general chat; the reception-only chat goes away
alter table public.messages drop constraint messages_channel_check;
update public.messages set channel = 'general' where channel in ('all', 'custodian');
delete from public.messages where channel = 'reception';
alter table public.messages add constraint messages_channel_check
  check (channel = 'general' or channel ~ '^dm:[0-9a-f-]{36}:[0-9a-f-]{36}$');

-- May I read/write this chat? Only active people of the custodian team, in general or in a DM they are part of
-- (and the other person must be an active member of the custodian team too).
create function public.can_chat(p_channel text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare a text; b text; me uuid := auth.uid(); other uuid;
begin
  if me is null or not (public.is_active() and public.my_department() = 'custodian') then return false; end if;
  if p_channel = 'general' then return true; end if;
  if p_channel !~ '^dm:[0-9a-f-]{36}:[0-9a-f-]{36}$' then return false; end if;
  a := split_part(p_channel, ':', 2); b := split_part(p_channel, ':', 3);
  if a >= b or me::text not in (a, b) then return false; end if;
  other := (case when me::text = a then b else a end)::uuid;
  return exists (select 1 from public.profiles p join public.roles r on r.id = p.role
                 where p.id = other and p.active and r.department = 'custodian');
exception when others then
  return false;
end;
$$;
revoke execute on function public.can_chat(text) from public, anon;
grant execute on function public.can_chat(text) to authenticated;

drop policy "Read the chats I belong to" on public.messages;
drop policy "Write in the chats I belong to" on public.messages;
drop policy "Delete my messages (supervisors moderate)" on public.messages;

create policy "Read the chats I belong to" on public.messages for select to authenticated
  using (public.can_chat(channel));
create policy "Write in the chats I belong to" on public.messages for insert to authenticated
  with check (sender = auth.uid() and public.can_chat(channel));
create policy "Delete my messages (supervisors moderate the general chat)" on public.messages for delete to authenticated
  using (public.can_chat(channel) and (sender = auth.uid() or (public.is_supervisor() and channel = 'general')));

create index if not exists messages_created_idx on public.messages (created_at desc);

-- Task invitations are posted in the general chat
create or replace function public.invite_to_task(p_assignment uuid, p_to uuid, p_note text)
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
  values ('general', me, coalesce(nullif(left(btrim(coalesce(p_note, '')), 300), ''), coalesce(tname, 'Task')), inv);
  return inv;
end;
$$;

