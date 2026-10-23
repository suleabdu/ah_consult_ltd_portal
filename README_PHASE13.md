# AH STUDENT HUB — Phase 13 Release Package

Phase 13 focuses on end-to-end QA, frontend routing reliability, and production cutover hardening.

## Key fixes
- `/apply#signin` 404 hardened across Vercel, Netlify and static/GitHub hosting.
- Student-login redirect now uses `apply.html#signin`.
- Authenticated new-student blank-page bug fixed by correctly targeting `#content` after sign-in.
- Continue/Back wizard controls hardened and navigation-step clicks now change the stage.
- Header controls made visually discoverable and higher contrast.
- Corrected Phase 11 migration 021 is included.
- Added migration 023 cutover diagnostic.
- Added static frontend audit and Playwright staging E2E harness.

## Validation
Run:

```bash
python3 scripts/phase13_frontend_audit.py
```

Expected: 0 errors.

For live browser QA, use `tests/e2e/` against a staging deployment with a dedicated pseudonym QA account.
