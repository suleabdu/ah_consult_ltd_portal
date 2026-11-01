# V18.9 deployment — governed enrolment, stationery and WhatsApp operations

## Release boundary

This release adds five pending migrations: `046_ah_consult_native_stationery.sql`, `047_student_progression_and_course_addition_control.sql`, `048_whatsapp_operational_messaging.sql`, `049_meta_whatsapp_cloud_only.sql`, and `050_student_course_addition_eligibility.sql`. It also changes the Student, Tutor and Admin portal bundles and adds three Edge Function paths: `admin-communications`, `whatsapp-webhook`, and the shared WhatsApp helper.

It is a staged deployment guide, not evidence that provider credentials, templates, legal identity or live operational approval have been completed.

## Before deployment

1. Take and verify a restore-capable backup of the target Supabase project.
2. Confirm migrations `001` through `045` have completed successfully. Never edit or replay an already-applied migration.
3. Use a staging project with synthetic accounts first. Do not test WhatsApp campaigns with real students until consent, templates and recipients have been reviewed.
4. Set a stable high-entropy `SETTINGS_ENCRYPTION_KEY` secret for the project. It encrypts WhatsApp provider credentials at rest.
5. Ensure the scheduled `communication-worker` caller has the service-role authorization header. Never expose that key to a browser, repository or sheet.

## Apply and deploy

1. Apply migrations `046`, `047`, `048`, `049` and `050` in numerical order through the Supabase migration workflow.
2. Deploy the Edge Functions with [the project script](../../scripts/deploy-functions.ps1) on Windows or [the shell script](../../scripts/deploy-functions.sh) on macOS/Linux. This deploys the new functions and their dependencies.
3. Deploy the updated `frontend/` directory and invalidate stale HTML/JavaScript caches.
4. In **Admin Dashboard → Document Designer**, review the prefilled identity from the supplied letterhead reference, save it as a draft and explicitly publish it. The generated stationery is vector-native; do not upload the source A4 letterhead as a PDF background.
5. In **Admin Dashboard → WhatsApp communications**, save Meta Cloud API settings as a disabled draft, complete Meta webhook verification, then enable delivery. Follow the detailed [WhatsApp operations runbook](../WHATSAPP_OPERATIONS.md).

## Staging acceptance checks

- Student, Tutor and Admin sidebar groups are keyboard reachable, expand and collapse with visible chevrons, retain the active section visibly expanded, and remain correctly limited by role.
- A student with an admitted, open intake can select a published additional course; it stays inactive after the payment claim, moves to Academic approval only after Finance confirmation, and becomes active only after authorized approval.
- The verified addition creates its own receipt record and a versioned revised admission letter while preserving the original letter and original receipt bytes.
- A student who has not reached the intake completion date, lacks a published/reviewed result, or lacks a registrar-issued statement cannot start another intake. A completed student with an issued statement can.
- Applications and staff registrations reject an absent, malformed or unconsented WhatsApp number.
- A template campaign reaches only opted-in target records, number hints remain masked in the UI, an inbound `1` receives a bot response, `4` creates a human handoff, and `STOP` prevents later automated delivery.
- The delivery worker records accepted/failed states without duplicate chatbot replies; the Meta webhook validates its signature and phone-number ID.
- Generate sample PDFs for all six document types and inspect A4 print output, diagonal bands, watermark, safe content area and footer at Actual Size.

## Rollback and recovery

Do not attempt destructive down-migrations against a production record. If an issue is found:

1. Disable WhatsApp delivery in the Admin Dashboard and pause the worker schedule.
2. Remove the new frontend bundle or roll it back through the approved deployment platform.
3. Keep the new database records and audit trail intact; investigate from staging/backup evidence.
4. Rotate provider credentials if they may have been exposed and follow the incident process in the WhatsApp runbook.

After a release, run `npm run validate`, `npm run test:unit`, `npm audit --omit=dev --audit-level=high`, the release-health checks, and the signed staging scenarios above. Production approval remains with the named institutional, security and operational owners.
