-- Resume Studio — multi-user schema.
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query -> Run).
--
-- Design note: the whole resume library is stored as ONE jsonb document per user, exactly the
-- shape of `Db` in lib/types.ts. The app has always treated the library as a single document
-- (the editor loads it all, edits in memory and saves it back), so splitting it into relational
-- tables would buy nothing and would break every component. `rev` gives us optimistic locking
-- so two tabs cannot silently overwrite each other.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles: one row per student, created automatically on sign-up
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text not null default '',
  college    text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- libraries: the student's resume library (one jsonb document, see lib/types.ts)
-- ---------------------------------------------------------------------------
create table if not exists public.libraries (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb  not null,
  rev        bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- library_versions: automatic snapshot of the PREVIOUS contents on every save,
-- so a student can never lose work to a bad edit. Trimmed to the last 30.
-- ---------------------------------------------------------------------------
create table if not exists public.library_versions (
  id         bigserial primary key,
  user_id    uuid   not null references auth.users (id) on delete cascade,
  rev        bigint not null,
  data       jsonb  not null,
  created_at timestamptz not null default now()
);

create index if not exists library_versions_user_idx
  on public.library_versions (user_id, id desc);

-- ---------------------------------------------------------------------------
-- Row level security: a student can only ever see and change their own rows.
-- ---------------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.libraries        enable row level security;
alter table public.library_versions enable row level security;

drop policy if exists "profiles are self-service" on public.profiles;
create policy "profiles are self-service" on public.profiles
  for all using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "libraries are self-service" on public.libraries;
create policy "libraries are self-service" on public.libraries
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- History is readable (to restore from) but never writable by hand: only the
-- trigger below writes it, and it runs as the table owner.
drop policy if exists "versions are self-readable" on public.library_versions;
create policy "versions are self-readable" on public.library_versions
  for select using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- On save: bump rev, stamp updated_at, snapshot the old contents.
-- Doing this in a trigger (not the app) keeps rev strictly increasing even if
-- two requests land at the same moment.
-- ---------------------------------------------------------------------------
create or replace function public.libraries_on_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.rev        := old.rev + 1;
  new.updated_at := now();

  insert into public.library_versions (user_id, rev, data)
  values (old.user_id, old.rev, old.data);

  delete from public.library_versions
   where user_id = old.user_id
     and id not in (
       select id from public.library_versions
        where user_id = old.user_id
        order by id desc
        limit 30
     );

  return new;
end;
$$;

drop trigger if exists libraries_before_update on public.libraries;
create trigger libraries_before_update
  before update on public.libraries
  for each row execute function public.libraries_on_update();

-- ---------------------------------------------------------------------------
-- On sign-up: create the profile row. The library itself is created lazily by
-- the app on first load, because the starter document is built in TypeScript
-- (lib/starter.ts) and would be a nightmare to keep in sync here.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
