-- Glidepath cloud: run once in Supabase → SQL Editor → New query → Run.
-- Every table has row-level security: each person can only see and change their own rows.

-- Profiles: one per account, created automatically on sign-up.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  monthly_email boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', null))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Flights: the summary of each completed flight (no telemetry), synced by the app.
create table if not exists public.flights (
  user_id uuid not null references auth.users (id) on delete cascade,
  id uuid not null,
  status text not null,
  off_block_at timestamptz,
  summary jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists flights_user_time on public.flights (user_id, off_block_at);
alter table public.flights enable row level security;
drop policy if exists "own flights" on public.flights;
create policy "own flights" on public.flights for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Bridges: the PCs you've paired, so any device signed in to your account can find them on your Wi-Fi.
create table if not exists public.bridges (
  user_id uuid not null references auth.users (id) on delete cascade,
  bridge_id text not null,
  name text,
  addresses text[] not null default '{}',
  port integer not null default 4810,
  token text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, bridge_id)
);
alter table public.bridges enable row level security;
drop policy if exists "own bridges" on public.bridges;
create policy "own bridges" on public.bridges for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Which monthly briefs have gone out (so a retry never sends twice).
create table if not exists public.email_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  period text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, period)
);
alter table public.email_log enable row level security;
drop policy if exists "read own email log" on public.email_log;
create policy "read own email log" on public.email_log for select using (auth.uid() = user_id);

-- Private bucket for the Windows download. Only signed-in people get a link (via the download function).
insert into storage.buckets (id, name, public) values ('releases', 'releases', false) on conflict (id) do nothing;
