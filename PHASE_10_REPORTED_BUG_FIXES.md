# Phase 10 — Reported Bug Fixes and Clean Routes

This hotfix addresses the browser/database failures reported during testing of Phase 9.

## Fixes included

- The original hotfix named the `WITH ORDINALITY` output columns. Phase 11 goes further by qualifying the ordinal use as `qi.question_ordinal` in the final assessment and assignment functions, and adds an administrator check that verifies this exact pattern.
- Added `020_reported_bug_fixes.sql`, which backfills missing profile rows from `auth.users`, repairs/validates the `applications.user_id -> profiles.id` foreign key where missing, reloads the PostgREST schema cache, and reasserts the student welcome RPC.
- Removed direct `.catch()` usage on the Supabase RPC builder for `mark_welcomed`; the result is awaited inside a guarded async task so a welcome-marker error cannot crash the application page.
- Added a safely escaped global `esc()` helper to `apply.html` and escaped error text in the setup-problem state.
- Made student and admin sign-out clear the browser's project-scoped Supabase session and navigate to the sign-in route even if the sign-out network request fails.
- Changed in-app page links/redirects to extensionless routes (`/apply`, `/portal`, `/staff-login`, etc.).
- Added clean URL routing rules for Netlify and `cleanUrls` configuration for Vercel.
- Removed nested `applications -> profiles` embeds from the admin screen's queries and joined profile rows by `user_id` client-side, so Applications, Course Additions and Deferments still load even if the live schema cache is stale.
- Updated the admin setup warning and added a regression checklist.

## Deployment sequence

1. Deploy the frontend files in `frontend/` to the existing hosting target.
2. In the Supabase SQL Editor, apply `supabase/migrations/020_reported_bug_fixes.sql` after migrations `001`–`019` have been applied in numerical order. Do not run `020` before its prerequisite migrations.
3. If the SQL raises the explicit orphan-user error, inspect application `user_id` values that have no matching `auth.users` row before retrying. The migration intentionally stops instead of creating invalid relationships.
4. Test the scenarios listed in `tests/REPORTED_BUG_FIXES_TEST_PLAN.md` in staging before production.

## Clean routes

The frontend now uses URLs without `.html` extensions. Netlify rewrites clean paths to the existing static files while redirecting old `.html` URLs to canonical routes. Vercel's `cleanUrls` setting provides the equivalent behavior.

## Limitations

No connection to the live Supabase project was available for this patch, so migration `020` has not been executed against the user's production database. Database and sign-out behavior must be verified in staging with an authenticated test account.


## Follow-on academic integrity

Migration `021_academic_integrity_release_readiness.sql` builds on the Phase 10 fixes. It preserves identifiable historical score components, labels ambiguous records `needs_review`, hides uncertain totals, and adds admin-only release diagnostics. Read `PHASE_11_ACADEMIC_INTEGRITY_RELEASE_READINESS.md` before applying migration 021.
