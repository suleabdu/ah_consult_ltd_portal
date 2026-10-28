# AH Student Hub: Step-by-Step Setup Guide

From an empty computer to a live, secure system. Follow the phases **in order**; each ends with a **Checkpoint** so you know it worked before moving on.

**Time:** about 2 hours the first time. **Skill needed:** you can copy commands into a terminal and click through web dashboards. No coding required.

**What you are building**

```
Students / staff  ->  Vercel (website)  ->  Supabase (database, login, functions)  ->  Google Sheet (read-only copy)
```

The **database is the single source of truth**. The Google Sheet is a read-only mirror; nothing done in the sheet can approve a payment or change a record.

---

## Phase 0: Prepare (15 minutes)

### 0.1 Create these free accounts
| Account | Used for | Link |
|---|---|---|
| GitHub | Stores the code, runs automatic tests | github.com |
| Supabase | Database, login, backend functions | supabase.com |
| Vercel | Hosts the website | vercel.com (sign up with GitHub) |
| Google | The mirror sheet and its service account | accounts.google.com |

### 0.2 Install these tools on your computer
1. **Git**: git-scm.com
2. **Supabase CLI**: follow supabase.com/docs/guides/cli (Windows: Scoop; Mac: Homebrew; or `npx supabase` with Node.js).
3. **Docker Desktop** (recommended): the CLI sometimes needs it to deploy functions. If you skip it, deployment can use `--use-api` (see Troubleshooting).
4. **A password manager**: you will generate several secrets. Never keep them in chat, email or the code.
5. *(Optional)* **Node.js 22**: only needed if you rebuild the bundled website libraries.

### 0.3 Unzip the project
Unzip `AHCT_SMS_HUB_Phase16.zip` to a folder such as `ahct-sms-hub`, then open a terminal **inside that folder**. All commands below run from there unless stated.

**Checkpoint:** `python3 scripts/validate.py` prints `29 passed, 0 failed` (needs Python 3). If you don't have Python, skip this check.

---

## Phase 1: Put the code on GitHub (10 minutes)

1. On GitHub click **New repository**. Name it `ahct-sms-hub`. Choose **Private**. Do **not** add a README.
2. In your terminal:
```bash
git init
git add .
git commit -m "Initial import: AH Student Hub v2.0"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/ahct-sms-hub.git
git push -u origin main
```
3. Open the **Actions** tab in GitHub. The **CI** workflow starts automatically.

**Checkpoint:** within a few minutes all four CI jobs (Static release gate, Edge Functions, Migrations + SQL tests, Vendored assets) show a green tick. Red? Open the job and read the first error; see Troubleshooting.

---

## Phase 2: Create the Supabase project (10 minutes)

1. In Supabase click **New project**. Choose a name, a strong **database password** (save it in your password manager), and the region closest to your students.
2. Wait for the project to finish provisioning.
3. Collect these values (Project Settings, then **API** and **General**):

| Value | Where | Secret? |
|---|---|---|
| **Project URL** `https://abcd1234.supabase.co` | API page | No |
| **Project ref** `abcd1234` (the part before `.supabase.co`) | General page | No |
| **anon / public key** | API page | No, safe in the website |
| **service_role key** | API page | **YES. Never in the website, GitHub, email or chat.** |

**Checkpoint:** you have all four values written down in your password manager.

---

## Phase 3: Build the database (15 minutes)

### 3.1 Link the CLI to your project
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```
Enter the database password when asked.

### 3.2 Apply all 25 migrations
```bash
supabase db push
```
Type `Y` to confirm. This applies `001` through `025` in order.

> **No CLI?** In Supabase open **SQL Editor**, and for each file in `supabase/migrations/` from `001` to `025` **in numeric order**: open the file, paste it, click **Run**. Never skip or reorder files.

### 3.3 Prove the security rules are in place
Open **SQL Editor**, paste the contents of `tests/sql/security_posture.sql`, click **Run**.

**Checkpoint:** the result says `security posture OK`.

**If it lists problems, do not ignore them.** The check reports every finding at once. On a brand-new project built only from these migrations it should pass. On a database that already existed (for example from an earlier version of the site), it can flag objects that were there before, such as an old function that logged-out visitors can run. For each finding:

1. Open `tests/sql/inspect_public_functions.sql` and run its **Query 1** (it shows each function's source), then **Query 2** (what a logged-out visitor actually receives).
2. **Returns only counts or other aggregate numbers, and something still uses it:** add its name to `allowed_anon_functions` at the top of `security_posture.sql` and run the check again.
3. **Nothing uses it any more** (for example it fed an old homepage that is now replaced): remove public access with `revoke execute on function public.THE_NAME() from public, anon;` (or drop it), then run the check again.
4. **Returns names, emails, registration numbers, marks or any list of people:** that is a privacy leak. Revoke access immediately and tell your developer.
5. For a table finding, run `revoke all on public.THE_TABLE from anon;`.

### 3.4 Review the starting catalogue
In **Table Editor** you will find ready-made data: **18 courses**, **1 intake**, **1 package** and **10 gallery photographs** (the existing graduation photos, already published). Open `intakes` and set the real `label`, `year`, `month`, `opens_at`, `closes_at` and `is_active`. Review `courses` fees against your price list (`fee_ngn`, in naira). The original list is in `supabase/seed/courses_rows.csv`.

---

## Phase 4: Point the website at your project (10 minutes)

> **Important:** `frontend/js/config.js` ships with the **original project's** URL and key. If you skip this phase, your website talks to the wrong database.

1. Open `frontend/js/config.js`.
2. In the `PRODUCTION` block replace `SUPABASE_URL` and `SUPABASE_ANON_KEY` with **your** Project URL and **anon** key from Phase 2. Use the anon key only.
3. Save, then:
```bash
git add frontend/js/config.js
git commit -m "Point frontend at my Supabase project"
git push
```

**Checkpoint:** `git diff HEAD~1 -- frontend/js/config.js` shows only those two values changed, and neither is the `service_role` key.

---

## Phase 5: Deploy the website on Vercel (10 minutes)

1. In Vercel click **Add New, Project**, then import your GitHub repository.
2. Set **Root Directory** to `frontend`. Set **Framework Preset** to **Other**. Leave **Build Command** and **Output Directory** empty.
3. Click **Deploy**.
4. When it finishes, copy your site address, for example `https://ahct-sms-hub.vercel.app`. This is your **site origin** (no trailing slash).

**Checkpoint:** opening the address shows the AH Consult home page. Visit `/apply` and `/staff-login`; both pages load. (Logging in won't work yet.)

*If you use a custom domain, add it in Vercel, Settings, Domains, and use that domain everywhere below.*

---

## Phase 6: Tell Supabase about your website (5 minutes)

In Supabase, **Authentication**, **URL Configuration**:
1. **Site URL**: your site origin, e.g. `https://ahct-sms-hub.vercel.app`
2. **Redirect URLs**: add `https://ahct-sms-hub.vercel.app/forgot-password` (and any custom domain).

**Email delivery:** Supabase's built-in email sender allows only a few messages per hour. Before real students register, configure your own sender under **Authentication, SMTP Settings** (for example Resend).

**Checkpoint:** both fields are saved with no trailing slash on the site origin.

---

## Phase 7: Secrets and backend functions (20 minutes)

### 7.1 Create your private secrets file
Copy `supabase/secrets.example.env` to a file **outside the project folder** (for example `~/ahct-secrets.env`) so it can never be committed. Fill in at least:

| Secret | What to put |
|---|---|
| `ALLOWED_ORIGINS` | **Required.** Your site origin(s), comma-separated, no trailing slash. |
| `ALLOW_LOCALHOST` | `true` while testing; change to `false` before go-live. |
| `SETTINGS_ENCRYPTION_KEY` | A long random value. Generate with `openssl rand -base64 48`. Store it in your password manager; **if you lose it, saved payment-provider secrets cannot be recovered.** |
| `PAY_MODE`, `BANK_NAME`, `BANK_ACCOUNT_NAME`, `BANK_ACCOUNT_NUMBER` | Bank-transfer fallback details. |

The Google Sheet values (`SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_B64`) come in Phase 8; add them then.

### 7.2 Upload the secrets
```bash
supabase secrets set --env-file ~/ahct-secrets.env
```

### 7.3 Deploy all 13 functions
Mac/Linux:
```bash
./scripts/deploy-functions.sh
```
Windows (PowerShell):
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-functions.ps1
```
The script deploys the three public functions (`admin-register`, `payment-webhook`, `upperlink-webhook`) without login requirements and the rest as protected.

### 7.4 Verify
```bash
./scripts/check-setup.sh
```
In Supabase, **Edge Functions** should list 13 functions.

**Checkpoint:** every line says `OK` except possibly secrets you intentionally have not set yet.

---

## Phase 8: The Google Sheet mirror (25 minutes)

### 8.1 Create a service account (a robot login for the sync)
1. Go to console.cloud.google.com and create a project (name it `ahct-sheet-sync`).
2. **APIs & Services, Library**: search **Google Sheets API**, click **Enable**.
3. **IAM & Admin, Service Accounts, Create service account**. Name it `sheet-sync`. Skip the optional role and access steps.
4. Open the new account, **Keys, Add key, Create new key, JSON**. A `.json` file downloads. **Treat it like a password.**
5. Copy the account's email (it looks like `sheet-sync@ahct-sheet-sync.iam.gserviceaccount.com`).

### 8.2 Create and share the spreadsheet
1. Create a new Google Sheet named `AH Student Hub Mirror`.
2. Click **Share** and add the service-account email as **Editor**.
3. Copy the sheet ID from its address: `docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`.

### 8.3 Add the two secrets
Encode the key file as one line of text:
- **Mac/Linux:** `base64 -w0 key.json` (Mac: `base64 -i key.json | tr -d '\n'`)
- **Windows PowerShell:** `[Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json"))`

Add to your private secrets file:
```
SHEET_ID=THE_ID_YOU_COPIED
GOOGLE_SERVICE_ACCOUNT_B64=THE_LONG_BASE64_TEXT
```
Upload again with `supabase secrets set --env-file ~/ahct-secrets.env`, then **delete `key.json`** from your computer (keep a copy in your password manager only if your policy requires it).

### 8.4 Run the built-in diagnostic
```bash
curl -s "https://YOUR_PROJECT_REF.supabase.co/functions/v1/sheet-sync?check=1" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"
```
**Checkpoint:** every step in the JSON reply has `"ok": true`. A failure message names exactly what to fix (usually the sheet is not shared with the service account as Editor).

The tabs and column headings are created automatically the first time the sync runs, so the next step must happen **after** that.

### 8.5 Schedule the workers (so syncing is automatic)
In **SQL Editor** run the following once. It stores your service-role key in Supabase **Vault** (encrypted) instead of in plain text in a job definition:
```sql
select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'service_role_key');

select cron.schedule('sheet-sync', '* * * * *', $$
  select net.http_post(
    url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/sheet-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
               'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body    := '{}'::jsonb
  );
$$);
```
Optional: schedule `communication-worker` the same way, every 5 minutes (`'*/5 * * * *'`), if you set up email/SMS/WhatsApp secrets. If Supabase has changed the Vault or pg_cron syntax, follow their current documentation; the idea is unchanged.

Two housekeeping jobs (expire unpaid applications after 48 hours, expire old drafts after 30 days) were already scheduled by the migrations.

### 8.6 Lock the sheet so it is read-only (after the first sync, Phase 11)
You will do this in Phase 11 once a test application has created the tabs.

---

## Phase 9: Create the first administrator (10 minutes)

Every staff account starts as **pending** until an administrator approves it, so the first administrator is approved once by hand.

1. In Supabase **Edge Functions, Secrets**, add `ADMIN_INVITE_CODE` with a temporary code you invent.
2. Open `https://YOUR-SITE/admin-register`. Enter your details, choose position **Administrator**, and use the temporary code.
3. In Supabase **SQL Editor** run (use the email you registered with):
```sql
update staff set status = 'approved' where email = 'you@example.com';
```
4. **Delete the `ADMIN_INVITE_CODE` secret** (Edge Functions, Secrets, delete).
5. Sign in at `/staff-login`.
6. In the Admin Dashboard open **Team members** and create access codes for other staff (the access-code section, which some screens call "Team & Access"). Approve their registrations there. Staff register at `/admin-register` using the code you give them.

**Checkpoint:** you can sign in and see the Admin Dashboard.

---

## Phase 10: Payments (15-30 minutes)

Choose one or combine:

**A. Manual bank transfer (simplest, works immediately).** Ensure the `PAY_MODE` and `BANK_*` secrets from Phase 7 are set. Students pay, claim payment in the portal, and an administrator approves in **Admin Dashboard, Payments**.

**B. Monnify (automatic).**
1. In the Admin Dashboard open **Payment Methods** and enter your Monnify details (saved encrypted).
2. In Monnify's dashboard set the webhook URL to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/payment-webhook`.
3. **Test in Monnify's sandbox first** with a small payment before switching to live keys.

**C. Upperlink.**
1. Enter the initialise and verify URLs from Upperlink's documentation in **Payment Methods**. They must be public `https://` addresses.
2. Callback address: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/upperlink-webhook`.
3. **Important:** this adapter was written without Upperlink's published API reference. Test thoroughly in their sandbox and confirm a real payment verifies correctly before you rely on it.

**Checkpoint:** a test application reaches **Paid** (automatically or after your approval).

---

## Phase 11: Smoke test and lock the sheet (20 minutes)

### 11.0 Check the public homepage
Open your site's home page and confirm: the new design loads; there is **no** list of student names or marks; the **Gallery** shows photographs and the filter tabs work; clicking a photograph opens the viewer (arrow keys and Esc work); and a programme level button such as *AutoCAD, Beginner* opens the application with that course pre-selected after you sign in. The **Learning Impact** section stays hidden until real figures exist; that is intentional. See `docs/HOMEPAGE.md` for how to manage gallery photographs from the Admin Dashboard.

### 11.1 End-to-end test
1. Open `/apply`, click **Create account** to register a test student, complete the application, select courses, and pay or claim payment.
2. In the Admin Dashboard confirm the application appears and the payment can be reviewed.
3. Open **Audit Centre**: every admin action should be listed.
4. Open the Google Sheet. Within about a minute the tabs **Online Applications** and **Admin Registrations** appear and fill in.

### 11.2 Make the sheet read-only
1. In the sheet open **Extensions, Apps Script**. Delete any old code and paste the whole of `sheets/Code.gs`. Save.
2. **Project Settings, Script Properties, Add**: `SERVICE_ACCOUNT_EMAIL` = your service-account email from Phase 8.
3. Run these functions one at a time (select the function, click **Run**, approve permissions the first time):
   1. `ahctRetireLegacyReview`
   2. `ahctProtectMirror`
   3. `ahctDiagnose`
4. Open **View, Execution log**.
5. Share the spreadsheet with staff as **Viewer** only.

**Checkpoint:** the log shows `PASS` for every line and the file editors are only you and the service account. The sync keeps working because the service account stays an editor.

---

## Phase 12: Go-live checklist

- [ ] CI is green on `main`.
- [ ] `config.js` uses **your** project URL and **anon** key.
- [ ] `ALLOWED_ORIGINS` lists your real site origin(s); `ALLOW_LOCALHOST` is `false`.
- [ ] `ADMIN_INVITE_CODE` secret is deleted.
- [ ] Payment methods tested in sandbox, then switched to live keys.
- [ ] Own SMTP configured for Supabase Auth emails.
- [ ] Intake dates, course fees and bank details reviewed.
- [ ] Mirror sheet shared as Viewer only; `ahctDiagnose` all PASS.
- [ ] Supabase **Database, Backups** reviewed (daily backups are on paid plans; consider a plan that fits your data).
- [ ] The service-role key, database password and service-account key are stored only in your password manager.
- [ ] If any earlier copy of this project (or its old config files) was ever shared, you rotated the credentials listed in `SECURITY.md`.

---

## Phase 13: Test safely on your own computer (optional)

By default, opening pages from your computer talks to your **live** project (a red ribbon warns you). Better: create a second Supabase project called `ahct-staging`, repeat Phases 2, 3 and 7 for it, then paste its URL and anon key into the `LOCAL` line in `frontend/js/config.js`. From then on local testing never touches live data.

Run the site locally:
```bash
./scripts/run-local.sh        # opens http://localhost:8888
```
Run the full database test-suite on a throw-away local PostgreSQL (it wipes that database; it refuses Supabase URLs):
```bash
DATABASE_URL=postgres:///hub_test ./scripts/test-sql.sh
```
See `docs/RUNBOOK.md` for details.

---

## Day-to-day operations

| Task | How |
|---|---|
| Approve a payment | Admin Dashboard, Payments |
| Add staff | Create an access code in Team members, share it, approve the registration |
| Change fees or intake | Table Editor: `courses`, `intakes`; or the matching Admin Dashboard screens |
| Deploy a code change | Push to `main`; CI tests it; Vercel publishes it. For functions run `./scripts/deploy-functions.sh` |
| Database change | Add a **new** numbered file in `supabase/migrations/`; never edit an applied one; `supabase db push` |
| Monthly | Review who has Editor access to the sheet and who has the `administrator` role |

---

## Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| `supabase db push` asks for a password repeatedly | Use the **database** password from Phase 2 (not your Supabase account password). |
| Function deploy fails mentioning Docker | Start Docker Desktop, or update the CLI and add `--use-api`. |
| Pages load but login or data fail; browser console mentions CORS | `ALLOWED_ORIGINS` is missing or doesn't match the site origin exactly (scheme + host, no trailing slash). Fix, re-run `supabase secrets set`, retry. |
| Staff registration returns "not enabled yet" | No active access code exists. Use the temporary `ADMIN_INVITE_CODE` (Phase 9) or have an administrator create a code. |
| "Too many attempts" at staff registration | Rate limit (10 per hour per network). Wait an hour, or an administrator can clear it (see `docs/RUNBOOK.md`). |
| Sheet stays empty | Run the Phase 8.4 diagnostic. Usually the sheet isn't shared with the service account as Editor, or the cron job from 8.5 wasn't created. |
| `ahctProtectMirror` says to set SERVICE_ACCOUNT_EMAIL | Add the script property exactly as in Phase 11.2. |
| Student paid but still "pending" | Admin Dashboard, Payments, **Verify**; check the provider's dashboard and the function logs for `payment-webhook` / `upperlink-webhook`. |
| CI job fails | Open the job log; the first red line names the cause. For SQL failures, confirm migrations weren't edited after being applied. |
| Password-reset email never arrives | Configure your own SMTP (Phase 6). The built-in sender is heavily limited. |

**Where to learn more:** `docs/HOMEPAGE.md` (homepage, gallery and figures), `docs/ARCHITECTURE.md` (how it fits together), `docs/RUNBOOK.md` (releases and incidents), `SECURITY.md` (security model and credential rotation).
