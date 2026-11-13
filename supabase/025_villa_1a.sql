-- 025: the villas. Villa 1A (an apartment) joins the guest rooms; more villa apartments can be added later.
-- House number 5 = the villas; their label is free text ("Villa 1A") instead of house+floor+room.
-- Like studios/apartments, it is only in the day's list when it is requested.
alter table public.guest_rooms drop constraint if exists guest_rooms_house_check;
alter table public.guest_rooms drop constraint if exists guest_rooms_code_chk;
alter table public.guest_rooms add constraint guest_rooms_house_check check (house between 1 and 5);
alter table public.guest_rooms add constraint guest_rooms_code_chk check (house = 5 or label = house::text || floor::text || num::text);
insert into public.guest_rooms (house, floor, num, label, sort, kind)
select 5, 1, 1, 'Villa 1A', 501, 'apartment'
where not exists (select 1 from public.guest_rooms where label = 'Villa 1A');
