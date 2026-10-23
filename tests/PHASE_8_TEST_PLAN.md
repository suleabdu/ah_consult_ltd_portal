# Phase 8 Test Plan

## Database
- [ ] 018 applies cleanly after 001–017.
- [ ] `management_analytics()` works for permitted staff roles.
- [ ] `management_analytics_breakdown()` returns JSON arrays.
- [ ] `admin_student_360()` returns expected students.
- [ ] `admin_student_360_detail()` returns application, courses, results, payments, documents and timeline.
- [ ] `request_document_job()` rejects non-staff users.
- [ ] `issue_document_job()` creates/updates a Student Documents record.
- [ ] `audit_center()` is administrator-only.
- [ ] `sheet_reconciliation()` is administrator-only.
- [ ] `communication_outbox` is not directly writable by browser users.

## Admin UI
- [ ] Institutional Intelligence loads without console errors.
- [ ] Student 360 search finds a real student by ID/name/email/phone.
- [ ] Student 360 displays correct admission/payment/course/result information.
- [ ] Admission Letter prints correctly.
- [ ] Payment Receipt prints correctly.
- [ ] Transcript prints correctly.
- [ ] Certificate prints correctly.
- [ ] Issued document appears in Student Documents.
- [ ] Audit Centre filters correctly.
- [ ] Sheets Reconciliation displays queue state.
- [ ] Full mirror refresh requires confirmation.

## Security
- [ ] Viewer cannot issue documents.
- [ ] Viewer cannot access Audit Centre.
- [ ] Non-administrator cannot call audit_center.
- [ ] Student cannot insert into document_jobs or communication_outbox directly.
- [ ] RLS remains enabled on new tables.
