"""
services/ids.py
AHCT Student Hub — ID generation
==============================================================================
Implements "AH CAD Training Programs — ID Generation and Meaning" (the
document supplied alongside the site files) as the single source of truth
for every generated ID in this system. This supersedes the OLD Apps Script
project's Registration ID format (Utils.generateRegistrationId_, which
produced IDs like "AH/4-BIPF/001") — see
docs/ARCHITECTURE_AND_DECISIONS.md for the full comparison and why the new
document's scheme was adopted instead.

--------------------------------------------------------------------------
STUDENT ID  (the "Registration ID" / login identifier)
--------------------------------------------------------------------------
Format (document Section 1.1.1 / 1.1.2), no separators:

    AH  CT  YY  M   NNNN
    AH = Organisation initials (AH Consult Ltd)
    CT = "CAD Training" programme, abbreviated
    YY = 2-digit year of the INTAKE (not necessarily the calendar year of
         submission — e.g. someone registering in Nov 2026 for the "March
         2027 Intake" gets YY=27)
    M  = the INTAKE's month, as its plain calendar number, no leading
         zero: July -> "7", October -> "10", December -> "12". THIS IS
         REVISION 2 of the month code — see "Revision history" below.
    NNNN = 4-digit, zero-padded, globally-incrementing student serial
           number (Counters sheet, counter name "StudentSerial")

    Examples: AHCT2670001 (July 2026 intake, 1st student — 11 characters)
              AHCT26100001 (October 2026 intake, 1st student — 12 characters)

REVISION HISTORY on the month code, because it changed once already:
  - Revision 1 (first build): the ID document's own worked examples only
    ever show a single digit ("9" for September), which doesn't obviously
    extend to Oct/Nov/Dec while holding the ID to a fixed 11 characters.
    That build's disclosed default used letters 'O'/'N'/'D' for those
    three months to preserve a fixed 11-character length.
  - Revision 2 (this version, per explicit instruction): the month code
    is now simply the intake's calendar month number as plain digits —
    "7" for July, "10" for October — with NO fixed total length; a
    December-intake ID is one character longer than a July-intake one.
    This is a deliberate, requested trade-off (clearer, unambiguous month
    codes over a fixed ID length) superseding Revision 1's default.

WHAT DID NOT CHANGE, and is worth stating plainly because it was the
actual bug being fixed alongside the code-format request: the month
ALWAYS comes from the selected Intake Mode's own label (e.g. "October
2026 Intake" -> month 10), NEVER from the server's current calendar date.
parse_intake_year_month() below has no fallback-to-today path at all any
more — if it can't read a month/year out of the intake label, it raises,
rather than silently substituting today's date. A silent fallback to
"today" is exactly what could make an intake's ID carry the wrong month
whenever an admin-entered intake label didn't parse (e.g. via the Admin
Dashboard's free-text "Add New Intake" field) — instead that now surfaces
immediately as a clear, actionable error at registration time (see
blueprints/registration.py) rather than quietly writing a wrong ID.

--------------------------------------------------------------------------
COURSE CODE
--------------------------------------------------------------------------
Format (document Sections 1.1.3 / 1.1.4): <course-prefix><category-digit>,
e.g. "RVT3" = Revit, Professional. Deterministic — looked up from
CONFIG.COURSE_CODE_PREFIX / CONFIG.CATEGORY_CODES, never generated per
registration. One student can hold several Course Codes (one per enrolled
course), consistent with the multi-course enrollment model already built
into the live Google Sheet schema.

--------------------------------------------------------------------------
TUTOR ID
--------------------------------------------------------------------------
Per document Section 1.1.5, the Tutor ID *is* the tutor's own email
address — there is no separate generated format. See services/auth.py.

--------------------------------------------------------------------------
OTHER IDS (Assignment / Submission / Lecture / Attendance / Exam)
--------------------------------------------------------------------------
Not specified by the document. Extended here, disclosed, in the same
relational spirit: "<CourseCode>-<kind><serial>" so every ID is still
traceable to its course at a glance, using the same Counters-backed serial
mechanism as the Student ID.
==============================================================================
"""

import re

from .sheets import GLOBAL_LOCK

MONTH_NAME_TO_NUMBER = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}


def next_counter_value(sheets_client, config, counter_name):
    """Atomically-ish (process-lock-guarded) increment-and-return for a
    named counter, backed by the Counters sheet. This is the Sheets-native
    stand-in for the original project's
    `lastRow = sheet.getLastRow(); serial = lastRow <= 1 ? 1 : lastRow`
    pattern, generalised to any ID kind instead of only Registrations.

    CAVEAT FOR PRODUCTION DEPLOYMENTS: the lock below is process-local. A
    single Render web service instance (the default / recommended setup
    for this project's traffic scale — see docs/SETUP_GUIDE.md) makes this
    safe. If you later scale to multiple instances/workers, replace
    GLOBAL_LOCK with a distributed lock (e.g. Redis) or move counters to a
    transactional store — the read-then-write below is not safe across
    processes without one.
    """
    with GLOBAL_LOCK:
        headers = config.HEADERS["COUNTERS"]
        sheet = sheets_client.get_or_create_sheet(config.SHEETS["COUNTERS"], headers)
        rows = sheets_client.get_all_rows_as_dicts(sheet, headers)

        row_index = -1
        current = 0
        for i, r in enumerate(rows):
            if r.get("CounterName") == counter_name:
                row_index = i + 2
                try:
                    current = int(r.get("NextValue") or 0)
                except ValueError:
                    current = 0
                break

        next_value = current + 1
        if row_index == -1:
            sheets_client.append_row(sheet, headers, {"CounterName": counter_name, "NextValue": next_value})
        else:
            sheets_client.set_cell(sheet, headers, row_index, "NextValue", next_value)

        return next_value


class IntakeLabelUnparseable(ValueError):
    """Raised when an Intake Mode's label doesn't contain a recognisable
    month name and 4-digit year. Deliberately a distinct, named exception
    (rather than a bare ValueError) so callers — see
    blueprints/registration.py — can catch it specifically and log/report
    it as a configuration problem rather than a generic failure."""


def parse_intake_year_month(intake_mode_label):
    """"July 2026 Intake" -> (2026, 7). "October 2026" -> (2026, 10).

    Deliberately has NO fallback to the current date. Every Student ID's
    month/year comes from the selected Intake Mode's own label — nowhere
    else. If the label doesn't contain a recognisable month name and a
    4-digit year, this raises IntakeLabelUnparseable with a message
    naming the exact label that failed, rather than silently substituting
    today's month/year (which would quietly bake the wrong month into
    every Student ID generated against that intake until someone noticed
    by hand). See the module docstring's "WHAT DID NOT CHANGE" note.
    """
    label = intake_mode_label or ""
    m = re.search(r"([A-Za-z]+)\s+(\d{4})", label)
    if not m:
        raise IntakeLabelUnparseable(
            f'Could not determine the intake month and year from the intake label "{label}". '
            'Intake Mode labels must contain a month name and a 4-digit year, e.g. '
            '"July 2026 Intake" — check this intake under Admin Dashboard -> Intake Modes.'
        )

    month_name, year_str = m.group(1).lower(), m.group(2)
    month = MONTH_NAME_TO_NUMBER.get(month_name)
    if month is None:
        raise IntakeLabelUnparseable(
            f'"{m.group(1)}" in the intake label "{label}" is not a recognised month name — '
            'check this intake under Admin Dashboard -> Intake Modes.'
        )

    return int(year_str), month


def generate_student_id(sheets_client, config, intake_mode_label):
    """AHCT<YY><M><NNNN> — see module docstring. Raises
    IntakeLabelUnparseable (propagated from parse_intake_year_month) if
    intake_mode_label doesn't carry a readable month/year — this
    deliberately stops registration rather than generate an ID with a
    wrong or guessed month."""
    year, month = parse_intake_year_month(intake_mode_label)
    yy = f"{year % 100:02d}"
    m_code = str(month)  # "7" for July, "10" for October — no leading zero
    serial = next_counter_value(sheets_client, config, "StudentSerial")
    nnnn = f"{serial:04d}"
    return f"AHCT{yy}{m_code}{nnnn}"


def course_code(config, course, category):
    """Deterministic lookup — never a serial. Raises a clear error for an
    unrecognised course/category pair rather than silently returning ''."""
    prefix = config.COURSE_CODE_PREFIX.get(course)
    digit = config.CATEGORY_CODES.get(category)
    if not prefix or not digit:
        return ""
    return f"{prefix}{digit}"


def generate_assignment_id(sheets_client, config, course_code_value):
    serial = next_counter_value(sheets_client, config, "Assignment")
    prefix = course_code_value or "GEN"
    return f"{prefix}-A{serial:04d}"


def generate_submission_id(sheets_client, config, student_id):
    serial = next_counter_value(sheets_client, config, "Submission")
    return f"{student_id}-S{serial:04d}"


def generate_lecture_id(sheets_client, config, course_code_value):
    serial = next_counter_value(sheets_client, config, "Lecture")
    prefix = course_code_value or "GEN"
    return f"{prefix}-L{serial:04d}"


def generate_attendance_id(sheets_client, config, lecture_id):
    serial = next_counter_value(sheets_client, config, "Attendance")
    return f"{lecture_id}-AT{serial:04d}"


def generate_exam_id(sheets_client, config, course_code_value):
    serial = next_counter_value(sheets_client, config, "Exam")
    prefix = course_code_value or "GEN"
    return f"{prefix}-EX{serial:04d}"
