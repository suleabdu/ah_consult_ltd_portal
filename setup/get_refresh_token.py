"""
setup/get_refresh_token.py
AH Student Hub — one-time local OAuth authorization
==============================================================================
Run this ONCE, locally, on your own computer — never deploy it and never
run it on Render. It opens a browser window, asks you to sign in as the
SAME Google account that owns (or has Editor access to) your AH Student
Hub spreadsheet, and asks you to approve Sheets + Drive access.

It then prints three values:

    GOOGLE_CLIENT_ID=...
    GOOGLE_CLIENT_SECRET=...
    GOOGLE_REFRESH_TOKEN=...

Copy all three into backend/.env (for local development) and into Render's
Environment tab (for the deployed backend) — see docs/SETUP_GUIDE.md,
Step 4.

Why this instead of a service account: a service account has no personal
Drive storage of its own, so files it "owns" can't be uploaded into a
regular Gmail account's Drive (the fix — Shared Drives — needs paid Google
Workspace). Authenticating as your own account instead means every file
this app uploads is owned by you, using your normal 15 GB quota, exactly
like the original Apps Script project running under "Execute as: Me".

USAGE:
    cd setup
    pip install -r requirements.txt
    python get_refresh_token.py
==============================================================================
"""

import sys
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

CLIENT_SECRET_FILE = Path(__file__).parent / "client_secret.json"


def main():
    if not CLIENT_SECRET_FILE.exists():
        print(
            "Couldn't find client_secret.json in this folder.\n\n"
            "Download it from Google Cloud Console -> APIs & Services -> "
            "Credentials -> your OAuth client ID -> Download JSON, "
            f"then save it as:\n  {CLIENT_SECRET_FILE}\n\n"
            "See docs/SETUP_GUIDE.md, Step 2, if you haven't created the "
            "OAuth client yet."
        )
        sys.exit(1)

    flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET_FILE), SCOPES)

    print(
        "\nA browser window is about to open.\n"
        "Sign in with the SAME Google account that owns your AH Student "
        "Hub spreadsheet, and click Allow on both permission screens "
        "(Sheets and Drive).\n"
    )
    # A random local port is used and closed automatically once Google
    # redirects back with the authorization code — nothing stays running
    # afterwards.
    credentials = flow.run_local_server(port=0)

    if not credentials.refresh_token:
        print(
            "\nGoogle didn't return a refresh token this time — this "
            "usually means this account already authorized this app "
            "before. Go to https://myaccount.google.com/permissions, "
            "remove access for this app's name, and run this script "
            "again.\n"
        )
        sys.exit(1)

    print("\nSuccess! Copy these three lines into backend/.env and into Render's Environment tab:\n")
    print(f"GOOGLE_CLIENT_ID={credentials.client_id}")
    print(f"GOOGLE_CLIENT_SECRET={credentials.client_secret}")
    print(f"GOOGLE_REFRESH_TOKEN={credentials.refresh_token}")
    print(
        "\nKeep these private — the refresh token is equivalent to a "
        "password for this Google account's Sheets/Drive access. "
        "client_secret.json and this script are never deployed anywhere; "
        "they were only needed for this one-time step.\n"
    )


if __name__ == "__main__":
    main()
