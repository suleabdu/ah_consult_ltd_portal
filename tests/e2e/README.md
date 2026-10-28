# Pseudonym end-to-end browser test

This folder is the live-browser test harness. It is intentionally separate from the static audit.

## Required test account
Use a **staging Supabase project** and a pseudonym test student, for example:

- Name: `AH QA Student`
- Email: a dedicated QA mailbox you control
- Phone: a non-production QA number
- Password: a dedicated QA password

Do not run destructive tests against production student records.

## Browser runner
The test is written for Playwright. Install Playwright in your local QA environment, then set:

```text
E2E_BASE_URL=https://YOUR-STAGING-SITE.example
E2E_STUDENT_EMAIL=...
E2E_STUDENT_PASSWORD=...
```

The test deliberately verifies the reported regressions first: clean/HTML routes, sign-in rendering,
visible header controls, wizard Continue/Back behavior, and student-portal access. Extend the same
fixture through payment, submission, academic, tutor, admin and sign-out workflows before go-live.
