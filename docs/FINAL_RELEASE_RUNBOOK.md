# AH STUDENT HUB — Final Release Runbook

## Release philosophy

The application should be shipped only after the **same build artifact** passes local validation and staging E2E. The production database must never be used as a substitute for QA.

## Gate A — Static source

```bash
python3 scripts/phase13_frontend_audit.py
python3 scripts/phase14_release_gate.py
```

Expected result:

```text
errors: 0
warnings: 0
PASS
```

## Gate B — Database structure

Confirm migrations are continuous from `001` through `023`. Run the release-readiness and Phase 13 diagnostic SQL against staging.

## Gate C — Browser regression

The minimum student regression circle is:

1. `/apply.html#signin` opens.
2. Sign-in form is visible.
3. Successful sign-in renders `#content` immediately.
4. Header profile/settings controls are visible.
5. Continue moves the wizard forward.
6. Back returns to the previous permitted stage.
7. Sign-out returns to sign-in.
8. Refresh after sign-out does not restore the session.

## Gate D — Student lifecycle

Test with the pseudonym QA student:

```text
Register/login
→ application draft
→ personal details
→ category/package
→ course
→ payment sandbox
→ payment verification
→ preview
→ confirm
→ submit
→ admission status
→ student portal
→ assignments
→ lectures
→ examinations
→ results
→ profile
→ password reset
→ sign-out
```

## Gate E — Staff roles

Test separately:

```text
Admin login
→ registrations
→ admissions
→ course/tutor assignment
→ academic controls
→ documents
→ notifications
→ audit/system health
```

and:

```text
Tutor login
→ assigned students
→ lectures
→ assignments
→ submissions
→ examinations
→ grading
→ results
```

## Gate F — Data integrity

For a controlled QA record, verify the same logical record exists in:

- Supabase authoritative tables.
- `sheet_sync_outbox`.
- Google Sheet mirror.

Then test update and delete behavior where the application permits it. The final sheet state must reconcile to the database state.

## Gate G — Security

Confirm:

- no service-role key in frontend files;
- no Google private key in the repository;
- RLS blocks cross-student access;
- student cannot invoke admin-only RPCs;
- tutor sees only assigned academic records;
- private files cannot be fetched anonymously;
- payment webhooks validate their signatures;
- Edge Functions enforce origin/token requirements appropriate to the environment.

## Gate H — Production promotion

Only after all staging gates pass:

1. Tag the tested Git commit.
2. Deploy that exact commit to production.
3. Apply only migrations not already present.
4. Verify the production site with non-destructive smoke checks.
5. Monitor Edge Function logs and Sheet outbox processing.

## Known environment limitation

This development environment can run source/static validation, migration structural validation and prepare the browser E2E harness, but it cannot authenticate into the user's private Supabase/Vercel/GitHub accounts. Therefore a live staging E2E result must never be fabricated here.
