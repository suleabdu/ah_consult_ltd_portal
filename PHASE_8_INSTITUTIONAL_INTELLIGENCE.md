# AH STUDENT HUB — Phase 8: Institutional Intelligence & Document Automation

Phase 8 turns the platform from a collection of dashboards into an operational command centre.

## What was added

### 1. Student 360°
- Staff can search students by student ID, name, email or phone.
- A single operational profile shows:
  - admission/application state
  - payment information
  - registered courses
  - published/unpublished results
  - documents
  - notifications
  - application lifecycle timeline
- The global admin search now opens Student 360 directly.

### 2. Management Intelligence
- Applications and admissions KPIs.
- Verified payment count and value.
- Approved student count.
- Active course/lecturer counts.
- Result publication metrics.
- Google Sheets queue health.
- Breakdown by intake, application status, course and result band.

### 3. Document Automation Architecture
- `document_templates` defines institutional document types and versions.
- `document_jobs` records generation/issuance requests.
- Standard print-ready documents are available for:
  - Admission Letter
  - Payment Receipt
  - Academic Transcript
  - Certificate of Completion
- The current implementation intentionally uses browser print / Save as PDF rather than pretending a server-side PDF engine exists.
- Issued documents are registered in the existing Student Documents centre.
- A future server-side PDF adapter can replace browser printing without changing the institutional workflow.

### 4. Communication Outbox
`communication_outbox` provides a provider-neutral queue for:
- Email
- SMS
- WhatsApp

It stores recipient, message, provider, attempts, retry state and provider message ID. No external provider credentials are hard-coded into the migration.

### 5. Audit Centre
- Administrator-only operational audit history.
- Filters and displays action, target, actor, timestamp and note.
- Covers existing and new institutional operations such as documents.

### 6. Google Sheets Reconciliation
- Supabase remains the source of truth.
- The dashboard exposes database application count, pending mirror jobs, failed jobs, completed jobs and last successful/error timestamps.
- A full mirror refresh can be queued through the existing authoritative resync function.
- The UI does not silently overwrite Supabase data to make the Sheet appear correct.

### 7. Security hardening
- New security-definer functions use an explicit `search_path`.
- Browser users do not receive direct write privileges for documents or communications.
- Operational functions enforce staff roles at the database layer.
- The original `handle_new_user` trigger is recreated with an explicit `public` search path.

## Important deployment note

No live Supabase project has been executed from this build environment. Apply migration `018_institutional_intelligence.sql` after migrations `001` through `017` in staging first.

Recommended staging acceptance sequence:

1. Apply migration 018.
2. Sign in as Administrator.
3. Open **Institutional Intelligence**.
4. Search and open a real student in **Student 360°**.
5. Open each document type and test **Print / Save as PDF**.
6. Mark one test document as issued and verify it appears in the student's Documents area.
7. Check **Audit Centre** and confirm document actions are logged.
8. Check **Sheets Reconciliation** and verify queue counts match the current sync state.
9. Test each staff role against the Student 360 and Intelligence permissions.
10. Test the communication queue function only after the intended email/SMS/WhatsApp provider adapters are configured.

## Next production layer

The next recommended layer is **Phase 9 — Production Automation & Governance**:
- server-side PDF generation and signed document URLs
- email provider integration
- WhatsApp/SMS provider adapters
- scheduled communication worker
- automated document issuance rules
- finance reconciliation dashboard
- academic performance analytics
- system health/uptime dashboard
- immutable audit export
- final RLS/storage/security review
- end-to-end staging test suite
