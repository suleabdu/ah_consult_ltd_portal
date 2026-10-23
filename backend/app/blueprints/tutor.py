"""
blueprints/tutor.py
AHCT Student Hub — Tutor/Admin Portal (Section 7 of the Development Plan)
==============================================================================
Python equivalent of TutorService.gs + the tutor half of
AssignmentService.gs, EXTENDED to complete the phases the supplied Apps
Script project had not yet built:
  - Phase 8  (Lecture System)       -> /lectures
  - Phase 9  (Examination System)   -> /exams
  - Phase 10 (Results / Grade Student, full CA + Exams(Objectives) +
              Exams(Practical) model, Section 8.1 banding) -> /results/save
  - Phase 11 (Leaderboard recalculation) -> services/analytics_service.py,
    triggered automatically whenever a result is saved.

All tutor-side functions are scoped to the calling tutor's OWN Course +
Category, resolved from their session — never from a client-supplied
value — so one tutor can never read or grade another tutor's students.
==============================================================================
"""

import uuid

from flask import Blueprint, request, jsonify

from .. import extensions as ext
from ..config import CONFIG
from ..services import ids as id_service
from ..services.analytics_service import recalculate_leaderboard

tutor_bp = Blueprint("tutor", __name__, url_prefix="/api/tutor")


def _require_session():
    token = request.headers.get("Authorization", "").replace("Bearer ", "") or (request.get_json(silent=True) or {}).get("token")
    return ext.security.require_session(token, [CONFIG.ROLES["TUTOR"]])


def _find_tutor_or_error(session):
    tutor = ext.data_service.find_tutor_by_email(session["actorId"])
    if not tutor:
        return None, (jsonify(success=False, error="We couldn't find your tutor account."), 404)
    return tutor, None


def _compute_tutor_kpis(bundle):
    graded = [s for s in bundle["students"] if s.get("total") not in ("", None)]
    top_student = max(graded, key=lambda s: float(s["total"] or 0)) if graded else None
    return {
        "totalStudents": bundle["analytics"]["totalStudents"],
        "totalAssignmentsSubmitted": bundle["analytics"]["totalSubmissions"],
        "topPerformingStudent": {"fullName": top_student["fullName"], "total": top_student["total"]} if top_student else None,
        "averageClassScore": bundle["analytics"]["averageScore"],
        "pendingGradingCount": max(0, bundle["analytics"]["totalSubmissions"] - bundle["analytics"]["gradedCount"]),
    }


@tutor_bp.post("/dashboard")
def get_tutor_dashboard():
    try:
        session = _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401

    tutor, err = _find_tutor_or_error(session)
    if err:
        return err

    enrolled = ext.data_service.get_registration_ids_assigned_to_tutor(tutor.get("Email"))
    if not enrolled:
        return jsonify(
            success=True, assigned=False, tutorName=tutor.get("TutorName") or tutor.get("Email"),
            course=tutor.get("Course"), category=tutor.get("Category"),
        )

    bundle = ext.data_service.build_tutor_bundle(tutor)
    return jsonify(
        success=True, assigned=True, tutorName=tutor.get("TutorName") or tutor.get("Email"),
        tutorId=tutor.get("Email"), tutorCode=tutor.get("TutorCode"),
        course=tutor.get("Course"), category=tutor.get("Category"),
        students=bundle["students"], kpis=_compute_tutor_kpis(bundle),
    )


# --------------------------------------------------------------------------
# Assignments (create / edit / list) — Phase 6
# --------------------------------------------------------------------------

def _get_tutor_assignment_list(tutor):
    headers = CONFIG.HEADERS["ASSIGNMENTS"]
    sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["ASSIGNMENTS"], headers)
    assignments = [a for a in ext.sheets_client.get_all_rows_as_dicts(sheet, headers)
                   if a.get("Course") == tutor["Course"] and a.get("Category") == tutor["Category"]]

    sub_headers = CONFIG.HEADERS["SUBMISSIONS"]
    sub_sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["SUBMISSIONS"], sub_headers)
    all_submissions = ext.sheets_client.get_all_rows_as_dicts(sub_sheet, sub_headers)

    result = []
    for a in assignments:
        subs = [s for s in all_submissions if s.get("AssignmentID") == a["AssignmentID"]]
        ungraded = sum(1 for s in subs if not s.get("Marks"))
        result.append({
            "assignmentId": a["AssignmentID"], "title": a["Title"], "description": a["Description"],
            "dueDate": a["DueDate"], "maxScore": a["MaxScore"], "attachmentUrl": a["AttachmentURL"],
            "postedDate": a["DateIssued"], "status": a.get("Status") or "Active",
            "submissionCount": len(subs), "ungradedCount": ungraded,
        })
    result.sort(key=lambda a: a["postedDate"] or "", reverse=True)
    return result


@tutor_bp.post("/assignments")
def get_tutor_assignments():
    try:
        session = _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401
    tutor, err = _find_tutor_or_error(session)
    if err:
        return err
    return jsonify(success=True, assignments=_get_tutor_assignment_list(tutor))


@tutor_bp.post("/assignments/create")
def create_assignment():
    payload = request.get_json(force=True, silent=True) or {}
    try:
        session = _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401
    tutor, err = _find_tutor_or_error(session)
    if err:
        return err

    title = str(payload.get("title", "")).strip()
    if not title:
        return jsonify(success=False, error="Assignment title is required."), 400

    max_score = payload.get("maxScore", "")
    if max_score not in ("", None):
        try:
            if float(max_score) < 0:
                raise ValueError
        except ValueError:
            return jsonify(success=False, error="Max score must be a positive number."), 400

    headers = CONFIG.HEADERS["ASSIGNMENTS"]
    sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["ASSIGNMENTS"], headers)
    code = id_service.course_code(CONFIG, tutor["Course"], tutor["Category"])
    assignment_id = id_service.generate_assignment_id(ext.sheets_client, CONFIG, code)

    ext.sheets_client.append_row(sheet, headers, {
        "AssignmentID": assignment_id, "CourseCode": code, "Course": tutor["Course"], "Category": tutor["Category"],
        "TutorCode": tutor.get("TutorCode"), "Title": title, "Description": payload.get("description", ""),
        "AttachmentURL": payload.get("attachmentUrl", ""), "DateIssued": ext.sheets_client.now_iso(),
        "DueDate": payload.get("dueDate", ""), "MaxScore": max_score, "Status": "Active",
    })

    ext.security.log_action(ext.sheets_client, session["actorId"], CONFIG.ROLES["TUTOR"], "ASSIGNMENT_CREATED", f"AssignmentID={assignment_id}; Title={title}")
    return jsonify(success=True, assignments=_get_tutor_assignment_list(tutor))


@tutor_bp.post("/assignments/update")
def update_assignment():
    payload = request.get_json(force=True, silent=True) or {}
    try:
        session = _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401
    tutor, err = _find_tutor_or_error(session)
    if err:
        return err

    assignment_id = payload.get("assignmentId")
    headers = CONFIG.HEADERS["ASSIGNMENTS"]
    sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["ASSIGNMENTS"], headers)
    rows = ext.sheets_client.get_all_rows_as_dicts(sheet, headers)
    row_idx = next((i for i, r in enumerate(rows) if r.get("AssignmentID") == assignment_id), -1)
    if row_idx == -1:
        return jsonify(success=False, error="Assignment not found."), 404

    record = rows[row_idx]
    if record.get("Course") != tutor["Course"] or record.get("Category") != tutor["Category"]:
        return jsonify(success=False, error="You can only edit your own assignments."), 403

    title = str(payload.get("title", "")).strip()
    if not title:
        return jsonify(success=False, error="Assignment title is required."), 400

    max_score = payload.get("maxScore", "")
    if max_score not in ("", None):
        try:
            if float(max_score) < 0:
                raise ValueError
        except ValueError:
            return jsonify(success=False, error="Max score must be a positive number."), 400

    ext.sheets_client.update_row(sheet, headers, row_idx + 2, {
        "Title": title, "Description": payload.get("description", ""), "DueDate": payload.get("dueDate", ""),
        "MaxScore": max_score, "AttachmentURL": payload.get("attachmentUrl", ""),
        "Status": payload.get("status") or record.get("Status") or "Active",
    })

    ext.security.log_action(ext.sheets_client, session["actorId"], CONFIG.ROLES["TUTOR"], "ASSIGNMENT_UPDATED", f"AssignmentID={assignment_id}")
    return jsonify(success=True, assignments=_get_tutor_assignment_list(tutor))


# --------------------------------------------------------------------------
# Submissions review & grading — Phase 7
# --------------------------------------------------------------------------

@tutor_bp.post("/submissions")
def get_submissions_for_review():
    payload = request.get_json(force=True, silent=True) or {}
    try:
        session = _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401
    tutor, err = _find_tutor_or_error(session)
    if err:
        return err

    assignment_id = payload.get("assignmentId")

    assign_headers = CONFIG.HEADERS["ASSIGNMENTS"]
    assign_sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["ASSIGNMENTS"], assign_headers)
    tutor_assignments = [a for a in ext.sheets_client.get_all_rows_as_dicts(assign_sheet, assign_headers)
                          if a.get("Course") == tutor["Course"] and a.get("Category") == tutor["Category"]]
    assignment_by_id = {a["AssignmentID"]: a for a in tutor_assignments}

    relevant_ids = [assignment_id] if assignment_id and assignment_id in assignment_by_id else (list(assignment_by_id.keys()) if not assignment_id else [])

    reg_sheet = ext.data_service.registrations_sheet()
    reg_headers = ext.sheets_client.headers(reg_sheet)
    reg_by_id = {r["Reg ID"]: r for r in ext.sheets_client.get_all_rows_as_dicts(reg_sheet, reg_headers)}

    sub_headers = CONFIG.HEADERS["SUBMISSIONS"]
    sub_sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["SUBMISSIONS"], sub_headers)
    submissions = []
    for s in ext.sheets_client.get_all_rows_as_dicts(sub_sheet, sub_headers):
        if s.get("AssignmentID") not in relevant_ids:
            continue
        assignment = assignment_by_id.get(s.get("AssignmentID"))
        student = reg_by_id.get(s.get("RegistrationID"))
        submissions.append({
            "submissionId": s["SubmissionID"], "assignmentId": s["AssignmentID"],
            "assignmentTitle": assignment["Title"] if assignment else "(deleted assignment)",
            "regId": s["RegistrationID"], "studentName": student["Full Name"] if student else s.get("StudentEmail"),
            "submissionText": s["SubmissionText"], "submissionFileUrl": s["SubmissionFileURL"],
            "submittedDate": s["SubmittedAt"], "grade": s["Marks"], "feedback": s["TutorRemarks"],
            "maxScore": assignment["MaxScore"] if assignment else "",
        })
    submissions.sort(key=lambda s: s["submittedDate"] or "", reverse=True)
    return jsonify(success=True, submissions=submissions)


@tutor_bp.post("/submissions/grade")
def grade_submission():
    payload = request.get_json(force=True, silent=True) or {}
    try:
        session = _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401
    tutor, err = _find_tutor_or_error(session)
    if err:
        return err

    submission_id = payload.get("submissionId")
    grade = payload.get("grade")
    feedback = payload.get("feedback", "")

    sub_headers = CONFIG.HEADERS["SUBMISSIONS"]
    sub_sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["SUBMISSIONS"], sub_headers)
    rows = ext.sheets_client.get_all_rows_as_dicts(sub_sheet, sub_headers)
    row_idx = next((i for i, r in enumerate(rows) if r.get("SubmissionID") == submission_id), -1)
    if row_idx == -1:
        return jsonify(success=False, error="Submission not found."), 404

    record = rows[row_idx]
    assign_headers = CONFIG.HEADERS["ASSIGNMENTS"]
    assign_sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["ASSIGNMENTS"], assign_headers)
    assignment = next((a for a in ext.sheets_client.get_all_rows_as_dicts(assign_sheet, assign_headers) if a["AssignmentID"] == record.get("AssignmentID")), None)
    if not assignment or assignment.get("Course") != tutor["Course"] or assignment.get("Category") != tutor["Category"]:
        return jsonify(success=False, error="You can only grade submissions for your own assignments."), 403

    if assignment.get("MaxScore") and grade not in ("", None):
        try:
            g = float(grade)
            if g < 0 or g > float(assignment["MaxScore"]):
                raise ValueError
        except ValueError:
            return jsonify(success=False, error=f'Grade must be between 0 and {assignment["MaxScore"]}.'), 400

    ext.sheets_client.update_row(sub_sheet, sub_headers, row_idx + 2, {
        "Marks": "" if grade in (None, "") else grade, "TutorRemarks": feedback or "",
    })

    ext.security.log_action(ext.sheets_client, session["actorId"], CONFIG.ROLES["TUTOR"], "SUBMISSION_GRADED", f"SubmissionID={submission_id}; Grade={grade}")
    return jsonify(success=True)


# --------------------------------------------------------------------------
# Grade Student / Results — Phase 10 (Section 7.4 / 8.1)
# --------------------------------------------------------------------------

@tutor_bp.post("/results/save")
def save_result():
    payload = request.get_json(force=True, silent=True) or {}
    try:
        session = _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401
    tutor, err = _find_tutor_or_error(session)
    if err:
        return err

    reg_id = payload.get("regId")
    reg_record, _, _ = ext.data_service.find_registration_by_student_id(reg_id)
    if not reg_record:
        return jsonify(success=False, error="Student not found."), 404

    # Ownership: the student must actually be assigned to this tutor.
    enrolled = ext.data_service.get_registration_ids_assigned_to_tutor(tutor.get("Email"))
    if reg_id not in enrolled:
        return jsonify(success=False, error="You can only record results for your own students."), 403

    def _num(v):
        try:
            return float(v or 0)
        except (TypeError, ValueError):
            return 0

    ca = _num(payload.get("ca"))
    exam_obj = _num(payload.get("examObjectives"))
    exam_prac = _num(payload.get("examPractical"))
    total = round(ca + exam_obj + exam_prac, 2)
    exam_status = ext.data_service.exam_status_for_total(total)
    code = id_service.course_code(CONFIG, tutor["Course"], tutor["Category"])

    headers = CONFIG.HEADERS["RESULTS"]
    sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["RESULTS"], headers)
    rows = ext.sheets_client.get_all_rows_as_dicts(sheet, headers)
    row_idx = next((i for i, r in enumerate(rows) if r.get("RegistrationID") == reg_id and r.get("CourseCode") == code), -1)

    data_map = {
        "Student Full Name": reg_record.get("Full Name"), "Gender": reg_record.get("Gender"),
        "Phone No": reg_record.get("Phone"), "Course Registered": tutor["Course"], "CourseCode": code,
        "Learning Category": tutor["Category"], "RegistrationID": reg_id,
        "Passport Photo": reg_record.get("Passport URL"), "CA": ca,
        "Exams (Objectives)": exam_obj, "Exams (Practical)": exam_prac, "Total": total,
        "Exam Status": exam_status, "Timestamp": ext.sheets_client.now_iso(), "RecordedBy": tutor.get("Email"),
    }

    if row_idx > -1:
        ext.sheets_client.update_row(sheet, headers, row_idx + 2, data_map)
    else:
        ext.sheets_client.append_row(sheet, headers, data_map)

    ext.security.log_action(ext.sheets_client, session["actorId"], CONFIG.ROLES["TUTOR"], "RESULT_SAVED", f"RegId={reg_id}; Total={total}; Status={exam_status}")

    # Phase 11 — Leaderboard recalculates immediately whenever a result changes.
    recalculate_leaderboard(CONFIG, ext.sheets_client, course_code_value=code)

    return jsonify(success=True, total=total, examStatus=exam_status)


# --------------------------------------------------------------------------
# Lectures — Phase 8
# --------------------------------------------------------------------------

@tutor_bp.post("/lectures")
def get_lectures():
    try:
        session = _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401
    tutor, err = _find_tutor_or_error(session)
    if err:
        return err

    headers = CONFIG.HEADERS["LECTURES"]
    sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["LECTURES"], headers)
    lectures = [l for l in ext.sheets_client.get_all_rows_as_dicts(sheet, headers)
                if l.get("Course") == tutor["Course"] and l.get("Category") == tutor["Category"]]
    lectures.sort(key=lambda l: l.get("DateHeld") or "", reverse=True)
    return jsonify(success=True, lectures=lectures)


@tutor_bp.post("/lectures/create")
def create_lecture():
    payload = request.get_json(force=True, silent=True) or {}
    try:
        session = _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401
    tutor, err = _find_tutor_or_error(session)
    if err:
        return err

    title = str(payload.get("title", "")).strip()
    if not title:
        return jsonify(success=False, error="Lecture title is required."), 400

    material_url = payload.get("materialUrl", "")
    if payload.get("materialData"):
        material_url = ext.sheets_client.save_base64_to_drive(
            payload["materialData"], CONFIG.FOLDERS["LECTURE_MATERIAL"], f"{title}_{tutor['Course']}"
        )

    code = id_service.course_code(CONFIG, tutor["Course"], tutor["Category"])
    headers = CONFIG.HEADERS["LECTURES"]
    sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["LECTURES"], headers)
    lecture_id = id_service.generate_lecture_id(ext.sheets_client, CONFIG, code)

    ext.sheets_client.append_row(sheet, headers, {
        "LectureID": lecture_id, "CourseCode": code, "Course": tutor["Course"], "Category": tutor["Category"],
        "TutorCode": tutor.get("TutorCode"), "Title": title, "Description": payload.get("description", ""),
        "MaterialURL": material_url, "DateHeld": payload.get("dateHeld") or ext.sheets_client.now_iso(),
        "Status": "Published",
    })

    ext.security.log_action(ext.sheets_client, session["actorId"], CONFIG.ROLES["TUTOR"], "LECTURE_CREATED", f"LectureID={lecture_id}; Title={title}")
    return jsonify(success=True, lectureId=lecture_id)


# --------------------------------------------------------------------------
# Exams — Phase 9
# --------------------------------------------------------------------------

@tutor_bp.post("/exams")
def get_exams():
    try:
        session = _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401
    tutor, err = _find_tutor_or_error(session)
    if err:
        return err

    headers = CONFIG.HEADERS["EXAMS"]
    sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["EXAMS"], headers)
    exams = [e for e in ext.sheets_client.get_all_rows_as_dicts(sheet, headers)
             if e.get("Course") == tutor["Course"] and e.get("Category") == tutor["Category"]]
    return jsonify(success=True, exams=exams)


@tutor_bp.post("/exams/create")
def create_exam():
    """Authors and 'sends' an exam to this tutor's own roster (Section
    7.3's "Set up Exams"). Questions are stored as free-form JSON text —
    this project doesn't specify a question-bank schema, so a flexible
    text/JSON blob (rendered by the frontend) is used rather than
    over-specifying one."""
    payload = request.get_json(force=True, silent=True) or {}
    try:
        session = _require_session()
    except PermissionError as e:
        return jsonify(success=False, error=str(e)), 401
    tutor, err = _find_tutor_or_error(session)
    if err:
        return err

    title = str(payload.get("title", "")).strip()
    if not title:
        return jsonify(success=False, error="Exam title is required."), 400

    code = id_service.course_code(CONFIG, tutor["Course"], tutor["Category"])
    headers = CONFIG.HEADERS["EXAMS"]
    sheet = ext.sheets_client.get_or_create_sheet(CONFIG.SHEETS["EXAMS"], headers)
    exam_id = id_service.generate_exam_id(ext.sheets_client, CONFIG, code)

    import json
    ext.sheets_client.append_row(sheet, headers, {
        "ExamID": exam_id, "CourseCode": code, "Course": tutor["Course"], "Category": tutor["Category"],
        "TutorCode": tutor.get("TutorCode"), "Title": title, "Instructions": payload.get("instructions", ""),
        "Questions": json.dumps(payload.get("questions", [])), "DateSent": ext.sheets_client.now_iso(),
        "DueDate": payload.get("dueDate", ""), "Status": "Sent",
    })

    ext.security.log_action(ext.sheets_client, session["actorId"], CONFIG.ROLES["TUTOR"], "EXAM_CREATED", f"ExamID={exam_id}; Title={title}")
    return jsonify(success=True, examId=exam_id)
