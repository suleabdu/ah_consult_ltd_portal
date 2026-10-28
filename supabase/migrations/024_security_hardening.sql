-- 024_security_hardening.sql
-- Phase 16 hardening. Safe to re-run (idempotent).
--  1. Postgres-backed rate limiting used by Edge Functions (staff-code guessing, webhook flooding).
--  2. Atomic replacement of an application's selected courses (was delete-then-insert across two API calls).

-- 1. Rate limiting ----------------------------------------------------------------------------
create table if not exists public.rate_limits (
  key          text primary key check (length(key) <= 200),
  window_start timestamptz not null default now(),
  hits         integer     not null default 0
);
alter table public.rate_limits enable row level security;          -- no policies on purpose: service role only
revoke all on public.rate_limits from public, anon, authenticated;

create or replace function public.check_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_hits integer;
begin
  if p_key is null or length(p_key) > 200 or coalesce(p_max, 0) < 1 or coalesce(p_window_seconds, 0) < 1 then
    return false;
  end if;
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update set
    hits         = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  if random() < 0.01 then                                            -- cheap housekeeping, no cron needed
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_max;
end $$;
revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

-- 2. Atomic course replacement ----------------------------------------------------------------
create or replace function public.replace_application_courses(p_application_id uuid, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.applications where id = p_application_id and status in ('draft', 'pending_payment')) then
    raise exception 'application % is not open for course changes', p_application_id using errcode = 'P0001';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'at least one course is required' using errcode = 'P0001';
  end if;
  delete from public.application_courses where application_id = p_application_id;
  insert into public.application_courses (application_id, course_code, fee_ngn)
  select p_application_id, r ->> 'course_code', (r ->> 'fee_ngn')::integer
  from jsonb_array_elements(p_rows) as r;
end $$;
revoke all on function public.replace_application_courses(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_application_courses(uuid, jsonb) to service_role;

-- 3. Defense in depth for anonymous visitors ----------------------------------------------------
-- Supabase grants the public "anon" role full table privileges by default, so only RLS stood between a visitor
-- and every table. Keep the four intentionally public, read-only catalogue tables and close everything else.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select on public.courses, public.intakes, public.packages, public.site_settings to anon;
alter default privileges in schema public revoke all on tables    from anon;   -- future tables are private to anon unless granted deliberately
alter default privileges in schema public revoke all on sequences from anon;
