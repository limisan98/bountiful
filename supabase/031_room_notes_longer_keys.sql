-- 031: the key of a note can now be a task of the day ("task:<uuid>", 41 characters), not only a room code
alter table public.room_notes drop constraint room_notes_room_check;
alter table public.room_notes add constraint room_notes_room_check check (char_length(btrim(room)) between 1 and 60);
