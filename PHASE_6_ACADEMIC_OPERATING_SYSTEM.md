# AH STUDENT HUB — Phase 6: Academic Operating System

Phase 6 moves the platform from a student portal into an authoritative academic operating system.

## What changed

### 1. Academic lifecycle history
- Adds `application_state_history`.
- Automatically records application status transitions.
- Students can see the lifecycle of their application.

### 2. Result publication and locking
`exam_results` now has:
- `published_at`
- `published_by`
- `locked_at`
- `locked_by`
- `revision_no`

New server-authoritative actions:
- `publish_result(uuid)` — Academic/Registrar/Administrator.
- `lock_result(uuid)` — Academic/Administrator.

Tutor result saving is now blocked after publication or locking. This prevents a published academic result from changing silently.

### 3. Authoritative Academic Record
New RPC:
- `student_academic_record(uuid)`

It returns the student's identity, intake, courses, published results, summary and lifecycle history in one controlled response.

The student portal now includes **Academic Record** and the normal Results page only displays **published** results.

### 4. Student 360 search
New RPC:
- `admin_student_360(text)`

It provides staff with a controlled cross-reference of student ID, name, email, phone, intake, admission state, course count and graded-course count.

### 5. Action Center hardening
`admin_action_center()` now uses explicit staff roles rather than the broader `is_admin()` helper and also exposes unpublished/locked result counts.

## Migration order
Run all migrations in order:

`001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012 → 013 → 014 → 015 → 016`

## Important
Phase 5 had one SQL compatibility issue in its timeline payment entry because the `payments` table does not have a `status` column. The Phase 5 migration included in this package has been corrected before Phase 6 is applied.

No live production database was changed by this build. Apply to staging first and test:
- student login
- admission/application lifecycle
- tutor grading
- result publication
- result locking
- student Results / Academic Record
- admin Action Center
- Google Sheet synchronization

## Design principle
The platform now separates three concepts:

**Tutor enters → Academic publishes → Academic/Administrator locks.**

That distinction is important for a production academic system because a grade being entered is not the same thing as an official result being published.
