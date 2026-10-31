# AHCT V18.7.0 — Native Document Studio deployment

**Status: staging candidate only.** No live Supabase or Vercel deployment has been made by this package.

## Important breaking behavior

- You can no longer upload/publish a full-page A4 letterhead. Only a compact PNG/JPEG institution logo is accepted.
- The admin must first configure a real postal address, organization name and phone/email in Document Designer before *new official PDF issuance* works. Set up identity before starting pending receipt jobs.
- New transcript and result-statement PDFs require academic review by an `academic` staff member, then registrar authorization from a **different** person. The two staff accounts must already be approved. Existing archived PDFs are unaffected.
- Full transcripts require published reviewed grades for every non-deferred enrolled course. Certificates remain on hold without a formally authorized completion engine. Academic approvals are invalidated on grade/enrolment changes.

## Deploy in order

1. Back up your **staging** Postgres database and files.
2. Run migration `supabase/migrations/040_native_document_studio_governed_issuance.sql` using normal migrations (do not edit 001–039).
3. Deploy updated Edge Functions: `supabase/functions/document-branding` and `supabase/functions/student-document`.
4. Deploy updated `frontend/js/pages/admin-dashboard.js` and the complete frontend if needed.
5. Open Admin Dashboard → Document Designer. Save the real institution identity and approved contact. Upload ONLY the logo if available.
6. Preview all templates and generate new receipts in staging from synthetic/verified test payments; confirm paper printing and SHA-256 archived retrieval.
7. Test role denial (finance, tutor, unapproved staff), academic review, registrar co-signoff by another staff account and invalidation after a grade change. Conduct SQL and Deno integration checks before production.

## Rollback

Restore the backed-up deployment in staging if tests fail. Do not modify or erase previously issued PDFs. Migration 040 is additive; legacy image records are retained for history, but the V18.7 user interface removes all full-page stationery management. Do not use an older renderer with new native-only profile settings without planning the rollback.

See [Native Studio architecture](../NATIVE_DOCUMENT_STUDIO.md) and [Document issuance policy](../DOCUMENT_ISSUANCE_POLICY.md).


## QA performed in the source workspace

- Python structural checks: 37 passed.
- Available independent Node regression suites: 13 passed.
- Frontend JavaScript syntax checked. Both changed Supabase Edge Functions parsed as TypeScript syntax.
- Two browser DOM suites not run (`jsdom` unavailable). No live Supabase SQL/RLS test or Deno type-check completed. No authenticated end-to-end issuing or payment callback tested.
- Sample PDF in `docs/samples/` is an **illustrative offline A4 design**, not a document produced by the deployed Edge Function.

## Before enabling real issuance

Set the verified institution name, postal address and contact details in Document Designer. Obtain institutional approval for template body and authorized signatory role labels. Review all newly generated PDF files in staging. The current signatory label is NOT a legally verified digital signature; integrate a separately approved signing system if required. Existing issued archives retain their original PDF bytes.
