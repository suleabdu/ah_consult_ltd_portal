"""
blueprints/auth.py
AHCT Student Hub — Login, forced password change, sessions, password reset
==============================================================================
Python equivalent of Authentication.gs. One consistent model across all
three roles (Section 9 of the Development Plan):
  - Login by Student ID (students), email (tutors — see the ID Generation
    document, Section 1.1.5), or email (admins).
  - Every account starts on the default password; first login forces a
    change before anything else is reachable.
  - Passwords are salted SHA-256 hashes (services/security.py) — plaintext
    is never written to any sheet.
  - Password resets use single-use, expiring tokens (PasswordResetTokens
    sheet).
  - Sessions are signed JWTs (services/security.py) instead of Apps
    Script's CacheService — see that module's docstring for why.
  - Every login attempt, password change, and reset event is logged to
    SystemLogs.
==============================================================================
"""

from flask import Blueprint, request, jsonify

from .. import extensions as ext
from ..config import CONFIG

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


# --------------------------------------------------------------------------
# Account lookup
# --------------------------------------------------------------------------

def find_student_account(student_id):
    record, headers, row_index = ext.data_service.find_registration_by_student_id(student_id)
    if not record:
        return None
    return {
        "actorId": record["Reg ID"],
        "displayName": record["Full Name"],
        "passwordHash": record["Password Hash"],
        "passwordSalt": record["Password Salt"],
        "rowIndex": row_index,
    }


def find_tutor_account(identifier):
    """identifier is the tutor's email (Tutor ID)."""
    record = ext.data_service.find_tutor_by_email(identifier)
    if not record:
        return None
    sheet = ext.data_service.tutors_sheet()
    headers = ext.sheets_client.headers(sheet)
    row_index = ext.sheets_client.find_row_index_by_column(sheet, headers, "Email", record.get("Email"))
    return {
        "actorId": record.get("Email"),
        "displayName": record.get("TutorName") or record.get("Email"),
        "passwordHash": record.get("PasswordHash", ""),
        "passwordSalt": record.get("PasswordSalt", ""),
        "rowIndex": row_index,
        "needsProfile": not record.get("TutorName") or not record.get("Course"),
    }


def find_admin_account(email):
    headers = CONFIG.HEADERS["ADMINISTRATORS"]
    sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["ADMINISTRATORS"], headers)
    rows = ext.sheets_client.get_all_rows_as_dicts(sheet, headers)
    target = str(email or "").strip().lower()
    for i, r in enumerate(rows):
        if str(r.get("Email", "")).strip().lower() == target:
            return {
                "actorId": r.get("Email"),
                "displayName": r.get("Email"),
                "passwordHash": r.get("Password", ""),
                "passwordSalt": r.get("PasswordSalt", ""),
                "rowIndex": i + 2,
            }
    return None


def find_account_by_role(identifier, role):
    if role == CONFIG.ROLES["TUTOR"]:
        return find_tutor_account(identifier)
    if role == CONFIG.ROLES["ADMIN"]:
        return find_admin_account(identifier)
    return find_student_account(identifier)


def is_recognized_role(role):
    return role in (CONFIG.ROLES["STUDENT"], CONFIG.ROLES["TUTOR"], CONFIG.ROLES["ADMIN"])


def write_password_to_account(role, row_index, password_hash, salt):
    if role == CONFIG.ROLES["TUTOR"]:
        sheet = ext.data_service.tutors_sheet()
        headers = ext.sheets_client.headers(sheet)
        ext.sheets_client.set_cell(sheet, headers, row_index, "PasswordHash", password_hash)
        ext.sheets_client.set_cell(sheet, headers, row_index, "PasswordSalt", salt)
    elif role == CONFIG.ROLES["ADMIN"]:
        headers = CONFIG.HEADERS["ADMINISTRATORS"]
        sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["ADMINISTRATORS"], headers)
        ext.sheets_client.set_cell(sheet, headers, row_index, "Password", password_hash)
        ext.sheets_client.set_cell(sheet, headers, row_index, "PasswordSalt", salt)
    else:
        sheet = ext.data_service.registrations_sheet()
        headers = ext.sheets_client.headers(sheet)
        ext.sheets_client.set_cell(sheet, headers, row_index, "Password Hash", password_hash)
        ext.sheets_client.set_cell(sheet, headers, row_index, "Password Salt", salt)


def get_account_email(role, row_index):
    if role == CONFIG.ROLES["TUTOR"]:
        sheet = ext.data_service.tutors_sheet()
        return sheet.cell(row_index, ext.sheets_client.headers(sheet).index("Email") + 1).value
    if role == CONFIG.ROLES["ADMIN"]:
        headers = CONFIG.HEADERS["ADMINISTRATORS"]
        sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["ADMINISTRATORS"], headers)
        return sheet.cell(row_index, headers.index("Email") + 1).value
    sheet = ext.data_service.registrations_sheet()
    headers = ext.sheets_client.headers(sheet)
    return sheet.cell(row_index, headers.index("Email") + 1).value


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------

@auth_bp.post("/login")
def login():
    payload = request.get_json(force=True, silent=True) or {}
    identifier = str(payload.get("identifier", "")).strip()
    password = str(payload.get("password", ""))
    role = payload.get("role")

    if not identifier or not password:
        return jsonify(success=False, error="Please enter your ID and password."), 400
    if not is_recognized_role(role):
        return jsonify(success=False, error="Unrecognized login type."), 400

    account = find_account_by_role(identifier, role)
    if not account:
        ext.security.log_action(ext.sheets_client, identifier, role, "LOGIN_FAILED", "No account found for this ID.")
        return jsonify(success=False, error="We couldn't find an account with that ID."), 404

    if not account["passwordHash"]:
        if not ext.security.is_default_password(password):
            ext.security.log_action(ext.sheets_client, account["actorId"], role, "LOGIN_FAILED", "Account has no password set yet and the default password was not used.")
            return jsonify(success=False, error="Incorrect ID or password."), 401
        ext.security.log_action(ext.sheets_client, account["actorId"], role, "LOGIN_DEFAULT_PASSWORD", "First login on a freshly added account — forcing a password change.")
        return jsonify(success=True, mustChangePassword=True, actorId=account["actorId"], role=role)

    if not ext.security.verify_password(password, account["passwordSalt"], account["passwordHash"]):
        ext.security.log_action(ext.sheets_client, account["actorId"], role, "LOGIN_FAILED", "Incorrect password.")
        return jsonify(success=False, error="Incorrect ID or password."), 401

    if ext.security.is_default_password(password):
        ext.security.log_action(ext.sheets_client, account["actorId"], role, "LOGIN_DEFAULT_PASSWORD", "Login succeeded with the default password — forcing a change.")
        return jsonify(success=True, mustChangePassword=True, actorId=account["actorId"], role=role)

    token = ext.security.create_session(account["actorId"], role, account["displayName"])
    ext.security.log_action(ext.sheets_client, account["actorId"], role, "LOGIN_SUCCESS", "")
    return jsonify(
        success=True,
        mustChangePassword=False,
        token=token,
        actorId=account["actorId"],
        role=role,
        displayName=account["displayName"],
        needsProfile=bool(account.get("needsProfile")) if role == CONFIG.ROLES["TUTOR"] else False,
    )


@auth_bp.post("/logout")
def logout():
    # Stateless JWT sessions have nothing server-side to invalidate; this
    # endpoint exists so the frontend has a symmetric call to make (and a
    # place to hang future server-side revocation if ever needed).
    return jsonify(success=True)


@auth_bp.post("/complete-forced-password-change")
def complete_forced_password_change():
    payload = request.get_json(force=True, silent=True) or {}
    actor_id = payload.get("actorId")
    role = payload.get("role")
    old_password = payload.get("oldPassword", "")
    new_password = payload.get("newPassword", "")

    if not ext.security.is_default_password(old_password):
        return jsonify(success=False, error="Your current password could not be verified."), 400

    strength = ext.security.validate_password_strength(new_password)
    if not strength["valid"]:
        return jsonify(success=False, error=strength["message"]), 400
    if new_password == CONFIG.SECURITY["DEFAULT_PASSWORD"]:
        return jsonify(success=False, error="Please choose a password other than the default one."), 400

    account = find_account_by_role(actor_id, role)
    if not account:
        return jsonify(success=False, error="Account not found."), 404

    if account["passwordHash"] and not ext.security.verify_password(old_password, account["passwordSalt"], account["passwordHash"]):
        ext.security.log_action(ext.sheets_client, actor_id, role, "PASSWORD_CHANGE_FAILED", "Old password did not match on forced change.")
        return jsonify(success=False, error="Your current password could not be verified."), 400

    salt = ext.security.generate_salt()
    new_hash = ext.security.hash_password(new_password, salt)
    write_password_to_account(role, account["rowIndex"], new_hash, salt)

    ext.security.log_action(ext.sheets_client, actor_id, role, "PASSWORD_CHANGED", "Forced change on first login.")
    token = ext.security.create_session(actor_id, role, account["displayName"])
    return jsonify(
        success=True,
        token=token,
        displayName=account["displayName"],
        needsProfile=bool(account.get("needsProfile")) if role == CONFIG.ROLES["TUTOR"] else False,
    )


@auth_bp.post("/request-password-reset")
def request_password_reset():
    payload = request.get_json(force=True, silent=True) or {}
    identifier = str(payload.get("identifier", "")).strip()
    role = payload.get("role")

    # Always returns success, even when no account matches, so this
    # endpoint can't be used to discover which IDs/emails are real.
    if not identifier or not is_recognized_role(role):
        return jsonify(success=True)

    account = find_account_by_role(identifier, role)
    if not account:
        return jsonify(success=True)

    email = get_account_email(role, account["rowIndex"])
    if not email:
        return jsonify(success=True)

    token = ext.security.generate_token()
    headers = CONFIG.HEADERS["PASSWORD_RESET_TOKENS"]
    sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["PASSWORD_RESET_TOKENS"], headers)
    from datetime import datetime, timedelta, timezone
    expiry = datetime.now(timezone.utc) + timedelta(hours=CONFIG.SECURITY["RESET_TOKEN_VALID_HOURS"])
    ext.sheets_client.append_row(sheet, headers, {
        "Token": token, "ActorID": account["actorId"], "Role": role,
        "CreatedAt": ext.sheets_client.now_iso(), "ExpiryAt": expiry.isoformat(), "Used": "FALSE",
    })

    reset_link = f"{CONFIG.FRONTEND_URL}/reset-password.html?token={token}"
    email_result = ext.email_service.send_password_reset_email(email, account["displayName"], reset_link)
    ext.security.log_action(
        ext.sheets_client, account["actorId"], role,
        "PASSWORD_RESET_REQUESTED" if email_result["sent"] else "PASSWORD_RESET_EMAIL_FAILED",
        "" if email_result["sent"] else f'To={email}; Reason={email_result["reason"]}',
    )
    return jsonify(success=True)


@auth_bp.post("/reset-password")
def reset_password():
    payload = request.get_json(force=True, silent=True) or {}
    token = str(payload.get("token", "")).strip()
    new_password = payload.get("newPassword", "")

    if not token:
        return jsonify(success=False, error="Missing reset token."), 400

    strength = ext.security.validate_password_strength(new_password)
    if not strength["valid"]:
        return jsonify(success=False, error=strength["message"]), 400
    if new_password == CONFIG.SECURITY["DEFAULT_PASSWORD"]:
        return jsonify(success=False, error="Please choose a password other than the default one."), 400

    headers = CONFIG.HEADERS["PASSWORD_RESET_TOKENS"]
    sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["PASSWORD_RESET_TOKENS"], headers)
    rows = ext.sheets_client.get_all_rows_as_dicts(sheet, headers)
    row_idx = next((i for i, r in enumerate(rows) if r.get("Token") == token), -1)
    if row_idx == -1:
        return jsonify(success=False, error="This reset link is invalid."), 400

    record = rows[row_idx]
    if str(record.get("Used")).strip().upper() == "TRUE":
        return jsonify(success=False, error="This reset link has already been used."), 400

    from datetime import datetime, timezone
    expiry_raw = record.get("ExpiryAt")
    try:
        expiry = datetime.fromisoformat(expiry_raw)
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
    except Exception:
        expiry = None
    if not expiry_raw or (expiry and expiry < datetime.now(timezone.utc)):
        return jsonify(success=False, error="This reset link has expired. Please request a new one."), 400

    actor_id, role = record.get("ActorID"), record.get("Role")
    account = find_account_by_role(actor_id, role)
    if not account:
        return jsonify(success=False, error="The account for this reset link no longer exists."), 404

    salt = ext.security.generate_salt()
    new_hash = ext.security.hash_password(new_password, salt)
    write_password_to_account(role, account["rowIndex"], new_hash, salt)
    ext.sheets_client.set_cell(sheet, headers, row_idx + 2, "Used", "TRUE")

    ext.security.log_action(ext.sheets_client, actor_id, role, "PASSWORD_RESET_COMPLETED", "")
    session_token = ext.security.create_session(actor_id, role, account["displayName"])
    return jsonify(
        success=True,
        token=session_token,
        role=role,
        displayName=account["displayName"],
        needsProfile=bool(account.get("needsProfile")) if role == CONFIG.ROLES["TUTOR"] else False,
    )


@auth_bp.post("/complete-tutor-profile")
def complete_tutor_profile():
    payload = request.get_json(force=True, silent=True) or {}
    token = payload.get("token")
    name = str(payload.get("name", "")).strip()
    email = str(payload.get("email", "")).strip()
    photo_data = payload.get("photoData")

    try:
        session = ext.security.require_session(token, [CONFIG.ROLES["TUTOR"]])
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401

    if not name or not email:
        return jsonify(success=False, error="Please provide both your name and email."), 400

    account = find_tutor_account(session["actorId"])
    if not account:
        return jsonify(success=False, error="Tutor account not found."), 404

    sheet = ext.data_service.tutors_sheet()
    headers = ext.sheets_client.headers(sheet)
    ext.sheets_client.set_cell(sheet, headers, account["rowIndex"], "TutorName", name)

    if photo_data:
        photo_url = ext.sheets_client.save_base64_to_drive(photo_data, CONFIG.FOLDERS["PASSPORT"], f"{name}_TutorPhoto")
        ext.sheets_client.set_cell(sheet, headers, account["rowIndex"], "PassportPhoto", photo_url)

    ext.security.log_action(ext.sheets_client, session["actorId"], CONFIG.ROLES["TUTOR"], "TUTOR_PROFILE_COMPLETED", f"Name={name}")
    return jsonify(success=True)
