-- 019: the real guest rooms (given by the owner, 2026-11-06 / 2026-11-09). Code = [House][Floor][Room].
--   House 1: floor 1 = 111-117 · floor 2 = 121-128 · floor 3 = 131-138
--   House 2: floor 2 = 221-226 · floor 3 = 231-236 (no floor 1)
--   House 3: floor 1 = 311-315 · floor 2 = 321-325 · floor 3 = 331-335
--   House 4: floor 1 = 411-415 · floor 2 = 421-425 · floor 3 = 431-435
delete from public.guest_rooms;
insert into public.guest_rooms (house, floor, num, label, sort)
select v.h, v.f, n, v.h::text || v.f::text || n::text, v.h * 100 + v.f * 10 + n
from (values (1, 1, 7), (1, 2, 8), (1, 3, 8), (2, 2, 6), (2, 3, 6),
             (3, 1, 5), (3, 2, 5), (3, 3, 5), (4, 1, 5), (4, 2, 5), (4, 3, 5)) as v(h, f, maxn), generate_series(1, v.maxn) n;
