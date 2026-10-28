# V18.6.1 — refactor / security release guide

**Status:** Source-only remediation. Not deployed. No production credentials changed by this package.

## Before launch (blocking)

1. Rotate the exposed Google service-account key and verify Google Sheets read-only sync against the actual project. See [security incident response](SECURITY_INCIDENT_RESPONSE.md).
2. Inspect original Git history (`gitleaks git --redact .`) and previous releases. Review service-role, Google OAuth, payment and encryption credentials for exposure; rotate where indicated.
3. Create a fresh, **separate** Supabase staging project. Configure `AHCT_STAGING_URL` and `AHCT_STAGING_ANON_KEY` and generate the public deployment `config.js` at build time. Load only synthetic records. Do not point public demonstrations at production or use real applicants. Obtain the client's written approval before publication.
4. Install dependencies with `npm ci`; run `npm run check`; run Deno checks and tests; run PostgreSQL/Supabase integration tests. The local environment used to prepare this ZIP did not have a working npm registry, Postgres or Deno, so these stages need separate verification.
5. Capture and approve the homepage, application, student, tutor, staff and admin screens at 1440px, 820px and 390px. Check controller load order, applicant sign-in, staff password controls, payment verification and PDF receipt issuance.
6. Enable production email confirmation and CAPTCHA in Supabase Auth. Local `supabase/config.toml` intentionally disables email confirmation for local development; **do not carry that setting into production**. Configure MFA and verified recovery for administrator and finance users before enforcing MFA on their database/API operations.
7. Test the actual vendor payment webhooks and reconcile the final received amount with the stored server price. Never accept browser-supplied payment state.
8. Have counsel and the data-protection lead approve the terms/privacy copy, data access/export procedure, retention schedule and cross-border processing disclosures.
9. Deploy functions; apply any **new** additive migrations via normal change control. The existing 001–034 migrations were not edited. Redeploy Vercel and verify its CSP headers, signed-in pages, clean URLs and public document verification.
10. After signoff, create a signed annotated tag `v18.6.1`, configure branch protection and approvals, then monitor function error references and sync queues.

## Changes in this source package

- Removed the populated credential template, generated Supabase state, duplicated seed folder and the prior `.git` archive; kept the original 34 SQL migrations unchanged.
- Extracted page scripts and embedded style blocks into dedicated local assets; replaced HTML event handlers with delegated listeners; set strict `script-src 'self'` while retaining inline **style** permission for existing style attributes to minimize visual-regression risk.
- Parsed and validated cancel-application requests with a UUID schema before privileged lookups; added request correlation IDs and structured error logs.
- Updated page metadata, current homepage sign-in discovery, README, changelog and architecture decisions; added secret scanning to CI and a pre-commit configuration.

## Deliberately not certified / postponed

- Production key revocation, full historical gitleaks scan, network-dependent npm tests, Deno checks, real Supabase SQL integration, full authenticated Playwright baseline approvals and live payment tests (a limited static 4-page/3-breakpoint Chromium comparison passed; see [static visual evidence](STATIC_VISUAL_PARITY.md)).
- Mandatory staff MFA, new payment gateways, true multi-currency accounting, verified privacy-data exports and enforceable retention/deletion automation. These need additional architecture/database decisions and live integration testing; see [roadmap](ROADMAP.md).

## Rollback

Keep a verified deployment snapshot **without any exposed credentials**. Restoring frontend assets does not roll back the database. Never undo already-applied migrations by replacing migration files; perform a reviewed forward migration instead.
