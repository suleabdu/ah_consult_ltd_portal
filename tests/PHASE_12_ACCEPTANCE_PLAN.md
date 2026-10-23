# Phase 12 — Staging Acceptance Plan

Run this only against a dedicated staging Supabase project with a recent backup/export. Do not run destructive or high-volume tests against production data.

## A. Database / migration integrity

- [ ] Fresh staging accepts migrations 001–022 in order, with no SQL errors.
- [ ] Corrected 013 creates its three score constraints once; a second attempt before migration 021 does not fail with duplicate constraint. Do **not** replay 013 after `grading_model` exists.
- [ ] Corrected 021 compiles `portal_data()`, `student_academic_record(uuid)`, `published_student_results(uuid)` and release checks successfully.
- [ ] Migration 021 is atomic: force a deliberate error only in a disposable database and confirm the transaction rolls back as expected.
- [ ] Migration 022 completes and can safely be re-applied to the same staging database.
- [ ] Refresh PostgREST metadata; admin Applications/deferments/course-additions load without relationship-cache errors.
- [ ] Run `tests/phase12_preflight.sql`; investigate every failure rather than hiding it.

## B. Course catalogue / financial integrity

- [ ] Exactly 18 active catalogue rows exist and code/name/category/fee match `courses_rows.csv`.
- [ ] Existing `application_courses.fee_ngn` snapshots do not silently change when course master fees are aligned.
- [ ] New application totals use the correct selected courses and authoritative fees.
- [ ] Payment initiation is idempotent for repeated clicks/retries.
- [ ] Invalid, duplicate, underpaid and wrong-reference payment webhooks are rejected or held for review.
- [ ] Verified payments are reflected consistently in Supabase and the Google Sheets mirror.

## C. Identity, permissions and role flows

- [ ] Student login, first login, refresh, sign-out and signed-out deep links all behave correctly.
- [ ] Tutor login routes to tutor portal and cannot access another tutor's course/student records.
- [ ] Administrator can use team/access, audit, sync, System Health and Release Readiness.
- [ ] Academic Coordinator can use authorized academic/result and release diagnostics but cannot manage administrator team/access unless explicitly granted.
- [ ] Finance/Registrar/Operations/Viewer capabilities align with the configured permission matrix.
- [ ] Ordinary authenticated and anonymous users cannot execute worker claim/complete/fail RPCs, student-ID allocation, or raw notification emission.

## D. Result integrity and privacy

- [ ] Tutors save Attendance (0–40), CA (0–30), and Exams (0–30); blank or out-of-range values are rejected rather than silently set to zero.
- [ ] A tutor cannot edit published/locked results without the authorized correction workflow.
- [ ] Student RPC payloads omit numeric components for draft/unpublished results.
- [ ] `needs_review` records expose no invented numeric total/band in student views.
- [ ] Legacy CA/Objective/Practical results match an original gradebook/export before anyone marks them source-verified or republishes them.
- [ ] Result publish creates one notification event; retries do not create duplicate notifications.

## E. Files and documents

- [ ] Student A cannot download Student B's passport, assignment submission or course material for a course they are not enrolled in.
- [ ] A tutor can access submissions only for assigned courses; Academic/Administrator access is according to policy.
- [ ] Storage paths use the project format `{auth.uid()}/...`; signed URLs expire and are not written to public logs.
- [ ] Admission letters, receipts, transcripts and certificates use authoritative data and correct student identity; verify against a sample before issuing a real document.

## F. Admin usability / routing

- [ ] `/apply`, `/portal`, `/tutor`, `/admin-dashboard` and all other internal paths work without `.html` in the URL on the deployed host.
- [ ] Legacy `.html` routes redirect to canonical extensionless URLs; no redirect loop occurs.
- [ ] Student application stages work on phone-sized and desktop viewports; validation errors are clear and accessible.
- [ ] Admin Applications, Teams & Access, deferments, course additions and Student 360 render when records are empty and when records exist.
- [ ] Error states distinguish permission/setup/database errors from genuinely empty records.
- [ ] Release Readiness displays both operational and structural checks with a usable timestamp and clear status labels.

## G. Background work / integrations

- [ ] Google Sheets worker can claim, complete and retry jobs under `service_role` only.
- [ ] Communication worker can claim, complete and retry email/SMS/WhatsApp jobs under `service_role` only.
- [ ] Provider failures record a safe error, apply backoff and do not expose credentials or sensitive payloads.
- [ ] Run a test against the configured payment provider in sandbox mode.
- [ ] Send a real staging email; test SMS/WhatsApp only after the actual providers and consent/preferences are configured.
- [ ] Compare the full coordinator/student/application data sets between Supabase and Google Sheets by stable IDs, not just row counts. Confirm no missing or duplicated records.

## Exit criteria

Release is blocked by any migration failure, public execute exposure of a privileged RPC, RLS/Storage overexposure, incorrect course fee, student draft-score leak, unresolved grade presented as authoritative, or unexplained Supabase/Sheets mismatch. Record test date, environment, tester, result and evidence for every check.
