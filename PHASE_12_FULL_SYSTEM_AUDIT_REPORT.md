# AH STUDENT HUB — Phase 12 Full-System Audit Report

**Release reviewed:** Supabase-backed AH STUDENT HUB, migrations 001–022  
**Review type:** source-code, SQL-structure, permissions, frontend, route, catalog and packaging audit  
**Status:** Static checks pass; **production deployment is not certified until staging PostgreSQL and end-to-end tests pass**.

## Executive summary

The audit fixed the two reported SQL failures and found additional permission and data-access problems that could have remained hidden after those syntax repairs. The current Phase 12 source includes the fixes below, a forward migration (022), a runtime admin audit RPC, a read-only staging preflight, a test plan and a corrected current-release guide.

Static validation completed with **50 Phase 12 checks passed, 0 failed**. The separate Phase 11 regression suite completed with **29 passed, 0 failed**. An independent signature check matched all **68 explicit grants in migration 022** to declared function signatures, and all **51 RPC names found in frontend assets** have explicit grants in migration 022. These are source checks; they do not execute PostgreSQL or prove the live Supabase project is configured correctly.

## Findings and applied fixes

### Critical — repeat-running migration 013

**Cause:** the grading check constraints could be added again, raising duplicate-object SQLSTATE `42710` if a prior run had already created one.  
**Applied fix:** the `exam_results_attendance_check`, `exam_results_ca_30_check` and `exam_results_exams_30_check` constraints are added only when absent, and the migration is wrapped in a transaction. Old legacy constraints are dropped by name if present. A guard prevents the historical Phase 3 baseline from being replayed after the newer `grading_model` schema has been introduced; replaying all of 013 after 021 could otherwise replace model-aware functions/columns with older definitions.

**Operational rule:** for an existing project, do not blindly replay 013. If `exam_results.grading_model` exists, use the corrected 021/022 release repairs after inspecting the actual schema. For a disposable fresh database, apply the migration chain once in numerical order.

### Critical — migration 021 failed parsing near `end $$;`

**Cause:** the previous `portal_data()` expression had a malformed nested course/result JSON expression that prevented PostgreSQL from completing the PL/pgSQL function definition.  
**Applied fix:** `portal_data()` is rewritten with clearly separated JSON aggregation scopes, consistent aliases, explicit closures, a pinned `search_path`, and a transaction around the migration. The nested course-result object returns numeric score fields only for published records whose grading model is not `needs_review`.

### Critical — implicit function permissions could break after security hardening

**Cause found during audit:** revoking PostgreSQL's default `PUBLIC EXECUTE` from every `SECURITY DEFINER` function can unintentionally break legitimate browser RPCs and RLS helpers that previously relied on that default grant.  
**Applied fix:** migration 022 revokes PUBLIC/anon execution from public-schema definer functions, forces `search_path = public, pg_temp`, then explicitly grants the intended frontend RPCs and RLS helpers to `authenticated`. Server worker primitives, student-ID allocation and the raw arbitrary-recipient notification emitter stay service-role-only; internal `notify_result_published` stays unavailable as a direct browser RPC.

### Critical — published-result privacy

**Cause found during audit:** the student portal's visual “Not published” label is not a security control if the RPC payload still includes score components.  
**Applied fix:** student-facing RPC output suppresses numeric score components for unpublished and `needs_review` results. The admin/tutor workflow retains the information necessary for review while students do not receive unpublished numeric scores in the portal result payload.

### High — private academic Storage access was too broad

**Cause found during audit:** older `mat_read`/`sub_read` policies permitted broader authenticated access. Storage policies are permissive-OR, so adding a narrower policy does not neutralize an older broad policy.  
**Applied fix:** migration 022 drops and recreates those read policies through helper functions that scope files to enrolled students, the file-owning tutor/assigned tutor, and authorized Academic/Administrator staff.

### High — privileged notification and background job functions

**Cause found during audit:** arbitrary-recipient notification emission and job claim/complete/fail functions needed tighter role grants.  
**Applied fix:** the raw notification emitter and queue worker functions are restricted to `service_role`. `notify_result_published(uuid)` is treated as an internal helper; authorized staff go through `publish_result(uuid)`, which enforces its publication workflow.

### Medium — catalog drift against the supplied file

**Cause found during audit:** the active catalog in the older seed differed from the uploaded `courses_rows.csv`.  
**Applied fix:** fresh-install seed 001 and forward reconciliation 022 both define these 18 active combinations:

| Course | Categories | Fees |
|---|---|---:|
| AutoCAD | Beginner / Intermediate / Professional | ₦20,000 / ₦30,000 / ₦60,000 |
| Graphic Design | Beginner / Intermediate / Professional | ₦20,000 / ₦30,000 / ₦60,000 |
| Lumion/Animation | Beginner / Intermediate / Professional | ₦20,000 / ₦30,000 / ₦60,000 |
| ArchiCAD | Beginner / Intermediate / Professional | ₦20,000 / ₦30,000 / ₦60,000 |
| Revit | Beginner / Intermediate / Professional | ₦20,000 / ₦30,000 / ₦60,000 |
| SketchUp | Beginner / Intermediate / Professional | ₦20,000 / ₦30,000 / ₦60,000 |

Other active codes absent from the authoritative list are deactivated rather than deleted. Existing `application_courses.fee_ngn` values are preserved because they are historical applicant price snapshots.

### Previously reported frontend defects retained in the regression suite

- Qualified assessment/assignment ordinality (`ord`) aliases.
- Student sign-out clears the project-scoped local token and returns to sign-in rather than looping to the portal.
- Application `esc()` and cleanup helpers are present.
- The Supabase RPC call does not assume that the query builder's return value is a native Promise.
- Netlify and Vercel canonical extensionless URLs are configured, and internal href/redirect targets do not directly expose `.html`.
- Release readiness status updates expose accessible live status/busy state.

## Migration-by-migration audit scope

All 22 migrations were scanned for SQL lexical structure (quotes, parentheses, comments and dollar-quoted bodies), function definitions/grants, repeated constraint creation, catalog rows, search-path declarations and migration order. Migration 022 additionally contains a runtime `system_audit_snapshot()` diagnostic for the actual database: RLS, fixed paths for security-definer functions, direct PUBLIC/anon execute, expected constraints, question indexing, student result privacy, audit immutability, worker grants, Storage read policies, the profile relationship and course catalog consistency.

The included `tests/phase12_preflight.sql` checks structural state from SQL Editor. The admin UI invokes the role-gated runtime snapshot using a signed-in Administrator/Academic account; SQL Editor alone cannot reproduce every authenticated user journey.

## Deployment order and rollback posture

1. Export the current database/grade data and payment reconciliation evidence. Do not attempt to reconstruct historical grades from guesswork.
2. On a **fresh staging database**, apply migrations 001–022 once in numerical order.
3. On an **existing staging database**, inspect which statements committed after the previous SQL Editor errors. Apply corrected 021 only after checking the current `exam_results` columns/constraints, then apply 022. Do not re-run 001–020 wholesale.
4. Run `tests/phase12_preflight.sql` and the administrator Release Readiness snapshot. Investigate every failed check and every `needs_review` record.
5. Run `tests/PHASE_12_ACCEPTANCE_PLAN.md` across Student, Tutor, Academic, Administrator, Finance and Registrar roles. Check Storage isolation using two different student accounts.
6. Test payment webhooks, email/SMS/WhatsApp and the Google Sheets mirror against staging/sandbox providers and stable IDs.
7. Promote only after the database migrations execute successfully and all critical end-to-end checks pass.

## Remaining limitations

- No live connection to the user's Supabase project was available. No PostgreSQL server or PostgreSQL parser was available in this execution environment; SQL was statically inspected, not executed. The first staging application of 021/022 remains the definitive syntax/runtime test.
- This is not a proof that production credentials, provider webhooks, scheduled workers, Supabase Auth settings or deployment-host rewrites are configured correctly; these require staging execution.
- Legacy score records flagged `needs_review` must be checked against the original gradebook/export before their numbers are treated as authoritative.
- Catalog reconciliation changes course master rows only; it intentionally does not rewrite the amount stored against an already-created application.

## Release recommendation

**Proceed to staging, not directly to production.** Phase 12 closes the known source defects and adds diagnostics to discover live-schema problems. Production approval should be a separate recorded decision made only after the migrations and acceptance plan pass in the staging project.
