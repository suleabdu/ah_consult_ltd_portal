"""
services/settings_service.py
AHCT Student Hub — Site settings: intake scheduling & the dynamic Part 1 form
==============================================================================
Python equivalent of Code.gs's "SITE SETTINGS" and "SURVEY / CHOICES"
sections. An admin edits the Settings / Survey / Choices sheets directly
(same operating model as the original) — no separate settings UI. Editing
a row changes the live public form immediately, no redeploy required.
==============================================================================
"""

from datetime import datetime, timedelta, date


class SettingsService:
    def __init__(self, config, sheets_client):
        self.config = config
        self.db = sheets_client

    # --- Intake modes --------------------------------------------------------

    def ensure_settings_seeded(self):
        headers = self.config.HEADERS["SETTINGS_INTAKES"]
        sheet = self.db.get_or_create_sheet(self.config.SHEETS["SETTINGS"], headers)
        rows = self.db.get_all_rows_as_dicts(sheet, headers)
        if not rows:
            today = date.today()
            far_future = today + timedelta(days=2 * 365)
            for mode in self.config.INTAKE_MODES:
                self.db.append_row(sheet, headers, {
                    "Intake Mode": mode,
                    "Opening Date": today.isoformat(),
                    "Closing Date": far_future.isoformat(),
                })
        return sheet

    def get_intake_mode_options(self):
        """Returns every configured intake mode with its current
        open/closed status and its raw opening/closing dates (so admin UI
        can show and edit them), e.g.
        [{label, isOpen, openingDate, closingDate}, ...]. Both dates are
        inclusive."""
        sheet = self.ensure_settings_seeded()
        headers = self.config.HEADERS["SETTINGS_INTAKES"]
        rows = self.db.get_all_rows_as_dicts(sheet, headers)
        today = date.today()

        options = []
        for r in rows:
            label = r.get("Intake Mode")
            if not label:
                continue
            open_date = self._parse_date(r.get("Opening Date"))
            close_date = self._parse_date(r.get("Closing Date"))
            is_open = (open_date is None or today >= open_date) and (close_date is None or today <= close_date)
            options.append({
                "label": label,
                "isOpen": is_open,
                "openingDate": r.get("Opening Date", ""),
                "closingDate": r.get("Closing Date", ""),
            })
        return options

    @staticmethod
    def _parse_date(value):
        if not value:
            return None
        if isinstance(value, str):
            for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y"):
                try:
                    return datetime.strptime(value.split("T")[0], fmt).date()
                except ValueError:
                    continue
            return None
        return None

    # --- Dynamic Part 1 survey ------------------------------------------------

    SURVEY_FIELD_TO_REGISTRATION_HEADER = {
        "fullName": "Full Name",
        "dob": "DOB",
        "gender": "Gender",
        "maritalStatus": "Marital Status",
        "religion": "Religion",
        "phone": "Phone",
        "email": "Email",
        "emergencyPhone": "Emergency Phone",
        "presentAddress": "Present Address",
        "permanentAddress": "Permanent Address",
        "occupation": "Occupation",
        "skills": "Skills",
        "laptop": "Laptop",
        "laptopBattery": "Laptop Battery",
        "referralCode": "Referral Code",
    }

    SEED_SURVEY_ROWS = [
        ["text", "fullName", "Full Name", "TRUE", "", ""],
        ["date", "dob", "Date of Birth", "TRUE", "", ""],
        ["select_one", "gender", "Select Gender", "TRUE", "gender", ""],
        ["select_one", "maritalStatus", "Marital Status", "TRUE", "marital_status", ""],
        ["select_one", "religion", "Religion", "TRUE", "religion", ""],
        ["text", "phone", "Applicant's Phone No.", "TRUE", "", ""],
        ["email", "email", "Email Address", "TRUE", "", ""],
        ["text", "emergencyPhone", "Emergency Phone No.", "TRUE", "", ""],
        ["textarea", "presentAddress", "Present Address", "TRUE", "", ""],
        ["textarea", "permanentAddress", "Permanent Address", "TRUE", "", ""],
        ["text", "occupation", "Occupation / Designation", "TRUE", "", ""],
        ["text", "skills", "Skills (comma separated)", "FALSE", "", ""],
        ["select_one", "laptop", "Do you have a laptop?", "TRUE", "yes_no", ""],
        ["select_one", "laptopBattery", "Laptop Battery Strength", "FALSE", "battery_strength", ""],
        ["text", "referralCode", "Referral Code (Optional)", "FALSE", "", ""],
        ["file", "passportImage", "Upload Passport Picture", "TRUE", "", ""],
    ]

    SEED_CHOICES_ROWS = [
        ["gender", "Male", "Male"],
        ["gender", "Female", "Female"],
        ["marital_status", "Single", "Single"],
        ["marital_status", "Married", "Married"],
        ["religion", "Christian", "Christian"],
        ["religion", "Muslim", "Muslim"],
        ["yes_no", "Yes", "Yes"],
        ["yes_no", "No", "No"],
        ["battery_strength", "Less than 3 hours", "Less than 3 hours"],
        ["battery_strength", "3 hours", "3 Hours"],
        ["battery_strength", "More than 3 hours", "More than 3 hours"],
    ]

    def ensure_survey_seeded(self):
        survey_headers = self.config.HEADERS["SURVEY"]
        survey_sheet = self.db.get_or_create_sheet(self.config.SHEETS["SURVEY"], survey_headers)
        if not self.db.get_all_rows_as_dicts(survey_sheet, survey_headers):
            for row in self.SEED_SURVEY_ROWS:
                survey_sheet.append_row(row, value_input_option="USER_ENTERED")

        choices_headers = self.config.HEADERS["CHOICES"]
        choices_sheet = self.db.get_or_create_sheet(self.config.SHEETS["CHOICES"], choices_headers)
        if not self.db.get_all_rows_as_dicts(choices_sheet, choices_headers):
            for row in self.SEED_CHOICES_ROWS:
                choices_sheet.append_row(row, value_input_option="USER_ENTERED")

    def get_survey_fields(self):
        self.ensure_survey_seeded()
        survey_headers = self.config.HEADERS["SURVEY"]
        survey_sheet = self.db.get_or_create_sheet(self.config.SHEETS["SURVEY"], survey_headers)
        survey_rows = self.db.get_all_rows_as_dicts(survey_sheet, survey_headers)

        choices_headers = self.config.HEADERS["CHOICES"]
        choices_sheet = self.db.get_or_create_sheet(self.config.SHEETS["CHOICES"], choices_headers)
        choice_rows = self.db.get_all_rows_as_dicts(choices_sheet, choices_headers)

        fields = []
        for r in survey_rows:
            if not r.get("name"):
                continue
            field = {
                "type": r.get("type") or "text",
                "name": r.get("name"),
                "label": r.get("label") or r.get("name"),
                "required": str(r.get("required")).strip().upper() == "TRUE",
                "hint": r.get("hint") or "",
            }
            if r.get("choice_list"):
                field["choices"] = [
                    {"value": c["value"], "label": c["label"]}
                    for c in choice_rows if c.get("list_name") == r["choice_list"]
                ]
            fields.append(field)
        return fields
