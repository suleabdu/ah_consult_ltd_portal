# Backend setup (server functions, database, secrets)

Follow these steps in order. They take about 20 minutes the first time.

## 0. Read this first: why the files look confusing
- Every function file is called **`index.ts`**. That is correct. The **folder name** tells Supabase which function it is
  (`supabase/functions/admin-settings/index.ts` is the function `admin-settings`).
- The three files in **`supabase/functions/_shared/`** (`lib.ts`, `crypto.ts`, `pay.ts`) are **not functions**. You never deploy them.
  They are bundled into the functions that use them. They must stay together in that exact folder.
- Every `.ts` file starts with a **SETUP GUIDE** box explaining where it goes, how to deploy it, which secrets it needs and how to test it.

## 1. Put the files in your project
1. Unzip `ahct-backend.zip` **into your project root**: the folder that already contains (or will contain) the `supabase` folder.
2. When asked, choose *merge / replace files*. Do not delete your existing `supabase` folder first.
3. Delete the old folder `supabase/functions/claim-payment` if you have it (no longer used).

## 2. Check the layout
- Windows PowerShell, from the project root: `powershell -ExecutionPolicy Bypass -File .\scripts\check-setup.ps1`
- Mac/Linux: `bash scripts/check-setup.sh`

Every line must say **OK**. A **MISSING** line names the file that is in the wrong place.

## 3. Connect to your Supabase project
```
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```
`YOUR_PROJECT_REF` is the part of your project URL before `.supabase.co`.

## 4. Database scripts
Supabase dashboard, SQL Editor. Open each file in `supabase/migrations/`, paste it, press Run, wait for *Success*, then the next one.
Order: `001`, `002`, `003`, `004`, `005`, `006`, `007`, `008`, `009`, `010`. If you already ran some earlier, run only the missing ones, still in order.

## 5. Secrets
Set each with `supabase secrets set NAME=value` or in Dashboard, Edge Functions, Secrets. Setting a secret needs no redeploy.

| Secret | Needed for | How to get it |
|---|---|---|
| `SETTINGS_ENCRYPTION_KEY` | Payment methods and access codes | PowerShell: `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`  Mac/Linux: `openssl rand -base64 32`. Keep a safe copy. |
| `SHEET_ID` | Google Sheet sync | The long code in the sheet address, between `/d/` and `/edit` |
| `GOOGLE_SERVICE_ACCOUNT_B64` | Google Sheet sync | Base64 text of the service account key file |
| `SHEET_WEBHOOK_SECRET` | Sheet approvals | Any long random value. Store the same value in Apps Script Project Settings → Script Properties as `SHEET_WEBHOOK_SECRET` |

Never put these values in GitHub or in chat.

## 6. Open the four webhook-style functions
Add the contents of `supabase/config.toml.additions.txt` to the end of `supabase/config.toml` (create the file if it does not exist).

## 7. Deploy
- Windows: `powershell -ExecutionPolicy Bypass -File .\scripts\deploy-functions.ps1`
- Mac/Linux: `bash scripts/deploy-functions.sh`

If it says **Docker is not running**: start Docker Desktop and run it again, or update the Supabase CLI and add `--use-api` to the deploy command.

## 8. Verify
- Open `Use the signed-in administrator dashboard to run the protected sync test; do not place secrets in query strings.`. It must report all steps OK.
- Open the admin dashboard, **Payment Methods**, add a method, press **Test**.
- Run `ahctDiagnose` in the Google Sheet's Apps Script (after pasting `apps-script/Code.gs`). Every line must say OK.

## 9. When something fails
| What you see | What it means | Fix |
|---|---|---|
| `Cannot find module ../_shared/pay.ts` (or crypto.ts, lib.ts) | The `_shared` folder is not at `supabase/functions/_shared/` | Move it there, run the check script |
| `Function not found` / 404 / "could not reach the server" | The function is not deployed, or an old copy is running | Run the deploy script again |
| `Docker is not running` | The CLI needs Docker to bundle | Start Docker Desktop, or add `--use-api` |
| `SETTINGS_ENCRYPTION_KEY secret is not set` | Missing secret | Step 5, then try again |
| `Only administrators can ...` | The signed-in person is not an approved Administrator | Approve them in Team & Access, or set role `administrator` and status `approved` in the `staff` table |
| `permission denied` / `relation ... does not exist` | A database script has not been run | Step 4 in order |
| `bad signature` (Monnify) | Secret key saved in Payment Methods does not match | Re-enter the Monnify secret key |

**If it still fails, send me the FIRST error line you see** (copy it exactly) and which step you were on.
