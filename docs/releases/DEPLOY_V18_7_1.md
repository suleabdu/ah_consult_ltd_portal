# AHCT V18.7.1 — Deployment and incident debugging

**Environment:** Deploy to a disposable staging Supabase project first; do not apply this package to production without verified backups and a change window. Nothing in this distribution has been deployed to your hosted project.

## Why Save Institutional Identity failed

Two independent causes were identified:

1. `frontend/js/pages/admin-dashboard.js` built authenticated headers, but then spread `...options` over them. A JSON `Content-Type` option **replaced** the entire headers object, stripping the `Authorization` and `apikey` headers. Saving was therefore likely to produce HTTP 401.
2. `document-branding` did not explicitly opt out of Supabase gateway JWT verification. A gateway rejection may happen **before the Edge Function executes or returns its own CORS headers**. We disable gateway verification for this one function and still authenticate each request with `userFrom(req)` plus the approved administrator role check. The handler does **not** become a public identity-management endpoint.

The `content.js` Permissions Policy `unload` warnings typically originate from browser extensions or injected scripts; they are not established as the cause of the 401. If they persist, reproduce in a clean browser profile.

## Required order

1. Confirm V18.7.0 migration `040_native_document_studio_governed_issuance.sql` has been applied. Back up production data and storage indexes.
2. Apply new migration `041_document_identity_profiles.sql` on staging, e.g. `supabase db push` after `supabase link --project-ref YOUR_STAGING_PROJECT_REF`.
3. Deploy the updated Edge Functions:

   ```bash
   supabase functions deploy document-branding --no-verify-jwt
   supabase functions deploy student-document
   ```

4. Publish modified frontend files, including `admin-dashboard.js`, `official-documents.js`, and `portal.js`. Clear the app/CDN cache or deploy a versioned build.
5. Set an appropriate `ALLOWED_ORIGINS` secret to the exact production site origin, plus any authorized staging origin. The shared CORS helper accepts localhost automatically unless `ALLOW_LOCALHOST=false`.
6. Log in again as an **approved administrator** (not a finance/tutor account), open Document Designer, and select the institutional identity panel. Use `Save identity draft` then `Publish / Set default`.

## Verification matrix

- With valid session: `GET /functions/v1/document-branding?settings=1` succeeds with profiles; JSON Save and multipart logo upload succeed.
- With no or invalid session: the function responds HTTP 401 with request-aware CORS (not private data).
- With logged-in non-admin: HTTP 403.
- Save creates a draft and **does not** change the active style. Publish swaps exactly one default and updates the singleton used by `student-document` atomically.
- Upload PNG/JPEG to a saved draft, publish, then render an authorized admission PDF. The logo should appear.
- Delete active logo: future PDFs use the AH monogram; unreferenced logo objects are cleaned up. Issued originals still contain their embedded artwork.
- Delete a non-default profile: succeeds. Delete the default: fails with HTTP 409 until another is published.
- Student portal: Download original yields its archived, SHA-256 checked PDF. `Print current style` retrieves a separately archived version tied to the default revision if the original has a frozen template snapshot and eligibility still holds.
- Academic result/transcript current-style reprints require still-valid academic review and independent registrar approval; certificate automatic reprints are NOT produced. A historic PDF without a frozen template snapshot must use its original or undergo a formal authorized reissuance.
- Repeat the printing test in the application Payment Receipts page.

## Important boundaries

**Publishing is not retroactive PDF mutation.** New issuance uses the latest published identity immediately. Existing printed documents remain independent immutable originals. For eligible documents, printing the current style creates a distinct hashed style copy on demand and saves it for later requests; this is not a new academic award or authorization. It is not safe to replace an already issued PDF silently.

**Service credentials must never appear in frontend code or shared ZIP files.** The original Google service-account key exposure from earlier releases still requires revocation, even though these source packages exclude it.

## When it still says 401/CORS

- Ensure the deployed `document-branding` function actually has `verify_jwt=false` (remote settings are not necessarily updated merely by editing `config.toml`).
- Inspect DevTools > Network: the preflight OPTIONS must receive `Access-Control-Allow-Origin` and the actual POST must include `Authorization: Bearer <user JWT>` and `apikey: <public anon key>`.
- Check `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` secrets on Supabase; keep service role key server-side only.
- Confirm the staff row has `role=administrator, status=approved` and the browser session is current.
- Check CORS `ALLOWED_ORIGINS` exact scheme/host/port. `http://localhost:8888` differs from `http://127.0.0.1:8888` and from an HTTPS production site.
- Check migrations 040 and 041 actually ran; 503 usually means missing schema, not CORS.
- Do not bypass permissions using service-role keys in browser code.

## Checks run locally

- `python scripts/validate.py` — 37/37.
- TypeScript syntax parse of modified Edge Functions — passed.
- New targeted authentication/profile/reprint regression — passed.
- Available unit/regression suites — passed; two DOM suites require `jsdom` and could not run in this environment.
- Database SQL tests, actual Supabase auth/CORS and live browser printing remain **not run**. Test staging before production.
