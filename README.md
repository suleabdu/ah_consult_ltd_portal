
> **Security first:** use `SECURITY_FIRST_STABILIZATION.md` before deployment. The previous archive contained exposed credentials; rotate them at their issuing providers. This package excludes those files but cannot revoke the original values.


> **Current release path — Supabase edition (Phase 12):** the active student, tutor and administrator portals use the static pages under `frontend/`, Supabase Auth/Postgres, and the Edge Functions under `supabase/functions/`. For a fresh staging database, apply migrations `001` through `022` once, in numerical order. For an existing database, inspect what actually applied before using forward repairs; never replay migration `013` after migration `021` has introduced `grading_model`. Deploy `frontend/` as the static site and configure/deploy the Supabase Edge Functions separately. Do not follow the older Flask/Sheets-only deployment walkthrough below when releasing the Phase 8+ Supabase build. That Python/Sheets implementation remains in `backend/` and is retained as a separate legacy track; it is not the database layer for the current Supabase portals.

See [`PHASE_12_SYSTEM_AUDIT_AND_RELEASE_HARDENING.md`](PHASE_12_SYSTEM_AUDIT_AND_RELEASE_HARDENING.md), [`tests/phase12_preflight.sql`](tests/phase12_preflight.sql), and [`tests/PHASE_12_ACCEPTANCE_PLAN.md`](tests/PHASE_12_ACCEPTANCE_PLAN.md) for the full-system audit, database preflight and staging acceptance steps. Phase 11 documents remain as historical release notes.

# AH Student Hub — Supabase Edition / legacy Python compatibility files

This repository preserves the original Flask/Google Sheets implementation and the newer Supabase-backed student management release. For Phase 12 and earlier Supabase releases, Supabase Auth/Postgres is the source of truth, the static frontend deploys to Netlify or Vercel, and Supabase Edge Functions handle privileged operations. Google Sheets is the synchronized reporting mirror for this release. The older Python/Sheets deployment notes below remain for that separate compatibility track.

The backend authenticates to Sheets/Drive as **your own Google account**
(the one that owns the spreadsheet) via a stored OAuth refresh token —
**not** a service account, which has no personal Drive storage of its own
and can't upload files into a regular Gmail account. See
`docs/ARCHITECTURE_AND_DECISIONS.md`, Section 12, for why.

## Start here

**New to this project? Read [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md)
first** — it's a complete, ordered walkthrough from an empty Google
account to a live site: Google Cloud credentials, the spreadsheet,
running things locally, GitHub, Render, and Netlify.

**Then read [`docs/ARCHITECTURE_AND_DECISIONS.md`](docs/ARCHITECTURE_AND_DECISIONS.md)**
— it documents every place this rewrite made a judgment call, fixed a
bug, resolved a conflict between the supplied source files, or completed
a phase the original project hadn't built yet. A few of these are worth
AH Consult Ltd's explicit sign-off, not just silent acceptance — they're
flagged clearly.

## Project layout

```
backend/                  Flask API (deploy to Render)
  app/
    config.py             Sheet names, header schemas, business constants
    services/
      sheets.py            Google Sheets/Drive client (the "database" layer)
      ids.py                Student ID / Course Code / etc. generation
      security.py           Password hashing, JWT sessions, audit logging
      email_service.py      Outbound SMTP email (confirmation, reset links)
      data_service.py       Cross-sheet joins shared by multiple blueprints
      settings_service.py   Intake scheduling + the dynamic Part 1 form
      analytics_service.py  Leaderboard recalculation
      payment_service.py    Optional live Monnify integration
    blueprints/
      auth.py               Login, password setup/reset, sessions
      registration.py       Public application portal (Stages 1-4)
      student.py             Student Portal
      tutor.py                Tutor Portal (assignments, grading, lectures, exams, results)
      admin.py                 Admin Dashboard
  requirements.txt, Procfile, render.yaml, gunicorn_config.py, .env.example

frontend/                 Static site (deploy to Netlify)
  index.html               Landing / home page (adapted from the AH Consult marketing site)
  apply.html                Public Application Portal (4 stages + receipt) — was index.html
  student-login.html / staff-login.html
  setup-password.html / forgot-password.html / reset-password.html
  portal.html               Student Portal
  tutor.html                 Tutor Portal
  admin-dashboard.html        Admin Dashboard (registrations, Tutors, Intake Modes)
  js/                        One file per page/concern — api.js is the fetch()
                              wrapper every page uses instead of google.script.run;
                              components.js renders the shared sidebar/header,
                              including the mobile drawer nav
  css/styles.css             Shared visual identity for the app pages (ported from
                              Styles.html) — index.html keeps its own separate
                              design system, matching the marketing site it's from

setup/
  get_refresh_token.py      Run ONCE, locally, to authorize your Google account
  requirements.txt

docs/
  SETUP_GUIDE.md            Full deployment walkthrough — start here
  ARCHITECTURE_AND_DECISIONS.md   Every judgment call, flagged and explained
```

## The short version of what changed

- **Student ID format** now follows the supplied "ID Generation and
  Meaning" document (`AHCT2690001`) instead of the live code's old
  `AH/4-BIPF/001` format.
- **Tutor ID is now the tutor's email address**, per that same document.
- **Google authentication uses an OAuth refresh token for a real Google
  account, not a service account** — see above and Section 12 of the
  architecture doc.
- Two phases the original `.gs` files hadn't built yet — the **Lecture
  System** and **Examination System** — are now real, plus a proper
  **Grade Student / Results** flow and automatic **Leaderboard**
  recalculation.
- **Tutor assignment is now explicit and admin-controlled** rather than
  automatic — see Section 14 of the architecture doc.
- **A new landing/home page** (`index.html`) now fronts the app,
  adapted from AH Consult Ltd's marketing site, linking out to Apply /
  Student Login / Staff Login — the registration form itself moved to
  `apply.html`. See Section 15.
- **A critical deadlock bug was found and fixed** — new registrations
  could hang forever at "Submitting..." without ever writing to the
  Registrations sheet. See Section 13.
- **All three dashboards now have real mobile navigation** (a slide-in
  drawer) instead of the sidebar simply vanishing on phone-width
  screens. See Section 16.
- Everything else — the registration flow, admissions, assignments,
  submissions, dashboards, and the visual design — was ported as
  faithfully as possible; the app should look and behave like the
  original wherever the specification didn't call for a change.

Full detail, including a few open items worth AH Consult Ltd's sign-off,
is in [`docs/ARCHITECTURE_AND_DECISIONS.md`](docs/ARCHITECTURE_AND_DECISIONS.md).

## Phase 9 — Production Automation & Governance

The latest package adds append-only audit governance, versioned document templates, server-rendered institutional documents, communication preferences, an idempotent outbound communication queue, protected communication workers, and a System Health view. See `PHASE_9_PRODUCTION_AUTOMATION_GOVERNANCE.md`.


## Phase 12 — Full-System Audit & Release Hardening

The latest release repairs migration repeat-safety, rewrites the malformed `portal_data()` SQL, makes student result payloads publication-safe, explicitly grants the allowed application RPCs after removing implicit `PUBLIC EXECUTE`, restricts service-worker primitives, hardens private academic-file reads, reconciles the authoritative 18-row `sheets/courses_rows.csv` catalog, and adds the admin-only `system_audit_snapshot()` diagnostic RPC.

**Release caution:** Phase 12 has passed static source validation, but no live PostgreSQL execution was available in this environment. Apply it to a backed-up staging Supabase project and pass the SQL preflight and role-by-role acceptance tests before promoting to production. See `PHASE_12_SYSTEM_AUDIT_AND_RELEASE_HARDENING.md`.
#   a h _ c o n s u l t _ l t d _ p o r t a l  
 