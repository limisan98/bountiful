-- ============================================================
-- BOUNTIFUL · Step 24 · Translation cache. The "translate" edge function (DeepL) stores every translation once per language,
-- so the same text is never paid for twice and shows up at once for everybody. Only the edge function (service role) touches this table.
-- ============================================================
create table if not exists public.translations (
  hash       text not null,            -- sha-256 of the original text
  target     text not null check (target in ('en', 'de', 'es', 'pt', 'nl', 'sv')),
  source     text,                     -- language DeepL detected
  translated text not null,
  created_at timestamptz not null default now(),
  primary key (hash, target)
);
alter table public.translations enable row level security;
revoke all on public.translations from anon, authenticated;
