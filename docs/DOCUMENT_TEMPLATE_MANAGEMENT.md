# Document Designer — V18.6.2

**Architecture:** `document_templates` stores the single published version per document key. `document_template_drafts` stores a separately editable unpublished draft. `document_template_versions` stores historic versions. The browser receives only administrator-authorized data via Supabase RPCs; the PDF Edge Function renders approved templates on first issuance. All portals call the shared `student-document` endpoint for official PDFs rather than loading hard-coded browser templates.

## Administrator workflow

1. Open **Admin portal → Document designer**. The common institutional letterhead still applies to all documents.
2. Pick an independent tab: Admission letter, Deferment letter, Payment receipt, Transcript, Result statement or Certificate. Switching tabs warns if there are unsaved changes.
3. Edit body, signatory, title or footer; click **Save draft**. The draft is private and is not used to issue documents. **Preview actual PDF** renders sample content with a `NOT ISSUED` mark.
4. Click **Publish approved revision** to promote a saved draft. The publication updates the authoritative row for just that document type and is available to all future issuance paths. Other document types are unaffected.
5. Use **Delete saved draft** to remove only unpublished work. Use **Delete revision** beside a *previously published superseded* version to hide it from the editor after entering a reason. **The current published revision is not deletable.** Publish a replacement first.

**Deletion semantics:** Deleting a revision is a *soft deletion*: the record is timestamped with actor and reason, remains in the immutable historical registry, and disappears from the active designer. It does not delete an issued PDF, alter its SHA-256, erase its history or create an invalid foreign key. Deleted versions cannot be restored using the old copy-to-draft RPC. A database backup and authorized recovery procedure would be required for a restored historical version.

**Document consistency:** All newly generated PDFs pull the active `document_templates` row server-side. Once the PDF is archived in private storage, it is immutable and the stored bytes and SHA-256 are returned by all portals, even when templates are updated. **Existing issued PDFs are deliberately not regenerated.** Pending/unissued PDFs use the latest published template when actually rendered, with the revision recorded on issuance.

## Deployment sequence

1. Backup the production database and test in a separate Supabase staging project.
2. Run only the **new** migration 035 with `supabase db push` (or your approved migration pipeline). Do not edit/re-apply earlier migration files.
3. Deploy the `student-document` Edge Function and publish updated `frontend/` assets. Browser frontend requires explicit public Supabase config; **never** embed a service-role key.
4. Log in as administrator; for every tab verify distinct body text, correct revision history, preview PDF, saved draft deletion, superseded version deletion and that current revision deletion is absent.
5. Save/publish a unique test phrase for each type on staging, then issue PDFs through the relevant student, application and staff flows. Verify PDF text and recorded `metadata.template_version` match the published revision. Download an older issued PDF and verify its SHA-256 remains unchanged.
6. Test unauthorized users: they must not call admin draft/deletion RPCs, including direct API calls. Confirm audit rows for `document_draft_deleted` and `document_revision_deleted`.

If the new frontend is deployed **before migration 035**, the Delete controls will return a missing-function error. Apply the database migration first. No production deployment or live student-data test is included in this source ZIP.

### Offline interface previews

The `docs/previews/` desktop and mobile screenshots show the HTML/CSS layout of the designer with **placeholder loading states**. They are not authenticated Supabase browser tests and do not imply the new SQL functions were executed against a database.
