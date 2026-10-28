# Runbook

## Before every release
```
python3 scripts/validate.py                                   # static gate (secrets, links, headers, JS syntax)
cd supabase/functions && deno test --no-check _shared/        # payment parsing and guard unit tests
for d in */; do deno check ${d}index.ts; done                 # type-check (skip _shared)
DATABASE_URL=postgres:///hub_test ./scripts/test-sql.sh       # wipes a LOCAL scratch database, applies 001-025, runs all SQL tests
npm ci && npm run check                                        # release gate + undefined-name lint + all frontend unit/DOM tests
node tests/browser/homepage.browser.mjs                        # optional: real Chromium at 3 screen sizes (see docs/HOMEPAGE.md)
```
`test-sql.sh` refuses hosted Supabase URLs. On a plain Postgres install, run `tests/sql/ci_extension_stubs.sh` once first (stubs for pg_cron and pg_net). CI does all of this on every push.

## Deploying
1. Merge to `main` (CI green). Vercel deploys the frontend automatically.
2. New migrations: `supabase db push` after reviewing the SQL. **Never edit an applied migration;** add a new numbered file.
3. Functions: `./scripts/deploy-functions.sh`.

## Rebuilding vendored assets
`npm ci && npm run build` regenerates `frontend/vendor/*`. CI fails if the committed files differ from a clean build.

## Incident quick reference
| Symptom | First checks |
|---|---|
| Student paid but still "pending" | Admin Dashboard > Payments > Verify; provider dashboard; function logs for `payment-webhook` / `upperlink-webhook`. |
| Sheet not updating | `sheet_outbox` rows with attempts > 0 and `last_error`; confirm the service account is still an editor; function logs for `sheet-sync`. |
| Browser CORS errors | `ALLOWED_ORIGINS` includes the exact Vercel origin (scheme + host, no trailing slash). |
| Staff locked out of registering | Rate limit: 10 attempts per IP per hour. Clear with `delete from rate_limits where key like 'adminreg:%'` (service role). |
| Suspected key leak | Rotate per SECURITY.md, redeploy functions, review `audit_log`. |

## Migration history note
Migrations 021 and 022 contain consolidated repair logic for earlier drift. Always start new environments from 001 and apply all files in order; do not replay individual old migrations on an existing database.

## Local frontend testing
Fill `LOCAL` in `frontend/js/config.js` with a separate staging project before opening pages from disk; otherwise local pages talk to the live project.
