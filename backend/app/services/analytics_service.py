"""
services/analytics_service.py
AHCT Student Hub — Leaderboard recalculation & cross-cutting KPIs (Phase 11)
==============================================================================
Not present in the supplied Apps Script project (AnalyticsService.gs was
named in the Development Plan's file architecture, Section 10.1, but never
implemented) — built here to complete Phase 11: "AnalyticsService.gs to
recalculate Leaderboard whenever Results changes."

recalculate_leaderboard is called from tutor.py's /results/save immediately
after every grade save, so the Leaderboard sheet — and therefore the
Student Portal's "Leaderboard" dashboard card (StudentService equivalent)
— never goes stale.
==============================================================================
"""


def recalculate_leaderboard(config, sheets_client, course_code_value=None):
    """Recomputes rank within each CourseCode from the Results sheet's
    Total column and rewrites the Leaderboard sheet. If course_code_value
    is given, only that course's ranks are touched (still a full rewrite
    of the sheet, since gspread has no cheap partial-clear — acceptable at
    this project's data volume)."""
    results_headers = config.HEADERS["RESULTS"]
    results_sheet = sheets_client.get_or_create_sheet(config.SHEETS["RESULTS"], results_headers)
    results = sheets_client.get_all_rows_as_dicts(results_sheet, results_headers)

    by_course = {}
    for r in results:
        code = r.get("CourseCode")
        if not code:
            continue
        by_course.setdefault(code, []).append(r)

    leaderboard_headers = config.HEADERS["LEADERBOARD"]
    leaderboard_sheet = sheets_client.get_or_create_sheet(config.SHEETS["LEADERBOARD"], leaderboard_headers)

    rows = []
    for code, entries in by_course.items():
        ranked = sorted(entries, key=lambda r: float(r.get("Total") or 0), reverse=True)
        for rank, r in enumerate(ranked, start=1):
            rows.append([
                r.get("RegistrationID"), r.get("Student Full Name"), code,
                r.get("Total"), rank, sheets_client.now_iso(),
            ])

    # Full rewrite (header + all rows) — simplest correct approach given
    # ranks can shift for every student whenever any one result changes.
    leaderboard_sheet.clear()
    leaderboard_sheet.update("A1", [leaderboard_headers] + rows if rows else [leaderboard_headers])
    leaderboard_sheet.format(f"A1:{chr(64 + len(leaderboard_headers))}1", {"textFormat": {"bold": True}})
