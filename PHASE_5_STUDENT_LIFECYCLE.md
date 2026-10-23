# Phase 5 — Student Lifecycle & Command Center

This phase turns AH STUDENT HUB into a cohesive student-lifecycle product while preserving the AH Minimal Academic visual system.

## Student experience
- My Activity: application, payment, admission and assessment timeline.
- Document Center: submitted passport/payment documents and server-issued student documents.
- Notifications: persisted server messages plus live application/payment/admission status notices.
- Academic Journey: dashboard progress and quick access.

## Admin experience
- Action Center metrics for applications, payments, deferments, students and operational exceptions.
- Global search for applications/students, courses and lecturers from the admin header.

## Migration
Run `015_student_lifecycle_command_center.sql` after migrations 001–014.

## Security
Student notifications/documents are read-only from the browser. Official writes remain server-side. Notification read state is changed only through `mark_notification_read()` and scoped to the signed-in student.

## UX principles
- Light gray background, white surfaces, black typography, restrained AH orange accent.
- Clear hierarchy, generous spacing, minimal shadows.
- Mobile-first cards/tables and large touch targets.
