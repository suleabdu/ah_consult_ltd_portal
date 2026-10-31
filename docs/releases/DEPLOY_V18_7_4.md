# AHCT Portal V18.7.4 — Center-stage Gallery

## Installation

Replace `frontend/index.html`, `frontend/css/home.css`, and `frontend/js/home.js` together and clear the deployed HTML/CSS/JS caches. The two updated gallery tests and the gallery design notes are included in the affected-files patch for developers.

No SQL migration, Supabase Edge Function redeployment, or new administration configuration is required. The existing media upload and removal controls still govern `gallery_items`, and the public homepage continues reading only `status=published` rows. If a public site is unconfigured, the gallery correctly shows an unavailable state rather than invented images.

## User experience

- Desktop: one sharp centered photograph, two soft photo previews on each side.
- Mobile: one sharp center and partially visible immediate neighbours, with outer previews visually hidden.
- Every 7.2 seconds: automatic next photo, unless paused, reduced-motion is enabled, user is hovering/focusing, page is hidden, or full-screen viewer is open.
- Categories, Next/Previous, Pause/Play, touchscreen swipes, arrow keys and full-screen photograph viewer all remain supported.

## Required staging checks

1. Open the homepage at 320/390/820/1440/1920px and verify no horizontal overflow, smooth transitions, center sharpness and side blur.
2. Try with 0, 1, 2, 5 and 12 published images; change category and test the current caption.
3. Use keyboard-only navigation, pause/play, touch swipes and the fullscreen viewer, including Escape focus return.
4. Upload, publish and remove a gallery photo through the existing admin media manager; confirm it updates via Realtime or the 60-second fallback.
5. Review LCP and image transfer sizes on low-bandwidth mobile connections; consider optimized image variants in storage.

## Validation performed

`python3 scripts/validate.py`: 37 structural checks passed. `node --check` passed for the changed JS and tests. Existing dependency-free governed-course and critical-regression checks pass. Full jsdom and browser E2E tests remain outstanding. The local browser was unable to navigate to localhost because the environment blocked it; the supplied concept image is illustrative, not a browser screenshot.
