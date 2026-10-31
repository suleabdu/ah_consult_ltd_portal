# Security

## Model in one paragraph
Browsers hold only the public anon key. Students and staff authenticate with Supabase Auth; **row-level security** limits each user to their own rows or their role's permissions. Money and approvals run in **Edge Functions or SECURITY DEFINER functions** that use the service role, which never leaves the server. The Google Sheet is a **read-only mirror**.

## Controls
- RLS enabled on every `public` table; `tests/sql/security_posture.sql` fails CI if any table lacks it.
- `anon` can only SELECT `courses`, `intakes`, `packages`, approved `gallery_items`, and the explicitly allow-listed public `site_settings` keys (`branding`, `theme`, `images`, `location`, `gallery`). Everything else is revoked, and future tables default to private.
- The only SECURITY DEFINER function callable by `anon` is `public_impact_stats()`: four aggregate numbers, never rows. It is allow-listed explicitly in `tests/sql/security_posture.sql`.
- All SECURITY DEFINER functions pin `search_path`; none is callable by `anon`.
- Payment status is parsed by whole words and the provider amount must cover the total (`_shared/guards.ts`, unit-tested). Webhook signatures use constant-time comparison. Provider URLs must be public https hosts.
- Staff registration is rate-limited (10 per IP per hour, 200 per hour overall) through Postgres (`check_rate_limit`).
- Errors returned to browsers carry a short reference ID, never internal messages.
- Browser headers (CSP, HSTS, frame, referrer, permissions policies) are set in `frontend/vercel.json`. All scripts are self-hosted.
- Dependencies are pinned (`package-lock.json`, `npm:@supabase/supabase-js@2.118.0`) and updated through Dependabot; the production dependency audit is a release gate. See the [exception register](docs/SECURITY_EXCEPTIONS.md) for the separately reviewed development-only linting finding.

## Known limitations (tracked)
- `script-src` now allows self-hosted JavaScript only and explicitly blocks inline script attributes. `style-src` still includes `'unsafe-inline'` for existing per-element style attributes until approved visual baselines permit their removal.
- Staff sign-up is protected by a single access code plus admin approval; MFA is not enforced.
- Hosted Supabase environments must retain email confirmation and a verified SMTP sender; this repository can only set the local-development equivalent.
- The Upperlink adapter infers response field names; verify against their sandbox before going live.
- The mirror sheet contains personal data. Share it as Viewer only and review its editors regularly.

## Credential hygiene (one-time, if earlier packages were ever shared)
Earlier packages of this project shipped real configuration files. If any copy left your control, rotate: the Supabase service-role key and database password, the Google service-account key, the Google OAuth client secret and refresh token, any payment-provider secrets, and `SETTINGS_ENCRYPTION_KEY` (re-save provider secrets afterwards).

## Reporting a vulnerability
Report privately via the existing AH Consult contact email, **ahconsultltd02@gmail.com**; mark the subject “Confidential security report”. Do not post private keys or vulnerability details in a public issue.

## V18.6 key exposure

The provided V18.6 archive shipped a populated example with a Google service-account private key. The cleaned source package does **not** revoke it. Follow [the mandatory revocation and historic-scan instructions](docs/SECURITY_INCIDENT_RESPONSE.md) before release.

## V18.7 native institutional documents (staging candidate)

The institution's full-page letterhead uploads are no longer supported by the active Document Designer or official PDF renderer. Only an admin-verified compact logo and text identity are permitted. Existing historical image records remain for rollback, but are not loaded in new PDFs. Staff signatory names/titles are *printed labels*, not cryptographically authenticated signatures. Final transcripts and result statements now require academic review and independent registrar authorization. Certificates remain blocked pending a formally approved completion policy. Run PostgreSQL/RLS and authenticated PDF integration tests on staging before production.
