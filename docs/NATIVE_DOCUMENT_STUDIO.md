# AHCT V18.7 Native Document Studio

## What changed
The old full-page stationery upload and 59.6 mm image-overlap calibration UI are removed. New PDFs are generated with **pdf-lib** using a native A4 text/vector masthead and a compact optional privately stored corporate logo. Two alignment modes, left and centered, are available. The renderer repeats the masthead and verification footer on each continuation page, aligns dates to the right above centered titles and justifies body paragraphs. The original full-page stationery files and previous issued PDF bytes are not deleted; old images are no longer accessible through the active admin UI or PDF engine.

## Authoritative institutional identity

The administrator uses **Document Designer → Institutional PDF identity** to set the legal organization name, tagline, official postal address, phone, email, HTTPS website and masthead alignment. A small PNG/JPEG corporate logo (max 1 MB) is optional; without one the engine renders an AH monogram. Only approved administrators can edit this profile or read the private logo through the `document-branding` Edge Function. The underlying identity table and storage bucket deny direct anon/authenticated access; the Edge Function uses its private service-role connection.

The new system refuses *new official PDF issuance* until the institution has saved a profile including its official address and at least one phone/email contact. This is intentional; configure the profile before processing pending receipts. Administrators can still generate clearly marked sample previews. Do not enter a fabricated address. The previous `institution_document_branding`, `institution_letterhead_versions` and `institution-letterheads` remain untouched solely for historical data and rollback; new generator code does not read them.

## Body / signatory editor

Six existing template tabs remain: Admission Letter, Deferment Letter, Payment Receipt, Transcript, Statement of Results, and Certificate. Each tab preserves draft, PDF preview, publishing, revision history and safe deletion. The **body, contact footer and signatory NAME/TITLE** are editable; the student ID, payment amount, grades and eligibility inputs remain server-derived and cannot be changed in a template. A typed signatory name is **not** a cryptographic e-signature or handwritten signature; a verified signatory authority and PDF cryptographic signature service would be separate additions. Signatory graphics are deliberately not distributed to the browser.

## Issuance policy and security

The new academic approval stage uses `document_issuance_reviews`: a staff account with the `academic` role reviews academic evidence, then a *different* `registrar` role approves it. These approvals are required before *first* PDF generation of new final transcripts and result statements. Complete final transcripts need a reviewed published grade for **every non-deferred course on the student's application**. Result statements may contain only the subset of grades that have been reviewed and published. Grade edits or changes to course enrolment invalidate the approvals. The registrar-only bulk issuance RPC will not create new records before the review is complete.

Certificate issuance remains blocked until AHCT formally approves a versioned programme-completion and award policy (attendance requirements, minimum passing thresholds, practical projects, exemptions and academic holds). The present course-grade coverage check is NOT a complete award policy, and the software does not invent a pass threshold. Admission letters still require approved admission; receipts require a verified payment with adequate amount; deferment letters require an approved deferment. Students still receive only their own authorized records; all new official PDFs are archived privately and fingerprinted SHA-256; old issued documents are always served from their immutable original archives.

## Rollout / staging verification

1. Back up staging. Apply migration `040_native_document_studio_governed_issuance.sql` **after migration 039**. Do not edit applied migrations. 
2. Redeploy the `document-branding` and `student-document` functions and the updated frontend admin bundle.
3. Log in as an approved admin, enter actual corporate identity and contact details, then save and upload only the approved logo (optional). Do **not** upload an A4 letterhead.
4. Preview all six tabs using the sample/NOT ISSUED route. Inspect both masthead alignments and print at A4 Actual Size.
5. Test manual and online payment confirmations with verified ledgers; the receipt worker may fail until institutional identity setup is complete.
6. Test academic reviewer and separate registrar accounts, a missing grade, an unpublished grade, a grade edit invalidating sign-off, unauthorized staff issuance, unauthorized student document access, and immutable historic archives.
7. Test the campus production logo and address: this source package contains no approved company logo or verified postal address.

### Important limitations

This package is **source code only**, not a live deployment or a certified security audit. SQL integration/RLS, Deno runtime type-check, live authentication, PDF font behavior, and actual payment callbacks still require a separate staging project. Multi-page transcripts are expected; one-page limits apply to receipts with reasonable template text. There is no authorized independent digital-signature service or finalized certificate policy yet.
