-- =============================================================================
-- PHASE 2: DATA INTEGRITY & TRANSACTION ENGINE
--
-- Goals:
--   1) Make payment settlement atomic and idempotent.
--   2) Make Google Sheet outbox processing safely claimable/retryable.
--   3) Add payment-attempt tracking for application/payment initialization.
--   4) Make staff access-code redemption atomic and service-role safe.
--   5) Provide reconciliation/health information for administrators.
--
-- Run AFTER migrations 001-011.
-- Safe to run more than once.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Payment ledger hardening
-- -----------------------------------------------------------------------------
alter table payments
  add column if not exists provider_transaction_id text,
  add column if not exists provider text,
  add column if not exists source text not null default 'provider',
  add column if not exists verified_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists payments_provider_transaction_uidx
  on payments(provider_transaction_id)
  where provider_transaction_id is not null;

create index if not exists payments_application_idx on payments(application_id);
create index if not exists payments_created_idx on payments(created_at desc);

-- Reject impossible negative amounts without changing historical positive data.
alter table payments drop constraint if exists payments_amounts_nonnegative;
alter table payments add constraint payments_amounts_nonnegative
  check (coalesce(expected_ngn, 0) >= 0 and coalesce(paid_ngn, 0) >= 0);

-- -----------------------------------------------------------------------------
-- 2. Payment initialization attempts
-- -----------------------------------------------------------------------------
create table if not exists payment_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid references applications(id) on delete set null,
  intake_id uuid not null references intakes(id),
  idempotency_key text not null,
  provider text,
  amount_ngn int not null check (amount_ngn >= 0),
  course_codes text[] not null default '{}',
  package_code text,
  status text not null default 'reserved'
    check (status in ('reserved','provider_created','completed','failed','expired')),
  provider_reference text,
  provider_transaction_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists payment_attempts_user_key_uidx
  on payment_attempts(user_id, idempotency_key);
create unique index if not exists payment_attempts_live_application_uidx
  on payment_attempts(user_id, intake_id)
  where status in ('reserved','provider_created');
create index if not exists payment_attempts_application_idx on payment_attempts(application_id);

alter table payment_attempts enable row level security;
drop policy if exists payment_attempts_own_read on payment_attempts;
create policy payment_attempts_own_read on payment_attempts
  for select to authenticated using(user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 3. Safe sheet outbox queue
-- -----------------------------------------------------------------------------
alter table sheet_outbox
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by text,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists completed_at timestamptz;

-- Collapse duplicate pending jobs created by earlier trigger versions before adding
-- the uniqueness guarantee. The newest queue row is retained.
delete from sheet_outbox s
where not s.done
  and exists (
    select 1 from sheet_outbox newer
     where not newer.done
       and newer.application_id is not distinct from s.application_id
       and newer.kind = s.kind
       and newer.id > s.id
  );

create unique index if not exists sheet_outbox_one_pending_uidx
  on sheet_outbox(application_id, kind)
  where done = false;

create index if not exists sheet_outbox_ready_idx
  on sheet_outbox(done, next_attempt_at, id)
  where done = false;
create index if not exists sheet_outbox_claim_idx
  on sheet_outbox(claimed_at, done);

-- Re-queue abandoned work. A worker can safely die without permanently owning jobs.
update sheet_outbox
set claimed_at = null, claimed_by = null
where done = false and claimed_at < now() - interval '15 minutes';

-- Atomically claims jobs. FOR UPDATE SKIP LOCKED prevents two workers from owning
-- the same job at the same time.
create or replace function claim_sheet_jobs(p_worker text, p_limit int default 10)
returns setof sheet_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(trim(p_worker), '') = '' then raise exception 'Worker id is required'; end if;
  if p_limit < 1 or p_limit > 100 then raise exception 'Invalid batch size'; end if;

  return query
  with candidates as (
    select id
    from sheet_outbox
    where not done
      and attempts < 8
      and (next_attempt_at is null or next_attempt_at <= now())
      and (claimed_at is null or claimed_at < now() - interval '15 minutes')
    order by id
    for update skip locked
    limit p_limit
  )
  update sheet_outbox s
     set claimed_at = now(),
         claimed_by = p_worker,
         last_attempt_at = now(),
         attempts = s.attempts + 1
    from candidates c
   where s.id = c.id
  returning s.*;
end $$;

create or replace function complete_sheet_job(p_id bigint, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update sheet_outbox
     set done = true,
         completed_at = now(),
         claimed_at = null,
         claimed_by = null,
         next_attempt_at = null,
         last_error = p_note
   where id = p_id and not done;
  return found;
end $$;

create or replace function fail_sheet_job(p_id bigint, p_error text, p_max_attempts int default 8)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare a int;
begin
  if p_max_attempts < 1 or p_max_attempts > 20 then raise exception 'Invalid maximum attempts'; end if;
  select attempts into a from sheet_outbox where id = p_id for update;
  if not found then return false; end if;

  update sheet_outbox
     set claimed_at = null,
         claimed_by = null,
         last_error = left(coalesce(p_error, 'Unknown synchronization error'), 1000),
         next_attempt_at = case
           when a >= p_max_attempts then null
           else now() + make_interval(secs => least(3600, power(2, greatest(a - 1, 0))::int * 10))
         end
   where id = p_id and not done;
  return found;
end $$;

-- Worker queue RPCs are server-only: authenticated browsers must not claim or settle jobs.
revoke all on function public.claim_sheet_jobs(text,integer) from public, anon, authenticated;
revoke all on function public.complete_sheet_job(bigint,text) from public, anon, authenticated;
revoke all on function public.fail_sheet_job(bigint,text,integer) from public, anon, authenticated;
grant execute on function public.claim_sheet_jobs(text,integer) to service_role;
grant execute on function public.complete_sheet_job(bigint,text) to service_role;
grant execute on function public.fail_sheet_job(bigint,text,integer) to service_role;

-- -----------------------------------------------------------------------------
-- 4. Atomic payment settlement
-- -----------------------------------------------------------------------------
create or replace function record_verified_payment(
  p_application uuid,
  p_provider text,
  p_provider_transaction_id text,
  p_paid_ngn int,
  p_raw_event jsonb default '{}'::jsonb,
  p_source text default 'provider'
) returns applications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a applications;
  existing payments;
  ref text;
begin
  if p_application is null then raise exception 'Application id is required'; end if;
  if p_paid_ngn is null or p_paid_ngn < 0 then raise exception 'Invalid payment amount'; end if;
  if coalesce(trim(p_provider_transaction_id), '') = '' then raise exception 'Provider transaction id is required'; end if;

  select * into a from applications where id = p_application for update;
  if not found then raise exception 'Application not found'; end if;

  -- A successful payment must exactly match the locked application amount.
  if p_paid_ngn <> a.total_ngn then
    raise exception 'Payment amount mismatch: expected %, received %', a.total_ngn, p_paid_ngn;
  end if;

  -- Same provider transaction can be delivered repeatedly. Treat it as idempotent.
  select * into existing from payments
   where provider_transaction_id = p_provider_transaction_id
   limit 1;
  if found then
    if existing.application_id <> a.id then
      raise exception 'Provider transaction is already attached to another application';
    end if;
    return a;
  end if;

  ref := coalesce(nullif(trim(a.pay_gateway_ref), ''), 'GW-' || a.pay_reference || '-' || p_provider_transaction_id);

  insert into payments(
    application_id, reference, provider_transaction_id, provider,
    expected_ngn, paid_ngn, raw_event, source, verified_at, paid_at
  ) values (
    a.id, ref, p_provider_transaction_id, p_provider,
    a.total_ngn, p_paid_ngn, coalesce(p_raw_event, '{}'::jsonb),
    coalesce(nullif(trim(p_source), ''), 'provider'), now(), now()
  );

  if a.status = 'pending_payment' then
    update applications
       set status = 'paid',
           paid_at = coalesce(paid_at, now()),
           payment_review = 'approved'
     where id = a.id
     returning * into a;
  end if;

  return a;
end $$;

-- Only trusted server-side Edge Functions may settle provider payments.
revoke all on function record_verified_payment(uuid,text,text,int,jsonb,text) from public, anon, authenticated;
grant execute on function record_verified_payment(uuid,text,text,int,jsonb,text) to service_role;

-- -----------------------------------------------------------------------------
-- 5. Atomic access-code redemption
-- -----------------------------------------------------------------------------
create or replace function redeem_access_code(p_hash text, p_role text, p_consume boolean default false)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c access_codes;
begin
  if coalesce(trim(p_hash), '') = '' then return false; end if;
  if p_consume then
    update access_codes
       set uses = uses + 1
     where code_hash = p_hash
       and active
       and (expires_at is null or expires_at > now())
       and (max_uses is null or uses < max_uses)
       and (allowed_roles is null or p_role = any(allowed_roles))
     returning * into c;
    return found;
  end if;

  select * into c
    from access_codes
   where code_hash = p_hash
     and active
     and (expires_at is null or expires_at > now())
     and (max_uses is null or uses < max_uses)
     and (allowed_roles is null or p_role = any(allowed_roles));
  return found;
end $$;
revoke all on function redeem_access_code(text,text,boolean) from public, anon, authenticated;
grant execute on function redeem_access_code(text,text,boolean) to service_role;

-- -----------------------------------------------------------------------------
-- 6. Admin reconciliation / health summary
-- -----------------------------------------------------------------------------
create or replace function admin_sync_health()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if not is_admin() then raise exception 'Not authorised'; end if;
  return jsonb_build_object(
    'pending', (select count(*) from sheet_outbox where not done),
    'processing', (select count(*) from sheet_outbox where not done and claimed_at is not null and claimed_at >= now() - interval '15 minutes'),
    'retry_waiting', (select count(*) from sheet_outbox where not done and next_attempt_at is not null and next_attempt_at > now()),
    'stuck', (select count(*) from sheet_outbox where not done and attempts >= 8),
    'synced', (select count(*) from sheet_outbox where done),
    'last_completed_at', (select max(completed_at) from sheet_outbox where done),
    'last_error_at', (select max(last_attempt_at) from sheet_outbox where not done and last_error is not null),
    'applications', (select count(*) from applications),
    'application_jobs', (select count(*) from sheet_outbox where kind = 'application'),
    'staff_jobs', (select count(*) from sheet_outbox where kind = 'staff')
  );
end $$;
revoke all on function admin_sync_health() from public, anon;
grant execute on function admin_sync_health() to authenticated;

-- Rebuild the old status RPC around the new queue fields while retaining the old
-- dashboard contract.
create or replace function admin_sync_status()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if not is_admin() then raise exception 'Not authorised'; end if;
  return jsonb_build_object(
    'pending', (select count(*) from sheet_outbox where not done),
    'stuck', (select count(*) from sheet_outbox where not done and attempts >= 8),
    'processing', (select count(*) from sheet_outbox where not done and claimed_at is not null and claimed_at >= now() - interval '15 minutes'),
    'synced', (select count(*) from sheet_outbox where done),
    'last_completed_at', (select max(completed_at) from sheet_outbox where done),
    'errors', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (
      select kind, left(last_error, 220) as error, created_at
      from sheet_outbox where not done and last_error is not null
      order by id desc limit 5
    ) e)
  );
end $$;
revoke all on function admin_sync_status() from public, anon;
grant execute on function admin_sync_status() to authenticated;

-- Make all application/staff queue triggers idempotent with the new unique index.
create or replace function queue_sheet() returns trigger language plpgsql as $$
begin
  if new.payment_claimed_at is not null or new.status not in ('draft','pending_payment','expired') then
    insert into sheet_outbox(application_id, kind) values(new.id, 'application')
    on conflict (application_id, kind) where done = false do nothing;
  end if;
  return new;
end $$;

create or replace function queue_staff_sheet() returns trigger language plpgsql as $$
begin
  insert into sheet_outbox(application_id, kind) values(new.id, 'staff')
  on conflict (application_id, kind) where done = false do nothing;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Reconciliation helper: queue only records that have no completed job.
-- -----------------------------------------------------------------------------
create or replace function admin_resync_sheet()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare a int; b int;
begin
  if not is_admin() then raise exception 'Not authorised'; end if;

  update sheet_outbox
     set attempts = 0,
         last_error = null,
         claimed_at = null,
         claimed_by = null,
         next_attempt_at = null
   where not done;

  insert into sheet_outbox(application_id, kind)
  select s.id, 'staff'
    from staff s
   where not exists (
     select 1 from sheet_outbox q
      where q.application_id = s.id and q.kind = 'staff' and q.done
   )
  on conflict (application_id, kind) where done = false do nothing;
  get diagnostics a = row_count;

  insert into sheet_outbox(application_id, kind)
  select a.id, 'application'
    from applications a
   where (a.payment_claimed_at is not null or a.status not in ('draft','pending_payment','expired'))
     and not exists (
       select 1 from sheet_outbox q
        where q.application_id = a.id and q.kind = 'application' and q.done
     )
  on conflict (application_id, kind) where done = false do nothing;
  get diagnostics b = row_count;

  return a + b;
end $$;
revoke all on function admin_resync_sheet() from public, anon;
grant execute on function admin_resync_sheet() to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Keep updated_at current for payment attempts.
-- -----------------------------------------------------------------------------
create or replace function touch_payment_attempt()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists payment_attempt_touch on payment_attempts;
create trigger payment_attempt_touch before update on payment_attempts
for each row execute function touch_payment_attempt();

-- -----------------------------------------------------------------------------
-- 9. Operational indexes
-- -----------------------------------------------------------------------------
create index if not exists applications_status_created_idx on applications(status, created_at desc);
create index if not exists applications_user_intake_idx on applications(user_id, intake_id);
create index if not exists applications_pay_reference_idx on applications(pay_reference);
create index if not exists audit_log_created_idx on audit_log(created_at desc);

-- Migration marker.
comment on table payment_attempts is 'Phase 2 payment initialization/idempotency ledger';
comment on table sheet_outbox is 'Phase 2 claimable, retryable Google Sheets mirror queue';
