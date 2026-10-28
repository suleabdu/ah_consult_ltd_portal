# AHCT V18.6.1 — Upgrade implementation report
**Prepared:** 28 October 2026 · **Scope:** Uploaded V18.6 source package; no live deployment.

## Addressed in the source package

- **Urgent credential exposure:** scrubbed `supabase/secrets.example.env` and excluded local Supabase `.temp/` and original Git objects from the distributable. Added `.gitignore` rules, Gitleaks CI/pre-commit, a documented key-revocation procedure and a scan warning on historical objects. **Actual cloud revocation has not happened.**
- **Safe deployment configuration:** removed the live-format Supabase URL/anon JWT from the distributed `config.js`. New `npm run configure:frontend` generates public-only browser configuration from deployment environment variables; it rejects privileged JWTs. Local previews cannot fall back to live records.
- **Build/static CI:** corrected the nine stale README sections and broken release references, refreshed the architecture and changelog, and taught lint to recognize the `AHOfficialDocuments` global. Added asset-extraction checks.
- **Page implementation:** extracted all 11 embedded JavaScript blocks to `frontend/js/pages/`; extracted 11 style blocks, deduplicated the three auth stylesheets, consolidated homepage brand overrides, renamed `v18-product.css` to `components.css`, and replaced HTML event handlers with delegated listeners. Styles and business logic remain unchanged. Script CSP now forbids inline JS; style CSP still permits inline style attributes pending full authenticated visual review.
- **Backend hardening:** `cancel-application` now accepts a bounded JSON body with strict UUID validation; shared Edge Function errors return request correlation headers and structured redacted error logs.
- **Product/readiness:** corrected public metadata, added a discoverable staff login path in the homepage footer, a lightweight English i18n registry, draft privacy/terms pages, ADRs, rollout plan, PR template, and a source-safe case study README.

## Verified locally

- Static release gate: **37 passed / 0 failed** after patches (see execution record).
- Client JavaScript body parity: **11 / 11 exact matches**.
- Static Chromium CSS/HTML visual parity: **0.0000% pixel differences** on four representative pages across three viewport widths (see [visual parity evidence](docs/STATIC_VISUAL_PARITY.md)).
- Node-based regression checks not requiring npm packages: passport compression, course preselection, critical regressions, V18 product design, V18.1, V18.2, V18.3, V18.5, V18.6 and asset extraction — passed.

## Still required before calling the release production-ready

1. Revoke the exposed Google credential in Google Cloud; update the live secret store; verify Sheet sync. Perform full Gitleaks scan of the original repository and any older distributed packages.
2. Run `npm ci && npm run check` in a network-enabled environment; two jsdom DOM tests and ESLint could not execute where this ZIP was built due unavailable npm registry dependencies. The source-level `AHOfficialDocuments` lint global is fixed but needs validation in the full gate.
3. Run Deno `check`/unit tests, Postgres/Supabase SQL posture tests and payment provider sandbox verification. The build environment lacked Deno/Postgres.
4. Approve full authenticated Playwright screenshots and interaction tests, accessibility axe and Lighthouse results, at desktop/tablet/mobile sizes.
5. Obtain approval before publishing provisional privacy/terms text or client case studies. Enable hosted email verification, CAPTCHA and enforceable staff TOTP where authorized. Payment adapter and multi-currency work is documented, not falsely represented as complete.

## Compatibility/rollout decisions

- Original SQL migrations **001–034**, their RLS model, payment settlement contracts, document templates, IDs and production database remain unchanged.
- The `student-login` redirect and legacy document rewrite rules remain in place because there is no evidence of zero historical traffic; deleting deep links prematurely would break bookmarks.
- The original Git repository was not modified, tagged or pushed; the clean delivery intentionally excludes Git history. Set up branch protection and tag only after release gates and explicit approval.

**Result:** A source-remediated V18.6.1 candidate, **not** a verified production deployment. Refer to [deployment/release steps](docs/RELEASE_V18_6_1.md) before cutover.
