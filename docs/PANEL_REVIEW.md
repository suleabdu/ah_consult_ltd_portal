# Panel review guide

## Scope and status

This package is a source-review candidate for AH Consult Ltd V18.8.1. It is intended to support technical and operational review of the corporate website, Student Hub and governed Supabase platform. It is not evidence of a production deployment, penetration-test certification, accreditation or authorization to publish a public demonstration.

## Suggested evidence route

| Review topic | Primary evidence |
| --- | --- |
| Product scope and source layout | [Repository README](../README.md) and [Architecture](ARCHITECTURE.md) |
| Security model and outstanding owner actions | [Security incident response](SECURITY_INCIDENT_RESPONSE.md), [SECURITY.md](../SECURITY.md) and CI workflow |
| Global release and ISMS controls | [Global panel readiness control register](GLOBAL_PANEL_READINESS.md) and [security exception register](SECURITY_EXCEPTIONS.md) |
| Database controls and migration sequence | `supabase/migrations/`, `tests/sql/` and [Architecture](ARCHITECTURE.md) |
| Browser journeys and accessibility-minded controls | `frontend/`, `tests/browser/` and `tests/unit/` |
| Official-document governance | [Document issuance policy](DOCUMENT_ISSUANCE_POLICY.md), [Native Document Studio](NATIVE_DOCUMENT_STUDIO.md) and [synthetic previews](samples/README.md) |
| Current staging/deployment scope | [V18.8.1 deployment guide](releases/DEPLOY_V18_8_1.md) |
| Earlier decisions and release history | [Release history](releases/README.md) and [archived reports](archive/) |

## Reproducible checks

Run the following only in an isolated development or staging environment:

```bash
npm ci
npm run check
```

The CI workflow additionally performs full-history secret scanning, Deno Edge Function checks, PostgreSQL migration and SQL tests, a production dependency audit, and a vendored-asset reproducibility check. Those gates should be run on the final, clean review commit before circulation.

## Required review boundary

- Do not supply or request production credentials, real student records, payment data or customer documents for this review.
- The committed browser configuration is intentionally inert; deployment generates public browser configuration from build-time environment variables.
- Treat the sample PDF artefacts as synthetic design evidence only. Their placeholder identity information must be configured before any official document can be issued.
- Exclude `.git/`, `node_modules/`, `supabase/.temp/` and local environment files from an external archive.

## Matters requiring independent confirmation

The source can demonstrate designed controls and automated checks, but it cannot establish live operational facts. Before a panel makes any production-readiness conclusion, independently confirm the security incident-response owner actions, staging deployment results, payment-provider sandbox results, accessibility testing, cross-device browser testing, credential rotation and formal policy approvals described in the linked security and release materials. The [global readiness register](GLOBAL_PANEL_READINESS.md) is the required evidence checklist.

