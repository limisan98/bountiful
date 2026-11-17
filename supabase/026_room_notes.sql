-- 026: notes on guest rooms (press and hold a room number in the checklist). Shared by the custodian team.
create table public.room_notes (
  id         uuid primary key default gen_random_uuid(),
  room       text not null check (char_length(btrim(room)) between 1 and 20),   -- the room code, e.g. 231 or "Villa 1A"
  day        date not null,
  body       text not null check (char_length(btrim(body)) between 1 and 1000),
  author     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index room_notes_day_idx on public.room_notes (day, room);
alter table public.room_notes enable row level security;
revoke all on public.room_notes from anon, authenticated;
grant select, delete on public.room_notes to authenticated;
grant insert (room, day, body) on public.room_notes to authenticated;
create policy "The custodian team reads room notes" on public.room_notes for select to authenticated
  using (public.is_active() and public.my_department() = 'custodian');
create policy "The custodian team writes room notes" on public.room_notes for insert to authenticated
  with check (public.is_active() and public.my_department() = 'custodian' and author = auth.uid());
create policy "Delete my room notes (supervisors moderate)" on public.room_notes for delete to authenticated
  using (public.is_active() and public.my_department() = 'custodian' and (author = auth.uid() or public.is_supervisor()));
alter publication supabase_realtime add table public.room_notes;
