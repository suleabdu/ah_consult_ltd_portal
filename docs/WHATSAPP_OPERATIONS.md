# WhatsApp Operations Runbook

This implementation uses only the Meta WhatsApp Cloud API. Provider credentials are encrypted server-side and are never returned to the browser or stored in source control.

## Before enabling production

1. Apply migrations through `049_meta_whatsapp_cloud_only.sql` in order. Migration 048 adds consent-backed WhatsApp fields, a private delivery register, campaigns, conversations and signed webhook-event storage; migration 049 locks the provider to Meta Cloud API only.
2. Set the Supabase Edge Function secret `SETTINGS_ENCRYPTION_KEY` to a high-entropy value. Keep it stable: changing it makes previously encrypted provider settings unreadable until they are re-entered.
3. Deploy `communication-worker`, `admin-communications` and `whatsapp-webhook`, together with the existing functions. The repository deployment scripts include all three.
4. In Meta, create or select the WhatsApp Business Account and phone number, create approved message templates, and obtain the permanent system-user access token, App Secret and a webhook verify token.
5. In **Admin Dashboard → WhatsApp communications**, enter the phone-number ID, Graph API version, approved default template, template language and the three write-only secrets. Save as a disabled draft first.
6. Configure Meta's callback URL as `https://YOUR_PROJECT.supabase.co/functions/v1/whatsapp-webhook`, subscribe the app to WhatsApp messages/statuses, complete the GET verification challenge, then enable the provider in the dashboard.
7. Send a single test template to a consenting test account, confirm the delivery status is recorded, send `1`, and verify the chatbot reply. Send `4` to confirm that a human handoff appears in the admin dashboard.

## Operating rules

- Applications and staff enrolment require a valid WhatsApp number and explicit consent. Campaigns only expose recipients who have an active opt-in; phone numbers are masked in the administrator UI.
- Use approved templates for invitations, reminders and all business-initiated communication. A template preview is an internal label, not a free-form replacement for an approved Meta template.
- The chatbot and human-handoff replies use free-form text only during the user-initiated 24-hour customer-service window. If that window has closed, create an approved template campaign instead.
- `STOP`, `OPT OUT`, `UNSUBSCRIBE` and `CANCEL` disable automated WhatsApp delivery. A future application edit must include a new affirmative consent before delivery resumes.
- Never request passwords, card numbers, bank PINs, OTPs or identity documents in WhatsApp. The chatbot directs students to the authenticated portal for payment and document actions.
- Check Finance, Academic and Registrar approval queues in the dashboard. An additional course is not active until Finance confirms payment and an authorised academic or registrar approves it.

## Routine controls

- Run the communication worker on a protected scheduler using the service-role authorization header. The worker uses an atomic queue claim and retries transient failures.
- Review campaign and webhook delivery records daily while a campaign is active. Cancel queued messages when an intake closes or a recipient's consent changes.
- Rotate the Meta access token and App Secret on a planned schedule. Save the replacement secrets in the dashboard before revoking the old values, then send a controlled test template.
- Restrict WhatsApp configuration to approved administrators. Staff support replies are audited, limited to the customer-service window and appear only for handoff conversations.

## Incident response

1. Disable the provider in Admin Dashboard immediately; workers will stop sending queued WhatsApp jobs.
2. Rotate the compromised Meta credential in Meta, then replace its encrypted value in the dashboard.
3. Review the audit trail, campaign recipients, delivery ledger and webhook event register to identify scope.
4. Preserve records required for investigation; do not delete the immutable audit or delivery evidence.

For Meta's current template, opt-in, automation and service-window requirements, use the official [WhatsApp Business Policy](https://whatsappbusiness.com/policy/?facet1=powerpoint) and [WhatsApp Developer Hub](https://whatsappbusiness.com/developers/developer-hub/).
