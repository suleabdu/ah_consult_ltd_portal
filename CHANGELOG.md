- Separate archived receipt for each verified provider payment; pending receipt issuance queue and admin retry.
- One canonical PDF renderer for official files and watermarked admin previews.
- Draft/publish workflow and template content version snapshots, configurable A4 letterhead safe areas and immutable receipt checks.
- Integrated applicant/student document access, legacy HTML redirects and removed duplicated unused assets.
- Additive migration 033 and new current release/testing guide. Not live-deployed or externally certified.

# Changelog

## 18.6.1 — Source security and CSP refactor (2026-10-28)

- Removed a credential-bearing example and Supabase local artifacts from the source distribution; existing exposed credentials still require revocation.
- Extracted embedded JS and styles, introduced page assets and strict script CSP, and corrected the current homepage entry links and metadata.
- Added UUID schema validation, structured error correlation, case-study documentation, ADRs, secret-scanning CI and a pre-commit hook.
- Kept all previously applied SQL migrations and core payment/RLS contracts unchanged. Follow docs/RELEASE_V18_6_1.md for unverified gates.

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
