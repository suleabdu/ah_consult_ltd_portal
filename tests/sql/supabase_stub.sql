-- SAFETY GUARD: this file emulates Supabase platform schemas for vanilla local PostgreSQL only.
-- Never run it in a hosted/local Supabase project: auth.users, auth.uid(), storage and publication
-- objects are managed by Supabase there. Use `supabase db reset` for a local Supabase stack.
do $stub_guard$
begin
  if to_regclass('auth.users') is not null and to_regprocedure('auth.uid()') is not null then
    raise exception 'supabase_stub.sql is only for plain PostgreSQL test databases. Supabase already owns auth.users/auth.uid(); use Supabase migrations or `supabase db reset` instead.'
      using errcode = '0A000';
  end if;
end
$stub_guard$;

-- Minimal stand-ins for the Supabase platform so the migrations can run on vanilla Postgres.
create extension if not exists pgcrypto;
do $$ begin
  create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
do $$ begin create role authenticator noinherit login; exception when duplicate_object then null; end $$;
create schema if not exists auth; create schema if not exists storage; create schema if not exists extensions;
create table if not exists auth.users(id uuid primary key default gen_random_uuid(), email text unique, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now(), email_confirmed_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'anon') $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
create table if not exists storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
grant all on all tables in schema auth, storage to service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;
