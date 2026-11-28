# Recruitment publication and delegated governance

## Staging and deployment

Back up the target and apply migrations 054–057 in order after 001–053, before deploying the frontend. Migration 054 preserves visibility of positions already marked open and adds an explicit publishing action for future changes. Review the opening/closing dates, status, and selected destinations for each vacancy. A position appears on the recruitment index only when Recruitment page is selected and its scheduled window is open. Homepage and Student Hub announcements follow their own selected destinations. Closing and reopening requires an authorised person to publish again. Migration 057 preserves existing homepage and Student Hub gallery placements and enables selection of additional destinations.

Deploy the updated frontend and `staff-invite` Edge Function. Configure `ALLOWED_ORIGINS`, add `https://YOUR_SITE/staff-invite-accept.html` to Supabase Auth's allowed redirect URLs, and configure Auth's invitation email and SMTP. Send only a controlled invitation to a consenting synthetic test account in staging.

## Permissions and onboarding

Administrators configure the added governance modules in Roles & Permissions and select which dashboard areas appear. Team, custom role, staff invitation, audit and health access are independently grantable. Financial provider keys, destructive deletion, access codes and other super-administrator controls remain restricted. Invitation issuance is restricted to approved administrators and approved HR users who have been granted invitation access. Delegated role assignment is restricted to non-system custom roles within the caller's own authority; administrator, self, protected built-in and governance-bearing roles cannot be assigned or edited by delegated users. HR may therefore need an administrator to assign an appropriate custom role to an existing self-registration first.

Staff self-registration remains available; it still requires an access code and approval. The new invitation path creates a new unconfirmed account and a pending staff record. The recipient sets a password through the invitation link; separate staff approval remains necessary. Existing accounts are not automatically converted to staff. No WhatsApp consent is assumed. If creation or email delivery fails after the account is created, an administrator must inspect and resolve the pending account before retrying; no automatic deletion or resend is performed.

## Acceptance checks

- Test vacancy draft, explicit publication, each selected destination, scheduling, expiry, close/reopen and deep-linked application using synthetic records. Confirm existing previously open positions after migration.
- Test copying chosen questions, duplicate handling, frozen application snapshots and concurrent requests.
- Publish and unpublish a photograph at each gallery destination; verify its category, ordering and other selected destinations remain intact.
- Attempt role escalation, assigning a protected role, changing your own account and accessing ungranted governance actions as delegated staff. Each must fail server-side.
- Verify staff invitation, expiry, password creation, pending approval, duplicate account and failed delivery recovery without exposing secrets. Verify the email sender and Auth redirect settings.
- These migrations and Edge Function have not yet been tested against a staging Supabase database or a real email provider. Do not treat client-side MFA as server-enforced protection.
