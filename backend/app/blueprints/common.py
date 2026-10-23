"""
blueprints/common.py
AHCT Student Hub — Health check
==============================================================================
Used by Render's health check, and a handy first thing to hit after
deploying to confirm the service is up and can reach Google Sheets.

Visiting this URL directly in a browser (e.g.
https://your-backend.onrender.com/api/health) bypasses the frontend
entirely — useful for telling apart "the backend itself is down/
misconfigured" from "the frontend can't reach an otherwise-healthy
backend" (a config.js pointing at the wrong URL, or a CORS_ORIGINS
mismatch — see corsOrigins below, and
docs/ARCHITECTURE_AND_DECISIONS.md, Section 22) — the two failure modes
that otherwise look identical to a visitor ("Failed to fetch" /
"Could not load the application form" either way).
==============================================================================
"""

from flask import Blueprint, jsonify

from .. import extensions as ext
from ..config import CONFIG

common_bp = Blueprint("common", __name__, url_prefix="/api")


@common_bp.get("/health")
def health():
    sheets_ok = True
    sheets_error = None
    try:
        ext.sheets_client.spreadsheet()
    except Exception as e:
        sheets_ok = False
        sheets_error = str(e)

    return jsonify(
        status="ok" if sheets_ok else "degraded",
        sheetsConnected=sheets_ok,
        sheetsError=sheets_error,
        # If your frontend's origin isn't in this list (and it isn't "*"),
        # every request from it will fail with a browser-level "Failed to
        # fetch" — this list is exactly what CORS_ORIGINS currently
        # resolves to, so a mismatched/missing frontend origin is visible
        # right here without needing to check Render's dashboard.
        corsOrigins=CONFIG.CORS_ORIGINS,
        monnifyEnabled=CONFIG.MONNIFY_ENABLED,
        emailEnabled=CONFIG.EMAIL_ENABLED,
    )
