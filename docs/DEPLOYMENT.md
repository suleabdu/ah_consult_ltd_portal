# Production Deployment — GitHub → Vercel → Supabase

## Vercel
Set **Root Directory = `frontend`**. No build command is required. The included `vercel.json` supplies clean routes and baseline security headers.

## Supabase
Apply migrations 001–024 in order and deploy the Edge Functions. Keep staging and production projects separate.

## Google Sheets
Run `apps-script/Code.gs` from the target spreadsheet. Store only `SHEET_WEBHOOK_SECRET` in Apps Script Script Properties. The same secret must exist in Supabase Edge Function secrets.

Each callback is signed as:

`HMAC_SHA256(secret, timestamp.request_id.raw_json_body)`

Requests older than five minutes or with a previously used request ID are rejected.

## Acceptance

Test student auth, staff approval, application submission, payments, tutor grading, admin/RLS boundaries, Sheet append/update/delete, Sheet review callbacks, retry handling, mobile behaviour and authenticated E2E before production promotion.
