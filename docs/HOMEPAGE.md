# Public Homepage

The homepage (`frontend/index.html`, `css/home.css`, `js/home.js`) is a static page. Everything dynamic comes from three **public, read-only** Supabase endpoints. Nothing personal is ever requested.

## What the page reads

| Section | Source | Exposure |
|---|---|---|
| Learning Impact | `rpc/public_impact_stats` | Four aggregate numbers. Never rows. |
| Training programmes | `courses` (active, public catalogue) | Course name and level. |
| Gallery | `gallery_items` where `status = 'published'` | Only published photographs (enforced by row-level security, not just by the page). |

Everything else on the page (services, about, contacts, map, forms) is static content carried over from the previous homepage.

## Learning Impact: counting rules

Defined in migration `025_public_homepage.sql` (`public_impact_stats()`), covered by `tests/sql/homepage_test.sql`.

| Figure | Counts | Never counts |
|---|---|---|
| **Learners enrolled** | Distinct *students* whose admission is `approved` **and** whose payment is confirmed (`paid_at` set). A student in two intakes counts once. | Drafts, unpaid, submitted-only, under review, rejected, expired. (`student_id` is allocated at *submission*, so it is deliberately not used.) |
| **Graduates** | Distinct students with at least one **issued** Certificate of Completion. | Generated-but-not-issued certificates, other document types. |
| **Training programmes** | Distinct names among active courses (levels are not counted separately). | Inactive courses. |
| **Open intakes** | Intakes that are active and not yet closed. | Closed or inactive intakes. |

A figure the database cannot state reliably comes back as `null` and the page **omits it**; if all four are `null` the whole section disappears. Graduates stays hidden until the first certificate is issued in the system, because earlier cohorts completed before certificates were tracked and a "0" would be misleading. The footnote under the figures describes only the figures that are displayed.

## Gallery management (no code, no redeploy)

Admin Dashboard, **Website & Branding**, **Home page gallery**:

| Action | How |
|---|---|
| Upload | **Add photos** (several at once). Saved as **Drafts** unless "Publish immediately" is ticked. |
| Caption / description | Caption is shown to visitors; the description is for screen readers (optional, caption is used if empty). |
| Categorise | Training, Projects, Graduation, Events, Other. The homepage builds its filter tabs from the categories that have published photos. |
| Publish / unpublish / archive | Status menu. Only **Published** photographs are visible to the public. |
| Feature | Tick **Featured**. The first featured photo becomes the large lead tile and the next two become tall tiles. |
| Reorder | Up/down arrows. |
| Delete | Permanent (the stored file remains in Storage). Prefer **Archive**. |

Each change is written to the audit log (`gallery.insert`, `gallery.update`, `gallery.delete`). Only approved administrators can write (`is_admin()` via row-level security).

**Freshness.** The page revalidates every 60 seconds while visible and when the tab regains focus. After the page is idle it also subscribes to Supabase Realtime for faster updates; if Realtime is unavailable the polling alone keeps the page current. The last good list is cached in the visitor's browser, so a brief outage does not blank the gallery.

**Image hosts.** The Content-Security-Policy allows images from this site, Supabase Storage (`*.supabase.co`, where dashboard uploads go) and `lh3.googleusercontent.com` (the existing Google-hosted photographs). Upload through the dashboard rather than pasting other URLs.

## Course deep links

Programme level buttons link to `apply.html?course=AutoCAD&category=Beginner`. The application wizard remembers the choice (also across sign-up and sign-in in the same tab) and pre-selects that category and course on the course step. Unknown names or levels are ignored, and "Lumion" matches "Lumion/Animation". VRAY was listed on the previous homepage but is not a registrable course, so it appears as an *enquiry-only* entry that opens the consultation form.

## Accessibility and performance notes

- Landmarks, one `h1`, skip link, visible focus ring, labelled controls, 44px minimum tap targets, `prefers-reduced-motion` respected, no autoplay.
- All text/background pairs meet WCAG AA. White text on the brand orange fails (2.85:1), so primary buttons use charcoal text and small orange text uses a darker tone. If an administrator changes the brand colours in the theme, re-check contrast.
- The photograph viewer is a native `<dialog>` (focus trap, Esc, focus returns to the photo that opened it) with Prev/Next, arrow keys and swipe.
- Images below the fold are lazy-loaded with fixed dimensions (no layout shift). Google-hosted photos are requested at display size (`=w500` style suffix) and fall back to the original URL if that fails; an unavailable image removes its tile instead of showing a broken icon.
- No framework, no third-party scripts, no inline event handlers. Fonts come from Google Fonts with system fallbacks.

## Testing

| Command | Covers |
|---|---|
| `./scripts/test-sql.sh` | Migration 025, gallery visibility and permissions, audit trail, every counting rule. |
| `npm run test:unit` | Homepage behaviour (jsdom), admin gallery manager, course deep-link, passport compressor. |
| `node tests/browser/homepage.browser.mjs` | Real headless Chromium at 1440, 820 and 390px (needs `npm i --no-save @sparticuz/chromium puppeteer-core`). |
| `python3 scripts/validate.py` | Includes homepage privacy rules (no student records, only three public endpoints). |

## Deploying this change

1. Apply `supabase/migrations/025_public_homepage.sql` **before** deploying the new frontend (the page reads the new table and function).
   If your database already has an older public metrics function (for example `public_homepage_metrics`), the security-posture check will flag it, because the new homepage does not use it. Inspect it with `tests/sql/inspect_public_functions.sql`; once the old homepage is no longer served, revoke public access or drop it (see the setup guide, Phase 3.3).
2. Deploy the frontend (push to `main`).
3. Open the Admin Dashboard gallery panel. Existing photographs were moved across automatically; review captions and categories, and feature up to three.
4. Confirm the gallery and figures appear on the live homepage, and that the old student-records block is gone.
