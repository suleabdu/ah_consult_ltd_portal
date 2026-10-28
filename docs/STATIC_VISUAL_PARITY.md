# Static visual parity evidence — 28 October 2026

**Technique:** Restored the original `frontend/` markup and stylesheets directly from the supplied V18.6 archive. Reconstructed the updated HTML with its extracted CSS in the original cascade position. Rendered both with Chromium at desktop (1440 × 900), tablet (820 × 1000), and mobile (390 × 844). Blocked external network requests and executed only the CSP-safe image-error fallback needed to reproduce the original broken-logo behavior. Compared the first viewport pixel-by-pixel, counting any RGB difference greater than 15.

| Page | Desktop | Tablet | Mobile |
|---|---:|---:|---:|
| Public homepage | 0.0000% | 0.0000% | 0.0000% |
| Training application | 0.0000% | 0.0000% | 0.0000% |
| Staff login | 0.0000% | 0.0000% | 0.0000% |
| Student portal | 0.0000% | 0.0000% | 0.0000% |

The source comparison also established **11/11 exact inline JavaScript body matches** and no relative URLs in the 11 extracted CSS blocks.

**Important limitations:** This is a static first-viewport comparison, not an authenticated browser session, end-to-end test, Lighthouse audit, real payment transaction, asset/network check, or a full-page Playwright golden-baseline approval. Remote images and font requests were disabled. The admin dashboard, tutor, document viewer and form state transitions still require full E2E screenshots and interactive testing against an isolated Supabase project prior to production rollout.
