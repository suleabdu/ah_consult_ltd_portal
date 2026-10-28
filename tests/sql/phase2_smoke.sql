-- Run manually in a STAGING Supabase project after migrations 001-012.
-- These are read-only smoke assertions; they do not create application/payment data.
select exists(select 1 from information_schema.columns where table_name='sheet_outbox' and column_name='claimed_at') as has_claimed_at;
select exists(select 1 from information_schema.columns where table_name='payments' and column_name='provider_transaction_id') as has_provider_transaction_id;
select exists(select 1 from information_schema.tables where table_name='payment_attempts') as has_payment_attempts;
select exists(select 1 from pg_proc where proname='claim_sheet_jobs') as has_claim_sheet_jobs;
select exists(select 1 from pg_proc where proname='record_verified_payment') as has_payment_settlement;
select exists(select 1 from pg_proc where proname='admin_sync_health') as has_sync_health;
