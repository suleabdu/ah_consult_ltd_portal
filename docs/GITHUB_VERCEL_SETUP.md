# AH STUDENT HUB — GitHub + Vercel + Supabase Release Setup

This is the **current Supabase edition** deployment path. The `backend/` Flask/Google-Sheets code is a legacy compatibility track and is not required for the current student/tutor/admin portals.

## 1. What is the source of truth?

- **Supabase Auth + PostgreSQL** = authoritative application database.
- **Supabase Edge Functions** = privileged server-side operations, payments, administration and Google Sheets synchronization.
- **Google Sheets** = reporting mirror, not the primary database.
- **GitHub** = source-control repository.
- **Vercel** = static frontend hosting and clean URL rewrites.

## 2. Local/offline smoke test

### Windows PowerShell

```powershell
Set-Location frontend
python -m http.server 8888
```

Open `http://localhost:8888`.

### macOS/Linux

```bash
./scripts/run-local.sh
```

The local server is intentionally simple: it verifies the static package, route files and frontend assets. Real authentication/payment/database behavior still requires a Supabase environment.

Run the release gates before deployment:

```bash
python3 scripts/phase13_frontend_audit.py
python3 scripts/phase14_release_gate.py
```

## 3. Create the GitHub repository

Create an empty repository, then from the extracted project root:

```bash
git init
git branch -M main
git add .
git commit -m "AH Student Hub release"
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

Never commit:

- service-role keys
- Google service-account JSON
- OAuth refresh tokens
- payment secrets
- `.env` files

The repository `.gitignore` already excludes the sensitive file classes used by this project.

## 4. Prepare Supabase

Use a **separate staging Supabase project first**.

Apply migrations `001` through `023` in order. For an existing project, inspect its current migration state before applying anything; do not blindly replay old migrations.

Then deploy the Edge Functions from `supabase/functions/` using the Supabase CLI.

The functions use the Supabase-provided values automatically:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Additional secrets are only required for the features that use them.

## 5. Required/optional Edge Function secrets

### Core hardening

```text
ALLOWED_ORIGINS=https://YOUR-VERCEL-DOMAIN.vercel.app
ALLOW_LOCALHOST=true
```

After local testing is finished, production can set `ALLOW_LOCALHOST=false`.

### Google Sheets synchronization

```text
SHEET_ID=your_google_sheet_id
SHEET_TAB=Online Applications
ADMIN_TAB=Admin Registrations
GOOGLE_SERVICE_ACCOUNT_B64=base64_of_service_account_json
```

Use the base64 form rather than manually editing JSON into an environment-variable field.

### Payment

Use the Admin payment settings where supported. If environment-based payment configuration is retained, use the corresponding `MONNIFY_*` or manual `BANK_*` values described in the function source.

For first staging tests, prefer a payment sandbox/test mode.

### Communication worker

Only if email/SMS/WhatsApp automation is being enabled:

```text
RESEND_API_KEY=...
RESEND_FROM_EMAIL=...
SMS_PROVIDER_URL=...
SMS_PROVIDER_TOKEN=...
WHATSAPP_PROVIDER_URL=...
WHATSAPP_PROVIDER_TOKEN=...
```

## 6. Deploy the frontend to Vercel

Import the GitHub repository into Vercel.

Set the project root to:

```text
frontend
```

No frontend build command is required; this is a static site.

The repository already contains `frontend/vercel.json`, including rewrites such as:

```text
/apply -> /apply.html
/student-login -> /student-login.html
/staff-login -> /staff-login.html
/portal -> /portal.html
/admin-dashboard -> /admin-dashboard.html
/tutor -> /tutor.html
```

This directly addresses the earlier `/apply` 404 problem.

## 7. Configure the frontend Supabase project

`frontend/js/config.js` contains the public Supabase URL and **anon** key. The anon key is intentionally client-visible; database protection must come from RLS and server-side authorization.

For a staging build, configure the staging project values before deployment. Do not put the service-role key in this file.

## 8. Configure Supabase Auth URLs

In Supabase Auth settings, configure the deployed Vercel URL as an allowed site/redirect URL. Include the reset-password and authentication return paths used by the application.

Also add the local URL during staging:

```text
http://localhost:8888
```

## 9. Configure Google Sheets synchronization

The authoritative flow is:

```text
Student/Admin action
        ↓
Supabase Postgres
        ↓
sheet_sync_outbox
        ↓
Sheet sync Edge Function
        ↓
Google Sheet mirror
```

The sheet must never be treated as the primary record source for application state.

## 10. Create a pseudonym QA student

Do this in **staging only**.

Example:

```text
Name:     AH QA Student
Email:    dedicated-qa-mailbox@example.com
Phone:    dedicated QA number
Password: dedicated QA password
```

Do not use a real student's account for destructive E2E testing.

## 11. Browser E2E

Install Playwright in the QA machine and run:

```bash
E2E_BASE_URL=https://YOUR-STAGING.vercel.app \
E2E_STUDENT_EMAIL=qa.student@example.com \
E2E_STUDENT_PASSWORD='YOUR-QA-PASSWORD' \
npx playwright test tests/e2e/student-smoke.spec.js
```

Windows PowerShell:

```powershell
$env:E2E_BASE_URL='https://YOUR-STAGING.vercel.app'
$env:E2E_STUDENT_EMAIL='qa.student@example.com'
$env:E2E_STUDENT_PASSWORD='YOUR-QA-PASSWORD'
npx playwright test tests/e2e/student-smoke.spec.js
```

## 12. Release order

Do not promote directly from code changes to production.

1. Run local static gates.
2. Apply migrations to staging.
3. Deploy Edge Functions to staging.
4. Deploy frontend to Vercel staging.
5. Create pseudonym QA accounts.
6. Run browser E2E.
7. Verify RLS/role boundaries.
8. Verify payment sandbox.
9. Verify Google Sheets reconciliation.
10. Verify admin/tutor/student flows.
11. Freeze the release commit/tag.
12. Promote the same tested commit to production.
13. Change `ALLOWED_ORIGINS` to the production Vercel/custom domain.
14. Disable localhost access if appropriate.

## 13. Production checklist

- [ ] Supabase production backup/restore plan confirmed.
- [ ] Migrations 001–023 applied and verified.
- [ ] Edge Functions deployed.
- [ ] Frontend deployed from the tested Git commit.
- [ ] Vercel rewrites verified.
- [ ] Auth redirect URLs verified.
- [ ] RLS role boundaries verified.
- [ ] Payment provider verified in intended mode.
- [ ] Google Sheet mirror reconciled against Postgres.
- [ ] Admin dashboard works.
- [ ] Tutor dashboard works.
- [ ] Student portal works.
- [ ] Password reset works.
- [ ] Sign-out/session invalidation works.
- [ ] Mobile layout checked.
- [ ] No service-role secret appears in frontend source.
