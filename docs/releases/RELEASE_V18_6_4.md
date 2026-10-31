# AHCT Portal V18.6.4: Receipt screen, one-page receipt layout & print speed

**Release scope:** source change only. The original source is V18.6.3; deploy to **staging first**.

## UI behavior

- Applicant's **Payment Receipts** page: the whole "Official payment receipts" detail card is removed. The payment summary and verification controls remain.
- Once archived and verified, the primary action is **Print Receipt** for both manual-finance and online-provider payments.
- A payment remains eligible only after full payment is verified in the ledger. The original manual/provider provenance is retained in the issued PDF.
- The detailed document list remains supported internally in the shared document service for other portals; the applicant receipt page no longer renders it.

## Document layout

- All six PDF types: no visible "SUBJECT:" block. Centered main heading and right-aligned website / document name / Document ID footer are retained. Body paragraphs remain justified.
- For new documents the default printable starting line is 10 mm from the A4 top edge and footer base clearance is 3 mm. The footer *text itself* occupies more than 3 mm, so actual content stops above it. Existing admin-customized margins are preserved.
- For previously untouched top/bottom values 85/20, migration **037** changes the settings to 10/3. If your uploaded company letterhead has an extended masthead or artwork there, **increase these safe areas in Admin → Document Designer** before production.
- Receipts are rejected with a descriptive 422 if an excessively long admin-authored template would overflow a single page. Rather than dropping financial details or shrinking below readable sizes, shorten the additional receipt text.
- Transcripts and result statements with numerous published courses may require multiple pages; forcing one page would lose information or produce illegible text. Every page receives the standard footer. Pre-existing archived official PDFs retain the original exact bytes.
- The 3 mm lower clearance may be too close for **some non-borderless printers**. Use Fit to printable area for those printers or increase the bottom safe area.

## Faster printing

1. The backend returns archived bytes immediately after authorization and integrity validation, before doing unrelated application/template queries.
2. The frontend caches up to three PDFs of at most 5 MB in ephemeral page memory, keyed by user ID, document ID and SHA fingerprint. It never caches private PDFs in localStorage or a public CDN.
3. Hovering over or focusing the print button can warm the cache; a duplicate concurrent request is coalesced.
4. Opening/printing no longer triggers an unrelated full receipt-list reload.
5. Loading the Payment Receipts view does not automatically invoke provider verification or the database repair RPC. Applicants can explicitly select **Verify/Refresh payment** for pending receipts.
6. The payment-wait page uses websocket updates primarily, with a 30–120-second jittered fallback instead of a fixed 12-second database query for every applicant.

**Browser limitations:** The OS printer dialog cannot open until the browser has received and parsed the PDF; first-print delay still depends on network latency, letterhead image size, PDF viewer implementation and printer drivers. No absolute subsecond guarantee is made.

## Staging deployment order

1. Back up the Supabase database and verify previously applied migrations 001–036. Never reapply historical migrations manually.
2. Apply `supabase/migrations/037_compact_document_safe_areas.sql` once on staging.
3. Deploy Edge Functions `document-branding` and `student-document`.
4. Publish `frontend/js/pages/apply.js`, `frontend/js/official-documents.js` and `frontend/js/pages/admin-dashboard.js`. Invalidate cached static assets where needed.
5. Review the approved uploaded letterhead at 10 mm/3 mm. Increase safe areas if its branding would overlap text.
6. Using *synthetic accounts and payment events*, test a manual receipt and a provider-verified receipt; check that both have one page and show the correct provenance, website, document name and ID. Test long course/result lists and every PDF type.
7. Check browser print in Chrome, Firefox, Safari and Windows browsers/printers at a desktop and mobile viewport.
8. Before performance tests, obtain hosting-provider approval. Run the provided `tests/load/staging-read-only.js` against a *staging* origin; expand authenticated workload coverage only with consent, traffic budgets and production-like data.

## Capacity verdict: 100,000 requests/second

**Not ready / not verified.** No legitimate 100k RPS benchmark was run. The static Vercel-delivered frontend may benefit from edge caching, but Supabase Auth, PostgREST/RLS, PDF issuance, provider reconciliation, storage and Realtime are dynamically accessed shared dependencies. The application has no demonstrated sustained 100k authenticated transaction throughput.

Capacity programme: collect a traffic mix (static/reads/writes/payment callbacks/printing), set SLOs for p95/p99 latency and error rate, baseline via k6, profile PostgreSQL plans/indexes/locks using `pg_stat_statements`, allocate database pool sizing and compute, move immutable public assets behind a CDN, cache anonymous reads, queue PDF issuance/sheet sync/webhooks, place per-user and IP rate limits, and load-test against a production-like distributed architecture with provider sign-off. Consider dedicated/enterprise infrastructure and horizontal partitioning/sharding only after profiling. Authenticate before returning any private PDF; never cache them publicly.
