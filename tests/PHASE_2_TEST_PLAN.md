# Phase 2 Test Plan

Run these tests against a disposable/staging Supabase project before production.

## Payment integrity

- Successful provider event with exact amount -> one payment row, application `paid`.
- Same provider event repeated -> no additional payment row.
- Provider transaction reused against a different application -> rejected.
- Amount lower than expected -> rejected.
- Amount higher than expected -> rejected.
- Non-success provider event -> ignored.
- Already-paid application -> remains paid; no duplicate settlement.
- Upperlink verification for an application already `rejected` or `expired` -> returns `paid: false`.

## Sheet queue

- Two workers claim the same queue concurrently -> only one receives the job.
- Successful processing -> `done=true`, `completed_at` populated, claim cleared.
- Temporary failure -> attempts increase and `next_attempt_at` is scheduled.
- Worker crash -> job becomes claimable after 15 minutes.
- Eight failures -> job remains visible as stuck and is not automatically retried.
- Reconciliation -> missing completed jobs are queued again without duplicating already completed jobs.

## Authorization

- Student cannot execute `record_verified_payment`.
- Tutor cannot execute administrator sync controls.
- Unauthenticated user cannot execute `admin_sync_status`.
- Service role can execute trusted settlement and queue functions.

## Access codes

- Valid unused code -> accepted.
- Expired code -> rejected.
- Max-use code -> rejected after its limit.
- Concurrent redemption cannot exceed the configured maximum.

## Application idempotency

- Repeat the same application request with the same `key` -> same application returned.
- Two concurrent requests with the same `key` -> one application only.
- Existing active application for the same user/intake -> resumed rather than duplicated.
