# AHCT Portal: 100k requests/second readiness review

**Verdict:** **Not demonstrably capable of 100,000 requests per second** on the current unbenchmarked frontend + single Supabase project architecture. Do not advertise this throughput.

## What 100k RPS means

100,000 HTTP requests each second sustained is approximately **8.64 billion requests/day**. It is not the same as 100,000 accounts or 100,000 people simultaneously online. For example, 100,000 users making one backend request each 30 seconds yields approximately 3,333 backend requests/sec before image assets, static JS and extra calls.

## High-risk request paths in this source

- Application status and payment verification: authentication, RLS checks and reads/writes to a single primary PostgreSQL cluster.
- PDF printing: authorization, storage download, SHA-256 verification; first issuance also embeds a full-page letterhead, queries template and application state, and archives a new document.
- Payment webhooks: verification and idempotent ledger mutation, which must not depend on client polling.
- Realtime and historic 12-second polling: reduced in V18.6.4, but other high-frequency subscriptions and admin refreshes still need measurement.
- Postgres bottleneck: even if Vercel can serve static HTML at high edge throughput, the database and auth services are distinct capacity limits.

## Required production architecture before a large launch

1. **CDN for public assets**, versioned files, compressed/minified JS/CSS, cache policies; avoid repeated static hits on Supabase.
2. **Independent read / write paths**: read replicas for eligible analytics/public reads; writes go to the transactional primary. Use RLS-aware API authorization; no cached cross-user private records.
3. **API gateway / WAF / admission control**: per-IP and per-user throttling, DDoS mitigation, concurrency ceilings and a clear overloaded response.
4. **Async work queues**: issue PDFs, sync sheets, process notifications and heavy reconciliation in workers with backoff/dead-letter queues and idempotent task keys. Transactions and webhooks should ACK quickly after durable recording.
5. **Database engineering**: instrument query plans and waits, right-size indexes and connection pools, avoid full-table scans, partition only after evidence, optimize heavy policies/RPCs and reduce writes on read paths.
6. **Observability and SLO**: OpenTelemetry request IDs, p50/p95/p99, RPS by route, error budgets, database saturation, Auth limits, memory/CPU, queue depth, PDF sizes, frontend page vitals.
7. **Provider quotas and recovery**: negotiate limits with Supabase/Vercel, exercise outages, failover, payment webhook retries and disaster recovery.
8. **Staged k6 trials**: start at ~10–50 RPS on a separate staging project, then 100/1k/5k+ after provider coordination and monitoring. A full 100k RPS test is a specialist exercise, not a default CI test.

## Proposed performance gates (targets, not measured values)

- Public static: p95 under 200 ms at edge (assuming regional CDN cache hit).
- Authenticated read: p95 under 500 ms for representative regions.
- Payment acknowledgement: p95 under 1 second excluding external settlement latency.
- Download previously issued PDF: p95 under 2 seconds for 1 MB objects, with storage/network variability.
- Backend errors <0.1% at agreed, observed traffic tiers.

None of these are proven by unit tests or static analysis. Preserve payment accuracy and audit integrity ahead of raw speed.
