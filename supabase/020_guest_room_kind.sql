-- 020: guest rooms can be regular rooms, studios or apartments.
-- Studios and apartments are NOT cleaned on Mondays with the rest: they are cleaned once when needed (a request / import),
-- so the Monday checklist only lists them when they are requested.
alter table public.guest_rooms add column kind text not null default 'room' check (kind in ('room', 'studio', 'apartment'));
-- then mark the real ones, e.g.:  update public.guest_rooms set kind = 'studio' where label in ('313', ...);
