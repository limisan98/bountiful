-- ============================================================
-- BOUNTIFUL · Step 1 · People, roles, allowlist, profile photos
-- ============================================================

-- 1) The three account types
create type public.app_role as enum ('supervisor', 'custodian', 'receptionist');

-- 2) The allowlist: only people listed here can create an account.
--    Each entry has an invitation code the supervisor hands to that person.
create table public.allowlist (
  email       text primary key check (email = lower(email)),
  full_name   text not null default '',
  role        public.app_role not null default 'custodian',
  invite_code text not null default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  claimed_by  uuid,
  created_at  timestamptz not null default now()
);

-- 3) One profile per registered account
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_url   text,
  role         public.app_role not null,
  language     text not null default 'en' check (language in ('en', 'de', 'es', 'pt', 'nl', 'sv')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- 4) Helper: is the current user an active supervisor?
create function public.is_supervisor()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'supervisor' and active
  );
$$;

-- 5) When someone registers: check the allowlist + code, then create their profile
create function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  a public.allowlist;
begin
  select * into a
  from public.allowlist
  where email = lower(new.email)
    and invite_code = upper(trim(coalesce(new.raw_user_meta_data ->> 'invite_code', '')))
    and claimed_by is null
  for update;

  if not found then
    raise exception 'This email or invitation code is not on the Bountiful list.';
  end if;

  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    a.email,
    coalesce(nullif(a.full_name, ''), split_part(a.email, '@', 1)),
    a.role
  );

  update public.allowlist set claimed_by = new.id where email = a.email;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 6) Supervisor tool: change someone's role or switch their account on/off
create function public.admin_update_member(p_id uuid, p_role public.app_role, p_active boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_supervisor() then
    raise exception 'Only a supervisor can do this.';
  end if;
  if p_id = auth.uid() then
    raise exception 'You cannot change your own role.';
  end if;
  update public.profiles  set role = p_role, active = p_active where id = p_id;
  update public.allowlist set role = p_role where claimed_by = p_id;
end;
$$;

-- 7) Security: who can do what
alter table public.allowlist enable row level security;
alter table public.profiles  enable row level security;

revoke all on public.allowlist from anon, authenticated;
revoke all on public.profiles  from anon, authenticated;

grant select, insert, update, delete on public.allowlist to authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url, language) on public.profiles to authenticated;

create policy "Supervisor manages the allowlist"
  on public.allowlist for all to authenticated
  using (public.is_supervisor()) with check (public.is_supervisor());

create policy "Signed-in people can see all profiles"
  on public.profiles for select to authenticated
  using (true);

create policy "People edit only their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

revoke execute on function public.handle_new_user()                          from public, anon, authenticated;
revoke execute on function public.is_supervisor()                            from public, anon;
revoke execute on function public.admin_update_member(uuid, public.app_role, boolean) from public, anon;
grant  execute on function public.is_supervisor()                            to authenticated;
grant  execute on function public.admin_update_member(uuid, public.app_role, boolean) to authenticated;

-- 8) Live updates when someone changes their name or photo
alter publication supabase_realtime add table public.profiles;

-- 9) Profile photos (the app shrinks them to 512x512 before upload)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

create policy "Avatars: signed-in can look"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars');

create policy "Avatars: upload to own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Avatars: replace own"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Avatars: delete own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
