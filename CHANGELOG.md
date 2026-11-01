## V18.9 — Governed enrolment, native stationery and WhatsApp operations (1 November 2026)

- Grouped Student, Tutor and Admin portal navigation around related responsibilities, with keyboard-reachable collapsible headings, dropdown chevrons, active-section visibility and responsive layouts.
- Added a server-governed additional-course workflow: student selection, payment claim, Finance verification, independent Academic/Registrar approval, receipt evidence, total reconciliation and versioned revised admission letter.
- Added an authenticated additional-course eligibility check so the Courses screen reflects the current intake directly from the database rather than an obsolete portal payload field.
- Prevented a new-intake application until the active programme has reached its duration, all results are reviewed/published and a statement has been issued; students who are still active are guided to the additional-course route.
- Added AH Consult diagonal vector stationery, a subdued watermark and controlled contact footer for future official PDF documents; historic issued documents remain immutable.
- Added consent-backed WhatsApp contact capture, encrypted Meta Cloud API settings, masked opt-in campaigns, signed inbound webhook processing, 24-hour chatbot guidance, opt-out handling and human handoff queues.
- Locked delivery to the Meta WhatsApp Cloud API through migration 049; the previous generic outbound webhook route is not available.
- Added release guidance and source-level regression checks. Staging, provider, accessibility and operational-owner approval remain required before production use.

## V18.8.1 — Corporate website and AH Student Hub separation (31 October 2026)

- Created a focused AH Consult corporate homepage and dedicated AH Student Hub public homepage. Corporate home immediately presents **Professional Services** versus **AH Student Hub** as two distinct visitor journeys.
- Removed all direct application, student-login and staff-login links from the corporate homepage and four service pages; Student Hub now provides prominent New Applicant, Student Login and Staff Login pathways.
- Added focused Architecture, Construction, Interior Design and Business Consultancy service pages; preserved the professional enquiry form on the corporate page.
- Moved the governed published-course list, learning impact data, admissions information and the coverflow gallery to Student Hub. Corporate project highlights use only published project photographs.
- Kept existing application, document, finance and staff roles/routes intact; no database migration is needed. Backward-compatible redirects route earlier homepage training anchors to Student Hub.
- Retained 1240 px centered content, responsive mobile navigation and admin-managed course/media publication. New division-navigation regression checks.
- Staging verification is still required for real data, cross-device browser behavior and access control.

## V18.7.4 — Center-stage published photo gallery

- Replaced the homepage mosaic with an accessible five-position, coverflow-style gallery (center sharp, two soft previews on each side at desktop sizes).
- Retained admin-managed published images, category filtering, featured-first ordering, lazy image loading, live refresh and the original fullscreen viewer.
- Added previous/next, play/pause, swipe, keyboard navigation, reduced-motion support and responsive layout.
- No database changes or new CDN dependency. Production files: `frontend/index.html`, `frontend/css/home.css`, `frontend/js/home.js`.

## V18.7.3 — Governed course catalogue and centered homepage (2026-10-31)

- Authorized course drafts, independent review, publishing, and code suffixes (e.g. ACAD1/ACAD2/ACAD3).
- Explicit administrator-approved Full Package eligibility per published course; preservation of historical course codes.
- Delegated gallery permissions using the existing image manager.
- 1240px centered responsive homepage content, with full-bleed section backgrounds.
- See [the V18.7.3 deployment guide](docs/releases/DEPLOY_V18_7_3.md) for instructions, safeguards and testing limitations.

## V18.7.1 — Institutional identities, login/CORS repair, versioned style copies

- Fixed the admin identity Save action dropping its session and API-key headers, causing 401 and browser CORS errors.
- Made `document-branding` gateway JWT handling explicit while retaining in-function administrator authentication and role checks.
- Added saved native branding profiles, draft editing, atomic Publish/Set Default, delete non-default, and remove published logo.
- Added separately SHA-256 verified updated-style reprints for eligible issued PDFs; immutable archived originals remain untouched.
- Added deploy instructions and regression coverage for authenticated JSON/multipart requests, role restrictions, revision publication and safe historic document access.

## V18.7.0 — native institutional PDF rendering and governed academic issuance (29 October 2026)

- Eliminated full-page letterhead uploads and image-backed PDF rendering for new documents; retained historical archives, deprecated migration records and private legacy files.
- Added administrator-managed institution identity and optional private compact logo, with left/center native A4 mastheads.
- Preserved six template tabs, controlled draft/publish history, signatory name/title, date, centered title, justified text, document footer and SHA-256 private PDF archive.
- Added two-person academic review/registrar approval for statements and final transcripts, full enrolled-course publication requirement for final transcripts, and automatic approval invalidation when grades/enrolments change.
- Certificate issuance stays blocked pending a formally approved completion and award policy.
- Added native-layout and issuance-policy regression coverage, migration 040 and a deployment runbook. Source-only release; requires staging integration and security testing.

## V18.6.6 — A4 letterhead clearance and date positioning (28 October 2026)

- Reserve 59.6 mm at the top of every A4 official document for full-page institutional letterhead artwork; a slightly conservative adaptation of one fifth of A4 height (297/5 = 59.4 mm).
- Right-align the issue date on the first printable line **above** the centered title, with a 12 pt glyph-ascent buffer below the protected header on all six document types; suppress visible Subject lines as in V18.6.5.
- Preserve the configured 3 mm bottom-edge clearance and right-aligned website/document-ID footer; reserve additional vertical room inside that region for readable footer content.
- Use more compact, legible payment-row spacing when receipts contain numerous verified provider details. The shared academic table styles remain unchanged; oversized receipt content is safely rejected rather than clipped.
- Add migration 039, update server-side defaults and validation and Document Designer settings, plus offline tests for long transcripts, manual receipts and provider receipts.
- Only preview and future newly issued documents use the updated layout; previously issued PDF bytes remain archived unchanged.

## V18.6.5 — Subject removal and 30 mm letterhead clearance (28 October 2026)

- Migration 038 increased top clearance to 30 mm and preserved bottom margin; removed redundant Subject labels and Subject PDF metadata.

## 18.6.4 — Document printing and applicant receipt presentation (28 October 2026)

- Remove the applicant-facing detailed **Official payment receipts** section. The payment overview and verified summary stay; one **Print Receipt** button handles manual and provider-confirmed payments.
- Retain finance-approved payment provenance and provider transaction references in the PDF, not in the removed receipt list.
- Remove visible document subjects across all six document types. Headings remain centered; paragraphs stay justified.
- Add compact A4 letterhead controls: 10 mm top clearance, 3 mm lower-edge clearance, with admin-adjustable larger safe areas. Migration 037 updates only original 85/20 defaults; custom margins are preserved.
- Put institutional footer text, website, document name and ID in a dedicated right-aligned region; reject oversized receipt templates instead of splitting a financial receipt over multiple pages.
- Improve printing latency with a user-scoped bounded in-memory cache, pointer/focus warming, no needless list reload, and an archive-only PDF retrieval fast path.
- Reduce application payment polling: Realtime-first, fallback 30–120 seconds with jitter and hidden-tab suppression.
- Add compact print regression checks and a staging-only, low-rate k6 starter test.
- Previous PDF archives remain unchanged; production-scale capacity has **not** been demonstrated.

# Changelog

## 18.7.5 — Manual application spreadsheet import and homepage content hierarchy
- Authorized registrar/admin bulk upload with strict template, preview, duplicate checks, quota, audit, invitations and recoverable staging.
- Atomic per-row draft registration and server-locked approved course prices; no automatic payments, admission or student IDs.
- Earlier About and dual institutional introductions, corrected architectural description, central training registration and a non-selectable contact placeholder. Gallery animation and governed courses retained.


## V18.6.3 — Consolidated letterhead and verified payment receipts (2026-10-28)

- Full source distribution of V18.6.1 and V18.6.2 plus every later document and payment patch.
- Uniform official document renderer: centered heading/subject, justified long-form body, no document ID in main content, right-aligned document name/ID/website in footer across pages.
- Admission letter ID overlap fixed; certificate respects the same safe-area margins and preserves the institution's letterhead.
- Removed Preview PDF and Download PDF actions for academic documents on the applicant Application Status page; receipt actions remain on Payment Receipts.
- Manual staff-approved payments now write verified, audited ledger evidence and issue AHCT manual receipts; existing qualifying approvals can be repaired through migration 036.
- Provider-verified payments retain provider references and available verified transaction evidence for AHCT receipts (not third-party issued receipt PDFs).
- Added a dedicated receipt provenance regression to `npm run test:unit`; migration 036 is additive and must run after 035.

## V18.6.2 — Administrator document designer tabs (28 October 2026)
- Six separate accessible document-type tabs, each preserving its draft/published history and unsaved-change prompts.
- Administrator-only database RPCs to delete unpublished drafts and logically retire superseded versions; live versions and archived PDFs protected; change history audited.
- PDF issuance now refuses missing/inactive published templates instead of silently using fallback wording.
- Added management and staging-deployment guide and dedicated regression tests. Existing migrations 001–034 preserved.

- Separate archived receipt for each verified provider payment; pending receipt issuance queue and admin retry.
- One canonical PDF renderer for official files and watermarked admin previews.
- Draft/publish workflow and template content version snapshots, configurable A4 letterhead safe areas and immutable receipt checks.
- Integrated applicant/student document access, legacy HTML redirects and removed duplicated unused assets.
- Additive migration 033 and new current release/testing guide. Not live-deployed or externally certified.

## 18.6.1 — Source security and CSP refactor (2026-10-28)

- Removed a credential-bearing example and Supabase local artifacts from the source distribution; existing exposed credentials still require revocation.
- Extracted embedded JS and styles, introduced page assets and strict script CSP, and corrected the current homepage entry links and metadata.
- Added UUID schema validation, structured error correlation, case-study documentation, ADRs, secret-scanning CI and a pre-commit hook.
- Kept all previously applied SQL migrations and core payment/RLS contracts unchanged. Follow [the V18.6.1 release guide](docs/releases/RELEASE_V18_6_1.md) for unverified gates.

## V18.5 — Institutional Document Integrity Source Patch (2026-10-28)


## 2.1.0 - Homepage redesign, gallery manager, application-flow fixes

### Fixed (blocked applicants)
- **`compress is not defined` on passport upload.** `apply.html` called `compress()` in two places but it was never defined (also in the original archive), so step 2 could never save. Added a robust implementation: JPEG/PNG only, auto-rotates, flattens transparency, and reduces the photo below the storage bucket's 100 KB limit, with clear error messages.
- **Payment could never start:** the payment step called an undefined `uid()` (idempotency key). Defined.
- **Deferment screen** (`apply.html`) used undefined `D` and `toast`; **portal deferment request** sent an undefined `p_reason`. Fixed.
- **Tutor bulk results upload** referenced the removed SheetJS library after the 2.0.0 change. Now uses the shared reader (.xlsx or .csv).
- **Course links did nothing:** the homepage linked to `apply.html?course=...&category=...` but the form ignored the parameters. The wizard now pre-selects the course.
- New **undefined-name lint** (`npm run lint:pages`, run in CI) so this class of bug cannot ship again; the old syntax-only gate could not see it.

### Homepage
- Rebuilt as a minimalist architectural design (charcoal, white, light grey, one orange accent) preserving all copy, contacts, links, the map and the eight services. No framework; Tailwind build removed.
- **Removed the public "examination record" block** that listed individual student names and marks.
- New **Learning Impact** section fed by `public_impact_stats()` (aggregates only, with documented counting rules; unreliable figures are omitted).
- New **gallery** with categories, featured layout, accessible full-size viewer, lazy loading, polling plus Realtime updates and graceful failure states.
- Admin Dashboard **gallery manager**: upload, caption, categorise, reorder, publish, unpublish, archive, feature, delete; audited.
- Migration `025_public_homepage.sql`: `gallery_items` (published-only public read), audit and publish triggers, one-time move of the existing photographs, `public_impact_stats()`.
- Removed (design decision): the dark-mode toggle, back-to-top button and the decorative architect quotes shown in the old gallery overlay. The "100% Secure" badge now reads "Secure".

### Quality
- The security-posture check now reports **all** findings in one message with the exact function signature and next steps, and `tests/sql/inspect_public_functions.sql` shows what any flagged public function exposes. (A pre-existing `public_homepage_metrics` function in a live database triggered this.)
- 118 frontend unit/DOM checks, 28 new SQL tests, a repeatable real-browser test at three screen sizes, and homepage privacy rules in the release gate.

## 2.0.0 - Phase 16: audit, hardening and consolidation

### Security
- **Removed the `sheet-review` function.** The sheet could approve payments and activate staff through a shared header secret. The sheet is now read-only (`sheets/Code.gs` v3).
- Payment status parsing: "unpaid", "incomplete" and "unsuccessful" were treated as paid; the amount could be missing or ₦1 short. Fixed with whole-word matching and a strict amount check.
- Constant-time webhook signature comparison; 256 KB webhook body cap; throttled Upperlink callback.
- SSRF guard for admin-configured provider URLs; payment return URLs restricted to allowed origins.
- Rate limiting for staff-code guessing (migration 024).
- No internal error text in responses; CORS no longer defaults to `*` (set `ALLOWED_ORIGINS`).
- `anon` privileges revoked everywhere except the four public catalogue tables.
- Browser security headers moved into `vercel.json`; vendored `supabase-js` and Tailwind; SheetJS 0.18.5 (known CVEs) replaced.
- Edge Functions pin `supabase-js` to 2.45.4 instead of an unpinned CDN import.

### Fixes
- `sheet-sync`: the error handler referenced an out-of-scope variable and crashed on batch failures; jobs were never marked failed.
- `deploy-functions` and `check-setup` skipped `communication-worker` and `document-render`; `check-setup` only verified migrations up to 013.
- Course selection is replaced atomically (`replace_application_courses`) instead of delete-then-insert.
- Tutor question import: `.xlsx` and `.csv` only (`.xls` dropped with SheetJS).

### Repository
- Removed the legacy Flask backend, duplicate root `js/` and `css/`, the Apps Script copies, 14 phase documents, old validators and committed caches. 231 files became about 100.
- Added `scripts/validate.py`, `scripts/test-sql.sh`, SQL posture and behaviour tests, Deno unit tests and GitHub Actions CI.

### Upgrade notes (existing deployments)
1. Apply migration `024_security_hardening.sql`.
2. Set `ALLOWED_ORIGINS` to your Vercel domain, then redeploy all functions.
3. Run `supabase functions delete sheet-review` and remove the `SHEET_WEBHOOK_SECRET` secret.
4. In the Google Sheet script run `ahctRetireLegacyReview()`, then `ahctProtectMirror()`, then `ahctDiagnose()`; share the sheet as Viewer only.
5. The pages `reset-password`, `setup-password` and `staff-login-legacy` no longer exist; password reset is `forgot-password`.

## 1.x - Phases 1-15
Delivered the application flow, payments, roles, academic engine, lifecycle tools and automation. History is in git.

## V18.6 — Applicant age, receipts, stationery library and guarded maintenance
- Added minimum-16-year-old checks at UI, function and SQL layers (migration 034).
- Added dedicated receipt tab, verification, PDF preview/download/print and on-demand verified receipt record recovery.
- Finance administrator receipt register, privileged PDF retrieval and audited certified-copy reissue.
- New letterhead revision library with active-default selection and non-destructive archival.
- Fixed PDF preview Close button contrast; configured local no-confirmation signup and documented hosted setting.
- Added guarded administration cleanup / unused intake reset without recycling historic student identifiers.
