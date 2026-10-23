# Phase 7 — Institutional Operations & Communication

This phase turns AH STUDENT HUB into an operational academic platform rather than only a collection of portals.

## Included
- Event-driven student notifications for application submission, payment verification, admission decisions and deferment decisions.
- Idempotent notification event ledger to prevent duplicate alerts.
- Result publication now creates a student notification.
- Institutional document registry for admission letters, receipts, certificates and other controlled documents.
- Document metadata and stable document keys for replacement/version-safe workflows.
- Staff-only document registration RPC.
- Notification templates stored centrally for future email/SMS/WhatsApp adapters.

## Migration order
Run `017_institutional_operations.sql` after migrations `001` through `016`.

## Important deployment note
The document registry deliberately does not pretend to generate PDFs. PDF generation/storage should be connected to a trusted storage or document service in the next implementation stage. The database records what document exists and where it is available.

## Next logical work
- Student 360 operational screen with full academic/payment/document timeline.
- Tutor My Courses workspace.
- Admission-letter/receipt/certificate PDF generation.
- Email/WhatsApp/SMS adapters consuming the notification event ledger.
- Management analytics and reconciliation centre.
