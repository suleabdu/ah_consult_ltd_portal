# ADR 001 — Google Sheets is a projection, not a control plane
**Status:** Accepted · 28 October 2026

**Context:** Spreadsheets are convenient for nontechnical staff but lack the authorization, consistency and audit guarantees required for financial and student records.

**Decision:** Supabase PostgreSQL is the system of record. Database-triggered outbox jobs feed a read-only Google Sheet. No sheet action can mark payments paid, approve applicants, or edit primary records.

**Consequences:** A temporary sync delay is acceptable; reconcile outbox counts to database rows and retry failed jobs. Never store privileged database credentials in Apps Script or the public site.
