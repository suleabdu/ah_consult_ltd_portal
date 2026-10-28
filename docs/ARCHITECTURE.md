# Architecture

## Components
```
Browser (Vercel, static)  --anon key + user JWT-->  Supabase Postgres (RLS)   <--- SQL tests in CI
        |                                              ^
        | JWT                                          | service role (server only)
        v                                              |
  Edge Functions (Deno) -------------------------------+--> payment providers (Monnify, Upperlink)
        |                                                 --> Google Sheets API (read-only mirror)
        +-- sheet-sync / communication-worker: pull jobs from outbox tables
```

## Edge Functions (16)
| Function | JWT | Purpose |
|---|---|---|
| create-application | yes | Creates/updates an application, locks prices from the database, opens a payment attempt (idempotent). |
| cancel-application, submit-application | yes | Student lifecycle transitions. |
| verify-payment | yes | Student- or admin-triggered re-check with the provider. |
| payment-webhook | no | Monnify callback; verified by HMAC signature (constant-time) and exact amount. |
| upperlink-webhook | no | Only a trigger: re-verifies with the provider before marking anything paid; rate-limited. |
| admin-register | no | Staff sign-up with an access code; rate-limited; account stays pending until an admin approves. |
| admin-delete, admin-settings, admin-sync | yes (admin) | Administration, encrypted provider settings, manual mirror refresh. |
| sheet-sync | service | Drains `sheet_outbox` into the read-only Google Sheet. |
| communication-worker | service | Outbound communication processing. |
| document-issue | yes (admin, finance or service role) | Recovery/retry worker that archives verified per-payment receipts. |
| student-document | yes (owner or service role) | Canonical PDF renderer and private archive, including watermarked admin previews. |
| document-branding | yes (admin) | Publish private letterhead assets and safe-area settings. |
| document-verify | no (public verification) | Public hash-based document verification; no PII exposure. |

Shared code lives in `_shared/`: `lib.ts` (CORS, auth, safe wrapper), `guards.ts` (pure, unit-tested security helpers), `crypto.ts`, `pay.ts`, `documents.ts`, `sync.ts`.

## Data and authorization
- Roles: administrator, registrar, finance, academic, operations, tutor, viewer, plus students. Permissions are rows in `role_permissions`, evaluated by SECURITY DEFINER helper functions inside RLS policies.
- Money state changes only through server code (`mark_paid` style functions, `admin_review_payment`). Students can neither write payments nor change their application status.
- `audit_log` is append-only (immutable trigger). Every administrative action writes to it.
- Outbox pattern: database triggers insert rows into `sheet_outbox` and communication queues; workers claim, process, retry with back-off, and mark failures (`fail_sheet_job`).
- Scheduled jobs: `expire-unpaid` (hourly) and `expire-drafts` (daily) via pg_cron. Worker invocation schedules are created by you; see docs/STEP_BY_STEP_SETUP_GUIDE.md.

## Decisions
- **Mirror, not control plane.** Spreadsheet access is broad and weakly attributable, so it can read but never write authority.
- **Server-side prices.** The client sends course codes; the function reads fees from the database.
- **Static frontend.** No build is needed to deploy; vendored libraries are rebuilt with `npm run build` and verified in CI.
- **Verify, do not trust, provider callbacks.** Signatures where the provider offers them, a callback-then-verify pattern where it does not.

## V18.5 receipt architecture

The `033` migration queues a pending canonical receipt per **verified payment ID**. Payment verification schedules the internal receipt worker, which uses `student-document` to archive a single private PDF and its SHA-256 fingerprint before reporting it issued. Students and administrators use a common PDF endpoint. Administrators save drafts and explicitly publish template revisions; history of previously issued PDFs is immutable; a missing letterhead blocks new official receipts. See [the current release guide](RELEASE_V18_6_1.md) for deployment constraints, testing and rollback.

## Architecture decision records

- [ADR 001: read-only spreadsheet mirror](adr/001-sheet-mirror.md)
- [ADR 002: server-side pricing and provider verification](adr/002-pricing-and-payments.md)
- [ADR 003: outbox-driven delivery](adr/003-outbox.md)
