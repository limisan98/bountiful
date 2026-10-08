-- =========================================================
-- BOUNTIFUL · Step 7 · Reception can edit the rooms they asked for
-- (room name, day, note). Rooms already cleaned stay as they are.
-- =========================================================
create function public.edit_room(p_id uuid, p_room text, p_day date, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active() then raise exception 'Your account is not active.'; end if;
  if char_length(btrim(coalesce(p_room, ''))) not between 1 and 40 then raise exception 'Please give a room name.'; end if;
  if char_length(coalesce(p_note, '')) > 300 then raise exception 'The note is too long.'; end if;
  update public.room_requests
     set room = btrim(p_room), day = p_day, note = btrim(coalesce(p_note, ''))
   where id = p_id and requested_by = auth.uid() and status <> 'done';
  if not found then raise exception 'You cannot change this room.'; end if;
end;
$$;

revoke execute on function public.edit_room(uuid, text, date, text) from public, anon;
grant execute on function public.edit_room(uuid, text, date, text) to authenticated;
