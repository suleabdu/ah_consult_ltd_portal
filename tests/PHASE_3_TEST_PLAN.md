# Phase 3 Test Plan

## Database
- Apply migrations 001–013 to a staging Supabase project.
- Verify `exam_results` exposes `attendance`, `ca`, `exams`, `total`, `band`.
- Verify a tutor cannot write a course they do not teach.
- Verify `admin_set_lecturer_active(false)` suspends the linked staff account.
- Verify `admin_delete_lecturer()` suspends the linked account and removes lecturer-owned academic content.
- Verify a pending course addition can be cancelled by its student and a paid/approved one cannot.
- Verify pending deferment can be cancelled; approved/rejected deferments cannot.

## Student application
1. Create/sign in as a test student.
2. Start an application.
3. Confirm order: Intake → Details → Category/Package → Courses → Payment.
4. Confirm passport uploads before payment.
5. Confirm payment success opens Preview.
6. Confirm Preview shows passport and all submitted details.
7. Confirm unchecked final confirmation blocks submission.
8. Submit and verify status becomes Submitted/Under review.
9. Approve admission in admin and verify first-time status page shows congratulations and a 15-second portal handoff.
10. Return again and verify immediate portal redirect.

## Student portal
- Profile shows passport and every application field.
- Courses show course name + category.
- Unpaid extra-course request has Delete; after payment claim it is no longer deletable.
- Deferment page allows course selection, reason and cancellation while pending.
- Lectures open their material links.
- Exams require Start Exam before the clock begins.
- Timed exams expire server-side.
- External assessment requires explicit student submission confirmation.
- Results show Attendance 40%, CA 30%, Exams 30% and total 100%.

## Tutor portal
- A tutor with multiple courses sees `Course Name (Category)` everywhere.
- Tutor can create Online/Paper assignments and exams.
- Tutor can add unlimited questions.
- Bulk question import accepts `Question, Options, Mandatory`.
- File-required assessments request a Drive/file link.
- Exam time allowance is stored and enforced.
- Bulk results import accepts `Student ID, Course Code, Attendance, CA, Exams`.
- Invalid score ranges are rejected.
- Feedback shows sender, course, category, intake and student ID.

## Admin portal
- Lecturer student counts are visible.
- Deactivate blocks tutor login.
- Delete suspends the tutor account and removes lecturer-owned teaching content.
- Registered tutor accounts can be searched and linked.
- Course assignment shows name + category.
- Deferment queue supports approve/reject.
