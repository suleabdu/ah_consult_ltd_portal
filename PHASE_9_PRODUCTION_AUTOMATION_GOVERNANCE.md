# AH STUDENT HUB — Phase 9: Production Automation & Governance

Phase 9 hardens the institutional operating layer and moves recurring work toward controlled automation.

## 1. Database migration

Apply, in order, through `019_production_automation_governance.sql` after migrations 001–018.

New controls include:
- append-only `audit_log`
- document template version registry
- document job template snapshots
- document generated/issued actor tracking
- student communication preferences
- idempotent email/SMS/WhatsApp outbox creation
- atomic communication worker claim/complete/fail functions
- system health snapshot RPC

## 2. Edge Functions

Deploy:

```bash
supabase functions deploy document-render
supabase functions deploy communication-worker
```

`document-render` is browser-authenticated and renders the authoritative document HTML from server-side data. The browser can use **Print → Save as PDF** without exposing service-role credentials.

`communication-worker` is service-role protected and must never be called directly by the public browser.

## 3. Communication provider secrets

For email via Resend:

```bash
supabase secrets set RESEND_API_KEY=...
supabase secrets set RESEND_FROM_EMAIL="AH Consult Ltd <noreply@yourdomain.example>"
```

For an SMS provider adapter:

```bash
supabase secrets set SMS_PROVIDER_URL=...
supabase secrets set SMS_PROVIDER_TOKEN=...
```

For WhatsApp:

```bash
supabase secrets set WHATSAPP_PROVIDER_URL=...
supabase secrets set WHATSAPP_PROVIDER_TOKEN=...
```

The SMS and WhatsApp endpoints intentionally use a provider-neutral JSON contract so the institution is not locked to one vendor.

## 4. Run the communication worker

The worker should be invoked from a trusted scheduler, not from a public page. A 1–5 minute cadence is appropriate for normal institutional notifications.

The request must contain:

`Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`

Do not place the service-role key in frontend JavaScript, GitHub, URLs, or browser storage.

## 5. Document lifecycle

1. Authorized staff requests a document.
2. The database snapshots the exact template version used.
3. `document-render` reads authoritative student/application/academic/payment data.
4. The administrator uses browser Print → Save as PDF.
5. The document job is marked issued and registered in `student_documents`.
6. The audit log records the request and issuance.

This phase deliberately does **not** pretend that browser printing is a server-side PDF archive. A future PDF provider can consume the same document job and write a permanent file URL into `document_jobs.file_path`.

## 6. Recommended production test sequence

### Database
- Apply migration 019 in staging.
- Confirm audit rows cannot be updated/deleted by authenticated users.
- Create a test notification and confirm only enabled communication channels are queued.
- Confirm duplicate notification insertion does not create duplicate channel jobs.
- Claim a communication job twice concurrently and verify only one worker receives it.

### Documents
- Generate all four document types.
- Confirm the rendered document reflects current authoritative data.
- Confirm a generated job records `generated_by`.
- Confirm issuance creates/updates the corresponding `student_documents` record.
- Confirm audit events are created.

### Security
- Attempt direct `insert/update/delete` against `communication_outbox` as an authenticated user: it must fail.
- Attempt direct document job creation: it must fail.
- Attempt `document-render` without a staff JWT: it must fail.
- Attempt `communication-worker` with anon/user JWT: it must fail.
- Confirm no service-role secret exists in frontend files.

### Operations
- Verify the System Health page.
- Verify Google Sheets remains a mirror and Supabase remains the source of truth.
- Verify failed Sheet jobs and communication jobs are visible for investigation.

## 7. Production governance decision

AH STUDENT HUB should now treat:

**Supabase → source of truth**

**Google Sheets → operational mirror/reporting layer**

**student_notifications → in-app communication record**

**communication_outbox → external delivery queue**

**document_jobs → controlled institutional document workflow**

**audit_log → append-only governance trail**

This separation prevents operational convenience tools such as Google Sheets or WhatsApp from becoming competing databases.
