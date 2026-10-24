-- AH STUDENT HUB — Phase 16 security hardening
-- Signed Google Sheet callbacks with replay protection.
begin;
create table if not exists public.sheet_webhook_events (
  request_id text primary key,
  payload_sha256 text not null,
  received_at timestamptz not null default now()
);
create index if not exists sheet_webhook_events_received_idx on public.sheet_webhook_events(received_at desc);
alter table public.sheet_webhook_events enable row level security;
revoke all on public.sheet_webhook_events from public, anon, authenticated;
comment on table public.sheet_webhook_events is 'Replay protection ledger for signed Google Sheets -> Supabase webhook requests.';
create or replace function public.prune_sheet_webhook_events(p_keep_days integer default 30)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer; begin delete from public.sheet_webhook_events where received_at < now() - make_interval(days => greatest(1, least(p_keep_days, 90))); get diagnostics n = row_count; return n; end; $$;
revoke all on function public.prune_sheet_webhook_events(integer) from public, anon, authenticated;
grant execute on function public.prune_sheet_webhook_events(integer) to service_role;
notify pgrst, 'reload schema';
commit;
