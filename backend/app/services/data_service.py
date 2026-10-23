"""
services/data_service.py
AHCT Student Hub — Shared cross-sheet lookups
==============================================================================
Centralises the relational joins used by more than one blueprint — the
Python equivalent of the shared helpers that lived directly in Code.gs
(findTutorByCode_, buildTutorBundle_, getCoursesForRegistration_, etc.).
Every join here goes through one of the five relational keys (Section 13
of the Development Plan): RegistrationID / StudentID, CourseCode,
TutorCode (or Tutor email), AssignmentID, SubmissionID — never a
positional column match.
==============================================================================
"""

from .ids import course_code as compute_course_code


class DataService:
    def __init__(self, config, sheets_client):
        self.config = config
        self.db = sheets_client

    # --- Registrations ------------------------------------------------------

    def registrations_sheet(self):
        return self.db.get_or_create_sheet(self.config.SHEETS["REGISTRATIONS"], self.config.HEADERS["REGISTRATIONS"])

    def find_registration_by_student_id(self, student_id):
        sheet = self.registrations_sheet()
        headers = self.db.headers(sheet)
        row_index = self.db.find_row_index_by_column(sheet, headers, "Reg ID", student_id)
        if row_index == -1:
            return None, None, -1
        row = sheet.row_values(row_index)
        record = self.db.row_to_dict(headers, row)
        return record, headers, row_index

    # --- Courses (one row per enrolled course) ------------------------------

    def courses_sheet(self):
        return self.db.get_or_create_sheet(self.config.SHEETS["COURSES"], self.config.HEADERS["COURSES"])

    def get_courses_for_registration(self, student_id):
        sheet = self.courses_sheet()
        headers = self.db.headers(sheet)
        rows = self.db.get_all_rows_as_dicts(sheet, headers)
        return [r for r in rows if r.get("Registration ID") == student_id]

    def get_registration_ids_for_course(self, course, category):
        sheet = self.courses_sheet()
        headers = self.db.headers(sheet)
        rows = self.db.get_all_rows_as_dicts(sheet, headers)
        return {r["Registration ID"] for r in rows if r.get("Course") == course and r.get("Category") == category}

    def get_registration_ids_assigned_to_tutor(self, tutor_email):
        """The AUTHORITATIVE tutor roster lookup — every registration ID
        whose Courses row has this tutor's email in "Assigned Tutor".
        Unlike get_registration_ids_for_course (a Course+Category
        convention match, still used for the registration-time "Tutor
        Code" suggestion and for the student's own "classmates" count),
        this is the explicit, admin-controlled assignment that actually
        determines what a tutor can see and grade. See
        docs/ARCHITECTURE_AND_DECISIONS.md, Section 14."""
        sheet = self.courses_sheet()
        headers = self.db.headers(sheet)
        rows = self.db.get_all_rows_as_dicts(sheet, headers)
        target = str(tutor_email or "").strip().lower()
        return {r["Registration ID"] for r in rows if str(r.get("Assigned Tutor", "")).strip().lower() == target and target}

    def assign_tutor_to_course(self, student_id, course, tutor_email):
        """Sets (or clears, if tutor_email is falsy) the explicit
        "Assigned Tutor" on the one Courses row matching this
        Registration ID + Course. Returns True if a matching row was
        found and updated, False otherwise."""
        sheet = self.courses_sheet()
        headers = self.db.headers(sheet)
        values = sheet.get_all_values()
        reg_idx = headers.index("Registration ID")
        course_idx = headers.index("Course")
        for i, row in enumerate(values[1:], start=2):
            row_reg = row[reg_idx] if reg_idx < len(row) else ""
            row_course = row[course_idx] if course_idx < len(row) else ""
            if row_reg == student_id and row_course == course:
                self.db.set_cell(sheet, headers, i, "Assigned Tutor", tutor_email or "")
                return True
        return False

    def get_tutors_for_course(self, course, category):
        """All Tutors rows registered for this exact Course + Category —
        used to populate the admin's "assign a tutor" dropdown scoped to
        tutors who actually teach that course."""
        sheet = self.tutors_sheet()
        headers = self.db.headers(sheet)
        rows = self.db.get_all_rows_as_dicts(sheet, headers)
        return [r for r in rows if r.get("Course") == course and r.get("Category") == category]

    # --- Tutors --------------------------------------------------------------

    def tutors_sheet(self):
        return self.db.get_or_create_sheet(self.config.SHEETS["TUTORS"], self.config.HEADERS["TUTORS"])

    def find_tutor_by_email(self, email):
        """Tutor ID = email (ID Generation document, Section 1.1.5)."""
        sheet = self.tutors_sheet()
        headers = self.db.headers(sheet)
        rows = self.db.get_all_rows_as_dicts(sheet, headers)
        target = str(email or "").strip().lower()
        for r in rows:
            if str(r.get("Email", "")).strip().lower() == target or str(r.get("TutorID", "")).strip().lower() == target:
                return r
        return None

    def lookup_tutor_code(self, course, category):
        """Read-only lookup: matches Course+Category against the Tutors
        sheet and returns whatever Tutor Code is already assigned. Never
        creates a Tutors row."""
        sheet = self.tutors_sheet()
        headers = self.db.headers(sheet)
        rows = self.db.get_all_rows_as_dicts(sheet, headers)
        for r in rows:
            if r.get("Course") == course and r.get("Category") == category:
                return r.get("TutorCode", "")
        return ""

    def build_tutor_bundle(self, tutor):
        """Everything the Tutor Portal needs, scoped strictly to students
        explicitly assigned to this tutor (see
        get_registration_ids_assigned_to_tutor) — NOT every student who
        merely shares this tutor's Course + Category. Mirrors
        buildTutorBundle_ in Code.gs, updated for explicit assignment."""
        course, category = tutor.get("Course"), tutor.get("Category")
        tutor_email = tutor.get("Email")

        enrolled_ids = self.get_registration_ids_assigned_to_tutor(tutor_email)
        reg_sheet = self.registrations_sheet()
        reg_headers = self.db.headers(reg_sheet)
        matched_regs = [r for r in self.db.get_all_rows_as_dicts(reg_sheet, reg_headers) if r.get("Reg ID") in enrolled_ids]

        results_headers = self.config.HEADERS["RESULTS"]
        results_sheet = self.db.get_or_create_sheet(self.config.SHEETS["RESULTS"], results_headers)
        class_results = [
            r for r in self.db.get_all_rows_as_dicts(results_sheet, results_headers)
            if r.get("CourseCode") == compute_course_code(self.config, course, category)
        ]
        results_by_reg = {r["RegistrationID"]: r for r in class_results}

        students = []
        for r in matched_regs:
            existing = results_by_reg.get(r.get("Reg ID"))
            students.append({
                "regId": r.get("Reg ID"),
                "fullName": r.get("Full Name"),
                "email": r.get("Email"),
                "phone": r.get("Phone"),
                "paymentStatus": r.get("Payment Status"),
                "intakeMode": r.get("Intake Mode"),
                "photoUrl": self.db.to_direct_image_url(r.get("Passport URL")),
                "ca": existing.get("CA") if existing else "",
                "examObjectives": existing.get("Exams (Objectives)") if existing else "",
                "examPractical": existing.get("Exams (Practical)") if existing else "",
                "total": existing.get("Total") if existing else "",
                "examStatus": existing.get("Exam Status") if existing else "",
            })
        reg_ids = {s["regId"] for s in students}

        assignment_headers = self.config.HEADERS["ASSIGNMENTS"]
        assignment_sheet = self.db.get_or_create_sheet(self.config.SHEETS["ASSIGNMENTS"], assignment_headers)
        assignments = [
            a for a in self.db.get_all_rows_as_dicts(assignment_sheet, assignment_headers)
            if (a.get("Course") == course or a.get("Course") == "All") and (a.get("Category") == category or a.get("Category") == "All")
        ]

        submission_headers = self.config.HEADERS["SUBMISSIONS"]
        submission_sheet = self.db.get_or_create_sheet(self.config.SHEETS["SUBMISSIONS"], submission_headers)
        relevant_submissions = [
            s for s in self.db.get_all_rows_as_dicts(submission_sheet, submission_headers)
            if s.get("RegistrationID") in reg_ids
        ]

        paid_count = sum(1 for s in students if s["paymentStatus"] == "Paid")
        avg_score = None
        if class_results:
            total = sum(float(r.get("Total") or 0) for r in class_results)
            avg_score = round(total / len(class_results), 1)

        analytics = {
            "totalStudents": len(students),
            "paidCount": paid_count,
            "unpaidCount": len(students) - paid_count,
            "totalAssignments": len(assignments),
            "totalSubmissions": len(relevant_submissions),
            "gradedCount": sum(1 for s in relevant_submissions if s.get("Marks")),
            "resultsPublished": len(class_results),
            "averageScore": avg_score,
        }

        return {"students": students, "assignments": assignments, "analytics": analytics}

    # --- Exam status banding (Development Plan Section 8.1) ----------------

    def exam_status_for_total(self, total):
        for band in self.config.EXAM_BANDS:
            if total <= band["max"]:
                return band["label"]
        return self.config.EXAM_BANDS[-1]["label"]
