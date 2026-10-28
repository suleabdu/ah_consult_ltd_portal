# Security

## Model in one paragraph
Browsers hold only the public anon key. Students and staff authenticate with Supabase Auth; **row-level security** limits each user to their own rows or their role's permissions. Money and approvals run in **Edge Functions or SECURITY DEFINER functions** that use the service role, which never leaves the server. The Google Sheet is a **read-only mirror**.

## Controls
- RLS enabled on every `public` table; `tests/sql/security_posture.sql` fails CI if any table lacks it.
- `anon` can only SELECT `courses`, `intakes`, `packages`, `site_settings` and `gallery_items` (row-level security limits the last to `status = 'published'`). Everything else is revoked, and future tables default to private.
- The only SECURITY DEFINER function callable by `anon` is `public_impact_stats()`: four aggregate numbers, never rows. It is allow-listed explicitly in `tests/sql/security_posture.sql`.
- All SECURITY DEFINER functions pin `search_path`; none is callable by `anon`.
- Payment status is parsed by whole words and the provider amount must cover the total (`_shared/guards.ts`, unit-tested). Webhook signatures use constant-time comparison. Provider URLs must be public https hosts.
- Staff registration is rate-limited (10 per IP per hour, 200 per hour overall) through Postgres (`check_rate_limit`).
- Errors returned to browsers carry a short reference ID, never internal messages.
- Browser headers (CSP, HSTS, frame, referrer, permissions policies) are set in `frontend/vercel.json`. All scripts are self-hosted.
- Dependencies are pinned (`package-lock.json`, `npm:@supabase/supabase-js@2.45.4`) and updated through Dependabot.

## Known limitations (tracked)
- `script-src` now allows self-hosted JavaScript only and explicitly blocks inline script attributes. `style-src` still includes `'unsafe-inline'` for existing per-element style attributes until approved visual baselines permit their removal.
- Staff sign-up is protected by a single access code plus admin approval; MFA is not enforced.
- The Upperlink adapter infers response field names; verify against their sandbox before going live.
- The mirror sheet contains personal data. Share it as Viewer only and review its editors regularly.

## Credential hygiene (one-time, if earlier packages were ever shared)
Earlier packages of this project shipped real configuration files. If any copy left your control, rotate: the Supabase service-role key and database password, the Google service-account key, the Google OAuth client secret and refresh token, any payment-provider secrets, and `SETTINGS_ENCRYPTION_KEY` (re-save provider secrets afterwards).

## Reporting a vulnerability
Report privately via the existing AH Consult contact email, **ahconsultltd02@gmail.com**; mark the subject “Confidential security report”. Do not post private keys or vulnerability details in a public issue.

## V18.6 key exposure

The provided V18.6 archive shipped a populated example with a Google service-account private key. The cleaned source package does **not** revoke it. Follow [the mandatory revocation and historic-scan instructions](docs/SECURITY_INCIDENT_RESPONSE.md) before release.
