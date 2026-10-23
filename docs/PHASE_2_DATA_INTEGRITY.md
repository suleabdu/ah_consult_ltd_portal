# Phase 2 — Data Integrity & Transaction Engine

This phase establishes Supabase PostgreSQL as the operational source of truth and makes the payment and Google Sheets paths transaction-safe.

## What changed

### Payment ledger
- `payments.provider_transaction_id` uniquely identifies a provider transaction.
- `record_verified_payment(...)` performs exact-amount validation and application/payment settlement atomically.
- Duplicate provider webhooks are idempotent.
- Negative payment amounts are rejected by a database constraint.
- Provider settlement is callable only by the Supabase service role.

### Payment attempts
`payment_attempts` records initialization attempts and their lifecycle so payment setup can be made idempotent and diagnosable.

### Google Sheets outbox
`sheet_outbox` now supports:
- atomic job claiming with `FOR UPDATE SKIP LOCKED`;
- worker ownership;
- retry scheduling with exponential backoff;
- abandoned-job recovery;
- completion timestamps;
- an eight-attempt ceiling.

The browser never processes the queue directly. The protected Edge Function owns the worker operation.

### Access codes
Staff access-code redemption is now atomic when consuming a code. The trusted Edge Function has the required `service_role` execute permission.

### Admin observability
`admin_sync_status()` and `admin_sync_health()` expose pending, processing, retrying, stuck and completed queue counts without exposing secrets.

## Migration

Apply migrations `001` through `013` in order in a staging Supabase project first. Phase 3 adds the academic engine and student/tutor UX; see `PHASE_3_ACADEMIC_UX.md`.

Do not run a destructive reset against production. Migration `012` is additive and safe to run more than once.

## Verification checklist

1. Create a test application and complete payment in test mode.
2. Send the same payment webhook twice.
3. Confirm only one payment row exists for the provider transaction ID.
4. Confirm the application becomes `paid` exactly once.
5. Confirm a wrong amount is rejected.
6. Queue a Sheet job and run the sync worker concurrently from two invocations; the same job must not be processed twice.
7. Force a Google API failure and confirm `attempts`, `last_error` and `next_attempt_at` are populated.
8. Confirm a retry eventually succeeds after the temporary failure is removed.
9. Run `admin_sync_health()` as an administrator and confirm the counts match the outbox.
10. Redeem a staff access code concurrently and confirm its usage cannot exceed `max_uses`.

## Important operational rule

Google Sheets is a reporting mirror. Supabase is the source of truth. Never edit authoritative student/payment data manually in the Sheet and expect those edits to flow back into Supabase.
