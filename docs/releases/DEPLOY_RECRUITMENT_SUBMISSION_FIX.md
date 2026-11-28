# Recruitment submission correction

Apply migration 059 after migrations 001–058. It replaces the guest submission function to remove an ambiguous question reference that caused PostgreSQL error 42702. Existing application records and stored documents are retained. Deploy the updated frontend for the revised recruitment layout and HR question guidance; redeploy `recruitment-apply` to include privacy-safe database error codes and cleanup when this specific error occurs.

Before retrying an application that displayed an uncertain-submission message, HR should check the application list for that candidate to avoid submitting a duplicate. After deployment, verify the flow in staging with a synthetic vacancy and application, including required questions and private attachments, and confirm that authorized HR can review it. Check Edge Function logs for `recruitment_submission_failed` if a submission still fails; log entries contain only the SQLSTATE, not applicant details.
