-- 019: the real guest rooms of House 1 and House 2 (given by the owner, 2026-11-06). Code = [House][Floor][Room].
--   House 1: floor 1 = 111-117 · floor 2 = 121-128 · floor 3 = 131-138
--   House 2: floor 2 = 221-226 · floor 3 = 231-236 (no floor 1)
-- Houses 3 and 4 still hold the placeholder rooms (x11-x16, x21-x26, x31-x36) until the real lists are known.
delete from public.guest_rooms where house in (1, 2);
insert into public.guest_rooms (house, floor, num, label, sort)
select h, f, n, h::text || f::text || n::text, h * 100 + f * 10 + n
from (values (1, 1, 7), (1, 2, 8), (1, 3, 8), (2, 2, 6), (2, 3, 6)) as v(h, f, maxn), generate_series(1, v.maxn) n;
