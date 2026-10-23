"""
blueprints/student.py
AHCT Student Hub — Student Portal (Section 6 of the Development Plan)
==============================================================================
Python equivalent of StudentService.gs + the student half of
AssignmentService.gs. One primary entry point (getStudentDashboard) plus
the Assignment page's list/submit pair.

ADMISSION GATING: the full Section 6.2 dashboard (Overall Performance,
Number in Class, Leaderboard, Pending/Submitted Assignments) is only
computed when this student's "Admission Status" is exactly "Admitted".
Anything else returns {admitted: false, profile} — a read-only summary,
same as the printed receipt.
==============================================================================
"""

import uuid

from flask import Blueprint, request, jsonify

from .. import extensions as ext
from ..config import CONFIG

student_bp = Blueprint("student", __name__, url_prefix="/api/student")


def _require_session():
    token = request.headers.get("Authorization", "").replace("Bearer ", "") or (request.get_json(silent=True) or {}).get("token")
    return ext.security.require_session(token, [CONFIG.ROLES["STUDENT"]])


def _build_student_profile(record, courses):
    return {
        "regId": record["Reg ID"],
        "fullName": record["Full Name"],
        "dob": record["DOB"],
        "gender": record["Gender"],
        "email": record["Email"],
        "phone": record["Phone"],
        "intakeMode": record["Intake Mode"],
        "learningMode": record["Learning Mode"],
        "totalCourseRegistered": record["Total Course Registered"],
        "courseFee": record["Course Fee"],
        "paymentStatus": record["Payment Status"],
        "admissionStatus": record.get("Admission Status") or "Pending",
        "passportUrl": ext.sheets_client.to_direct_image_url(record.get("Passport URL")) or record.get("Passport URL") or "",
        "courses": [{"course": c["Course"], "category": c["Category"], "courseCode": c.get("CourseCode"), "fee": c["Fee"], "tutorCode": c["Tutor Code"]} for c in courses],
    }


def _compute_overall_performance(reg_id):
    headers = CONFIG.HEADERS["RESULTS"]
    sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["RESULTS"], headers)
    rows = [r for r in ext.sheets_client.get_all_rows_as_dicts(sheet, headers) if r.get("RegistrationID") == reg_id]
    if not rows:
        return None
    total = sum(float(r.get("Total") or 0) for r in rows)
    return round(total / len(rows), 1)


def _compute_number_in_class(reg_id, intake_mode, my_courses):
    courses_sheet = ext.data_service.courses_sheet()
    courses_headers = ext.sheets_client.headers(courses_sheet)
    all_course_rows = ext.sheets_client.get_all_rows_as_dicts(courses_sheet, courses_headers)

    my_pairs = {f'{c["Course"]}||{c["Category"]}' for c in my_courses}
    matching_reg_ids = set()
    for c in all_course_rows:
        if c.get("Registration ID") == reg_id:
            continue
        if f'{c.get("Course")}||{c.get("Category")}' in my_pairs:
            matching_reg_ids.add(c.get("Registration ID"))

    if not matching_reg_ids:
        return 0

    reg_sheet = ext.data_service.registrations_sheet()
    reg_headers = ext.sheets_client.headers(reg_sheet)
    intake_by_id = {r["Reg ID"]: r["Intake Mode"] for r in ext.sheets_client.get_all_rows_as_dicts(reg_sheet, reg_headers)}

    return sum(1 for rid in matching_reg_ids if intake_by_id.get(rid) == intake_mode)


def _compute_leaderboard_rank(reg_id):
    headers = CONFIG.HEADERS["LEADERBOARD"]
    sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["LEADERBOARD"], headers)
    rows = ext.sheets_client.get_all_rows_as_dicts(sheet, headers)
    match = next((r for r in rows if r.get("RegistrationID") == reg_id), None)
    return match["Rank"] if match else None


def get_matching_assignments(courses):
    headers = CONFIG.HEADERS["ASSIGNMENTS"]
    sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["ASSIGNMENTS"], headers)
    all_assignments = ext.sheets_client.get_all_rows_as_dicts(sheet, headers)
    result = []
    for a in all_assignments:
        for c in courses:
            if (a.get("Course") == c["Course"] or a.get("Course") == "All") and (a.get("Category") == c["Category"] or a.get("Category") == "All"):
                result.append(a)
                break
    return result


def _submitted_assignment_ids(reg_id):
    headers = CONFIG.HEADERS["SUBMISSIONS"]
    sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["SUBMISSIONS"], headers)
    rows = [r for r in ext.sheets_client.get_all_rows_as_dicts(sheet, headers) if r.get("RegistrationID") == reg_id]
    return {r["AssignmentID"] for r in rows}


def get_student_assignment_list(reg_id, courses):
    matching = get_matching_assignments(courses)
    headers = CONFIG.HEADERS["SUBMISSIONS"]
    sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["SUBMISSIONS"], headers)
    my_submissions = [r for r in ext.sheets_client.get_all_rows_as_dicts(sheet, headers) if r.get("RegistrationID") == reg_id]
    sub_by_assignment = {s["AssignmentID"]: s for s in my_submissions}

    result = []
    for a in matching:
        sub = sub_by_assignment.get(a["AssignmentID"])
        result.append({
            "assignmentId": a["AssignmentID"],
            "title": a["Title"],
            "description": a["Description"],
            "course": a["Course"],
            "category": a["Category"],
            "dueDate": a["DueDate"],
            "maxScore": a["MaxScore"],
            "attachmentUrl": a["AttachmentURL"],
            "assignmentStatus": a.get("Status") or "Active",
            "status": "Graded" if (sub and sub.get("Marks")) else ("Submitted" if sub else "Pending"),
            "submittedDate": sub["SubmittedAt"] if sub else None,
            "submissionFileUrl": sub["SubmissionFileURL"] if sub else None,
            "marks": sub["Marks"] if sub else None,
            "feedback": sub["TutorRemarks"] if sub else None,
        })
    result.sort(key=lambda a: a["dueDate"] or "")
    return result


@student_bp.post("/dashboard")
def get_student_dashboard():
    try:
        session = _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401

    reg_id = session["actorId"]
    record, headers, row_index = ext.data_service.find_registration_by_student_id(reg_id)
    if not record:
        return jsonify(success=False, error="We couldn't find your registration record."), 404

    admission_status = record.get("Admission Status") or "Pending"
    courses = ext.data_service.get_courses_for_registration(reg_id)
    profile = _build_student_profile(record, courses)

    if admission_status != "Admitted":
        return jsonify(success=True, admitted=False, admissionStatus=admission_status, profile=profile)

    cards = {
        "overallPerformance": _compute_overall_performance(reg_id),
        "numberInClass": _compute_number_in_class(reg_id, record["Intake Mode"], courses),
        "leaderboard": _compute_leaderboard_rank(reg_id),
        "pendingAssignments": len(get_matching_assignments(courses)) and len(
            [a for a in get_matching_assignments(courses) if a["AssignmentID"] not in _submitted_assignment_ids(reg_id)]
        ),
        "submittedAssignments": len(_submitted_assignment_ids(reg_id)),
    }

    return jsonify(
        success=True, admitted=True, admissionStatus=admission_status, profile=profile,
        cards=cards, assignments=get_student_assignment_list(reg_id, courses),
    )


@student_bp.post("/assignments")
def get_student_assignments():
    try:
        session = _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401

    reg_id = session["actorId"]
    record, _, _ = ext.data_service.find_registration_by_student_id(reg_id)
    if not record:
        return jsonify(success=False, error="We couldn't find your registration record."), 404
    if (record.get("Admission Status") or "Pending") != "Admitted":
        return jsonify(success=False, error="Assignments are available once your application is admitted."), 403

    courses = ext.data_service.get_courses_for_registration(reg_id)
    return jsonify(success=True, assignments=get_student_assignment_list(reg_id, courses))


@student_bp.post("/assignments/submit")
def submit_assignment():
    payload = request.get_json(force=True, silent=True) or {}
    try:
        session = _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401

    reg_id = session["actorId"]
    assignment_id = payload.get("assignmentId")
    submission_text = payload.get("submissionText", "")
    file_base64 = payload.get("fileBase64")
    file_name = payload.get("fileName")

    record, _, _ = ext.data_service.find_registration_by_student_id(reg_id)
    if not record:
        return jsonify(success=False, error="We couldn't find your registration record."), 404
    if (record.get("Admission Status") or "Pending") != "Admitted":
        return jsonify(success=False, error="Assignments are available once your application is admitted."), 403

    student_email = record.get("Email")
    courses = ext.data_service.get_courses_for_registration(reg_id)

    assign_headers = CONFIG.HEADERS["ASSIGNMENTS"]
    assign_sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["ASSIGNMENTS"], assign_headers)
    assignment = next((a for a in ext.sheets_client.get_all_rows_as_dicts(assign_sheet, assign_headers) if a["AssignmentID"] == assignment_id), None)
    if not assignment:
        return jsonify(success=False, error="Assignment not found."), 404

    belongs = any(
        (assignment["Course"] == c["Course"] or assignment["Course"] == "All")
        and (assignment["Category"] == c["Category"] or assignment["Category"] == "All")
        for c in courses
    )
    if not belongs:
        return jsonify(success=False, error="This assignment isn't part of your enrolled course(s)."), 403

    if (assignment.get("Status") or "Active") == "Closed":
        return jsonify(success=False, error="This assignment is closed and no longer accepting submissions."), 403

    if not submission_text and not file_base64:
        return jsonify(success=False, error="Please write a response or attach a file before submitting."), 400

    new_file_url = None
    if file_base64:
        new_file_url = ext.sheets_client.save_base64_to_drive(file_base64, CONFIG.FOLDERS["SUBMISSION"], file_name or f"{reg_id}_{assignment_id}")

    from ..services.sheets import GLOBAL_LOCK
    with GLOBAL_LOCK:
        sub_headers = CONFIG.HEADERS["SUBMISSIONS"]
        sub_sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["SUBMISSIONS"], sub_headers)
        rows = ext.sheets_client.get_all_rows_as_dicts(sub_sheet, sub_headers)

        existing_row_index = -1
        existing_record = None
        for i, r in enumerate(rows):
            if r.get("RegistrationID") == reg_id and r.get("AssignmentID") == assignment_id:
                existing_row_index = i + 2
                existing_record = r
                break

        file_url = new_file_url if new_file_url is not None else (existing_record.get("SubmissionFileURL") if existing_record else "")

        data_map = {
            "SubmissionID": existing_record["SubmissionID"] if existing_record else str(uuid.uuid4()),
            "AssignmentID": assignment_id,
            "RegistrationID": reg_id,
            "StudentName": record.get("Full Name"),
            "StudentEmail": student_email,
            "SubmissionText": submission_text or "",
            "SubmissionFileURL": file_url,
            "SubmittedAt": ext.sheets_client.now_iso(),
            "Marks": "",
            "TutorRemarks": "",
            "Status": "Submitted",
        }

        if existing_row_index > -1:
            ext.sheets_client.update_row(sub_sheet, sub_headers, existing_row_index, data_map)
        else:
            ext.sheets_client.append_row(sub_sheet, sub_headers, data_map)

    return jsonify(success=True, submissionId=data_map["SubmissionID"])
