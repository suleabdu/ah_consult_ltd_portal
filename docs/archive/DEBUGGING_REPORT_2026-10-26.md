# AHCT SMS Hub — Debugging report (26 October 2026)

This report maps the reported symptoms to changes in this v17 debug package. Live Supabase, payment providers and Google Sheets cannot be verified from the local source package alone.

## Fixes applied

1. **`homepage_test.sql` reported one failed test.** The test asserted `count(*) = 5` across the entire `applications` table. That only works on a blank database and fails as soon as real applications exist. The assertion now counts only the four fixture users in the two named test intakes. On failure, the SQL raises an exception containing the failed test names, rather than only a count.
2. **`security_posture.sql` flagged `public_homepage_metrics()`.** The Phase 16 homepage calls `public_impact_stats()`, while an already-deployed v17 homepage may still call `public_homepage_metrics()`. Removing it outright could break that deployed homepage. Migration `027_secure_public_homepage_metrics.sql` therefore retains it as a compatibility RPC, aligns its counting rules with `public_impact_stats()`, pins `search_path`, and returns aggregate values only. The security test now explicitly allow-lists both reviewed aggregate-only functions. After migration 027, `inspect_public_functions.sql` may show both functions as `SECURITY DEFINER`; that is expected, provided both return only the tested aggregate keys and remain pinned to `search_path=public, pg_temp`.
3. **Payment-stage JavaScript exception.** `apply.html` now checks that the Back/Continue elements exist before attaching click handlers. Payment and confirmation stages do not render the Continue button, so assigning `onclick` directly to `null` caused the reported exception.
4. **Local `/admin-dashboard` returned 404.** The old runner was Python's plain static server, which does not apply Vercel rewrites. `scripts/local_server.py` now maps the clean URLs from `frontend/vercel.json` to their `.html` files. Both shell and PowerShell local-run scripts use this server.
5. **`supabase_stub.sql` produced `permission denied for schema auth`.** This file creates Supabase stand-in schemas and tables only for vanilla local PostgreSQL. It must not be executed in hosted Supabase because `auth.users`, `auth.uid()` and storage are managed platform objects. A guard now stops with an explicit explanation. For the real project, apply migrations only; for a clean local Supabase stack, use `supabase db reset`.

## Reports that are not defects by themselves

- **`sheet-sync?check=1` returns `UNAUTHORIZED_NO_AUTH_HEADER`.** That is the intended result for a direct browser URL request with no `Authorization` header. `sheet-sync` is a protected worker. Use the authenticated Admin Dashboard → Team & Access → Sync now/Reconcile controls, or the Sheets Reconciliation view. Never put a service-role key in a browser URL or public frontend.
- **`content.js` reports that `unload` is not allowed.** `content.js` is not a file in this repository. This warning is typically injected by a browser extension or other page instrumentation. Test in a clean/incognito profile with extensions disabled to confirm. It is separate from the portal exception in `apply.html`.
- **`has_sync_health = true`** confirms that the checked object exists; it does not prove that the sync job ran successfully.
- **`sheet_pending = 1`** means at least one Sheet outbox job was pending at the time of the query. It is not a security failure, but reconciliation is not fully caught up until the queue is processed. Check the admin dashboard's sync view and worker logs.
- **`phase12_preflight.sql`** prints a summary sentence. That sentence alone does not prove preflight passed; inspect the result sets from its earlier queries for unexpected privileges, RLS gaps and security-definer functions.

## Recommended verification sequence

1. Back up production and apply migrations through `027` in staging first. If Supabase's remote migration history already records migration `026`, keep the matching `026_public_homepage_metrics.sql` file; apply only the new `027` cleanup to that existing project.
2. Run `tests/sql/inspect_public_functions.sql` query 1 separately. `public_homepage_metrics()` and `public_impact_stats()` are intentionally public, pinned to a safe `search_path`, and return aggregate fields only. The tests verify their allowed output keys and value types.
3. Run `tests/sql/security_posture.sql` and `tests/sql/homepage_test.sql`. The latter is transactional and rolls its test fixtures back; do not remove the `ROLLBACK`.
4. Start local frontend with `bash scripts/run-local.sh` or `scripts\\run-local.ps1`; visit `/`, `/apply`, and `/admin-dashboard` without `.html`.
5. At the payment stage, confirm no `Cannot set properties of null` exception appears. Test the payment flow with provider sandbox credentials, not a real charge.
6. In the signed-in admin dashboard, run Sheet sync/reconciliation and wait for pending work to clear; investigate failed jobs or `last_error` before production sign-off.

## Environment-dependent checks still required

The package does not have access to your live Supabase project, JWTs, payment sandbox, Google service account or the actual Google Sheet. Therefore the database migrations, permissions, provider webhooks, real sync and production deployment must still be verified in staging. Do not regard this report as a claim that live integration tests have been performed.

To test the protected diagnostic endpoint from a shell, use `scripts/check-sheet-sync.sh` (macOS/Linux) or `scripts/check-sheet-sync.ps1` (PowerShell) with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `ADMIN_ACCESS_TOKEN` set to a current session access token for an approved administrator. Do not use the public anon key as the bearer token; do not use or disclose the service-role key in a browser. The admin access token is short-lived and the function still checks the user's approved administrator role.
