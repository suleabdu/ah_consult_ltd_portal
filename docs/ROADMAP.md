# Controlled next-phase roadmap

| Workstream | Implementation gate | Owner signoff |
|---|---|---|
| Staff MFA | Supabase TOTP enrollment + challenge before privileged operations, RLS/API AAL2 enforcement, recovery procedure | Security & operations |
| Payment portability | Provider interface and sandbox adapters for Paystack/Flutterwave/Stripe where legally available, webhooks, refund/reconciliation states | Finance |
| Currency support | ISO currency column, minor-unit integer amounts, FX conversion source, immutable provider snapshots and migration | Finance & engineering |
| Privacy exports | Identity-verified self-service authenticated export, third-party document controls and audit logs | Privacy officer |
| Retention | Written records schedule, legal holds and referentially safe erasure | Client & counsel |
| Localization | Central catalog, translation QA, locale-aware price and date formats | Product |
| Observability | Request-ID log correlation, authenticated health checks, alert policy and redacted telemetry | Operations |
| Browser quality | Playwright three-breakpoint baselines and approvals; axe, Lighthouse CI, E2E on synthetic local Supabase | Engineering |
| Showcase | Separate demonstration project; synthetic accounts; non-production URLs; client written permission | Client |

The current package preserves the original financial and authorization contracts rather than prematurely changing deployed schemas or exposing incomplete alternate gateways.
