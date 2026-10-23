> **Superseded release note:** Phase 12 is the current release path. See `PHASE_12_SYSTEM_AUDIT_AND_RELEASE_HARDENING.md` and follow migrations 001–022 in the documented fresh-install/existing-install order. This file describes Phase 11 only.

# Phase 11 — Academic Integrity & Release Readiness

## Scope

Phase 11 follows the reported-issue hotfix in migration `020_reported_bug_fixes.sql`. It reconciles historical grading records, hardens assessment question indexing, exposes an administrator/Academic Coordinator release readiness report, and provides an audit view of archived legacy scoring components.

## What changed

### 1. Explicit assessment question indexing

The `submit_assessment` and `submit_assignment` functions use a named, qualified `WITH ORDINALITY` output (`qi.question_json`, `qi.question_ordinal`). This removes ambiguous/unqualified ordinal references that were implicated in the reported `column "ord" does not exist` error.

### 2. Model-aware academic results

The database supports three result models:

- `attendance_ca_exams_40_30_30`: current model; Attendance 0–40, CA 0–30, Exams 0–30.
- `legacy_ca_exam_obj_prac`: identifiable historical CA + Objective + Practical records; their historic component total remains visible.
- `needs_review`: records whose old/new component values cannot be safely classified. Generated `total` and `band` are intentionally `NULL`, rather than publishing an invented total.

Legacy source components are copied into `legacy_exam_results_archive`. The archive has no cascading foreign key to live results, so its snapshot can survive deletion of the current result row. Direct access is revoked; the `admin_legacy_result_archive` RPC exposes a bounded read-only view only to Administrators and Academic Coordinators.

When a tutor saves a legacy/review-needed record, all three current-model scores must be explicitly entered. The database switches the record to the new grading model and writes an audit entry including the previous model and legacy component details. Published/locked results still require an authorized reopen action first.

**Important data caveat:** migration `013` already capped legacy CA values at 30 in the live `exam_results` table. Phase 11 archives the values that exist immediately before its own change; it cannot recover values that an earlier migration already altered. If you have source spreadsheets with original scores, preserve them as independent records before reconciling historical results.

### 3. Student, tutor and administrator UI

- Tutor grading identifies legacy and ambiguous records, requires explicit score entry, validates bulk spreadsheet values, and asks for confirmation before the bulk import converts historical records.
- Student results label legacy grading and show “Review required” where the model is ambiguous; those uncertain totals are not shown as grades.
- Student-facing RPCs now return numeric result components only when a result is published. A hidden UI label is not treated as data security; unpublished score components are withheld in the database payload itself.
- Student Home receives the `published`/`locked` result markers required to filter its “Latest results” section correctly.
- Student 360 labels grading models clearly.
- Release Readiness reports schema/profile integrity, ordinal indexing, grading compatibility, legacy/review counts, append-only audit status, and queue backlogs.
- The Release Readiness view offers Administrators and Academic Coordinators authorized review of archived legacy result components.

### 4. Staging diagnostics

`release_readiness_snapshot()` is restricted to Administrators and Academic Coordinators and returns overall status, actionable checks and aggregate queue/result metrics. A “ready” result is useful evidence, but is not a substitute for testing authenticated user journeys, storage permissions, the deployed Edge Functions, and real payment/email/Sheet provider responses in staging.

## Deployment order

1. Take a database backup and preserve the raw legacy results source files.
2. Use a dedicated Supabase staging project.
3. Apply migrations `001` through `021` in numerical order. Do not cherry-pick migration 021 in front of 020.
4. Deploy the `frontend/` contents to the current static host. Keep `js/config.js` pointed at staging while testing; its anon key is public but it selects the project that the page talks to.
5. Sign in as each test role, open Admin → Release Readiness, run checks, and review any `needs_review` academic records before production.
6. Run `tests/phase11_release_smoke.sql` as an authorized staging administrator, then complete `tests/PHASE_11_TEST_PLAN.md`.
7. Promote only after all critical scenarios pass and the final RLS/security review is signed off.

## Verified in this package

- Frontend external and inline JavaScript syntax checks.
- Backend Python syntax checks.
- Continuous migration numbering through 021.
- Netlify and Vercel extensionless-route configuration checks.
- Static frontend scan for known service-role/private-key markers.
- ZIP integrity.

## Not verified here

The migration has **not** been executed against your live Supabase database. No PostgreSQL server was available in this workspace, so database-level correctness still needs staging execution. Provider delivery, RLS behavior, schema-cache refresh, and the exact original HTTP 422 response must also be tested in the deployed environment.
