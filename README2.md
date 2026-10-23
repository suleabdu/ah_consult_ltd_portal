# AH Student Hub: Local Test Run and Pre-Deployment Guide

> Run the whole system on your computer, prove every journey works, then push to GitHub.

### Contents

1. [How the testing works](#1-how-the-testing-works)
2. [Ground rules](#2-ground-rules)
3. [What you need installed](#3-what-you-need-installed)
4. [Check your project folder](#4-check-your-project-folder)
5. [Setup, step by step](#5-setup-step-by-step)
6. [Test scenarios](#6-test-scenarios)
7. [Debugging toolbox](#7-debugging-toolbox)
8. [Clean up between test rounds](#8-clean-up-between-test-rounds-staging-only)
9. [Go-live checklist](#9-go-live-checklist)
10. [Optional: a fully offline copy with Docker](#10-optional-a-fully-offline-copy-with-docker)

## 1. How the testing works

The website pages are plain HTML files, so they run on your computer. The database, logins, file storage and server functions live in Supabase (online), and the approvals live in a Google Sheet. So the safest test setup is:

- **Local web server** on your computer serving the pages (`http://localhost:5500`).
- **A separate STAGING Supabase project** (a free second project) that holds only test data.
- **A TEST copy of your Google Sheet** connected to the staging project.

This is better than a fully offline copy because Google Apps Script and Monnify can reach a Supabase project but can never reach your computer. With staging you can test everything, including approving a payment from the sheet.

Never test on your real project: test applications would appear in your real sheet and in front of real staff.

## 2. Ground rules

- Always open pages through **http://localhost:5500/...**, never by double-clicking the file (`file://` breaks logins and web requests).
- Never put secrets in GitHub. The only values allowed in `js/config.js` are the project URL and the **anon** key. These are public by design and protected by database security rules.
- Secrets that must never be committed: the `service_role` key, the Google key file, Monnify keys, `SHEET_WEBHOOK_SECRET`, `ADMIN_INVITE_CODE`.
- Use different test emails with one Gmail account: `you+student1@gmail.com`, `you+admin1@gmail.com` all arrive in the same inbox.
- Use different passwords and a different staff access code for staging than for production.

## 3. What you need installed

- A code editor: VS Code (recommended).
- Git.
- Node.js 18 or newer (for the Supabase command-line tool).
- Python 3 (optional, for a one-line web server) or the VS Code extension Live Server.
- Google Chrome (for the developer tools and the phone-size view).
- The Supabase CLI. Global npm install is not supported by Supabase, so use one of:
    - Windows with Scoop: `scoop bucket add supabase https://github.com/supabase/scoop-bucket.git` then `scoop install supabase`
    - Mac: `brew install supabase/tap/supabase`
    - Or put `npx` in front of every command below (for example `npx supabase login`).

## 4. Check your project folder

Your repository should look like this:

```
your-repo/
  index.html, apply.html, payment-success.html,
  staff-login.html, admin-register.html, admin-dashboard.html
  js/config.js
  supabase/
    config.toml
    migrations/001_apply.sql ... 013_phase3_academic_engine.sql
    functions/_shared/lib.ts
    functions/create-application, cancel-application, submit-application,
              payment-webhook, sheet-sync, sheet-review, admin-register
```

If your pages sit inside a `frontend` folder, run the web server from that folder. The folder `claim-payment` is no longer used (it was replaced by a database function) and can be deleted.

## 5. Setup, step by step

### Step 1. Create the staging project

1. In Supabase click **New project**. Name it `ahct-staging`. Choose a region near Nigeria, and save the database password.
2. Open **Project Settings, then API**. Copy the **Project URL**, the **anon public** key and (keep private) the **service_role** key.

### Step 2. Build the database

Open **SQL Editor** in the staging project. Run each file in this order, one at a time, pasting the whole file and pressing Run. Each must finish with Success before the next.

| File | What it adds |
|---|---|
| `001_apply.sql` | Tables, security rules, payment and passport storage. If it complains about `pg_cron` or `pg_net`, open Database, then Extensions, switch both on, and run it again. |
| `002_packages.sql` | Full Package (₦100,000). |
| `003_payment_review.sql` | Payment claim and review columns. |
| `004_status_and_edits.sql` | Payment history access. |
| `005_claim_rpc.sql` | The fast "I have paid" function. |
| `006_realtime.sql` | Instant page updates. |
| `007_admin.sql` | Staff accounts, lecturers, admin permissions. |

**Check:** Table Editor should list `applications`, `application_courses`, `audit_log`, `courses`, `intake_counters`, `intakes`, `lecturer_courses`, `lecturers`, `lectures`, `assignments`, `packages`, `payments`, `profiles`, `sheet_outbox`, `staff` and `student_feedback`. The seeded courses are AutoCAD (Beginner and Intermediate), Revit (Beginner) and Graphic Design (Beginner), and one intake called October 2026 that is open for 30 days. Edit these rows if you want other test data.

### Step 3. Authentication settings

In **Authentication, then URL Configuration** (names vary slightly by dashboard version):

- Site URL: `http://localhost:5500`
- Redirect URLs: add `http://localhost:5500/**`

In **Authentication, then Providers (or Sign In), then Email**: turn **Confirm email** OFF for staging so test accounts can sign in immediately. Remember to leave it ON in production.

### Step 4. Server functions

In a terminal inside your repository:

```
supabase login
supabase link --project-ref YOUR_STAGING_REF
```

Your staging reference is the part of the project URL before `.supabase.co`.

Set the staging secrets. Manual payment mode is used so that you do not need a Monnify account to test:

```
supabase secrets set PAY_MODE=manual BANK_NAME=TestBank BANK_ACCOUNT_NAME=AHConsultTest BANK_ACCOUNT_NUMBER=0123456789
# Generate strong unique values locally; set SHEET_WEBHOOK_SECRET and any ADMIN_INVITE_CODE in Supabase Dashboard > Edge Functions > Secrets. Do not paste angle-bracket placeholders as values.
supabase secrets set SHEET_ID=YOUR_TEST_SHEET_ID
```

Set `GOOGLE_SERVICE_ACCOUNT_B64` in the dashboard (**Edge Functions, then Secrets, then Add new secret**) so the long value is not mangled by the terminal. It is the base64 text of your Google service account key file. Leave `ALLOWED_ORIGIN` unset for staging.

Only provider callbacks and the separately authenticated Apps Script review endpoint skip gateway JWT verification. The Sheet sync worker remains protected. The intended configuration is:

```
[functions.payment-webhook]
verify_jwt = false
[functions.upperlink-webhook]
verify_jwt = false
[functions.sheet-review]
verify_jwt = false
[functions.sheet-sync]
verify_jwt = true
```

Deploy:

```
supabase functions deploy create-application
supabase functions deploy cancel-application
supabase functions deploy submit-application
supabase functions deploy admin-register
supabase functions deploy payment-webhook
supabase functions deploy sheet-sync
supabase functions deploy sheet-review
supabase functions deploy admin-sync
```

For scheduled syncing when no administrator is using the dashboard, configure a protected scheduler only after the secured worker is tested. Do not paste the service-role key into a committed SQL migration or store it in a URL; use a protected secret store such as Supabase Vault.

### Step 5. The test Google Sheet

1. In Google Sheets choose **File, then Make a copy** of your sheet (or create a blank one). Its id is the long code between `/d/` and `/edit` in the address. That is `YOUR_TEST_SHEET_ID`.
2. Share the test sheet with the service account email (Editor). Confirm the email shown in Edge Function diagnostics or the function logs.
3. Open **Extensions → Apps Script**. Paste the updated `apps-script/Code.gs` and set `SUPABASE_URL` to the **staging** URL. Do not embed secrets in the source code. In Project Settings → Script Properties, create `SHEET_WEBHOOK_SECRET` with the same value stored in Supabase Secrets.
4. Choose `ahctSetupSheet` in the toolbar, press Run, and allow permissions. A report appears. Every line must say OK.

Test Sheet synchronization by signing in to the staging Admin Dashboard and using **Team & Access → Google Sheet sync → Sync now**. Confirm that the queued jobs clear, the correct rows appear in the test sheet, and failures are visible in Supabase Edge Function logs. Do not put a secret in a URL query string.

### Step 6. Point the pages at staging and start the server

Edit `js/config.js` so it contains the STAGING values:

```
window.APPLY_CONFIG = {
  SUPABASE_URL: 'https://YOUR_STAGING_REF.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_STAGING_ANON_KEY'
};
```

Before editing, copy the production file to a safe place outside the repository (for example `config.production.txt`). You will restore it before committing.

Start the server from the folder that holds `index.html`. Pick one:

- Python: `python -m http.server 5500`
- VS Code: right-click `index.html`, then Open with Live Server (default port 5500)
- Node: `npx serve -l 5500 .`

Open `http://localhost:5500/index.html`.

### Step 7. Pre-flight checks (2 minutes)

- [ ] Open `apply.html`. You see the photo panel and the Create your account form, not a Setup problem message.
- [ ] Press F12, open Console. There are no red errors.
- [ ] The sheet check address returns `all_ok:true`.
- [ ] In the Apps Script report every line says OK.
- [ ] Open `admin-register.html`, submit with a wrong staff code. You get the message that the code is not valid. (This proves the secret and function are live.)

## 6. Test scenarios

Work through these in order. Tick each box only when the expected result happens. Use `?debug=1` at the end of a page address (for example `apply.html?debug=1`) to show technical error detail on screen while testing.

### A. Home page

- [ ] Every menu link scrolls to the right section (Home, About, Services, Training, 3D and Materials, Contact).
- [ ] Each of the eight service cards shows its text and the enquiry link pre-selects that service in the form.
- [ ] The consultation form with an empty name shows an error. With a name and service it opens WhatsApp with your message ready.
- [ ] Staff Login, Student Login and Apply buttons open the right pages.
- [ ] Dark mode toggle works. Page is readable in both modes.
- [ ] Press Ctrl+Shift+M in Chrome and check phone sizes (iPhone SE, Pixel, iPad): nothing overflows sideways, buttons are tappable.

### B. Student journey (use a fresh test email)

1. Open `apply.html`. Create an account. **Expected:** the dashboard opens with a left menu, header, and the right-hand summary panel.
2. Programme step: choose the intake and Beginner, press Next. Tick one course, check the total, press Next, then Proceed to payment. **Expected:** a payment page showing the test bank account, the amount and a payment reference.
3. Press *Go back and change my courses*. **Expected:** a warning listing four consequences. Confirm. **Expected:** you return to step 1 with your earlier choices selected. In Supabase Table Editor the old application shows status `expired`.
4. Choose the Full Package. Tick two Beginner courses. **Expected:** the second replaces the first (one per level). Tick one Intermediate. The total stays ₦100,000. Proceed to payment.
5. Press *I have paid, check now*. **Expected:** the message "Payment submitted". Within a minute a row appears in the sheet tab *Online Applications* with Pending in the Payment Review column and plain formatting.
6. In the sheet, set the row to Approved. **Expected:** a toast in the sheet says the form is unlocked, and the student page moves by itself to the payment-success page (green tick, receipt summary).
7. Press *Continue to application form*. Submit it empty. **Expected:** red messages under each missing field. Choose laptop Yes. **Expected:** the battery question appears. Choose No. **Expected:** it disappears.
8. Upload a large phone photo (over 100 KB). **Expected:** a small preview with a size under 100 KB. Complete all fields and submit. **Expected:** a Student ID in the form AHCT2610NNNN and the Admission Status page.
9. Check the right panel: photo, name, phone, gender, education, occupation, courses and total. Check the sheet row now shows the new answers in the extra columns.
10. Open Payment status. **Expected:** Payment confirmed, a history list, and a printable receipt.
11. Refresh the browser at every stage (payment, form, status). **Expected:** you land on the correct step each time and nothing is lost.
12. Open the payment-success page directly for a student who has NOT been approved. **Expected:** "No confirmed payment yet" (it must not open for unpaid students).

### C. Admin journey

1. Open `admin-register.html`. Wrong code gives an error. A password under 10 characters is refused. A valid form with the code `<SET_A_NEW_RANDOM_STAFF_INVITE_CODE>` shows "Registration received".
2. Open the sheet tab *Admin Registrations*. **Expected:** your row with Pending.
3. Try to sign in at `staff-login.html`. **Expected:** a message that your registration is awaiting approval.
4. Set the row to Approved in the sheet. **Expected:** a toast naming the person. Sign in. **Expected:** the dashboard opens.
5. Sign out, then try five wrong passwords. **Expected:** a 30-second lock message.
6. Overview: the numbers match what you did as the student.
7. Applications: search by name, filter by status and course, open a row. **Expected:** the passport photo and every answer, including the new questions.
8. Mark under review. Switch to the student account. **Expected:** status shows Under review.
9. Reject without writing a note. **Expected:** refused. Add a note and reject. **Expected:** the student sees Not admitted and your message. Create another student and Approve admission with a note. **Expected:** Admitted and your message.
10. Payments: with a second student who pressed *I have paid*, use *Send payment query* with a note. **Expected:** the student sees your message on the payment page. Then Approve. **Expected:** their form unlocks.
11. Intakes: create an intake that opens tomorrow. **Expected:** the student cannot apply to it yet. Close the October intake. **Expected:** the apply page shows "Applications are closed". Reopen it with a future closing date.
12. Lecturers: add one, assign courses. **Expected:** the student count matches submitted students on those courses. Performance shows zeros until data exists. To see the numbers, run this in the SQL Editor (staging only):

    ```
    insert into lectures(lecturer_id, course_code, title) select id, 'ACAD1', 'Intro lecture' from lecturers limit 1;
    insert into student_feedback(lecturer_id, rating, comment) select id, 5, 'Clear and patient' from lecturers limit 1;
    ```

13. Export CSV from Applications. Open it in Excel. **Expected:** one row per application with all columns.
14. Open the dashboard at a phone-size window (375 px wide). **Expected:** the menu becomes a drawer, tables become cards, nothing is cut off.
15. Inactivity sign-out: in `admin-dashboard.html` temporarily change `30*60*1000` to `15*1000`, reload, wait 15 seconds without touching anything. **Expected:** sent back to sign-in with a notice. Change it back.

### D. Security checks (these must all be refused)

- [ ] Sign in as a student, then open `admin-dashboard.html`. **Expected:** sent to staff-login with the message that this account is not staff.
- [ ] A visitor who is not signed in cannot read data. In a terminal (on Windows use `curl.exe`, not `curl`):

    ```
    curl.exe "https://YOUR_STAGING_REF.supabase.co/rest/v1/applications?select=*" -H "apikey: YOUR_ANON_KEY"
    ```

    **Expected:** `[]` (empty).

- [ ] A student cannot approve their own payment. On a page of your site press F12, Console, and run (replace the email and password with a student's):

    ```
    const c = supabase.createClient(APPLY_CONFIG.SUPABASE_URL, APPLY_CONFIG.SUPABASE_ANON_KEY);
    await c.auth.signInWithPassword({email:'you+student1@gmail.com', password:'THEIR_PASSWORD'});
    await c.from('applications').update({status:'paid'}).neq('status','x');
    ```

    Then look in Table Editor. **Expected:** no status changed.

- [ ] The sheet function refuses strangers: `curl.exe -X POST https://YOUR_STAGING_REF.supabase.co/functions/v1/sheet-review -H "Content-Type: application/json" -d "{}"` returns Unauthorized.
- [ ] Double-click *Proceed to payment* quickly. **Expected:** only one application exists in Table Editor.

### E. Real phone test (optional but valuable)

1. Start the server visible to your network: `python -m http.server 5500 --bind 0.0.0.0`. Allow it through the Windows firewall prompt.
2. Find your computer address with `ipconfig` (for example 192.168.1.20). On your phone (same Wi-Fi) open `http://192.168.1.20:5500/apply.html`.
3. Add `http://192.168.1.20:5500/**` to Redirect URLs in Supabase.
4. Test the camera photo upload and the whole student journey.

### F. Failure behaviour

- [ ] Turn off your Wi-Fi at the moment you press Submit. **Expected:** a clear message, not a frozen button.
- [ ] Temporarily break `SUPABASE_URL` in `js/config.js`. **Expected:** a Setup problem message, not a blank page. Restore it.

## 7. Debugging toolbox

- **Browser Console (F12):** red errors show what failed. Add `?debug=1` to the address for more detail.
- **Network tab:** a red request shows the failing web call and its response.
- **Supabase, Edge Functions, Logs:** pick the function. Lines starting `FUNCTION ERROR` or `SHEET-SYNC ERROR` give the reason.
- **Supabase, Logs, Postgres:** database errors.
- **Sheet sync health:** the `?check=` address in Step 5.
- **Why a row did not reach the sheet:**

    ```
    select id, kind, attempts, left(last_error,300) as error from sheet_outbox order by id desc limit 5;
    ```

- **Approvals in the sheet do nothing:** run `ahctDiagnose` in Apps Script, then check Apps Script, Executions for errors.
- **Test the approval link without the sheet:**

    ```
    Use the signed-in Admin Dashboard review controls for end-to-end testing. If you test the protected webhook directly, inject the secret from a local environment variable and never paste it into shell history, docs, or a URL.
    ```

    It should answer that the connection and secret are OK.

- **Page shows old content:** hard refresh with Ctrl+Shift+R.

## 8. Clean up between test rounds (staging only)

Run this in the staging SQL Editor to wipe test applications. **Never run it on production.**

```
truncate table sheet_outbox, payments, application_courses, applications restart identity cascade;
delete from intake_counters;
```

Delete test accounts in Authentication, Users. Clear the test rows in the two sheet tabs (keep row 1).

## 9. Go-live checklist

Only continue when every box in section 6 is ticked.

### Prepare the code

- [ ] Restore the production values in `js/config.js` (use your saved copy).
- [ ] Confirm no secret is in the code: search the project for `service_role`, `secret` and `eyJ`. Only the anon key may appear.
- [ ] Confirm `.gitignore` contains:

    ```
    .env
    *.env
    supabase/.env*
    supabase/.temp/
    *service-account*.json
    node_modules/
    ```

- [ ] Run `git status` and `git diff js/config.js`. The config must show the production URL.

### Prepare production Supabase (your real project)

- [ ] Run any migration you have not yet run there, in order, ending with `007_admin.sql`.
- [ ] Set the production secrets: `ADMIN_INVITE_CODE` (a new strong code), `SHEET_WEBHOOK_SECRET` (a new strong value), `SHEET_ID` (real sheet), `GOOGLE_SERVICE_ACCOUNT_B64`, the Monnify keys and `MONNIFY_BASE_URL` (live address), and `ALLOWED_ORIGIN` set to your exact site address (for example `https://yoursite.netlify.app`, no trailing slash). Remove `PAY_MODE=manual` if you want automatic Monnify payments.
- [ ] Link to production (`supabase link --project-ref PRODUCTION_REF`) and deploy all functions again.
- [ ] Authentication: Site URL is your real site, Redirect URLs include it, Confirm email is ON, and custom email sending is configured so messages do not say Supabase.
- [ ] Monnify dashboard: the webhook address is `https://PRODUCTION_REF.supabase.co/functions/v1/payment-webhook`.
- [ ] Production Google Sheet: paste the updated `apps-script/Code.gs` with the production URL only; set `SHEET_WEBHOOK_SECRET` in Script Properties (never in source), run `ahctSetupSheet`, and confirm all checks pass.

### Push

```
git add .
git commit -m 'Application flow, admin dashboard, staff login, home page redesign'
git push origin main
```

Netlify redeploys on push. Wait for the deploy to finish.

### Smoke test on the live site (5 minutes)

- [ ] Home page loads and the consultation form works.
- [ ] Register one real staff account with the real access code, approve it in the real sheet, sign in.
- [ ] Create one test student, run a small payment, approve it, and confirm the sheet row appears.
- [ ] Delete the test student and test application afterwards.

### Rollback if something is wrong

- **Website:** in Netlify choose Deploys, then the previous deploy, then Publish deploy. Or `git revert` the last commit and push.
- **Functions:** check out the older version and run `supabase functions deploy NAME` again.
- **Database changes** are additive. If one fails, note the error message before re-running it.

## 10. Optional: a fully offline copy with Docker

Useful if you want to work without internet, but the sheet approvals and Monnify webhooks cannot reach your computer, so keep the staging setup as your main test.

1. Install Docker Desktop and start it.
2. In the repository: `supabase init` (once), then `supabase start`. It prints a local URL, an anon key and a Studio address.
3. `supabase db reset` applies every file in `supabase/migrations` to the local database.
4. Create `supabase/functions/.env` with the same secrets as Step 4 and run `supabase functions serve --env-file supabase/functions/.env`.
5. Put the local URL (`http://127.0.0.1:54321`) and local anon key in `js/config.js`.
6. Local emails appear in the mail catcher at `http://127.0.0.1:54324`. Approve payments from the admin dashboard instead of the sheet.

## Quick reference

- **Pages:** `index.html`, `apply.html`, `payment-success.html`, `staff-login.html`, `admin-register.html`, `admin-dashboard.html`.
- **Student tester:** `you+student1@gmail.com`. **Staff tester:** `you+admin1@gmail.com`.
- **Staging staff invite code and sheet webhook secret:** generate unique values and store them only in the relevant secret store / Apps Script Script Properties. Generate separate values for production; do not commit or paste either value into this guide.
- **Test seed courses:** AutoCAD Beginner ₦30,000, AutoCAD Intermediate ₦40,000, Revit Beginner ₦50,000, Graphic Design Beginner ₦30,000. Full Package ₦100,000.

## Phase 2 — Data Integrity & Transaction Engine

The project now includes migration `012_integrity_engine.sql`, which adds atomic payment settlement, provider transaction idempotency, claimable/retryable Sheet synchronization, payment-attempt tracking, atomic access-code redemption, and administrator sync health reporting. See `docs/PHASE_2_DATA_INTEGRITY.md` and `tests/PHASE_2_TEST_PLAN.md` before applying it to production.
