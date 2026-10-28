# ADR 002 — Prices and payment claims are server-authoritative
**Status:** Accepted · 28 October 2026

**Context:** Client-selected price amounts and unverified payment redirects can be manipulated.

**Decision:** Clients select course identifiers; the server reads active pricing from Postgres and creates idempotent attempts. Provider results are verified by an authenticated backend route; signed callbacks and amount checks gate finance records. Receipt PDFs are archived with integrity hashes.

**Consequences:** New payment-provider adapters must implement shared verification and idempotency behavior and pass sandbox tests before they can be enabled. Do not expose service-role or provider secrets to clients.
