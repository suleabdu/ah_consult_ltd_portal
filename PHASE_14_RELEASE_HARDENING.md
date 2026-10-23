# AH STUDENT HUB — Phase 14 Release Hardening

Phase 14 is a controlled continuation of Phase 13. It does not add academic features. It strengthens the release gate before live staging execution.

## Completed locally
- Expanded Playwright student smoke coverage.
- Added browser console/page-error fail-fast behavior.
- Added explicit Continue → Back regression coverage.
- Added sign-out/session-persistence coverage.
- Added source-route, migration-ledger and frontend credential-safety checks.
- Kept all live tests parameterized through `E2E_BASE_URL`, `E2E_STUDENT_EMAIL`, and `E2E_STUDENT_PASSWORD`.

## Important boundary
Live Auth, Supabase, payment, Sheets, tutor, admin and browser E2E are **not marked passed** until a staging deployment and dedicated pseudonym QA accounts are supplied.

## Run local gate
```bash
python3 scripts/phase14_release_gate.py
python3 scripts/phase13_frontend_audit.py
```

## Run live staging E2E
```bash
E2E_BASE_URL=https://YOUR-STAGING-SITE \
E2E_STUDENT_EMAIL=qa.student@example.com \
E2E_STUDENT_PASSWORD='YOUR-QA-PASSWORD' \
 npx playwright test tests/e2e/student-smoke.spec.js
```

Never place production credentials in source control or run destructive tests against real student records.
