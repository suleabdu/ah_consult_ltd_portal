# AHCT V18.7.1 — Document Identity Repair and Profile Publishing

This release repairs the admin Document Designer's `Save Institutional Identity` failure and adds native identity profiles with a separate publishing stage. It ships both the complete source and an affected-files patch.

**Main changes:** Fixed the JavaScript header spread that discarded the session JWT on JSON POST; pinned the `document-branding` Edge Function gateway policy to `verify_jwt=false` while preserving authenticated in-function administrator checks; created multiple identity profiles and atomic default publishing; implemented safe deletion of non-default profiles and published-logo removal; and offered SHA-256 checked updated-style reprints separately from immutable original issued documents.

**Compatibility:** Supabase migrations 001–040 remain untouched. New migration 041 must run before deployment of the Edge Function. Existing `student-document` request contracts remain compatible; `current_style:true` is an optional, authenticated request parameter. Previously archived PDFs are never rewritten.

**Governance:** All students retain original document access. A revised branding identity propagates to new PDFs immediately after publishing. Only eligible existing records with original frozen template wording can generate an updated-style reprint. Academic records continue to require appropriate academic/registrar authorization; certificate copies require formal reissuance. This is safer than an undetected global PDF rewrite.

**Local verification:** 37 structural checks passed; 14 dependency-free Node regression suites passed; both changed TypeScript Edge Functions passed local parser checks. Two DOM suites require jsdom. Supabase database integration, authenticated browser use and live PDF rendering/printing are not verified here.

Read [deployment instructions](DEPLOY_V18_7_1.md).
