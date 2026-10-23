# AH STUDENT HUB — Phase 12: Full-System Audit & Release Hardening

## Release objective

Phase 12 reconciles the full SQL migration chain (001–022), addresses repeat-run/syntax problems, reviews privileged-function grants and private academic-file access, aligns the course catalogue with the supplied `courses_rows.csv`, and adds a staging preflight and release gate.

This is a source-code and static-structure audit. **It is not a claim that the SQL has been executed successfully on your Supabase project.** The live database, role grants, Storage policies, PostgREST cache, Edge Functions, payment/email provider responses and Google Sheets sync still require staging tests.

## Confirmed defects and corrections

### 1. `013_phase3_academic_engine.sql` — duplicate Attendance constraint

The three current-model checks are now guarded by `IF NOT EXISTS` checks against `pg_constraint`. That avoids the duplicate-object error if the migration was interrupted after a constraint had already been created. The migration runs in a transaction when pasted into SQL Editor.

**Important:** migration 013 is an older baseline and redefines legacy portal/grading functions. A guard stops the file from replaying if `grading_model` already exists (introduced in migration 021). Do not use 013 as a general repair script after 021 has been installed. Run the corrective forward migration instead.

### 2. `021_academic_integrity_release_readiness.sql` — incomplete function body

The `portal_data()` function was rewritten into smaller, indented JSON expressions to remove the malformed nested aggregate that caused `unexpected end of function definition`. The migration is transaction-wrapped so a syntax/runtime error rolls its changes back as a unit rather than leaving a partial schema.

Student-facing RPC payloads now return numeric score components only after a result is published and its grading model is source-safe. Unpublished results do not leak draft score components, even if the user inspects the RPC response.

### 3. Academic-record integrity

The current grading model is Attendance 40%, CA 30%, Exams 30%; the legacy model used CA, Objective and Practical components. Legacy score data that can no longer be reconstructed safely is marked `needs_review`. Phase 12 never labels an archive snapshot “verified” automatically.

**CAUTION:** on databases where the original 013 migration had already clamped CA before the archive was created, the original CA may no longer be present in the database. Restore it from an original gradebook/export or backup; do not invent a replacement score. Do not publish or reconvert a `needs_review` record until it has been checked by authorized Academic staff.

### 4. Privileged function grants

Migrations 001, 008, 012, 017 and 019, plus the forward migration 022, now explicitly align key grants:

- Student-ID serial allocation is server-only.
- Google Sheets and communication queue claim/complete/fail RPCs are service-role only.
- The raw arbitrary-recipient notification emitter is not callable by browser roles.
- `notify_result_published(uuid)` is treated as an internal publication helper; staff should call the authorization-checked `publish_result(uuid)` instead.
- `is_admin()` retains explicit authenticated execution because RLS policies use it.
- The final hardening migration removes implicit PUBLIC/anon execution from SECURITY DEFINER functions, then explicitly restores authenticated execution for the approved client-facing RPCs and RLS helpers. Internal worker and arbitrary-recipient notification functions remain service-role-only. This explicit-grant restoration is important: an earlier function that relied only on PostgreSQL's default PUBLIC grant would otherwise stop working when PUBLIC access is revoked.

### 5. Storage privacy

Migration 022 replaces broad `mat_read` and `sub_read` SELECT policies with helper functions that scope reads to approved/enrolled students, the owning tutor, the assigned tutor, and authorized Academic/Administrator staff. This is important because permissive RLS policies combine with OR semantics: merely adding a narrower policy does not cancel a broader policy with a different name.

### 6. Catalogue reconciliation

Both a fresh install (001) and an upgraded database (022) use the 18 rows in the user-supplied `courses_rows.csv`: AutoCAD, Graphic Design, Lumion/Animation, ArchiCAD, Revit and SketchUp, each with Beginner/Intermediate/Professional categories and ₦20,000/₦30,000/₦60,000 fees.

The catalogue upsert updates `courses` and deactivates any active course code absent from the supplied CSV (it preserves those old rows and foreign-key history). It intentionally does **not** rewrite `application_courses.fee_ngn`, because that column is a historical price snapshot for a specific application and should not silently alter an existing applicant's invoice.

### 7. Existing reported application defects

The Phase 10 fixes remain in the source: qualified ordinality aliases, `esc()` in `apply.html`, browser/RPC handling, realtime cleanup, session-clearing sign-out, profile retrieval without relying on a nested `applications → profiles` PostgREST embed, and extensionless URLs for Netlify/Vercel.

## Full migration map

| Migration | Main responsibility | Release review focus |
|---|---|---|
| 001 | Core application/profile/course schema, base RLS, Storage and initial jobs | Fresh database only; provider extensions must be available; seed intake/catalog values |
| 002 | Packages and package access | RLS + active package contents |
| 003 | Payment review/status additions | State transitions and ownership |
| 004 | Payment read policies and status/edit support | Student isolation |
| 005 | Atomic payment-claim path and passport access | Auth grants; payment idempotency |
| 006 | Realtime support | Realtime publication configuration |
| 007 | Administrator foundation and staff review | Role bootstrap + admission/payment grants |
| 008 | Roles, permissions, sync status | `has_role`/`is_admin` grants and policy logic |
| 009 | Student/tutor portals and assessment/submission access | Tutor roster scopes; Storage policies later tightened in 022 |
| 010 | Site settings, permissions, payment providers and access codes | Role gates; secret/config handling |
| 011 | Application workflow, admissions, deferments, course additions and admin workflow | Transition rules and staff access |
| 012 | Integrity engine, outbox claims/retries, payment settlement | Service-only worker execution; idempotency |
| 013 | Assessment engine and current score components | Repeat-safe constraints; never replay after 021 |
| 014 | Assessment/assignment validation hardening | Required files/questions, authoritative assessment state |
| 015 | Notifications, documents and activity centre | Own-row visibility and notification actions |
| 016 | Application history, result publication/locking, Student 360 | Publication/locking controls |
| 017 | Event-driven notifications and document registry | Raw notification emitter must stay private |
| 018 | Analytics, document jobs and outbound-communication queues | Staff role checks, job lifecycle |
| 019 | Production worker queue, immutable audit and system health | Service-role grants, retry/lock semantics |
| 020 | Reported bug fixes | Clean routes, `esc()`/cleanup, qualified ordinality, sign-out |
| 021 | Academic-integrity archive, model-aware totals, release readiness | Transactional apply; source-backed result classification; student result privacy |
| 022 | Full-system audit, Storage read hardening, privilege reconciliation, catalogue | RLS, SECURITY DEFINER grants/search paths, worker grants, explicit app-RPC permissions, 18-row catalogue |

## Recommended staging deployment order

1. Back up the staging database and export the existing academic gradebook before making any scoring changes.
2. Deploy a **separate staging frontend** using the staging Supabase URL and anon key.
3. Fresh staging: apply migrations 001–022 once, in numerical order. Do not run the historical migration set twice.
4. Existing staging: inspect which statements actually committed after earlier errors. Reapply the corrected 021 only after checking the schema and data; it is intended to be repeatable. Apply 022 after 021.
5. Do not replay 013 if `public.exam_results.grading_model` exists. It will intentionally stop to protect the newer model-aware formula.
6. Run `tests/phase12_preflight.sql` in Supabase SQL Editor. Resolve every failed check and review every legacy-score warning.
7. Deploy the required `supabase/functions/` Edge Functions and configure provider secrets only in Supabase. Never put service-role/payment/email credentials into `frontend/`.
8. Run `tests/PHASE_12_ACCEPTANCE_PLAN.md`: student, tutor, Academic, Administrator, payments, document jobs, communications, Storage access and Google Sheets mirror.
9. Refresh PostgREST schema metadata if a corrected FK/grant still appears stale: `NOTIFY pgrst, 'reload schema';` (already included at the end of migration 021). Then sign out/in and retest.
10. Promote to production only after the staging SQL runs successfully and real browser/provider/mirror tests pass.

## Known boundaries / remaining operational dependencies

- No direct connection to the user's Supabase database was available during this audit, and no PostgreSQL server/parser is installed in this execution environment. Static lexical checks do not substitute for Postgres executing each migration.
- Payment, mail, SMS/WhatsApp and Google Sheets depend on correctly configured Edge Function secrets/providers and must be tested with real staging responses.
- A catalogue match is not a payment reconciliation: compare existing application price snapshots and provider settlements before modifying real financial records.
- The app intentionally does not mark legacy grades verified based only on the archive. Obtain original source records for affected grades.
- Do not expose audit tables, service-role keys, communication payloads or document storage paths to ordinary students.

## Quality gate

A release is acceptable only when (a) all migrations apply without SQL errors, (b) preflight has no critical failures, (c) each role can perform its approved journeys and is blocked from unauthorized journeys, (d) draft results and private documents remain inaccessible to students who should not see them, (e) all 18 catalogue rows match, (f) payment/webhook idempotency succeeds, and (g) the Google Sheets mirror reconciles to Supabase without duplicated or missing records.
