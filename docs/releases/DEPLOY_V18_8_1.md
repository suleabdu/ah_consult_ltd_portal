# AHCT V18.8.1 — Corporate website and Student Hub separation

## Intent and decisions

- `/` and `index.html` represent **AH Consult Ltd** and guide visitors immediately to either Professional Services or AH Student Hub.
- Only `/student-hub` (`student-hub.html`) contains direct new-application, student-login or staff-login paths. Staff/student authentication routes and authorization logic remain unchanged.
- Architecture, Construction, Interior Design and Business Consultancy each have a short service page, all pointing to the corporate enquiry form.
- Published courses, approved gallery content, learning-impact summaries and the training admissions CTA now live in Student Hub. Corporate project photos are loaded only from published `projects` gallery items.
- Maintained 1240px centered content max with section background colors extending full-width.

## Changes and deployment

No SQL migrations, Supabase configuration or Edge Function deployments are necessary for this upgrade. Deploy the updated **frontend** folder to the existing static hosting project. Files include six public pages, two CSS files, `js/corporate.js`, a small `js/theme.js` image-slot extension, `js/home.js` copy correction, admin image-slot labels, and `vercel.json`. Preserve other application routes, environment configuration and `config.js` build step.

After deploying, verify these routes: `/`, `/student-hub`, `/services/architecture`, `/services/construction`, `/services/interior-design`, `/services/consultancy`, `/apply`, `/staff-login`, `/portal`, `/admin-dashboard`. Test previously bookmarked `/#register`, `/#gallery`, `/#apply` and `/#training` anchors. Verify the production gallery has published `projects` photos, otherwise its empty state should be displayed.

## Staging acceptance checklist

1. Corporate homepage shows **Professional Services** and **AH Student Hub** choices without application/student/staff login buttons, on both desktop and mobile.
2. Student Hub offers **Apply for training**, **Student login**, **Staff login** and the approved course catalogue; no student data leaks to public pages.
3. The four services route to corporate service-specific enquiry, not student admissions.
4. Published course visibility and Full Package controls remain enforced by Supabase. Admin image uploading and approvals remain unchanged.
5. Mobile menu can be opened, navigated and dismissed with Escape; no horizontal scrolling.
6. Published student photos appear in Student Hub coverflow only; professional project photos appear in the corporate highlights.
7. SEO, title and description metadata describe each page correctly.
8. Validate with `python3 scripts/validate.py`, `node tests/unit/v18_8_public_divisions.test.mjs`, and `npm run test:unit` after installing dependencies. Full browser/E2E and authenticated tests must be run on staging.

## Operational notes

- There is no automatic publication of new courses or images; authorized staff retain control.
- Source-only change: no live website has been modified.
- Browser navigation to localhost/file URLs was blocked in the authoring environment; automated source checks passed, real screenshots and browser behavior remain staging gates.
- Secret rotation for any previously exposed Google service-account private key remains a separate, urgent production responsibility.
