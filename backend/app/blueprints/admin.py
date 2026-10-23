"""
blueprints/admin.py
AHCT Student Hub — Admin Dashboard
==============================================================================
Python equivalent of AdminService.gs (getAdminDashboardData,
updateAdmissionStatus). Admin login itself needs no new code —
blueprints/auth.py already handles CONFIG.ROLES["ADMIN"] via
find_admin_account.

EXTENSION beyond the original project: the original design had admin staff
add/edit Tutors, Administrators, and Settings (intake open/close dates)
sheet rows BY HAND directly in Google Sheets — documented as a deliberate
"the sheet itself is the interface" choice (Config.gs). That still works
unchanged here (nothing stops an admin opening the spreadsheet directly).
This blueprint additionally exposes /tutors and /intakes endpoints so the
Admin Dashboard UI can do the same thing without leaving the app — a
disclosed convenience layered on top of the original model, not a
replacement for it.

TUTOR ASSIGNMENT is different from the two above — it is NOT just a
convenience layer over manual sheet editing. /registrations/assign-tutor
is now the one authoritative way a student ends up on a tutor's roster
(the Courses sheet's "Assigned Tutor" column), replacing the previous
course/category auto-matching. See
docs/ARCHITECTURE_AND_DECISIONS.md, Section 14.
==============================================================================
"""

from flask import Blueprint, request, jsonify

from .. import extensions as ext
from ..config import CONFIG

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")


def _require_session():
    token = request.headers.get("Authorization", "").replace("Bearer ", "") or (request.get_json(silent=True) or {}).get("token")
    return ext.security.require_session(token, [CONFIG.ROLES["ADMIN"]])


@admin_bp.post("/dashboard")
def get_admin_dashboard_data():
    try:
        _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401

    sheet = ext.data_service.registrations_sheet()
    headers = ext.sheets_client.headers(sheet)
    all_regs = ext.sheets_client.get_all_rows_as_dicts(sheet, headers)

    courses_sheet = ext.data_service.courses_sheet()
    courses_headers = ext.sheets_client.headers(courses_sheet)
    all_course_rows = ext.sheets_client.get_all_rows_as_dicts(courses_sheet, courses_headers)
    courses_by_reg = {}
    for c in all_course_rows:
        rid = c.get("Registration ID")
        courses_by_reg.setdefault(rid, []).append({
            "course": c.get("Course"), "category": c.get("Category"),
            "courseCode": c.get("CourseCode"), "fee": c.get("Fee"), "tutorCode": c.get("Tutor Code"),
            "assignedTutor": c.get("Assigned Tutor", ""),
        })

    admitted = pending = rejected = 0
    rows = []
    for r in all_regs:
        status = r.get("Admission Status") or "Pending"
        if status == "Admitted":
            admitted += 1
        elif status == "Rejected":
            rejected += 1
        else:
            pending += 1
        rows.append({
            "regId": r.get("Reg ID"), "fullName": r.get("Full Name"), "dob": r.get("DOB"),
            "gender": r.get("Gender"), "email": r.get("Email"), "intakeMode": r.get("Intake Mode"),
            "totalCourseRegistered": r.get("Total Course Registered"), "courseFee": r.get("Course Fee"),
            "learningMode": r.get("Learning Mode"), "paymentStatus": r.get("Payment Status"),
            "admissionStatus": status, "courses": courses_by_reg.get(r.get("Reg ID"), []),
        })

    return jsonify(
        success=True,
        summary={"totalApplications": len(all_regs), "admitted": admitted, "pending": pending, "rejected": rejected},
        admissionStatuses=CONFIG.ADMISSION_STATUSES,
        rows=rows,
    )


@admin_bp.post("/registrations/update-status")
def update_admission_status():
    payload = request.get_json(force=True, silent=True) or {}
    try:
        session = _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401

    reg_id = payload.get("regId")
    new_status = payload.get("newStatus")
    if new_status not in CONFIG.ADMISSION_STATUSES:
        return jsonify(success=False, error="Invalid admission status."), 400

    sheet = ext.data_service.registrations_sheet()
    headers = ext.sheets_client.headers(sheet)
    row_index = ext.sheets_client.find_row_index_by_column(sheet, headers, "Reg ID", reg_id)
    if row_index == -1:
        return jsonify(success=False, error="Registration not found."), 404

    ext.sheets_client.set_cell(sheet, headers, row_index, "Admission Status", new_status)
    ext.security.log_action(ext.sheets_client, session["actorId"], CONFIG.ROLES["ADMIN"], "ADMISSION_STATUS_UPDATED", f"RegId={reg_id}; NewStatus={new_status}")
    return jsonify(success=True, regId=reg_id, admissionStatus=new_status)


@admin_bp.post("/registrations/assign-tutor")
def assign_tutor():
    """Sets the ONE authoritative field that puts a student on a tutor's
    roster (Courses sheet's "Assigned Tutor" column) — replacing the
    course/category auto-matching the Tutor Portal used to rely on. Pass
    tutorEmail: "" to unassign / clear it. See
    docs/ARCHITECTURE_AND_DECISIONS.md, Section 14."""
    payload = request.get_json(force=True, silent=True) or {}
    try:
        session = _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401

    reg_id = payload.get("regId")
    course = payload.get("course")
    tutor_email = str(payload.get("tutorEmail") or "").strip().lower()
    if not reg_id or not course:
        return jsonify(success=False, error="regId and course are required."), 400

    if tutor_email and not ext.data_service.find_tutor_by_email(tutor_email):
        return jsonify(success=False, error="No tutor account exists with that email."), 404

    updated = ext.data_service.assign_tutor_to_course(reg_id, course, tutor_email)
    if not updated:
        return jsonify(success=False, error="No matching enrolled course found for that student."), 404

    action = "TUTOR_ASSIGNED" if tutor_email else "TUTOR_UNASSIGNED"
    ext.security.log_action(ext.sheets_client, session["actorId"], CONFIG.ROLES["ADMIN"], action, f"RegId={reg_id}; Course={course}; TutorEmail={tutor_email}")
    return jsonify(success=True, regId=reg_id, course=course, assignedTutor=tutor_email)


# --------------------------------------------------------------------------
# Tutor management (convenience layer — see module docstring)
# --------------------------------------------------------------------------

@admin_bp.post("/tutors")
def list_tutors():
    try:
        _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401

    sheet = ext.data_service.tutors_sheet()
    headers = ext.sheets_client.headers(sheet)
    tutors = ext.sheets_client.get_all_rows_as_dicts(sheet, headers)
    for t in tutors:
        t.pop("PasswordHash", None)
        t.pop("PasswordSalt", None)
    return jsonify(success=True, tutors=tutors)


@admin_bp.post("/tutors/create")
def create_tutor():
    payload = request.get_json(force=True, silent=True) or {}
    try:
        session = _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401

    email = str(payload.get("email", "")).strip().lower()
    course = payload.get("course")
    category = payload.get("category")
    if not email or not course or not category:
        return jsonify(success=False, error="Email, course, and category are required."), 400

    if ext.data_service.find_tutor_by_email(email):
        return jsonify(success=False, error="A tutor with that email already exists."), 409

    from ..services import ids as id_service
    tutor_code = id_service.course_code(CONFIG, course, category)

    sheet = ext.data_service.tutors_sheet()
    headers = ext.sheets_client.headers(sheet)
    ext.sheets_client.append_row(sheet, headers, {
        "TutorID": email, "TutorName": payload.get("name", ""), "Email": email,
        "Course": course, "Category": category, "TutorCode": tutor_code,
        "CreatedDate": ext.sheets_client.now_iso(),
    })

    ext.security.log_action(ext.sheets_client, session["actorId"], CONFIG.ROLES["ADMIN"], "TUTOR_CREATED", f"Email={email}; Course={course}; Category={category}")
    return jsonify(success=True, tutorId=email, tutorCode=tutor_code)


# --------------------------------------------------------------------------
# Intake mode scheduling (convenience layer — see module docstring)
# --------------------------------------------------------------------------

@admin_bp.post("/intakes")
def list_intakes():
    try:
        _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401
    return jsonify(success=True, intakes=ext.settings_service.get_intake_mode_options())


@admin_bp.post("/intakes/update")
def update_intake():
    payload = request.get_json(force=True, silent=True) or {}
    try:
        session = _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401

    label = payload.get("label")
    opening_date = payload.get("openingDate")
    closing_date = payload.get("closingDate")

    headers = CONFIG.HEADERS["SETTINGS_INTAKES"]
    sheet = ext.settings_service.ensure_settings_seeded()
    row_index = ext.sheets_client.find_row_index_by_column(sheet, headers, "Intake Mode", label)
    if row_index == -1:
        ext.sheets_client.append_row(sheet, headers, {"Intake Mode": label, "Opening Date": opening_date, "Closing Date": closing_date})
    else:
        ext.sheets_client.update_row(sheet, headers, row_index, {"Opening Date": opening_date, "Closing Date": closing_date})

    ext.security.log_action(ext.sheets_client, session["actorId"], CONFIG.ROLES["ADMIN"], "INTAKE_UPDATED", f"Label={label}")
    return jsonify(success=True)


# --------------------------------------------------------------------------
# Email diagnostics
# --------------------------------------------------------------------------

@admin_bp.post("/email/test")
def send_test_email():
    """Sends a one-off test email through the exact same code path (and
    exact same SMTP credentials) as every other outbound email, so a
    broken setup can be confirmed and diagnosed in seconds from the Admin
    Dashboard's "Diagnostics" tab, instead of needing a full registration
    round-trip. Also logs the attempt to SystemLogs either way."""
    payload = request.get_json(force=True, silent=True) or {}
    try:
        session = _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401

    to_email = str(payload.get("to", "")).strip()
    if not to_email:
        return jsonify(success=False, error="Please enter an email address to send the test to."), 400

    result = ext.email_service.send_test_email(to_email)
    ext.security.log_action(
        ext.sheets_client, session["actorId"], CONFIG.ROLES["ADMIN"],
        "TEST_EMAIL_SENT" if result["sent"] else "TEST_EMAIL_FAILED",
        f'To={to_email}' + ("" if result["sent"] else f'; Reason={result["reason"]}'),
    )

    if not result["sent"]:
        return jsonify(success=False, error=result["reason"]), 502
    return jsonify(success=True)
