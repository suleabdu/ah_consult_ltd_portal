"""
config.py
AHCT Student Hub — Central configuration
==============================================================================
Python/Flask equivalent of Config.gs. Single source of truth for sheet
names, header schemas, security settings, and business constants. Every
other module imports CONFIG from here instead of hardcoding any of these
values a second time — mirrors the discipline of the original Apps Script
project (see the MIGRATION NOTE that used to live at the top of Config.gs).

Values that come from the environment (spreadsheet ID, Google OAuth
credentials, secrets, mail settings) are read via os.environ. Security-sensitive
values intentionally have no insecure fallback; see backend/.env.example.
==============================================================================
"""

import os
from datetime import timedelta


def _bool_env(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


class Config:
    # -------------------------------------------------------------------
    # Core Flask / security
    # -------------------------------------------------------------------
    SECRET_KEY = os.environ.get("SECRET_KEY", "")
    JWT_SECRET = os.environ.get("JWT_SECRET", "")
    JWT_ALGORITHM = "HS256"

    # -------------------------------------------------------------------
    # Google Sheets / Drive (the "database")
    # -------------------------------------------------------------------
    SPREADSHEET_ID = os.environ.get("SPREADSHEET_ID", "")

    # OAuth refresh token for the Google account that owns the spreadsheet
    # (NOT a service account — see services/sheets.py's module docstring
    # for why). Generate these three once, locally, with
    # setup/get_refresh_token.py — see docs/SETUP_GUIDE.md, Steps 2-4.
    GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
    GOOGLE_REFRESH_TOKEN = os.environ.get("GOOGLE_REFRESH_TOKEN", "")

    # Drive folders — same names Code.gs already used, so an existing
    # Drive tree from the Apps Script project can be reused unchanged.
    FOLDERS = {
        "PASSPORT": "AHCT_Passports",
        "RECEIPT": "AHCT_PaymentReceipts",
        "SUBMISSION": "AHCT_Submissions",
        "LECTURE_MATERIAL": "AHCT_LectureMaterials",
    }
    DRIVE_PARENT_FOLDER_ID = os.environ.get("DRIVE_PARENT_FOLDER_ID", "")  # optional

    ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "")

    # -------------------------------------------------------------------
    # CORS — the Netlify-hosted frontend origin(s) allowed to call this API.
    # Comma-separated list; "*" allowed for local development only.
    # -------------------------------------------------------------------
    CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:8888")

    # -------------------------------------------------------------------
    # Roles
    # -------------------------------------------------------------------
    ROLES = {
        "STUDENT": "student",
        "TUTOR": "tutor",
        "ADMIN": "admin",
    }

    # -------------------------------------------------------------------
    # Security (specification Section 9 of the Development Plan)
    # -------------------------------------------------------------------
    SECURITY = {
        "DEFAULT_PASSWORD": os.environ.get("DEFAULT_PASSWORD", ""),
        "RESET_TOKEN_VALID_HOURS": int(os.environ.get("RESET_TOKEN_VALID_HOURS", "2")),
        "SESSION_TIMEOUT_MINUTES": int(os.environ.get("SESSION_TIMEOUT_MINUTES", "30")),
        "MIN_PASSWORD_LENGTH": int(os.environ.get("MIN_PASSWORD_LENGTH", "8")),
    }
    SESSION_TIMEOUT = timedelta(minutes=SECURITY["SESSION_TIMEOUT_MINUTES"])

    # -------------------------------------------------------------------
    # Business constants
    # -------------------------------------------------------------------
    # Seed data only — the live, operator-editable source of truth for
    # which intake modes exist and whether each is open is the Settings
    # sheet (see services/registration_service.get_intake_mode_options).
    INTAKE_MODES = ["July 2026 Intake", "December 2026 Intake", "March 2027 Intake"]

    CATEGORIES = ["Beginner", "Intermediate", "Professional", "Full Package"]
    CATEGORY_FEES = {
        "Beginner": 20000,
        "Intermediate": 30000,
        "Professional": 60000,
        "Full Package": 100000,
    }
    # Single-digit category codes used inside Course Codes — AH CAD Training
    # Programs ID Generation and Meaning, Section 1.1.3.
    CATEGORY_CODES = {
        "Beginner": "1",
        "Intermediate": "2",
        "Professional": "3",
        "Full Package": "4",
    }

    # Course title -> course-code prefix, per the ID Generation document,
    # Section 1.1.4. NOTE: the original site's course dropdown listed this
    # course as "Animation / Lumion" (value "Animation") — the ID document
    # names it "Lumion" with prefix LSF. This rewrite standardises on
    # "Lumion" throughout (dropdown label, CourseCode lookup) to match the
    # authoritative ID document; see docs/ARCHITECTURE_AND_DECISIONS.md.
    COURSES = ["Revit", "AutoCAD", "Graphic Design", "Lumion", "SketchUP", "ArchiCAD"]
    COURSE_CODE_PREFIX = {
        "Revit": "RVT",
        "AutoCAD": "ACAD",
        "Graphic Design": "GRD",
        "Lumion": "LSF",
        "SketchUP": "SKT",
        "ArchiCAD": "PLN",
    }

    ADMISSION_STATUSES = ["Pending", "Admitted", "Rejected"]

    # Exam Status bands (specification Section 8.1). Total = CA + Exams
    # (Objectives) + Exams (Practical). The 40/41 boundary gap in the
    # original brief is resolved as: 0-40 inclusive -> FAILED.
    EXAM_BANDS = [
        {"max": 40, "label": "FAILED"},
        {"max": 59, "label": "PASS WITH CREDIT"},
        {"max": 69, "label": "PASS WITH MERIT"},
        {"max": 100, "label": "PASS WITH DISTINCTION"},
    ]

    # -------------------------------------------------------------------
    # Sheet names ("tables" in this Sheets-as-database system)
    # -------------------------------------------------------------------
    SHEETS = {
        "REGISTRATIONS": "Registrations",
        "TUTORS": "Tutors",
        "COURSES": "Courses",
        "ASSIGNMENTS": "Assignments",
        "SUBMISSIONS": "Submissions",
        "RESULTS": "Results",
        "LEADERBOARD": "Leaderboard",
        "LECTURES": "Lectures",
        "ATTENDANCE": "Attendance",
        "SYSTEM_LOGS": "SystemLogs",
        "PASSWORD_RESET_TOKENS": "PasswordResetTokens",
        "MESSAGES": "Messages",
        "ADMINISTRATORS": "Administrators",
        "SETTINGS": "Settings",
        "SURVEY": "Survey",
        "CHOICES": "Choices",
        "EXAMS": "Exams",
        "COUNTERS": "Counters",
    }

    # -------------------------------------------------------------------
    # Header schemas — one list per sheet. Written on first use and
    # self-healed (missing columns appended, nothing ever removed or
    # reordered) by SheetsClient.get_or_create_sheet — mirrors
    # Utils.ensureSheetHeaders_ in the original project exactly.
    # -------------------------------------------------------------------
    HEADERS = {
        "REGISTRATIONS": [
            "SerialNumber", "Timestamp", "Intake Mode", "Reg ID", "Full Name", "DOB", "Gender",
            "Marital Status", "Religion", "Present Address", "Permanent Address", "Phone",
            "Emergency Phone", "Email", "Occupation", "Skills", "Laptop", "Laptop Battery",
            "Total Course Registered", "Course Fee", "Learning Mode", "Payment Status", "Referral Code",
            "Passport URL", "Payment Receipt URL", "Payment Reference", "Password Hash",
            "Password Salt", "Tutor Code", "Admission Status",
        ],
        # Tutor ID is the tutor's own email address (ID Generation document,
        # Section 1.1.5) — the primary key and login identifier for a tutor
        # account. "TutorCode" is kept alongside as the per Course+Category
        # code admin staff already use for rosters/reporting, but it is no
        # longer what a tutor logs in with.
        "TUTORS": [
            "TutorID", "TutorName", "Email", "Course", "Category", "TutorCode",
            "PasswordHash", "PasswordSalt", "CreatedDate", "PassportPhoto",
        ],
        "COURSES": [
            # "Tutor Code" is auto-filled at registration as a suggested
            # convention label (from whichever Tutors row already teaches
            # this Course+Category) — informational only. "Assigned
            # Tutor" is the tutor's email and is the ONE authoritative
            # field that actually puts a student on a tutor's roster; it
            # starts blank and is set explicitly by an admin (Admin
            # Dashboard -> a registration's course row -> Assign Tutor,
            # or POST /api/admin/registrations/assign-tutor) rather than
            # being inferred automatically. See
            # docs/ARCHITECTURE_AND_DECISIONS.md, Section 14.
            "Registration ID", "Full Name", "Course", "Category", "CourseCode", "Fee", "Tutor Code",
            "Assigned Tutor", "Timestamp",
        ],
        "ASSIGNMENTS": [
            "AssignmentID", "CourseCode", "Course", "Category", "TutorCode", "Title", "Description",
            "AttachmentURL", "DateIssued", "DueDate", "MaxScore", "Status",
        ],
        "SUBMISSIONS": [
            "SubmissionID", "AssignmentID", "RegistrationID", "StudentName", "StudentEmail",
            "SubmissionText", "SubmissionFileURL", "SubmittedAt", "Marks", "TutorRemarks", "Status",
        ],
        "RESULTS": [
            "Student Full Name", "Gender", "Phone No", "Course Registered", "CourseCode",
            "Learning Category", "RegistrationID", "Passport Photo", "CA",
            "Exams (Objectives)", "Exams (Practical)", "Total", "Exam Status",
            "Timestamp", "RecordedBy",
        ],
        "LEADERBOARD": ["RegistrationID", "StudentName", "CourseCode", "TotalScore", "Rank", "LastUpdated"],
        "LECTURES": [
            "LectureID", "CourseCode", "Course", "Category", "TutorCode", "Title",
            "Description", "MaterialURL", "DateHeld", "Status",
        ],
        "ATTENDANCE": ["AttendanceID", "LectureID", "RegistrationID", "StudentName", "Status", "Timestamp"],
        "SYSTEM_LOGS": ["LogID", "Timestamp", "ActorID", "Role", "Action", "Details"],
        "PASSWORD_RESET_TOKENS": ["Token", "ActorID", "Role", "CreatedAt", "ExpiryAt", "Used"],
        "MESSAGES": ["MessageId", "RegId", "StudentEmail", "Sender", "MessageText", "Timestamp"],
        "ADMINISTRATORS": ["Email", "Password", "PasswordSalt", "CreatedAt"],
        "SETTINGS_INTAKES": ["Intake Mode", "Opening Date", "Closing Date"],
        "SURVEY": ["type", "name", "label", "required", "choice_list", "hint"],
        "CHOICES": ["list_name", "value", "label"],
        "EXAMS": [
            "ExamID", "CourseCode", "Course", "Category", "TutorCode", "Title",
            "Instructions", "Questions", "DateSent", "DueDate", "Status",
        ],
        # One row per named counter (e.g. "StudentSerial", "Assignment",
        # "Submission", ...) — backs ids.py's atomic-ish serial generator,
        # the Sheets-native stand-in for Apps Script's LockService-guarded
        # sheet.getLastRow() pattern (see services/ids.py).
        "COUNTERS": ["CounterName", "NextValue"],
    }

    RELATIONAL_KEYS = ["RegistrationID", "CourseCode", "TutorCode", "AssignmentID", "SubmissionID"]

    # -------------------------------------------------------------------
    # Email (SMTP) — see services/email_service.py. Defaults suit Gmail
    # with an App Password; any standard SMTP provider works.
    # -------------------------------------------------------------------
    SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
    SMTP_USERNAME = os.environ.get("SMTP_USERNAME", "")
    SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
    SMTP_USE_TLS = _bool_env("SMTP_USE_TLS", True)
    MAIL_FROM_NAME = os.environ.get("MAIL_FROM_NAME", "AH Student Hub")
    MAIL_FROM_ADDRESS = os.environ.get("MAIL_FROM_ADDRESS", SMTP_USERNAME)
    EMAIL_ENABLED = _bool_env("EMAIL_ENABLED", True)

    # Public URL of the deployed frontend (Netlify) — used to build links
    # inside outbound emails (login link, reset link). Falls back to a
    # placeholder so local dev doesn't crash.
    FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:8888")

    # -------------------------------------------------------------------
    # Payment — Monnify (optional; matches the commented-out template that
    # already existed in the original Code.gs). Left disabled by default;
    # see services/payment_service.py.
    # -------------------------------------------------------------------
    MONNIFY_ENABLED = _bool_env("MONNIFY_ENABLED", False)
    MONNIFY_API_KEY = os.environ.get("MONNIFY_API_KEY", "")
    MONNIFY_SECRET_KEY = os.environ.get("MONNIFY_SECRET_KEY", "")
    MONNIFY_CONTRACT_CODE = os.environ.get("MONNIFY_CONTRACT_CODE", "")
    MONNIFY_BASE_URL = os.environ.get("MONNIFY_BASE_URL", "https://sandbox.monnify.com")

    # Static fallback settlement account shown until Monnify is configured
    # — mirrors getTemporaryAccountDetails() in the original Code.gs.
    STATIC_BANK_NAME = os.environ.get("STATIC_BANK_NAME", "")
    STATIC_ACCOUNT_NUMBER = os.environ.get("STATIC_ACCOUNT_NUMBER", "")
    STATIC_ACCOUNT_NAME = os.environ.get("STATIC_ACCOUNT_NAME", "")


CONFIG = Config()
