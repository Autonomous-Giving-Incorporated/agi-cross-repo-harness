-- Synthetic replica of the AGI platform's tenant-isolation slice, for RLS
-- verification on plain Postgres (a CI service container). The SECURITY DEFINER
-- helper functions and SELECT policies are reproduced VERBATIM from the AGI
-- Supabase project (extracted read-only); only the supporting columns are
-- minimized and auth.uid()/auth.jwt() are shimmed to read request.jwt.claims,
-- exactly as Supabase does. Synthetic data only - no production rows.

-- Supabase-compatible roles.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

-- Minimal auth shims mirroring Supabase's auth.uid() / auth.jwt().
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

drop schema if exists public cascade;
create schema public;
grant usage on schema public, auth to anon, authenticated;

create type app_role as enum
  ('director','campaign_lead','development','board_viewer','data_steward','auditor','infrastructure_delegate');

-- Minimal supporting tables (only the columns the policies/functions reference).
create table public.profiles (
  id uuid primary key,
  active boolean not null default true,
  mfa_enforced boolean not null default false
);
create table public.clients (
  id text primary key,
  state text not null default 'active'
);
create table public.platform_administrators (
  user_id uuid primary key,
  active boolean not null default true,
  revoked_at timestamptz
);
create table public.client_memberships (
  client_id text not null references public.clients(id),
  user_id uuid not null,
  role app_role not null,
  active boolean not null default true,
  primary key (client_id, user_id)
);
create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.clients(id),
  title text not null
);

-- Verbatim platform helper functions.
create or replace function public.current_session_aal() returns text
  language sql stable set search_path to 'public' as $$
  select coalesce(
    nullif(auth.jwt() ->> 'aal', ''),
    nullif(current_setting('request.jwt.claim.aal', true), ''),
    'aal1'
  )
$$;

create or replace function public.is_client_member(p_client_id text) returns boolean
  language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1
    from public.client_memberships m
    join public.clients c on c.id = m.client_id and c.state = 'active'
    join public.profiles p on p.id = m.user_id and p.active is true
    where m.client_id = p_client_id
      and m.user_id = auth.uid()
      and m.active is true
      and (
        m.role = 'board_viewer'
        or (p.mfa_enforced is true and public.current_session_aal() = 'aal2')
      )
  )
$$;

create or replace function public.current_client_role(p_client_id text) returns app_role
  language sql stable security definer set search_path to 'public' as $$
  select m.role
  from public.client_memberships m
  join public.clients c on c.id = m.client_id and c.state = 'active'
  join public.profiles p on p.id = m.user_id and p.active is true
  where m.client_id = p_client_id
    and m.user_id = auth.uid()
    and m.active is true
    and (
      m.role = 'board_viewer'
      or (p.mfa_enforced is true and public.current_session_aal() = 'aal2')
    )
$$;

create or replace function public.is_master_admin() returns boolean
  language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1
    from public.platform_administrators a
    join public.profiles p on p.id = a.user_id and p.active is true
    where a.user_id = auth.uid()
      and a.active is true
      and a.revoked_at is null
      and p.mfa_enforced is true
      and public.current_session_aal() = 'aal2'
  )
$$;

-- RLS + policies (verbatim quals from the platform).
alter table public.clients enable row level security;
alter table public.client_memberships enable row level security;
alter table public.decisions enable row level security;

create policy "members read their clients" on public.clients
  for select using (is_client_member(id) or is_master_admin());
create policy "members read client memberships" on public.client_memberships
  for select using (is_client_member(client_id) or is_master_admin());
create policy "client members read decisions" on public.decisions
  for select using (is_client_member(client_id));
create policy "client directors decide" on public.decisions
  for all using (current_client_role(client_id) = any (array['director'::app_role, 'campaign_lead'::app_role]));

grant select on public.clients, public.client_memberships, public.profiles to authenticated;
grant select, insert, update, delete on public.decisions to authenticated;
grant execute on all functions in schema public to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;

-- Synthetic seed: two tenants, board_viewer members, an MFA-enforced director,
-- and tenant-scoped rows.
insert into public.profiles (id, active, mfa_enforced) values
  ('11111111-1111-4111-8111-111111111111', true, false),
  ('22222222-2222-4222-8222-222222222222', true, false),
  ('33333333-3333-4333-8333-333333333333', true, true);
insert into public.clients (id, state) values ('hacker-dojo','active'), ('other-tenant','active');
insert into public.client_memberships (client_id, user_id, role, active) values
  ('hacker-dojo','11111111-1111-4111-8111-111111111111','board_viewer', true),
  ('other-tenant','22222222-2222-4222-8222-222222222222','board_viewer', true),
  ('hacker-dojo','33333333-3333-4333-8333-333333333333','director', true);
insert into public.decisions (client_id, title) values
  ('hacker-dojo','HD decision 1'), ('hacker-dojo','HD decision 2'),
  ('other-tenant','OT decision 1');
