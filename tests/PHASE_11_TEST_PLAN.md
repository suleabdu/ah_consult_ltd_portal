# Phase 11 — Staging Acceptance Test Plan

Run only in a dedicated staging project with test records. Never use a student grade, real payment, or production personal data as a test fixture.

## A. Migration and database checks

- [ ] Back up staging before applying changes.
- [ ] Confirm migrations 001–020 are present and successful.
- [ ] Apply `021_academic_integrity_release_readiness.sql` in the SQL Editor.
- [ ] Confirm no SQL error occurs; if one does, stop and preserve the full error text and statement location.
- [ ] Run `tests/phase11_release_smoke.sql` as an Administrator.
- [ ] Confirm `submit_assessment` and `submit_assignment` contain `qi.question_ordinal`.
- [ ] Confirm `applications.user_id` has a validated foreign key to `profiles.id` and no orphan profile rows.
- [ ] Confirm `exam_results.total` is model-aware and `grading_model` supports the three expected values.
- [ ] Confirm `audit_log_immutable` is enabled.
- [ ] Confirm the Release Readiness RPC reports a status and individual check details.

## B. Academic data safety

- [ ] Create or identify one known 40/30/30 result. Verify total/band remain unchanged.
- [ ] Identify a legacy result with Objective or Practical values and verify its reconstructed CA + Objective + Practical total is shown as Legacy.
- [ ] Identify or create a zero-attendance/zero-exam ambiguous record. Verify it is labelled Review required and its official `total` and `band` are null.
- [ ] Confirm the legacy archive contains original components and remains available through the authorized archive RPC even if the live result row is deleted in a disposable test fixture.
- [ ] Verify an ordinary student cannot invoke `admin_legacy_result_archive`.
- [ ] Verify a Tutor cannot edit a published or locked result.
- [ ] Verify only Administrator/Academic can reopen a result and that a correction reason of at least 10 characters is required.
- [ ] Reopen a test result, enter all three current-model scores, save, verify it changes to the current grading model, and inspect the audit entry.
- [ ] Verify a tutor cannot save blank score inputs; explicit `0` remains valid.
- [ ] Upload a grade CSV with a missing value, invalid score, wrong student/course pair, and valid row. Confirm invalid rows are skipped and described instead of being converted to zero.

## C. Assessment and application flow

- [ ] Start and submit an exam with mandatory questions; missing mandatory answers are rejected.
- [ ] Start and submit an assignment with a required file link; missing link is rejected.
- [ ] Provide all required answers and links; successful submission is persisted once.
- [ ] Sign in as a new student; welcome-marker failure, if simulated, does not crash the portal.
- [ ] Sign out from Student Portal and confirm the local session is cleared and the browser opens `/apply#signin` instead of looping back to `/portal`.
- [ ] Confirm the application page has no `esc is not defined` or undefined `cleanup()` errors.

## D. Admin and clean routes

- [ ] Test `/apply`, `/portal`, `/tutor`, `/admin-dashboard`, `/student-login`, `/staff-login`, `/forgot-password`, `/reset-password`, `/setup-password`, `/admin-register`, and `/payment-success` without `.html`.
- [ ] Open an old `.html` link and confirm the host redirects to its canonical extensionless path.
- [ ] Confirm Applications, Deferments and Course Additions load with profile names/emails on the admin screen.
- [ ] Confirm Teams & Access lists staff and that role restrictions are respected.
- [ ] Use Student 360 and verify the result model badge is Legacy, Review required, or 40/30/30 as appropriate.
- [ ] Open Release Readiness → Review legacy score archive and confirm it is administrator/academic-only.

## E. External integrations / release gate

- [ ] Verify email provider secrets remain server-side and send a staging test message.
- [ ] Verify communication retry/backoff and dead-letter visibility.
- [ ] Verify the Google Sheets mirror queue completes and records match Supabase for the test records.
- [ ] Verify document render/print and issuance metadata.
- [ ] Capture browser console, Network response body for any 4xx/5xx, and Supabase function/database logs for failures.
- [ ] Do not promote if any critical test fails or any ambiguous academic result remains unreviewed.
