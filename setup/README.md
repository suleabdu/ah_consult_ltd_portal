# setup/

Contains `get_refresh_token.py` — a one-time, local-only script that
authorizes this app to act as your own Google account (instead of a
service account) for Sheets/Drive access.

**Full instructions:** see `docs/SETUP_GUIDE.md`, Steps 2–4.

Quick version, once you've downloaded `client_secret.json` from Google
Cloud Console into this folder (Step 2 of the guide):

```bash
cd setup
pip install -r requirements.txt
python get_refresh_token.py
```

Nothing in this folder is deployed to Render or Netlify — it's a
throwaway local step. `client_secret.json` is git-ignored; never commit it.
