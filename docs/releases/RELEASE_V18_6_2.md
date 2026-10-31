# V18.6.2 Document Designer release checklist

This incremental source release builds on V18.6.1, preserving HTML routes, institution colors, issued PDFs, and migrations 001–034 unchanged.

## What changed

- Six keyboard-accessible, document-specific tabs inside Admin → Document designer, with independent editor state, version history, unsaved-change handling, PDF previews and publication controls.
- **Delete saved draft** acts on unpublished content only. **Delete revision** logically retires an older revision from the designer; the current published revision remains protected. Both are administrator-restricted and audited in the database.
- Updated `student-document` to require the approved, active document template before first PDF issuance. All application/student/admin document flows use the shared issuance endpoint. Already archived PDFs are returned as-is with SHA-256 verification.
- SQL migration 035, SQL security-posture assertions, a dedicated Node interaction suite and local static desktop/mobile layout screenshots.

## Deployment order

1. Confirm the earlier exposed Google service-account key is **revoked**, backed-up secrets are rotated and previous Git history is scanned. This cannot be accomplished by replacing a ZIP.
2. Take a verified database backup and test this release on an isolated **staging Supabase project**.
3. Apply `supabase/migrations/035_document_designer_tabs_safe_deletion.sql` using the regular Supabase migration pipeline. Do not modify migrations 001–034.
4. Deploy `supabase/functions/student-document` (the existing single PDF issuance/preview endpoint).
5. Publish the updated frontend on the already configured HTTPS hosting environment; set only public Supabase credentials via `npm run configure:frontend`. Never expose the service-role token.
6. Run `npm ci && npm run check`, `scripts/test-sql.sh` against a **disposable** PostgreSQL test instance, Deno checks, and authenticated Playwright screenshot/interaction tests in staging.
7. In the real admin interface, for each of the six tabs: load template, edit then discard, save draft, preview draft, publish, delete old version and delete draft; test an unauthorized account's direct RPC request is rejected.
8. Verify a *newly issued* PDF contains the latest text and metadata template version. Download an older issued PDF and compare its stored hash to confirm it has not changed. Verify receipts and letterheads still work.

**Important:** The preview PNGs are offline static layout captures, not live application screenshots. No production project was connected or altered.

## Rollback strategy

If the client-side release fails, redeploy the former frontend assets and former `student-document` function. Migration 035 is additive and leaves existing templates, versions and archived records intact; do not destructively roll back applied migrations. Template retirements can be reviewed from retained rows and audit entries and should only be undone by an authorized database recovery operation.
