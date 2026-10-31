# AHCT V18.7.3 — Governed Course Catalogue, Gallery Delegation, Global Homepage Width

## Upgrade overview

The V18.7.3 update introduces a *staff-managed* course catalogue. No new courses are added automatically. Approved staff create draft courses; an independent administrator approves them; an administrator publishes them. Only published, active courses are available to new applicants. Each category gets a numeric **suffix**, not prefix:

| Letters entered | Category | Allocated code |
|---|---|---|
| ACAD | Beginner | **ACAD1** |
| ACAD | Intermediate | **ACAD2** |
| ACAD | Professional | **ACAD3** |

Letters must be 1–4 uppercase A–Z characters (the UI automatically uppercases entries). Select **Apply to all categories** to create three drafts at once, each with its own NGN fee. Existing course codes and student enrolments stay unchanged. A duplicate code rejects the entire create transaction.

**Full Package**: During draft creation, staff can *request* inclusion; this does **not** activate package eligibility. Once published, an administrator must expressly select **Included** for each course. The server verifies both publication and Full Package eligibility before initiating payment.

**Gallery permissions**: Existing homepage gallery management is reused. Administrators can delegate `media` `write` permission to an approved staff role via Staff & Access → Role Permissions. Only authorized staff can upload JPEG/PNG/WebP gallery images, edit captions, publish, archive, reorder or delete them. Website-wide logo and branding settings remain administrator-only. Deleting an internally hosted gallery image attempts storage cleanup; externally hosted images are only removed from the gallery record.

**Homepage**: Section backgrounds remain edge-to-edge, but content is centered in a **1240px maximum-width** wrapper with responsive side padding. The mobile header avoids horizontal overflow at 320px. The homepage course list is populated only from published database courses; a failure produces an unavailable message, not an unapproved hard-coded course list.

## Deployment order

1. **Back up and snapshot staging**. Compare the zip with your working repository, especially if you have made further modifications after V18.7.2. Do not overwrite newer work blindly.
2. Apply only the *new* migration: `supabase/migrations/042_governed_course_catalogue_and_media.sql`. Leave applied migrations 001–041 untouched. If your installation has pending earlier migrations, apply them in normal ascending order first.
3. Deploy the modified `supabase/functions/create-application/index.ts` function and static frontend (`index.html`, `js/home.js`, `js/pages/admin-dashboard.js`, `js/pages/apply.js`, `css/home.css`). No further Edge Functions require redeployment for this update.
4. Sign into the administrator dashboard. In **Role Permissions**, authorize a suitable academic role to manage courses and a suitable team role to manage gallery media (or retain administrator-only gallery management).
5. Create a course such as `ACAD` and select all three categories; verify the draft IDs are ACAD1/ACAD2/ACAD3. Use a *different* administrator account to approve, then publish. Confirm that unpublished options cannot be selected in the application.
6. Open the Full Package checkbox for each published course that management approves. Test normal and Full Package applications in sandbox payments; confirm server-side price calculation and that unapproved package courses cannot be purchased as part of the package.
7. Upload one photo as a draft and publish it; verify that staff without `media` permission cannot edit it. Archive or delete a test image. Confirm course catalogue and gallery respond to changes without a redeploy.
8. Test homepage at narrow phone, tablet, 1440px and widescreen widths. Clear stale CDN/browser caches after deployment.

## Governance and intentional limitations

- A course author **cannot approve their own draft**. A separate approved administrator must review it; an administrator publishes approved courses. If you have only one administrator, authorize an academic course creator or enroll a second approved administrator. Do not bypass separation of duties.
- Drafts and rejected courses may be edited by their original authorized creator; the allocated course code and category are immutable. Approved/published records cannot be edited through draft editing; retirement hides them from new applicants without rewriting historical enrolments.
- Existing published courses retain their historical Full Package eligibility during migration to avoid breaking prior commercial arrangements. Review these course checkboxes after deployment to align with AHCT management's approved package membership.
- The 18-course catalogue in the feedback document is **not fabricated or seeded**: authorized officers must reconcile and publish only real, management-approved course details and fees.
- This release does not implement the separate planned manual student-registration / acting-registrar governance changes; those require additional institutional policies and tests.
- **No production database, payment account or hosted project was changed** during preparation. SQL/RLS integration tests and authenticated browser workflows must be run on staging. An isolated static browser layout check confirmed the wrapper at 320–2560px, but did not connect to Supabase.
