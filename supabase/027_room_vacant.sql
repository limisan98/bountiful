-- 027: a room can be marked "vacant" for a day (the guest left before check-out time). Stored next to the room notes.
alter table public.room_notes add column kind text not null default 'note' check (kind in ('note', 'vacant'));
create unique index room_notes_vacant_once on public.room_notes (room, day) where kind = 'vacant';
grant insert (kind) on public.room_notes to authenticated;
-- anybody on the custodian team can clear a vacant mark (the others stay: only the author or a supervisor deletes a note)
create policy "The custodian team clears vacant marks" on public.room_notes for delete to authenticated
  using (kind = 'vacant' and public.is_active() and public.my_department() = 'custodian');
