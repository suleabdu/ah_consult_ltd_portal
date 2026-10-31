# AHCT V18.7.5 — Guided bulk manual applications and public-content improvements

## Deployment order (staging first)

1. **Back up** the production database and verify all migrations through `042` are present. Do not modify older migrations.
2. Apply `supabase/migrations/043_manual_application_bulk_import.sql` to a **staging** Supabase project, then check the new tables and `ahct_import_application_row` RPC. Confirm RLS allows no direct applicant/staff access to the staging tables.
3. Deploy the staff-authenticated Edge Function:
   ```sh
   supabase functions deploy admin-bulk-import --no-verify-jwt
   ```
   This flag prevents a gateway rejection before CORS; the function checks the real access token and approved `administrator`/`registrar` role using Supabase Auth and the `staff` table.
4. Publish `frontend/admin-dashboard.html`, `frontend/js/pages/admin-dashboard.js`, `frontend/js/pages/admin-bulk-import.js`, `frontend/templates/AHCT_Manual_Application_Bulk_Template.xlsx`, `frontend/templates/AHCT_Manual_Application_Bulk_Template.csv`, and the updated `frontend/index.html`.
5. Configure a verified sender, invitation email template and redirect URL in Supabase Auth. **Test with synthetic addresses first.** The import sends real account invitations on commit, never plain-text passwords.
6. Sign in as an approved Registrar/Administrator. Open **Bulk registration** under Administration and tools. Download a template, populate a single synthetic row with a unique `Source Reference`, an intake label and active published `Course Codes` (for example `ACAD1`). Validate, review the preview and confirm. Check the email invitation and that the new application is a **draft**, not paid or approved, with no Student ID.
7. Test rejection of duplicate paper reference, reused email, a draft course, unknown intake, invalid DOB, corrupted Excel and a repeated batch. Confirm a partial/failed import can be reviewed in **View recent import batches** and resumed by the same officer. If a function timed out during processing, use **Recover if interrupted** only after the 10-minute safety window.
8. Check that the existing payment ledger, Finance payment verification and student-ID allocation remain unchanged; carry out one full manual-finance-verification test on staging.
9. Review the updated homepage order, distinct AH Consult / AH Student Hub copy, the `Choose a service` dropdown placeholder, and its single training registration section on mobile and desktop. Existing coverflow gallery and the admin-managed gallery remain unchanged.
10. Only then deploy to production. Avoid clearing caches or performing a bulk import of real student records before training authorized officers and confirming the notice/consent basis for contacting them.

## Import contract

- **Required:** Source Reference, First Name, Surname, Email, Phone, Intake, Course Codes.
- **Optional:** Date of Birth (`YYYY-MM-DD`), Gender, Registration Note.
- **Size:** maximum 100 rows per spreadsheet / 1 MB; up to 500 staged rows per officer in 24 hours.
- **Courses:** one or more existing, **published** course codes, comma-separated; `ACAD1`, `ACAD2`, `ACAD3` have suffix digits in the correct position.
- **Intake:** exact existing intake label or ID, including historical intakes where data entry is authorized.
- **Amounts:** backend calculates draft application totals from current published course fees. These **must not** be treated as proof that an older paper enrolment was paid at that price. Finance must reconcile historical payments separately with supporting evidence.
- **Identity:** a genuine unique applicant email is mandatory to issue a secure portal invitation. Staff must resolve applicants without email through an approved offline-identity process; do not create fake shared emails.
- **Approvals:** manual import does **not** set paid status, admit applicants, issue academic documents, or allocate a Student ID. Existing gates remain authoritative.
- **Partial commits:** database changes are atomic per row, not across the whole spreadsheet. The import records successful rows and failures so a retry does not create already-imported rows twice. An invitation may have been sent before a subsequent database failure; follow the audit and reconcile rather than deleting the invited user blindly.

## Security and operational controls

- Preview reads Excel/CSV locally; the upload sends normalized rows to the Edge Function for validation and staging, not the raw workbook.
- Batch and row tables have RLS enabled, no anon/authenticated grants, and are managed through an approved admissions officer's authenticated Edge Function.
- Paper source references are globally unique; email collisions fail validation; matching phones are displayed as warnings because legitimate relatives can share phone numbers.
- The source document is sensitive: restrict access, encrypt backups and apply AHCT's written retention policy. The provided `ahct_cleanup_manual_import_staging()` service-only maintenance function can purge **completed** staging rows after 30 days and abandoned previews after 14 days. Schedule it using an authorized server job after approving retention policy; it is not scheduled automatically in the migration.
- Auth invitation delivery is subject to Supabase Auth email and rate limits. Configure a dedicated email provider for large legitimate cohorts. A high-volume import should be scheduled outside live peak traffic.
- Regenerate the [release checksum manifest](../evidence/FILE_SHA256SUMS.txt) with the consolidated release. No Supabase secrets or staff personal data belong in these archives.

## Validation boundaries

Local validation can check source structure, JavaScript syntax, XLSX sheet contract and regression tests. It **cannot** prove Auth invitations, email delivery, Postgres SQL permissions/RPC execution or real student progression without a staging Supabase project. Do not label this production-proven without completing the checks above.
