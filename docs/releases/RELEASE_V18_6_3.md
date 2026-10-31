# AHCT Portal V18.6.3 — Consolidated release & staging checklist

**Prepared:** 28 October 2026  
**Scope:** Complete source archive (not a patch) with prior V18.6.1 security refactor, V18.6.2 Document Designer, letterhead renderer improvements, and V18.6.3 payments.  
**Status:** Ready for **staging** deployment and integration verification. No production deployment or database migration was executed while building this archive.

## Changes included

1. **Baseline V18.6.1:** secrets-example sanitization, exclusion of `.git` and Supabase `.temp`, frontend JS/CSS extraction, safer public config, tests, release documentation. Old exposed credentials must be revoked separately.
2. **V18.6.2:** six independent Document Designer tabs; administrator-only draft deletion and old-version retirement; current published templates and previously issued PDFs protected (migration 035).
3. **Letterhead fixes:** heading and subject centered; body paragraphs justified where typographically reasonable; Document ID hidden in main document; website, document name and ID right-aligned in every footer; safe margins for certificates; admission-heading collision fixed.
4. **V18.6.3:** Application Status hides academic Preview PDF/Download PDF; receipts screen retains preview/download/print; approved manual payments have verifiable ledger status and manual receipts; online payments issue AHCT receipts based on verified provider data, with actual transaction references where supplied (migration 036).

## Files and components

The archive includes all `frontend/` files, `supabase/migrations/001` through `036`, all Edge Functions and helpers, deployment scripts, `sheets/Code.gs`, security and architectural documentation, and unit/SQL/browser test sources. Its folder structure is identical to the base product repository.

## Staging installation order

1. Extract into a **new project directory** and review changes before merging them into your repository. Do not copy old `.env`, `.git`, or `.temp` files from earlier ZIPs.
2. Revoke/rotate the formerly exposed Google service-account private key and investigate historical Git objects using Gitleaks. If other credentials were exposed, rotate those as well.
3. Create a **separate staging Supabase project** with synthetic student records. Set public frontend configuration through `AHCT_SUPABASE_URL` and `AHCT_SUPABASE_ANON_KEY` using `npm run configure:frontend`; keep server secrets in Supabase secret storage. Local tests need separate `AHCT_STAGING_URL` and `AHCT_STAGING_ANON_KEY`. Do not test against live student data.
4. Before migrations, take a **database backup**, review `035_document_designer_tabs_safe_deletion.sql` and `036_manual_and_provider_receipt_provenance.sql` with your DB lead, and inspect historical manual approval records. Apply 001–036 in numeric order **only for fresh databases**. For an existing deployment, apply only the pending migrations; never edit or replay already-applied migrations. The data-repair section of 036 modifies narrowly matching historical records and queues eligible receipts.
5. Redeploy Edge Functions `student-document`, `verify-payment`, and `upperlink-webhook`. Payment helpers are bundled by their imports. Follow `scripts/deploy-functions.sh` or PowerShell equivalents for complete fresh deployment.
6. Deploy the full `frontend/` folder to Vercel with no caching of stale HTML. Purge/revalidate cached JS if necessary; do not publish the source ZIP itself.
7. **Test document workflows:** all six tabs, drafts, revision deletion, publish only one type, protection of current template, distinct tab state, new PDF content, letterhead safe margins, all-page footers, and immutable old PDF hashes.
8. **Test manual receipt:** finance confirms bank evidence and approves; verified ledger and receipt queue created; student accesses Manual Receipt in Payment Receipts, not Application Status. Include extra-course approval and an old eligible manual record after reviewed migration.
9. **Test automated receipt:** payment succeeds through signed callback / independently verified provider API; reject amount mismatch/duplicate/not-paid callbacks; ensure provider evidence is faithfully represented. Confirm it is labeled an AHCT receipt unless the provider offers a separate issued-file API.
10. Complete SQL posture tests in disposable database, Deno type-checks, automated browser E2E and mobile accessibility, then obtain responsible production release approval.

## Reproduce source checks

```bash
npm ci
npm run check
node tests/unit/payment-receipt-provenance.test.mjs
node tests/unit/document-designer-tabs.test.mjs
DATABASE_URL='postgres:///your_disposable_test_database' ./scripts/test-sql.sh
for d in supabase/functions/*/; do [ "$(basename "$d")" = _shared ] || deno check "${d}index.ts"; done
```

**Limitations of package verification:** The available source structural checks and dependency-free regressions run locally. A source-code ZIP does not prove real receipt issuance or prove database-side compatibility with your existing production records. Full dependency-backed lint/jsdom tests, real Supabase/Postgres migration execution, provider sandbox tests and authenticated PDF browser previews require a configured environment.

## Security note

Do not commit secrets or internal production URLs. The public demo should use synthetic records and explicit AH Consult permission. Staff MFA, production email confirmation/CAPTCHA and full historical credential-response closure remain release gates.
