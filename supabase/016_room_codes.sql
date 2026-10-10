-- 016: guest rooms use the 3-digit room code [House][Floor][Room], e.g. 322 = House 3, floor 2, room 2.
-- The 24 rooms seeded in 015 were placeholders, so they are replaced. The per-floor room count (6) is a placeholder too:
-- edit/add/remove rows of guest_rooms to match the real building (label must be the 3-digit code).
alter table public.guest_rooms add column floor int, add column num int;
delete from public.guest_rooms;
alter table public.guest_rooms alter column floor set not null, alter column num set not null;
alter table public.guest_rooms add constraint guest_rooms_floor_chk check (floor between 1 and 3);
alter table public.guest_rooms add constraint guest_rooms_num_chk check (num between 1 and 9);
alter table public.guest_rooms add constraint guest_rooms_code_chk check (label = house::text || floor::text || num::text);
insert into public.guest_rooms (house, floor, num, label, sort)
select h, f, n, h::text || f::text || n::text, h * 100 + f * 10 + n
from generate_series(1, 4) h, generate_series(1, 3) f, generate_series(1, 6) n;
