# AH Student Hub — Competition-Ready Supabase Release

AH Student Hub is a Supabase-backed institutional operating system for student applications, admissions, payments, academic operations, staff workflows and reporting.

## Canonical architecture

`GitHub → Vercel (frontend) → Supabase Auth/Postgres/Edge Functions → Google Sheets mirror`

Supabase/Postgres is the **source of truth**. Google Sheets is an interoperability/reporting mirror and may send signed review decisions through `sheet-review`.

## Repository layout

- `frontend/` — production static web application; configure Vercel Root Directory to `frontend`.
- `supabase/migrations/` — ordered database migrations 001–024.
- `supabase/functions/` — privileged server-side operations.
- `supabase/seeds/` — seed/reference data.
- `apps-script/Code.gs` — only the Google Sheets approval/review integration retained.
- `scripts/` — deployment and release validation utilities.
- `docs/` — canonical setup and operational documentation.
- `tests/` — SQL/E2E acceptance tests.

Legacy Flask/Render, Netlify and duplicate Sheets implementations are intentionally excluded from this release package.

## Staging sequence

1. Create separate Supabase staging and production projects.
2. Apply migrations `001` through `024` in order.
3. Configure secrets from `setup/SUPABASE_FUNCTION_SECRETS.example.txt`.
4. Deploy Edge Functions.
5. Put the staging Supabase URL and anon key in `js/config.js` under `LOCAL` before local testing.
6. Deploy `frontend/` to a Vercel preview/staging deployment.
7. Configure the Google Sheet service account and Apps Script `SHEET_WEBHOOK_SECRET`.
8. Run authenticated browser E2E tests against staging.
9. Verify Sheet mirror reconciliation and payment/webhook flows.
10. Promote the exact tested commit to production.

## Security rules

- Never commit service-role keys, Google service-account JSON, payment secrets or webhook secrets.
- Localhost deliberately refuses production data unless explicitly forced with `?env=production`.
- Google Sheet callbacks use timestamped HMAC-SHA256 signatures and request IDs with replay protection.
- Production errors expose a request ID, not database exception details.
- Google Sheets is never authoritative.

## Local release gate

```bash
python scripts/release_gate.py
```

This is a static gate; it does not replace live staging tests for Supabase, Auth, RLS, Google Sheets, payments or browser journeys.
