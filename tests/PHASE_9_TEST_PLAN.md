# Phase 9 Production Automation & Governance — Test Plan

## A. Migration

- [ ] Apply migrations 001–019 to a clean staging project.
- [ ] Re-run 019 to confirm it is safe to re-run.
- [ ] Confirm all expected tables/functions/triggers exist.

## B. Audit governance

- [ ] Authenticated user cannot update `audit_log`.
- [ ] Authenticated user cannot delete `audit_log`.
- [ ] Authorized server-side workflows can append audit events.
- [ ] Attempted mutation returns `audit_log is append-only`.

## C. Communications

- [ ] Insert a student notification.
- [ ] Confirm one email job is queued when email is enabled and an email exists.
- [ ] Confirm SMS/WhatsApp are not queued unless explicitly enabled.
- [ ] Repeat the same event and confirm the unique `(notification_id,channel)` rule prevents duplicates.
- [ ] Claim the queue from two workers concurrently; each job must be owned by one worker only.
- [ ] Successful provider call changes job to `sent`.
- [ ] Failed provider call schedules exponential retry.
- [ ] The eighth failure remains failed and stops automatic retry.

## D. Documents

- [ ] Request admission letter.
- [ ] Request payment receipt.
- [ ] Request academic transcript.
- [ ] Request certificate.
- [ ] Confirm the document job stores the exact template HTML snapshot/version.
- [ ] Render through `document-render` with an approved staff JWT.
- [ ] Render without JWT and confirm rejection.
- [ ] Confirm generated jobs record `generated_by` and `generated_at`.
- [ ] Issue a document and confirm `student_documents` is updated.
- [ ] Confirm a second issuance updates the same stable `document_key` rather than creating duplicates.

## E. System Health

- [ ] Administrator can open System Health.
- [ ] Operations/Viewer can read health metrics according to role policy.
- [ ] Public/anonymous users cannot call the health RPC.
- [ ] No provider secrets appear in the response.

## F. Sheet governance

- [ ] Supabase remains writable source of truth.
- [ ] Sheet sync continues from `sheet_outbox`.
- [ ] Failed jobs remain visible.
- [ ] Full mirror refresh can be queued by an administrator.
- [ ] No browser code contains a Google service-account private key.

## G. Production secrets

- [ ] `RESEND_API_KEY` is stored only as a Supabase Edge Function secret.
- [ ] `RESEND_FROM_EMAIL` is configured and domain verified.
- [ ] SMS provider secrets are server-side only.
- [ ] WhatsApp provider secrets are server-side only.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is never shipped to frontend code.

## H. Scheduler

- [ ] Trusted scheduler invokes `communication-worker` every 1–5 minutes.
- [ ] Worker rejects anon/user JWTs.
- [ ] Worker succeeds only with service-role authorization.
- [ ] Worker metrics/logs are monitored.
