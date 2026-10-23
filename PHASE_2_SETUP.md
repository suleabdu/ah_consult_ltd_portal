# AHCT Student Hub — Phase 2 Setup Guide

## 1. Use staging first

Create/choose a disposable Supabase staging project. Do not test migration changes against live student/payment data first.

## 2. Apply migrations

Apply `001` through `013` in order. If using the Supabase CLI, use your normal linked-project migration workflow. If using SQL Editor, paste each migration separately and confirm success before moving to the next.

Migration `012_integrity_engine.sql` is additive and designed to be rerunnable.

## 3. Deploy functions

After the migration is successful, deploy the Edge Functions from the project root:

```bash
supabase functions deploy sheet-sync
supabase functions deploy payment-webhook --no-verify-jwt
supabase functions deploy verify-payment
supabase functions deploy admin-sync
```

Then deploy the remaining functions using `scripts/deploy-functions.sh` or the PowerShell equivalent.

## 4. Configure secrets

No new plaintext application secret is introduced by Phase 2. Continue using the rotated secrets from Phase 1.

Do not place service-account JSON, payment keys or webhook secrets in the repository.

## 5. Google Sheets

Confirm the replacement service account still has Editor access to the target spreadsheet. The worker now claims queue jobs atomically and retries temporary failures.

## 6. Test payment idempotency

Use a provider test transaction. Send the provider webhook twice with the same transaction reference. The second delivery must not create a second payment row.

Then send a deliberately incorrect amount. The webhook should return an amount-mismatch response and the application must remain unpaid.

## 7. Test Sheet concurrency

Create at least one pending outbox job. Trigger `sheet-sync` twice close together. The same job must not be processed by both workers.

Force a temporary Google failure if possible and inspect `sheet_outbox`:

- `attempts` increases;
- `last_error` is recorded;
- `next_attempt_at` is populated;
- the job becomes available again after the retry time.

## 8. Test access-code concurrency

Create an access code with `max_uses = 1`. Submit two registrations simultaneously using that code. Only one should consume the code successfully.

## 9. Admin sync monitor

Open the Admin Dashboard and confirm the Google Sheet panel displays queue state. `Sync now` triggers the protected worker. `Reconcile` calls the database reconciliation routine rather than blindly creating duplicate queue jobs.

## 10. Production promotion

Only after all Phase 2 tests pass in staging:

1. Back up production database metadata.
2. Apply migration `012` to production.
3. Deploy the updated functions.
4. Monitor payment and sheet-sync logs.
5. Run a controlled test record.
6. Confirm the Sheet and Supabase match.
7. Only then reopen normal intake/payment traffic.

## Rollback note

Do not delete Phase 2 columns or functions as an emergency rollback. The migration is additive. If a Phase 2 function fails, temporarily disable the affected workflow, investigate the logs, and restore the previous function version while keeping the additive database structures intact.
