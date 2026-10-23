# AHCT SMS — Phase 3 Academic Experience & Production UX

Phase 3 builds on migrations 001–012 and adds the academic workflow and student experience requested for production use.

## Migration

Apply `supabase/migrations/013_phase3_academic_engine.sql` after `012_integrity_engine.sql`.

### What Phase 3 adds
- Draft-first application flow: Intake → Applicant Details → Category/Package → Courses → Payment → Payment Success/Preview → Confirm → Submit for Review → Status.
- Passport upload before payment, with server validation and private storage.
- Complete student profile preview with passport and submitted details.
- Admission/status experience with first-time 15-second portal handoff and immediate returning-student redirect.
- Unpaid extra-course deletion.
- Professional deferment workflow with cancellation while pending and admin approval/rejection.
- Tutor access is tied to an active lecturer record; deactivation suspends tutor login.
- Lecturer statistics and delete/deactivate controls.
- Registered tutor-account search/linking when assigning lecturers.
- Course labels consistently include category.
- Official grading model: Attendance 40% + CA 30% + Exams 30% = 100%.
- Bulk Excel/CSV result import.
- Assignment/exam question builders with unlimited questions, Online/Paper mode, file requirement, external links, bulk question import and exam time limits.
- Server-side exam attempt/timer records.
- Student lecture viewing and improved assessment UX.
- Tutor feedback with sender, course, category, intake and student ID.

## Excel result format
The first sheet must use exactly these headers:

`Student ID | Course Code | Attendance | CA | Exams`

Rules:
- One student/course per row.
- Attendance: 0–40.
- CA: 0–30.
- Exams: 0–30.
- Student ID must exactly match the portal roster.
- Course Code must exactly match the course code.
- Do not rename headers or merge cells.

## Question bulk-import format
Use these columns:

`Question | Options | Mandatory`

- One question per row.
- `Options` contains choices separated by `|`, for example: `A|B|C|D`.
- Leave Options blank for an open-answer question.
- Mandatory must be `Yes` or `No`.

## External-link workflow
For an external assignment/exam, the tutor supplies the link. The student opens it, completes the external work, returns to AHCT SMS and explicitly confirms submission. The system does not treat merely opening a link as submission.

## Security notes
- Supabase/PostgreSQL remains authoritative.
- Google Sheets remains a reporting mirror through the Phase 2 durable outbox.
- Exam timing is server-authoritative.
- Lecturer deactivation blocks Tutor Portal access at both staff and lecturer level.
- Student deferment/cancellation and extra-course deletion are server-authorized RPCs.

## Deployment order
1. Apply migrations 001–013 to staging.
2. Deploy `create-application` and all existing Edge Functions.
3. Deploy the frontend files.
4. Test with dedicated student, tutor and administrator accounts.
5. Only after staging passes, apply migration 013 and deploy to production.
