-- 020: guest rooms can be regular rooms, studios or apartments (owner's handwritten list, 2026-11-10).
-- Studios and apartments are NOT cleaned on Mondays with the rest: they are cleaned once when needed (a request / import),
-- so the Monday checklist only lists them when they are requested.
alter table public.guest_rooms add column if not exists kind text not null default 'room';
alter table public.guest_rooms drop constraint if exists guest_rooms_kind_chk;
alter table public.guest_rooms add constraint guest_rooms_kind_chk check (kind in ('room', 'studio', 'apartment'));

-- 315 does not exist; 416 and 426 do
delete from public.guest_rooms where label = '315';
insert into public.guest_rooms (house, floor, num, label, sort)
select v.h, v.f, v.n, v.h::text || v.f::text || v.n::text, v.h * 100 + v.f * 10 + v.n
from (values (4, 1, 6), (4, 2, 6)) as v(h, f, n)
where not exists (select 1 from public.guest_rooms g where g.label = v.h::text || v.f::text || v.n::text);

update public.guest_rooms set kind = 'studio'
  where label in ('311', '313', '314', '321', '322', '323', '324', '325', '331', '332', '333', '334', '335', '432');
update public.guest_rooms set kind = 'apartment'
  where label in ('411', '416', '421', '422', '426');
