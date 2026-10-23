"""
blueprints/registration.py
AHCT Student Hub — Public Application Portal (Section 5 of the Development Plan)
==============================================================================
Python equivalent of the registration half of Code.gs. Three endpoints:
  GET  /api/public/config             -> intake modes, categories, fees, survey fields
  GET  /api/public/payment-account    -> temporary transfer account details
  POST /api/public/register           -> processRegistration equivalent

Stage 1 (Intake Mode) / Stage 2 (Application) / Stage 3 (Payment) / receipt
are all frontend concerns (frontend/apply.html) — this blueprint only
implements Stage 4's actual write, plus the config the frontend needs to
render Stages 1-3 without hardcoding anything the backend could drift from.
==============================================================================
"""

from flask import Blueprint, request, jsonify

from .. import extensions as ext
from ..config import CONFIG
from ..services.ids import IntakeLabelUnparseable
from ..services import ids as id_service

registration_bp = Blueprint("registration", __name__, url_prefix="/api/public")


@registration_bp.get("/config")
def public_config():
    return jsonify(
        intakeModes=ext.settings_service.get_intake_mode_options(),
        categories=CONFIG.CATEGORIES,
        categoryFees=CONFIG.CATEGORY_FEES,
        courses=CONFIG.COURSES,
        surveyFields=ext.settings_service.get_survey_fields(),
    )


@registration_bp.get("/payment-account")
def payment_account():
    payment_ref = request.args.get("reference", "")
    # Static fallback account (mirrors getTemporaryAccountDetails in the
    # original Code.gs). See services/payment_service.py for the optional
    # live Monnify integration this can be switched to.
    if CONFIG.MONNIFY_ENABLED:
        from ..services.payment_service import create_monnify_reserved_account
        customer_email = request.args.get("email", "")
        customer_name = request.args.get("name", "")
        try:
            account = create_monnify_reserved_account(CONFIG, payment_ref, customer_email, customer_name)
            return jsonify(**account, validForMinutes=30)
        except Exception as e:
            return jsonify(error=str(e)), 502

    return jsonify(
        bankName=CONFIG.STATIC_BANK_NAME,
        accountNumber=CONFIG.STATIC_ACCOUNT_NUMBER,
        accountName=CONFIG.STATIC_ACCOUNT_NAME,
        reference=payment_ref,
        validForMinutes=30,
    )


def _find_duplicate_registration(sheet, headers, form_data):
    """Six-field duplicate check (Email, Phone, Intake Mode, Full Name,
    DOB, Gender), matching findDuplicateRegistration_ in Code.gs."""
    def norm(v):
        return str(v or "").strip().lower()

    target = {
        "email": norm(form_data.get("email")),
        "phone": str(form_data.get("phone") or "").strip(),
        "intakeMode": str(form_data.get("intakeMode") or "").strip(),
        "fullName": norm(form_data.get("fullName")),
        "dob": str(form_data.get("dob") or "").strip(),
        "gender": str(form_data.get("gender") or "").strip(),
    }
    rows = ext.sheets_client.get_all_rows_as_dicts(sheet, headers)
    for r in rows:
        if (norm(r.get("Email")) == target["email"]
                and str(r.get("Phone") or "").strip() == target["phone"]
                and str(r.get("Intake Mode") or "").strip() == target["intakeMode"]
                and norm(r.get("Full Name")) == target["fullName"]
                and str(r.get("DOB") or "").strip() == target["dob"]
                and str(r.get("Gender") or "").strip() == target["gender"]):
            return r
    return None


def _build_public_receipt_data(record):
    courses = ext.data_service.get_courses_for_registration(record["Reg ID"])
    return {
        "regId": record["Reg ID"],
        "intakeMode": record["Intake Mode"],
        "fullName": record["Full Name"],
        "dob": record["DOB"],
        "gender": record["Gender"],
        "email": record["Email"],
        "phone": record["Phone"],
        "learningMode": record["Learning Mode"],
        "totalFee": record["Course Fee"],
        "passportUrl": ext.sheets_client.to_direct_image_url(record.get("Passport URL")) or record.get("Passport URL") or "",
        "courses": [{"course": c["Course"], "category": c["Category"], "fee": c["Fee"]} for c in courses],
    }


@registration_bp.post("/register")
def register():
    form_data = request.get_json(force=True, silent=True) or {}

    try:
        sheet = ext.data_service.registrations_sheet()
        headers = ext.sheets_client.headers(sheet)

        # --- Duplicate submission check (first pass) ---
        early_duplicate = _find_duplicate_registration(sheet, headers, form_data)
        if early_duplicate:
            return jsonify(
                success=True, duplicate=True, regId=early_duplicate["Reg ID"],
                message="Application already submitted. This is your original Registration Summary.",
                receipt=_build_public_receipt_data(early_duplicate),
            )

        # --- Intake Mode must still be open ---
        submitted_intake = str(form_data.get("intakeMode", "")).strip()
        intake_option = next(
            (o for o in ext.settings_service.get_intake_mode_options() if str(o["label"]).strip() == submitted_intake),
            None,
        )
        if not intake_option or not intake_option["isOpen"]:
            return jsonify(success=False, error="Applications for this intake are currently closed. Please choose a different intake mode."), 400

        # --- Validate & price the selected courses server-side ---
        course_selections = form_data.get("courses") or []
        if not isinstance(course_selections, list) or len(course_selections) == 0:
            return jsonify(success=False, error="Please select at least one course before submitting."), 400

        seen_courses = set()
        enrolled_courses = []
        for item in course_selections:
            course = str((item or {}).get("course", "")).strip()
            category = str((item or {}).get("category", "")).strip()
            if not course or not category:
                return jsonify(success=False, error="Every selected course must have a course and a category."), 400
            if category not in CONFIG.CATEGORY_FEES:
                return jsonify(success=False, error=f'Unrecognized category "{category}" for {course}.'), 400
            if course in seen_courses:
                return jsonify(success=False, error=f"{course} was selected more than once."), 400
            seen_courses.add(course)

            tutor_code = ext.data_service.lookup_tutor_code(course, category)
            if not tutor_code:
                ext.security.log_action(
                    ext.sheets_client, "", CONFIG.ROLES["STUDENT"], "TUTOR_CODE_NOT_FOUND",
                    f'No Tutors-sheet row matches Course="{course}" Category="{category}" — add one so future registrations resolve correctly.',
                )
            enrolled_courses.append({
                "course": course, "category": category,
                "fee": CONFIG.CATEGORY_FEES[category], "tutorCode": tutor_code,
                "courseCode": id_service.course_code(CONFIG, course, category),
            })

        total_fee = sum(c["fee"] for c in enrolled_courses)

        # --- Verify payment actually happened, when Monnify is live ---
        # Without this, "Payment Status": "Paid" below is just whatever
        # the CLIENT sent — trivially spoofable. When Monnify is
        # configured, this replaces that blind trust with a real check
        # against the reserved account the applicant was shown on Stage
        # 3. (When Monnify is OFF, payment is still verified by a human
        # reviewing the uploaded receipt against the static account —
        # the original project's model — so no check happens here.)
        payment_reference = form_data.get("paymentReference", "")
        if CONFIG.MONNIFY_ENABLED:
            from ..services.payment_service import has_received_payment
            if not payment_reference or not has_received_payment(CONFIG, payment_reference, expected_amount=total_fee):
                return jsonify(
                    success=False,
                    error="We couldn't confirm your payment yet. Bank transfers can take a few minutes to reflect — "
                          "please wait a little and try submitting again.",
                ), 402

        # --- Passport photo and payment receipt uploads ---
        passport_url = "No File Uploaded"
        if form_data.get("passportData"):
            passport_url = ext.sheets_client.save_base64_to_drive(
                form_data["passportData"], CONFIG.FOLDERS["PASSPORT"], f'{form_data.get("fullName", "applicant")}_Passport'
            )

        receipt_url = "No File Uploaded"
        if form_data.get("receiptData"):
            receipt_url = ext.sheets_client.save_base64_to_drive(
                form_data["receiptData"], CONFIG.FOLDERS["RECEIPT"], f'{form_data.get("fullName", "applicant")}_Receipt'
            )

        # --- Student Portal credentials ---
        credentials = ext.security.build_default_credentials()

        # --- Resolve Survey-driven Part 1 fields ---
        survey_field_values = {}
        for field in ext.settings_service.get_survey_fields():
            if field["type"] == "file":
                continue
            if field["name"] not in form_data:
                continue
            header_name = ext.settings_service.SURVEY_FIELD_TO_REGISTRATION_HEADER.get(field["name"], field["label"])
            survey_field_values[header_name] = form_data[field["name"]]

        # === CRITICAL SECTION — Student ID generation + row writes ===
        from ..services.sheets import GLOBAL_LOCK
        with GLOBAL_LOCK:
            # Re-check for a duplicate now that we hold the lock.
            late_duplicate = _find_duplicate_registration(sheet, headers, form_data)
            if late_duplicate:
                return jsonify(
                    success=True, duplicate=True, regId=late_duplicate["Reg ID"],
                    message="Application already submitted. This is your original Registration Summary.",
                    receipt=_build_public_receipt_data(late_duplicate),
                )

            student_id = id_service.generate_student_id(ext.sheets_client, CONFIG, form_data.get("intakeMode"))
            serial_num = int(student_id[-4:])

            data_map = {
                "SerialNumber": serial_num,
                "Timestamp": ext.sheets_client.now_iso(),
                "Intake Mode": form_data.get("intakeMode"),
                "Reg ID": student_id,
                "Total Course Registered": len(enrolled_courses),
                "Course Fee": total_fee,
                "Learning Mode": form_data.get("learningMode"),
                "Payment Status": form_data.get("paymentStatus") or "Paid",
                "Passport URL": passport_url,
                "Payment Receipt URL": receipt_url,
                "Payment Reference": form_data.get("paymentReference", ""),
                "Password Hash": credentials["hash"],
                "Password Salt": credentials["salt"],
                "Tutor Code": "; ".join(c["tutorCode"] for c in enrolled_courses),
                "Admission Status": "Pending",
            }
            data_map.update(survey_field_values)

            missing_headers = [h for h in survey_field_values if h not in headers]
            if missing_headers:
                headers = ext.sheets_client.ensure_sheet_headers(sheet, headers + missing_headers)

            ext.sheets_client.append_row(sheet, headers, data_map)

            courses_sheet = ext.data_service.courses_sheet()
            courses_headers = ext.sheets_client.headers(courses_sheet)
            for c in enrolled_courses:
                ext.sheets_client.append_row(courses_sheet, courses_headers, {
                    "Registration ID": student_id,
                    "Full Name": form_data.get("fullName"),
                    "Course": c["course"],
                    "Category": c["category"],
                    "CourseCode": c["courseCode"],
                    "Fee": c["fee"],
                    "Tutor Code": c["tutorCode"],
                    "Timestamp": ext.sheets_client.now_iso(),
                })
        # === END CRITICAL SECTION ===

        ext.security.log_action(
            ext.sheets_client, student_id, CONFIG.ROLES["STUDENT"], "REGISTRATION_CREATED",
            f'Courses={", ".join(c["course"] + ":" + c["category"] for c in enrolled_courses)}; Fee={total_fee}; Intake={form_data.get("intakeMode")}',
        )

        login_url = f"{CONFIG.FRONTEND_URL}/student-login.html"
        email_result = ext.email_service.send_confirmation_email(form_data, student_id, enrolled_courses, total_fee, login_url)
        if email_result["sent"]:
            ext.security.log_action(ext.sheets_client, student_id, CONFIG.ROLES["STUDENT"], "CONFIRMATION_EMAIL_SENT", f'To={form_data.get("email")}')
        else:
            # Never blocks the registration itself — a student's data is
            # already safely written above — but this is exactly the
            # entry to check in SystemLogs when "the applicant didn't
            # get an email" is reported. See
            # docs/ARCHITECTURE_AND_DECISIONS.md, Section 17.
            ext.security.log_action(
                ext.sheets_client, student_id, CONFIG.ROLES["STUDENT"], "CONFIRMATION_EMAIL_FAILED",
                f'To={form_data.get("email")}; Reason={email_result["reason"]}',
            )

        # --- Retire the one-time Monnify reserved account, now that it's served its purpose ---
        if CONFIG.MONNIFY_ENABLED and payment_reference:
            from ..services.payment_service import deallocate_monnify_reserved_account
            deallocate_monnify_reserved_account(CONFIG, payment_reference)

        return jsonify(success=True, regId=student_id, emailSent=email_result["sent"])

    except IntakeLabelUnparseable as e:
        # A configuration problem (an Admin-entered Intake Mode label
        # that doesn't parse), not a fault in the applicant's submission
        # — logged distinctly so it shows up clearly in SystemLogs rather
        # than looking like just another failed registration, and the
        # applicant gets an apologetic message rather than the raw
        # technical detail.
        ext.security.log_action(
            ext.sheets_client, "", CONFIG.ROLES["STUDENT"], "INTAKE_LABEL_UNPARSEABLE",
            f'{e} | Submitted by: {form_data.get("email", "")}',
        )
        return jsonify(
            success=False,
            error="We couldn't process this intake right now due to a configuration issue on our end. "
                  "Please contact AH Consult Ltd, or try again after choosing a different intake mode.",
        ), 500

    except Exception as e:
        return jsonify(success=False, error=str(e)), 500
