# AHCT Portal V18.6.6 — letterhead clearance deployment

## What changed

- The protected top letterhead boundary on A4 is **59.6 mm** from the top edge (requested; exact A4 fifth is 59.4 mm). The first text baseline includes a small additional glyph-height allowance; the date is right aligned just below that boundary and above the centered document title on each of the six document types.
- The bottom *edge clearance* remains **3 mm**; the footer still occupies extra height above that edge. The 234.4 mm between guides is the combined main-content-and-footer area, not a promise of 234.4 mm of text.
- The common PDF renderer protects every new page of longer academic documents. Payment-detail rows are compact only for receipts, to preserve one A4 page when ordinary provider fields are present. Any unusually long edited receipt is rejected rather than cut off.
- The admin branding page defaults to 59.6 mm, with 59.6–120 mm supported for the top safe area. Existing uploaded letterhead images and bottom margin are preserved.

## Files to deploy

1. `supabase/migrations/039_a4_letterhead_top_fifth_date_alignment.sql` — applies the new default and updates the singleton row and constraint; historical migrations are not changed.
2. `supabase/functions/student-document/index.ts` — shared PDF renderer for six document types.
3. `supabase/functions/document-branding/index.ts` — administrator settings fallbacks and bounds.
4. `frontend/js/pages/admin-dashboard.js` — updated Document Designer wording and margin control.
5. `tests/unit/document-print-compact.test.mjs` — local layout tests (not deployed to edge).

## Staging deployment

1. Back up Supabase and confirm migrations **001–038** are applied, in order. Apply **039** using your standard Supabase migration process, not by editing applied migrations.
2. Redeploy Edge Functions `document-branding` and `student-document`; then deploy the updated frontend asset.
3. Preview each of the six document types with the **actual uploaded letterhead** at A4 size. Verify the date clears the masthead, the footer clears any printed background, and the printed sheet has no clipping. Print both manual and provider-verified receipts from staging.
4. Confirm older issued PDFs still download unchanged. A new preview is not a replacement for an archived signed/issued document.
5. Run SQL/Edge Function integration and end-to-end browser tests in staging. Local mock tests do not confirm a real printer's non-printable region.

## Print production note

A 3 mm minimum bottom-edge clearance is tight for some consumer printers, even if the PDF is valid. If output clips, use a printer that supports the requested printable area or increase the bottom clearance to 5–10 mm; do not hide or clip official document IDs. The user-requested top margin (59.6 mm) is larger than most generic blank letter templates but reasonable for a tall corporate masthead.
