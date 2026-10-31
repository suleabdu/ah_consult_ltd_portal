# AHCT homepage gallery — V18.7.4

## Behavior

Only rows with `gallery_items.status = published` are requested through the public Supabase REST API, retaining the existing row-level security. The administrator's upload, removal, category, featured, ordering and publication workflow is unchanged.

The homepage uses a centered image with up to two blurred images on each side on desktop. The carousel dynamically keeps at most seven image nodes in memory (five positions plus two off-stage buffers) instead of loading every published image at once. Adjacent cards can be selected, and the active card opens the original full-resolution `<dialog>` viewer with keyboard/swipe navigation.

## Accessibility and responsiveness

- Arrow buttons, an explicit Play/Pause control, keyboard left/right and touch swipe gestures.
- Automatic rotation every 7.2 seconds, paused by hover, keyboard focus, fullscreen viewer or document visibility. Reduced-motion preferences disable automatic rotation and transitions by default.
- Mobile focuses on the center image with partial adjacent images; outer cards are hidden visually at 540px and below.
- The active image's caption and position are announced for manual navigation; automatic rotation avoids repeated announcements.
- Images have alt text, dimensions and lazy decoding. Any unavailable image is excluded; existing Google Drive URL fallback remains.

## Deployment

Deploy the three changed frontend files together and clear HTML/CSS/JS caches. No Supabase migration, Edge Function redeploy or new administrator settings are required. The homepage still needs your correctly configured public Supabase URL and anon key to fetch actual published gallery images.

## Test checklist

1. Publish at least seven gallery photos across two categories. Confirm five visible slots and one sharp centered photo on desktop.
2. Use next/previous, swipe, click a side image, click center to open the viewer, close with Escape and verify focus recovery.
3. Confirm category tabs and published/unpublished visibility, and try a broken image URL.
4. Verify 320, 390, 820, 1440 and 1920px screens without horizontal overflow.
5. Check Play/Pause; focus or hover should pause; reduced motion should disable automatic rotation.
6. Check Supabase Realtime and the 60-second fallback refresh after admin updates.

### Verification limits

Structural and dependency-free tests can be run offline. A real browser visual QA pass and authenticated Supabase integration are still necessary before declaring production readiness.
