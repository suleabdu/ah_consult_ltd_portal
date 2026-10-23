# AH STUDENT HUB — Phase 13: End-to-End QA, Frontend Routing & Cutover Hardening

## Lead-engineer objective
No release is shipped from static inspection alone. Phase 13 establishes a release gate that combines:

1. static source validation;
2. route/link validation;
3. browser E2E validation with a pseudonym QA account;
4. database/RPC regression checks;
5. payment/application workflow checks;
6. staff/tutor/admin authorization checks;
7. Google Sheets mirror reconciliation;
8. final cutover checklist.

## Reported bugs addressed in this build

### 1. `/apply#signin` 404
Root cause: the application was generating extensionless routes while a generic/static host can only resolve the physical `apply.html` file. Netlify/Vercel rewrites exist, but the frontend must also remain portable to static hosting/GitHub Pages.

Fix:
- internal application links now target `apply.html` (production hosts may canonicalise it to `/apply`);
- the student-login bridge targets `apply.html#signin`;
- a `404.html` fallback maps supported clean paths back to their physical HTML files while preserving query strings and hashes.

### 2. New student sees a blank application page
Root cause: after authentication `authView()` left the shared `view` variable pointing at hidden `#authForm`. `showApp()` did not switch it to `#content`. The first `pickView()/wizard()` render therefore happened inside the hidden authentication container. Clicking Profile happened to reset `view` to `#content`, making the page appear.

Fix:
- `showApp()` sets `view = $('#content')`;
- `wizard()` defensively sets the same target every time.

### 3. Continue / Back buttons appear not to work
The buttons were rendered into the hidden auth container because of the issue above. Additional hardening was added:
- explicit `type="button"`;
- `preventDefault()` in navigation handlers;
- Back decrements the current wizard stage only when valid;
- navigation-step clicks now actually set `S.w.n` before rendering.

### 4. Header controls are difficult to discover
The application header now uses high-contrast outlined controls, a visible orange avatar, stronger hover/focus affordances, and mobile-friendly icon-only controls.

## Static release gate
Run:

```bash
python3 scripts/phase13_frontend_audit.py
```

Expected result:

```text
PHASE 13 FRONTEND AUDIT
errors: 0 warnings: 0
PASS: static frontend release gate
```

## Live pseudonym test sequence
Run against **staging**, not production:

1. Create pseudonym QA student.
2. Open `/student-login.html` and verify automatic sign-in redirect.
3. Open `/apply.html#signin` directly.
4. Sign in.
5. Verify the application content is visible without clicking Profile/Summary.
6. Verify Summary, profile avatar and Settings are visually discoverable.
7. Create/select intake.
8. Continue to Details.
9. Back to Intake.
10. Continue to Category.
11. Select a category.
12. Continue to Courses.
13. Select a course.
14. Continue to Payment.
15. Verify payment details.
16. Complete the staging payment flow.
17. Preview application.
18. Back/forward through permitted stages.
19. Confirm and submit.
20. Verify application status.
21. Verify admitted-state routing when the test account is marked admitted.
22. Verify Student Portal opens.
23. Verify portal home, applications, courses, assignments, lectures, exams, results, tutors and profile.
24. Verify sign out clears the session and returns to sign-in.
25. Repeat with a staff/tutor QA account for authorization boundaries.
26. Reconcile Supabase records against the Google Sheets mirror.

## Ship gate
A release is **blocked** by any:

- 404 on an internal route;
- blank authenticated page;
- console exception on first load;
- non-working Continue/Back;
- inaccessible header control;
- unauthorized RPC/data exposure;
- payment/application mismatch;
- missing Sheets mirror record;
- duplicate Sheet row;
- stale result visibility;
- sign-out/session persistence failure.

Warnings may be accepted only when explicitly documented by the release owner.
