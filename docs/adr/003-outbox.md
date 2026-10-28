# ADR 003 — Asynchronous outbox for reliable projections
**Status:** Accepted · 28 October 2026

**Context:** Synchronous updates to third-party services can fail after the database transaction succeeds.

**Decision:** Record outbox jobs in the same database as source changes; workers claim them, retry failures and preserve auditability. Read-only sheet sync and communications use this pattern.

**Consequences:** Monitor pending, retrying and failed jobs. Idempotency is required for delivery to external systems. External projections may lag the canonical database.
