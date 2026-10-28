# Installation and file placement

All frontend routes live under `frontend/`; their JavaScript lives in `frontend/js/` and styles in `frontend/css/`. Deploy the **entire** `frontend/` directory to Vercel. Do not paste the pages into Supabase functions.

Supabase Edge Functions deploy from `supabase/functions/<function-name>/index.ts`; `_shared/` contains imported helpers and is **not** independently deployed. Run `scripts/deploy-functions.sh` (or the PowerShell equivalent) after reading [the operations runbook](RUNBOOK.md). Apply migrations using Supabase migration tooling in numerical order; do not hand-edit old migrations.

Provide secrets through Supabase Edge Function secrets. Copy `supabase/secrets.example.env` only as a reference, **not** a real secrets file. The deployed frontend uses only the Supabase anon key; service-role, payment provider, and Google credentials must not ship to browsers. Set `ALLOWED_ORIGINS` to your production domain and disable local origins in production. The checked-in `frontend/js/config.js` is inert: to deploy, configure public runtime values with:

```bash
AHCT_SUPABASE_URL=https://your-project.supabase.co AHCT_SUPABASE_ANON_KEY=<public-anon-jwt> npm run configure:frontend
```

Use these same environment variables as deployment build variables (Vercel output directory: `frontend`; build command: `npm run configure:frontend` from repository root). For local previews, supply a **separate synthetic-data staging** project via `AHCT_STAGING_URL` and `AHCT_STAGING_ANON_KEY`. A local page without staging variables stays offline. The generator rejects service-role JWTs. Generated configuration is public by design but should not be committed back to the source repository.

Run `npm ci && npm run check` locally. SQL migration tests require a PostgreSQL test database; type-checking functions requires Deno. See [the release checklist](RELEASE_V18_6_1.md) for exact checks.
