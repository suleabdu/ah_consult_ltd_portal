# AHCT Portal V18.6.6 — Consolidated source update

This complete project contains all earlier V18.6.1–V18.6.5 changes plus V18.6.6 letterhead positioning and compact verified receipt print rows. The complete source is authoritative; do not apply older affected-files patches over it.

**Important security prerequisite:** revoke the Google service-account key previously exposed in older archives, even though this ZIP excludes it.

- Includes all 39 sequential SQL migrations (new in this release: `039_a4_letterhead_top_fifth_date_alignment.sql`). Apply **only pending** migrations to the existing Supabase project.
- Frontend changes: `js/pages/apply.js`, `js/official-documents.js`, `js/pages/admin-dashboard.js`.
- Edge Functions changed: `student-document`, `document-branding`.
- Bundled all 16 Edge Functions, original templates, tests and documentation; no production data, `.git`, `.temp` or environment secrets.
- See [the V18.6.6 release guide](../releases/RELEASE_V18_6_6.md) and [the capacity assessment](../CAPACITY_REVIEW_100K_RPS.md) for explicit caveats and staged verification.
- No live production changes and no actual 100k/s load test were performed.

## Latest V18.6.6 rollout

1. Run pending migrations in order up to 039 (never re-run applied ones).
2. Deploy `document-branding`, `student-document`, and `frontend/js/pages/admin-dashboard.js`.
3. Preview each of the six official document types against the real letterhead, and test manual/electronic receipt printing.
4. The 3 mm bottom-edge clearance remains unchanged, while content text stops above the multi-line verification footer. Archived/issued PDFs never regenerate.
