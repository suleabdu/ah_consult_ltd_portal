# Security exception register

Exceptions are temporary, risk-owned decisions. They are not silent waivers and do not replace remediation.

## DEV-2026-10-31-ESLINT

| Field | Record |
| --- | --- |
| Scope | Development-only linting dependency graph: `eslint@10.14.0`, `@eslint-community/eslint-utils@4.10.1`, `@eslint/config-array@0.23.5` and transitive `minimatch@10.2.6` |
| Finding | `npm audit` currently reports four moderate findings in the development linting path. The registry's automated proposed fix is an unsafe downgrade to `eslint@4.0.0`; it must not be applied automatically. |
| Production exposure | The release gate must run `npm audit --omit=dev --audit-level=high`. This exception does not waive a production dependency finding. |
| Interim controls | Lockfile committed; full static tests run in CI; no lint tooling is deployed to the static production site; review on every dependency update. |
| Required owner action | Track upstream remediation, test a supported upgrade in a branch, and obtain security-owner acceptance or replace the toolchain before the exception expiry. |
| Owner | Technical lead and security owner |
| Expiry | 2027-01-31, or immediately if a production path, exploit evidence, or supported remediation becomes available |
| Evidence to attach | `npm audit --json` report stored privately, CI run URL, decision record and remediation test result |

## Rules

- An exception must have an owner, scope, compensating controls, evidence, review date and expiry.
- A critical/high production dependency finding blocks release unless a documented executive risk acceptance explicitly says otherwise.
- Do not include tokens, package-manager credentials, customer data or confidential vulnerability details in this file.
