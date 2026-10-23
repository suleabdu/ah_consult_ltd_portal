# Reported Bug Fixes — Regression Test Plan

Apply migrations `001` through `020` in numeric order to a staging Supabase project before testing.

## Database
1. Run `020_reported_bug_fixes.sql`; confirm it completes without FK/orphan errors.
2. Confirm the `applications.user_id -> profiles.id` foreign key exists and PostgREST schema cache reload has completed.
3. Start and submit an exam with a question set; confirm no `column "ord" does not exist` error.
4. Submit an assignment with mandatory and file-required questions; confirm validation works and no `ord` error appears.
5. Sign in as an admitted student and confirm `mark_welcomed` returns without a 422 response.

## Student application and sign-out
1. Open `/apply` and verify the page and all script/style assets load.
2. Create account / sign in; confirm no `ReferenceError: esc is not defined`.
3. As a newly admitted student, open `/apply`; confirm the welcome status is rendered and the Student Portal link works.
4. Click Sign out from `/portal`; verify the browser lands on `/apply#signin` with no authenticated session.
5. Sign in as a returning admitted student; verify it routes to `/portal` only when authenticated and not when signing out.

## Admin
1. Sign in as an administrator; Applications should populate.
2. Confirm Deferments and Course Additions load without an `applications`/`profiles` relationship error.
3. Open Team & Access; verify staff records/actions are visible for an administrator.
4. Check the warning area; the relationship-cache errors should be gone.

## Clean URLs
1. `/apply.html` redirects to `/apply`.
2. `/portal.html` redirects to `/portal`.
3. `/staff-login.html` redirects to `/staff-login`.
4. Confirm extensionless routes work on the selected deployment host (Netlify or Vercel).
