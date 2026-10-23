"""
services/security.py
AHCT Student Hub — Password hashing, sessions, role guards, audit logging
==============================================================================
Python equivalent of Security.gs + the session half of Authentication.gs.

Password hashing: SHA-256 with a per-user salt, exactly like the original
(Utilities.computeDigest in Apps Script) — kept identical so this remains a
drop-in migration: existing Password Hash / Password Salt values already
sitting in a live Registrations/Tutors sheet from the Apps Script era
continue to verify correctly against this code without a forced reset.

Sessions: Apps Script used CacheService (a managed, self-expiring key-value
store) for session tokens. Render/Flask has no equivalent built in, so
sessions here are signed, self-contained JWTs (stateless — no server-side
session store needed, which also means they work fine across multiple
worker processes/instances, unlike the Counters lock in services/ids.py).
A JWT's exp claim gives the same "expires after N minutes" behaviour;
"sliding expiration" (extend on every use) is approximated by the frontend
re-requesting a fresh token on activity — see docs/ARCHITECTURE_AND_DECISIONS.md.
==============================================================================
"""

import hashlib
import time
import uuid

import jwt


class SecurityService:
    def __init__(self, config):
        self.config = config

    # --- Passwords ---------------------------------------------------------

    @staticmethod
    def generate_salt():
        return str(uuid.uuid4())

    @staticmethod
    def hash_password(password, salt):
        return hashlib.sha256(f"{password}{salt}".encode("utf-8")).hexdigest()

    def verify_password(self, password, salt, expected_hash):
        if not expected_hash:
            return False
        return self.hash_password(password, salt) == expected_hash

    def build_default_credentials(self):
        salt = self.generate_salt()
        h = self.hash_password(self.config.SECURITY["DEFAULT_PASSWORD"], salt)
        return {"hash": h, "salt": salt}

    def is_default_password(self, password_attempt):
        return password_attempt == self.config.SECURITY["DEFAULT_PASSWORD"]

    def validate_password_strength(self, password):
        min_len = self.config.SECURITY["MIN_PASSWORD_LENGTH"]
        if not password or len(password) < min_len:
            return {"valid": False, "message": f"Password must be at least {min_len} characters long."}
        return {"valid": True}

    # --- Tokens (password RESET links only) --------------------------------

    @staticmethod
    def generate_token():
        return str(uuid.uuid4())

    # --- Sessions (stateless JWT) --------------------------------------------

    def create_session(self, actor_id, role, display_name):
        now = int(time.time())
        payload = {
            "actorId": actor_id,
            "role": role,
            "displayName": display_name,
            "iat": now,
            "exp": now + self.config.SECURITY["SESSION_TIMEOUT_MINUTES"] * 60,
        }
        return jwt.encode(payload, self.config.JWT_SECRET, algorithm=self.config.JWT_ALGORITHM)

    def validate_session(self, token):
        if not token:
            return None
        try:
            payload = jwt.decode(token, self.config.JWT_SECRET, algorithms=[self.config.JWT_ALGORITHM])
        except jwt.PyJWTError:
            return None
        return payload

    def require_session(self, token, allowed_roles):
        """Raises PermissionError if the token is missing/expired/invalid,
        or the role isn't permitted. Mirrors requireSession_ in
        Authentication.gs — validate first, THEN branch on role, never the
        other way around."""
        session = self.validate_session(token)
        if not session:
            raise PermissionError("Your session has expired. Please log in again.")
        if allowed_roles and session["role"] not in allowed_roles:
            raise PermissionError("You do not have permission to perform this action.")
        return session

    # --- Audit logging -------------------------------------------------------

    def log_action(self, sheets_client, actor_id, role, action, details=""):
        """Appends one row to SystemLogs. Deliberately fire-and-forget
        (never raises) so a logging failure can never block the action it's
        recording — mirrors Security.logAction_."""
        try:
            headers = self.config.HEADERS["SYSTEM_LOGS"]
            sheet = sheets_client.get_or_create_sheet(self.config.SHEETS["SYSTEM_LOGS"], headers)
            sheets_client.append_row(sheet, headers, {
                "LogID": str(uuid.uuid4()),
                "Timestamp": sheets_client.now_iso(),
                "ActorID": actor_id or "",
                "Role": role or "",
                "Action": action or "",
                "Details": details or "",
            })
        except Exception:
            pass
