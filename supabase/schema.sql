-- =====================================================================
--  IELTS with KHMDV — database schema
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  Safe to re-run: it drops and recreates policies/functions.
-- =====================================================================

-- ---------- Profiles (one per student/teacher account) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  telegram    text not null default '',
  phone       text not null default '',
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------- Tests (content WITHOUT answers) ----------
-- visibility: 'draft'    → only admin sees it
--             'practice' → every logged-in student sees it in the practice list
--             'mock'     → hidden; only served through the start-mock function
create table if not exists public.tests (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  kind          text not null check (kind in ('reading','listening')),
  duration_min  int  not null default 60,
  visibility    text not null default 'draft' check (visibility in ('draft','practice','mock')),
  audio_url     text not null default '',
  strict_audio  boolean not null default false,   -- play once, no pause/seek
  content       jsonb not null default '{"parts":[]}'::jsonb,
  question_count int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------- Answer keys (admin-only, never sent to students before submit) ----------
create table if not exists public.test_keys (
  test_id  uuid primary key references public.tests(id) on delete cascade,
  answers  jsonb not null default '{}'::jsonb      -- {"1":["true"],"2":["coffee","coffees"],...}
);

-- ---------- Sunday mocks ----------
create table if not exists public.mocks (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  test_ids          uuid[] not null default '{}',   -- sections in order (e.g. listening, reading)
  results_released  boolean not null default false,
  created_at        timestamptz not null default now()
);

create table if not exists public.mock_secrets (
  mock_id   uuid primary key references public.mocks(id) on delete cascade,
  password  text not null default ''
);

-- ---------- Attempts (one row per student per test, per mock) ----------
create table if not exists public.attempts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  test_id       uuid not null references public.tests(id) on delete cascade,
  mock_id       uuid references public.mocks(id) on delete cascade,
  status        text not null default 'started' check (status in ('started','submitted')),
  answers       jsonb not null default '{}'::jsonb,
  correct       int,
  total         int,
  band          numeric(2,1),
  detail        jsonb,
  started_at    timestamptz not null default now(),
  opened_at     timestamptz,                       -- when the student pressed Start on this section
  submitted_at  timestamptz,
  test_title    text not null default '',
  test_kind     text not null default ''
);
alter table public.attempts add column if not exists opened_at timestamptz;
alter table public.attempts add column if not exists test_title text not null default '';
alter table public.attempts add column if not exists test_kind  text not null default '';
create unique index if not exists attempts_one_per_mock
  on public.attempts(user_id, test_id, mock_id) where mock_id is not null;
create index if not exists attempts_user on public.attempts(user_id);
create index if not exists attempts_mock on public.attempts(mock_id);

-- =====================================================================
--  Helper: is the current user an admin?
-- =====================================================================
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- Create a profile automatically when someone signs up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, telegram, phone)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name',''),
          coalesce(new.raw_user_meta_data->>'telegram',''),
          coalesce(new.raw_user_meta_data->>'phone',''))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Students may edit their name/telegram but never make themselves admin
create or replace function public.protect_admin_flag() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_admin is distinct from old.is_admin and not public.is_admin() then
    new.is_admin := old.is_admin;
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect_admin on public.profiles;
create trigger profiles_protect_admin before update on public.profiles
  for each row execute function public.protect_admin_flag();

-- Students can see which mock sections they've finished (without scores)
create or replace function public.my_mock_progress(p_mock uuid)
returns table(test_id uuid, status text, submitted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.test_id, a.status, a.submitted_at
  from public.attempts a
  where a.mock_id = p_mock and a.user_id = auth.uid();
$$;

-- =====================================================================
--  Row Level Security
-- =====================================================================
alter table public.profiles     enable row level security;
alter table public.tests        enable row level security;
alter table public.test_keys    enable row level security;
alter table public.mocks        enable row level security;
alter table public.mock_secrets enable row level security;
alter table public.attempts     enable row level security;

-- profiles
drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles update" on public.profiles;
create policy "profiles read"   on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profiles update" on public.profiles for update using (id = auth.uid() or public.is_admin());

-- tests
drop policy if exists "tests read"  on public.tests;
drop policy if exists "tests write" on public.tests;
create policy "tests read"  on public.tests for select
  using ((visibility = 'practice' and auth.uid() is not null) or public.is_admin());
create policy "tests write" on public.tests for all
  using (public.is_admin()) with check (public.is_admin());

-- answer keys: admin only
drop policy if exists "keys admin" on public.test_keys;
create policy "keys admin" on public.test_keys for all
  using (public.is_admin()) with check (public.is_admin());

-- mocks: everyone logged in can see the schedule; only admin edits
drop policy if exists "mocks read"  on public.mocks;
drop policy if exists "mocks write" on public.mocks;
create policy "mocks read"  on public.mocks for select using (auth.uid() is not null);
create policy "mocks write" on public.mocks for all
  using (public.is_admin()) with check (public.is_admin());

-- mock passwords: admin only
drop policy if exists "secrets admin" on public.mock_secrets;
create policy "secrets admin" on public.mock_secrets for all
  using (public.is_admin()) with check (public.is_admin());

-- attempts: students see their own practice results, and mock results only once released.
-- Inserts/updates happen only inside the server functions (service role bypasses RLS).
drop policy if exists "attempts read"   on public.attempts;
drop policy if exists "attempts admin"  on public.attempts;
create policy "attempts read" on public.attempts for select using (
  public.is_admin()
  or (user_id = auth.uid() and (
        mock_id is null
        or exists (select 1 from public.mocks m where m.id = mock_id and m.results_released)))
);
create policy "attempts admin" on public.attempts for all
  using (public.is_admin()) with check (public.is_admin());

-- =====================================================================
--  Storage bucket for listening audio (public read, admin upload)
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('audio', 'audio', true)
on conflict (id) do nothing;

drop policy if exists "audio public read"  on storage.objects;
drop policy if exists "audio admin write"  on storage.objects;
drop policy if exists "audio admin update" on storage.objects;
drop policy if exists "audio admin delete" on storage.objects;
create policy "audio public read"  on storage.objects for select using (bucket_id = 'audio');
create policy "audio admin write"  on storage.objects for insert with check (bucket_id = 'audio' and public.is_admin());
create policy "audio admin update" on storage.objects for update using (bucket_id = 'audio' and public.is_admin());
create policy "audio admin delete" on storage.objects for delete using (bucket_id = 'audio' and public.is_admin());

-- =====================================================================
--  Library uploads (HTML tests the admin adds from the website)
-- =====================================================================
create table if not exists public.library_items (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  kind        text not null check (kind in ('reading','listening','mock')),
  level       text not null default '',
  path        text not null,
  size        bigint not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.library_items enable row level security;
drop policy if exists "library read"  on public.library_items;
drop policy if exists "library write" on public.library_items;
create policy "library read"  on public.library_items for select using (auth.uid() is not null);
create policy "library write" on public.library_items for all using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets (id, name, public) values ('library', 'library', false) on conflict (id) do nothing;
drop policy if exists "library files read"   on storage.objects;
drop policy if exists "library files write"  on storage.objects;
drop policy if exists "library files delete" on storage.objects;
create policy "library files read"   on storage.objects for select using (bucket_id = 'library' and auth.uid() is not null);
create policy "library files write"  on storage.objects for insert with check (bucket_id = 'library' and public.is_admin());
create policy "library files delete" on storage.objects for delete using (bucket_id = 'library' and public.is_admin());

-- =====================================================================
--  AFTER you sign up on your own site, make yourself admin:
--    update public.profiles set is_admin = true where id =
--      (select id from auth.users where email = 'YOUR-EMAIL@example.com');
-- =====================================================================
