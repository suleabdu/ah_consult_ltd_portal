# AHCT Student Hub — Security Stabilization & Setup Guide

**Release focus:** first improvement only — remove exposed credentials from the distributable project, make secret handling safer, protect Google Sheets synchronization, and provide a clean setup/recovery procedure.

> **Critical:** The original ZIP included live-looking credentials and a Google service-account private key. Assume all credentials in the original ZIP, its copies, and any Git history were exposed. This cleaned package cannot revoke remote credentials. Complete the rotation checklist below before deploying.

## 1. What changed in this security release

- Removed the real `backend/.env` from the package and retained only `backend/.env.example` with blank secret values.
- Removed `setup/client_secret.json`, generated Supabase `.temp` metadata, the Supabase diagnostic CSV, the local notebook, Python virtual environments/cache, and the embedded `.git` folder. The new ZIP does not contain the earlier Git history.
- Replaced the Apps Script hard-coded webhook secret with a value loaded from **Apps Script Script Properties**.
- Changed `sheet-sync` to require gateway JWT verification and a second authorization check: an approved administrator or a trusted server-side request using the backend service credential.
- Added `admin-sync`, an authenticated administrator-only function for invoking the Sheet sync worker.
- Removed the unauthenticated browser-side `no-cors` calls to `sheet-sync` and updated deployment/preflight scripts.
- Removed weak Flask security/password/signing-key fallbacks, blanked hard-coded bank settlement details and default admin email, added fail-closed startup checks for unique signing keys, explicit CORS origins, and a strong legacy temporary password. The Render template now generates independent signing keys and a random initial-password setting.
- Strengthened `.gitignore` for `.env` files, Google credentials, logs, local metadata, caches, and build output.

This is a **security stabilization patch**, not a guarantee that the entire product is production-ready. Payment verification, database permissions, and other findings from the audit should be handled in the next improvement after this baseline is verified.

## 2. Do these credential-rotation steps before deploying

### 2.1 Google service-account key used by Sheet sync

1. Open Google Cloud Console → **IAM & Admin → Service Accounts**.
2. Select the service account that was represented by the JSON file in the original archive.
3. Open **Keys**. Disable the exposed key first if you can, then create a replacement JSON key for the same service account.
4. Update the Supabase Edge Function secret `GOOGLE_SERVICE_ACCOUNT_B64` using the replacement key (instructions in section 5). Do not put the downloaded JSON file inside the project or commit it.
5. Confirm the Sheet is shared with the service-account email as **Editor**, and confirm Google Sheets API is enabled.
6. After the replacement key has been tested successfully, permanently delete the exposed key from Google Cloud Console. Deleting the key disables future authentication with that key; it does not invalidate already-issued short-lived access tokens immediately, so do not delay this step.

Official guidance: https://cloud.google.com/iam/docs/keys-create-delete

### 2.2 Apps Script ↔ Supabase review secret

1. Generate a new random secret locally. Python example:

   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```

2. In Supabase, open **Project → Edge Functions → Secrets** and set `SHEET_WEBHOOK_SECRET` to the newly generated value.
3. Open the Google Sheet → **Extensions → Apps Script**.
4. In Apps Script, open **Project Settings → Script Properties → Add script property**.
5. Set the property name to `SHEET_WEBHOOK_SECRET` and its value to the same newly generated secret; save it.
6. Ensure the spreadsheet uses the updated `apps-script/Code.gs` from this package. Prefer one canonical Apps Script copy; do not paste multiple versions into the same project.
7. Run `ahctSetupSheet` and authorize the script. It should report that the script property is configured. Then test a controlled payment/staff review action.
8. Remove the old exposed secret from any Apps Script project, deployment, notes, and secret store. Do not reuse it.

### 2.3 Google OAuth credentials for the old Flask backend

The cleaned package intentionally omits the former `backend/.env` and `setup/client_secret.json`. If you still operate the legacy Flask backend:

1. Revoke the exposed Google OAuth refresh token / grant through the Google account's security or connected-app controls.
2. In Google Cloud Console → **APIs & Services → Credentials**, review the OAuth client. Rotate or replace its client secret if it was exposed.
3. Create a fresh, local OAuth client file of the correct **OAuth client** type. Do not substitute a service-account JSON file; the two credential types are different.
4. Run `setup/get_refresh_token.py` only on your trusted machine, capture the fresh token, and update the backend deployment's secret settings.
5. If Flask/Google Sheets will no longer be a production backend, do not regenerate these legacy credentials just to keep an abandoned stack alive; disable that integration after confirming it is not used.

### 2.4 SMTP / email credentials

1. Rotate the SMTP credential or Gmail App Password that was in the original environment file.
2. Update the deployment's SMTP secret values (not this source package).
3. Send a test email in the intended environment and verify sender identity, delivery, and reset-link behavior.

### 2.5 Monnify / payment-provider credentials

1. Identify whether the exposed values belonged to **sandbox** or **live** mode.
2. Regenerate the appropriate Monnify API/secret credentials in the provider dashboard.
3. Update the active payment method in the AHCT administrator dashboard, or update the legacy backend secret store if that stack remains active.
4. Verify a sandbox transaction end-to-end before using live credentials. Do not mark a payment successful based on a return URL alone.

### 2.6 Flask application signing secrets

If the legacy Flask API remains deployed, generate independent values for `SECRET_KEY` and `JWT_SECRET` (at least 32 characters each) and update its secret environment configuration. The startup checks now refuse weak/missing keys, wildcard CORS, or a missing/weak `DEFAULT_PASSWORD`. Changing signing secrets may invalidate existing sessions/tokens; plan that change intentionally. The legacy flow still uses one shared initial password for newly provisioned accounts; use a random long value only as a temporary compatibility measure, and prioritize replacing it with per-account activation links in the next improvement.

### 2.7 Supabase API keys

The original `backend/.env` did not contain a Supabase service-role key, but do a separate scan of your Supabase project and any past repositories before assuming no Supabase key was exposed elsewhere.

- Keep the publishable/anon key in browser configuration only; row-level security must still protect all tables.
- Never put a Supabase secret/service-role key in HTML, JavaScript, Git, Apps Script source, or a shared ZIP.
- If any Supabase secret/service-role key was ever included in a public repository or shared artifact, create a replacement secret key, update the server/Edge Function consumers, test, and then deactivate the compromised key.
- Prefer the newer publishable/secret API keys where supported. Follow the dashboard flow for the project's current key type; do **not** rotate the project's JWT signing secret casually as a substitute for rotating an API key, because it may invalidate existing tokens/sessions.

Official guidance: https://supabase.com/docs/guides/getting-started/api-keys

## 3. Clean local setup (Windows)

1. Download and extract `AHCT_SMS_Python_Security_Stabilized.zip` to a new folder. Do not copy the previous `.git` directory, `.env`, Google key JSON, or logs into it.
2. Install Git, a current LTS version of Node.js (for frontend/tooling if used), the current Supabase CLI, and Python 3.11+ only if you plan to run the legacy Flask backend.
3. Open PowerShell in the extracted `AHCT_SMS_Python` project root — the folder containing `supabase/`, `scripts/`, and this guide.
4. Check the cleaned files are present:

   ```powershell
   Get-ChildItem
   Get-ChildItem supabase\functions
   Get-ChildItem supabase\migrations
   ```

5. Initialize a **new repository** rather than reusing the old Git history:

   ```powershell
   git init
   git add .
   git status --short
   ```

   Before `git commit`, confirm `.env`, `client_secret*.json`, service-account JSON, logs, and private keys are not staged. The `.gitignore` should exclude them. Then commit to a new private GitHub repository.

6. Link the intended Supabase project:

   ```powershell
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   ```

   Use the project reference from the correct Supabase project URL. Do not paste secret API keys into source files or shell scripts.

7. Run the project preflight check:

   ```powershell
   .\scripts\check-setup.ps1
   ```

   Fix every `MISSING` or failed check before deployment. Review that all SQL migrations in `supabase\migrations` have been applied to the intended database in numeric order. For an existing production database, inspect migration history before applying anything; do not blindly rerun non-idempotent SQL.

8. Deploy functions:

   ```powershell
   .\scripts\deploy-functions.ps1
   ```

   This package includes `admin-sync`. `sheet-sync` is deployed with JWT verification enabled. Only external provider callbacks that authenticate themselves inside the handler should use a no-JWT deployment override.

## 4. Clean local setup (macOS/Linux)

Run these commands from the extracted project root:

```bash
# Install dependencies separately using your operating system's package manager.
# Then:
git init
git add .
git status --short
supabase login
supabase link --project-ref YOUR_PROJECT_REF
bash scripts/check-setup.sh
bash scripts/deploy-functions.sh
```

Before committing, inspect staged files and confirm there are no real `.env` files, key JSON files, `.pem` files, or logs. Initialize a fresh repository: the old Git history is intentionally not included in the cleaned ZIP.

## 5. Set Supabase Edge Function secrets

In Supabase Dashboard → **Edge Functions → Secrets**, set the secrets that the live functions actually need. Do not paste values into this guide or source code. Common examples used by this project include:

- `SHEET_ID` — Google spreadsheet ID.
- `GOOGLE_SERVICE_ACCOUNT_B64` — base64 encoding of the **replacement** service-account JSON file.
- `SHEET_WEBHOOK_SECRET` — the new random secret shared with Apps Script Script Properties for `sheet-review` only.
- `SETTINGS_ENCRYPTION_KEY` — a strong encryption key for stored payment-provider settings; preserve it securely because losing it may make previously encrypted provider credentials unreadable.
- `ADMIN_INVITE_CODE` — optional legacy staff-registration code, if this old pathway is still enabled.
- The relevant Monnify/Upperlink configuration only if the payment configuration screen does not hold the active provider settings.
- `ALLOWED_ORIGIN` or `ALLOWED_ORIGINS` — the exact trusted frontend origin(s), where used by the functions.

To generate independent Flask signing keys and a strong legacy temporary password locally, use these commands and save each result directly in the local `.env` / deployment secret settings. Never commit the values:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"  # run separately for SECRET_KEY and JWT_SECRET
python -c "import secrets; print(secrets.token_urlsafe(24))"  # DEFAULT_PASSWORD compatibility value
```

To base64-encode a newly created service-account JSON locally without printing the JSON key itself into the terminal output:

**PowerShell** (replace the path with the private local file path):

```powershell
$bytes = [System.IO.File]::ReadAllBytes('C:\secure\new-service-account.json')
$b64 = [Convert]::ToBase64String($bytes)
supabase secrets set GOOGLE_SERVICE_ACCOUNT_B64=$b64
Remove-Variable bytes,b64
```

**macOS/Linux:**

```bash
base64 < /secure/path/new-service-account.json | tr -d '\n' > /tmp/google-sa.b64
supabase secrets set GOOGLE_SERVICE_ACCOUNT_B64="$(cat /tmp/google-sa.b64)"
rm -f /tmp/google-sa.b64
```

Do not upload the key JSON or temporary base64 file to GitHub. Use your operating system's secure temporary directory and delete local copies when no longer needed. If organizational policy allows, prefer a managed identity/federation approach over long-lived service-account keys.

Supabase secrets documentation: https://supabase.com/docs/guides/functions/secrets

## 6. Google Sheet and Apps Script setup

1. Confirm you are using the intended Google Sheet and retain a separate backup before enabling any write operations.
2. Enable the Google Sheets API in the Google Cloud project that owns the service account.
3. Share the target spreadsheet with the replacement service-account email as **Editor**.
4. Set `SHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_B64` in Supabase Edge Function secrets.
5. Deploy the updated Apps Script code from `apps-script/Code.gs` into the spreadsheet's Apps Script project.
6. Add `SHEET_WEBHOOK_SECRET` in Apps Script Project Settings → Script Properties, matching the Supabase value exactly.
7. Run the setup/diagnostic function in Apps Script and authorize the requested spreadsheet access.
8. Test only with a controlled test row or designated test application. Check both the Edge Function logs and the Google Sheet before enabling real intake.
9. Confirm normal Google Sheet writes use raw cell values, so student-provided text is not treated as spreadsheet formulas.

## 7. Sheet-sync behavior and verification

- Browser pages must not invoke `sheet-sync` directly with an unauthenticated `no-cors` request.
- The `sheet-sync` function requires a valid gateway JWT and then checks that the caller is either an approved administrator or the trusted server-side key.
- The `admin-sync` function checks that the signed-in staff member is an approved administrator before asking the worker to process jobs.
- Outbox rows are the durable queue. A sync HTTP response is not enough by itself to prove full equality: compare record counts and stable IDs in the database and Sheet, and inspect failed/pending outbox jobs.
- If automatic sync is needed when no administrator is using the dashboard, configure a trusted scheduled worker after verifying the secure endpoint. Keep the scheduling credential in a protected secret store (for example, Supabase Vault), not in a committed SQL file, URL, or frontend code. Test the schedule with a non-production row first.

## 8. Safe first-deployment checklist

- [ ] All exposed credentials have been rotated or disabled at their issuing providers.
- [ ] The replacement Google service-account key works; the exposed key is disabled/deleted.
- [ ] `SHEET_WEBHOOK_SECRET` is set in both Supabase Secrets and Apps Script Script Properties.
- [ ] No real `.env`, OAuth JSON, service-account JSON, private key, local log or Git history is in the new repository.
- [ ] Supabase migrations are applied and reconciled with the existing database.
- [ ] `sheet-sync` has JWT verification enabled and server-side authorization is present in the handler.
- [ ] If the legacy Flask API remains active, it starts only with separate strong `SECRET_KEY` / `JWT_SECRET`, explicit `CORS_ORIGINS`, and a strong temporary password value.
- [ ] `admin-sync` is deployed and only an approved administrator can run it.
- [ ] Payment, registration, staff approval, application submission and Sheet-sync smoke tests pass in staging.
- [ ] Failed jobs produce visible errors and can be retried without creating duplicate Sheet rows.
- [ ] Backups/exports are stored privately and access to student passport files remains restricted.

## 9. Important scope note

This improvement is intentionally focused on credential exposure and the unauthenticated synchronization entry point. It does not claim to resolve every finding in the earlier audit. The next priority should be payment-status correctness and transaction/permission fixes, followed by race-safe outbox claiming and database reconciliation.
