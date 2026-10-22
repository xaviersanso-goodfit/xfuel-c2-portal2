-- XFuel C2 portal — Supabase schema, roles and row level security.
-- Run this once in the Supabase SQL editor (Dashboard > SQL Editor > New query).

-- ---------------------------------------------------------------------------
-- 1. Profiles: one row per auth user, carrying the role.
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('editor', 'viewer');

create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text not null,
  full_name   text,
  role        public.user_role not null default 'viewer',
  created_at  timestamptz not null default now()
);

comment on table public.profiles is 'Access control. Editors write scenarios; viewers read only.';

-- New sign-ups land as viewers. Promote to editor manually (see README).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'viewer')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper used by policies. security definer avoids recursive RLS on profiles.
create or replace function public.is_editor()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'editor'
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Scenarios: the full input set as JSONB, versioned by name.
-- ---------------------------------------------------------------------------
create table if not exists public.scenarios (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  inputs      jsonb not null,
  is_base     boolean not null default false,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists scenarios_updated_idx on public.scenarios (updated_at desc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists scenarios_touch on public.scenarios;
create trigger scenarios_touch before update on public.scenarios
  for each row execute function public.touch_updated_at();

-- Only one scenario may be flagged as the base case.
create unique index if not exists scenarios_single_base
  on public.scenarios ((is_base)) where is_base;

-- ---------------------------------------------------------------------------
-- 3. Commentary: qualitative notes per scenario and section.
-- ---------------------------------------------------------------------------
create table if not exists public.commentary (
  id          uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.scenarios on delete cascade,
  section     text not null,
  body        text not null default '',
  updated_by  uuid references auth.users on delete set null,
  updated_at  timestamptz not null default now(),
  unique (scenario_id, section)
);

drop trigger if exists commentary_touch on public.commentary;
create trigger commentary_touch before update on public.commentary
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Row level security.
-- ---------------------------------------------------------------------------
alter table public.profiles   enable row level security;
alter table public.scenarios  enable row level security;
alter table public.commentary enable row level security;

-- Profiles: a user reads their own row; editors read all.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_editor());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (public.is_editor()) with check (public.is_editor());

-- Scenarios: every authenticated user reads; only editors write.
drop policy if exists scenarios_select on public.scenarios;
create policy scenarios_select on public.scenarios
  for select to authenticated using (true);

drop policy if exists scenarios_insert on public.scenarios;
create policy scenarios_insert on public.scenarios
  for insert to authenticated with check (public.is_editor());

drop policy if exists scenarios_update on public.scenarios;
create policy scenarios_update on public.scenarios
  for update to authenticated
  using (public.is_editor()) with check (public.is_editor());

drop policy if exists scenarios_delete on public.scenarios;
create policy scenarios_delete on public.scenarios
  for delete to authenticated using (public.is_editor());

-- Commentary: read for all authenticated, write for editors.
drop policy if exists commentary_select on public.commentary;
create policy commentary_select on public.commentary
  for select to authenticated using (true);

drop policy if exists commentary_write on public.commentary;
create policy commentary_write on public.commentary
  for all to authenticated
  using (public.is_editor()) with check (public.is_editor());

-- ---------------------------------------------------------------------------
-- 5. Promote yourself to editor after first sign-in:
--     update public.profiles set role = 'editor' where email = 'you@xfuel.com';
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 5. Change log: a field-level audit trail of scenario edits.
-- ---------------------------------------------------------------------------
-- Append only by design. Editors may insert; nobody may update or delete, so
-- the history cannot be rewritten from the application. Any authenticated user
-- can read it, on the view that an audit trail nobody can see is not an audit
-- trail.
create table if not exists public.change_log (
  id           uuid primary key default gen_random_uuid(),
  scenario_id  uuid references public.scenarios on delete cascade,
  scenario_name text not null default '',
  user_id      uuid references auth.users on delete set null,
  user_email   text not null default '',
  field_key    text not null,
  field_label  text not null,
  old_value    text not null default '',
  new_value    text not null default '',
  changed_at   timestamptz not null default now()
);

create index if not exists change_log_scenario_idx on public.change_log (scenario_id, changed_at desc);
create index if not exists change_log_time_idx on public.change_log (changed_at desc);

alter table public.change_log enable row level security;

drop policy if exists change_log_select on public.change_log;
create policy change_log_select on public.change_log
  for select to authenticated using (true);

drop policy if exists change_log_insert on public.change_log;
create policy change_log_insert on public.change_log
  for insert to authenticated with check (public.is_editor());

-- No update or delete policy is defined, so both are denied for everyone.
