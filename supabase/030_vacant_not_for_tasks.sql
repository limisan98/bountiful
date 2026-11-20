-- 030: marking a task of the day as "available" (stored like a vacant room, key 'task:<id>') does not send the room notification.
create or replace function public.push_on_room_vacant() returns trigger language plpgsql security definer set search_path = public as $$
declare
  tz text := coalesce((select value from public.app_settings where key = 'timezone'), 'Europe/Berlin');
  nowl timestamp := now() at time zone tz;
  today date := (now() at time zone tz)::date;
  planned boolean := exists (select 1 from public.shift_plan where day = (now() at time zone tz)::date);
  g record;
  ttl text; bdy text;
begin
  if new.kind <> 'vacant' or new.room like 'task:%' then return new; end if; -- "available" marks on tasks send nothing
  for g in
    select t.lang, array_agg(t.id) as ids from (
      select p.id, coalesce((select s.lang from public.push_subscriptions s where s.user_id = p.id order by s.created_at desc limit 1), 'en') as lang
        from public.profiles p join public.roles r on r.id = p.role
       where p.active and r.department = 'custodian' and p.id <> new.author and public.push_wants(p.id, 'vacant', true)
         and (not planned or exists (select 1 from public.shift_plan sp join public.shifts sh on sh.id = sp.shift_id
                                      where sp.user_id = p.id and sp.day = today and nowl::time between sh.start_time and sh.end_time))
    ) t group by t.lang
  loop
    ttl := case g.lang
      when 'de' then 'Zimmer ' || new.room || ' ist leer'
      when 'es' then 'La habitación ' || new.room || ' está vacía'
      when 'pt' then 'O quarto ' || new.room || ' está vazio'
      when 'nl' then 'Kamer ' || new.room || ' is leeg'
      when 'sv' then 'Rum ' || new.room || ' är tomt'
      else 'Room ' || new.room || ' is vacant' end;
    bdy := case g.lang
      when 'de' then 'Der Gast ist schon abgereist: das Zimmer kann sofort gereinigt werden.'
      when 'es' then 'El huésped ya se fue: la habitación se puede limpiar ya.'
      when 'pt' then 'O hóspede já saiu: o quarto já pode ser limpo.'
      when 'nl' then 'De gast is al vertrokken: de kamer kan meteen schoongemaakt worden.'
      when 'sv' then 'Gästen har redan åkt: rummet kan städas direkt.'
      else 'The guest already left: the room can be cleaned right away.' end;
    perform public.push_send(g.ids, 'roomVacant', jsonb_build_object('title', ttl, 'body', bdy), './#/home', 'vacant-' || new.room);
  end loop;
  return new;
end;
$$;
