"""
services/sheets.py
AHCT Student Hub — Google Sheets client (the "database" layer)
==============================================================================
Python equivalent of Utilities.gs. Every other service module reads and
writes sheet data exclusively through the SheetsClient below — nothing
outside this file calls the Google Sheets API directly, mirroring how
every .gs service file only ever went through Utils.gs.

Design notes carried over from the Apps Script project:
  - Rows are always mapped by HEADER NAME, never by column position
    (row_to_dict / get_all_rows), so column reordering/migration can never
    silently misalign data.
  - get_or_create_sheet self-heals: it only ever APPENDS missing header
    columns, never removes or reorders existing ones — safe to run against
    a worksheet that already has live data.
  - A process-local threading.Lock stands in for Apps Script's
    LockService.getScriptLock() around the few critical sections that must
    not interleave (ID generation + row append). This is documented in
    services/ids.py; see the caveat there about multi-instance/multi-worker
    deployments.

AUTHENTICATION — OAuth refresh token, not a service account:
  A service account has NO personal Drive storage of its own. Uploading a
  file "owned" by a service account into a regular Gmail account's Drive
  fails immediately unless it's inside a Shared Drive — a paid Google
  Workspace feature, not available on a personal Gmail account. So this
  client instead authenticates as the SAME Google account that already
  owns the spreadsheet, via a long-lived OAuth refresh token generated
  once, locally, by setup/get_refresh_token.py — exactly matching how the
  original Apps Script project ran under "Execute as: Me". Every uploaded
  file ends up owned by that real account, using its normal 15 GB quota,
  nothing paid or organization-only required. See docs/SETUP_GUIDE.md.
==============================================================================
"""

import base64
import io
import re
import threading
from datetime import datetime, timezone

import gspread
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# One process-wide lock guarding every "read current state, then write"
# critical section across the whole app (registration, submissions,
# ID counters, etc.) — the same coarse-grained trade-off
# LockService.getScriptLock() made in the original project: simple and
# safe, at the cost of serializing unrelated writes briefly. See
# services/ids.py for the note on horizontally-scaled deployments.
#
# RLock, not Lock: several call paths acquire this lock and then call
# into another function that acquires it again on the SAME thread (e.g.
# blueprints/registration.py holds it for the whole "check duplicate +
# generate ID + write rows" critical section, and ids.py's
# next_counter_value() — called from inside that same block — also
# acquires it around the counter read/write). A plain threading.Lock()
# is NOT reentrant, so that nested acquisition deadlocks the request
# forever: the passport/receipt uploads (which happen before the lock)
# complete and appear in Drive, any log lines written before the lock
# (e.g. TUTOR_CODE_NOT_FOUND) appear in SystemLogs, but the thread then
# blocks permanently trying to re-acquire a lock it already holds — the
# Registrations row is never written and the request never returns, so
# the frontend sits at "Submitting Application..." indefinitely.
# threading.RLock() allows the same thread to acquire it multiple times
# (with matching releases) while still only ever allowing ONE thread
# through at a time overall, which is all the atomicity guarantee here
# actually requires.
GLOBAL_LOCK = threading.RLock()


class SheetsClient:
    """Thin wrapper around gspread + Drive, scoped to one spreadsheet."""

    def __init__(self, config):
        self.config = config
        # Deliberately lazy: credentials are not loaded and no Google API
        # client is created until the first sheet/Drive operation actually
        # runs. This lets the Flask app boot (and /api/health report a
        # clear "degraded" reason) even before Google credentials are
        # configured, instead of crashing on import.
        self._creds = None
        self._gc = None
        self._drive = None
        self._spreadsheet = None
        self._sheet_cache = {}

    def _ensure_client(self):
        if self._gc is None:
            self._creds = self._load_credentials()
            self._gc = gspread.authorize(self._creds)
            self._drive = build("drive", "v3", credentials=self._creds, cache_discovery=False)

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------
    def _load_credentials(self):
        client_id = self.config.GOOGLE_CLIENT_ID
        client_secret = self.config.GOOGLE_CLIENT_SECRET
        refresh_token = self.config.GOOGLE_REFRESH_TOKEN

        if not (client_id and client_secret and refresh_token):
            raise RuntimeError(
                "Google OAuth credentials are not configured. Set "
                "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and "
                "GOOGLE_REFRESH_TOKEN — generate them once by running "
                "setup/get_refresh_token.py locally. See "
                "docs/SETUP_GUIDE.md, Steps 2-4."
            )

        # token=None (no access token yet) + refresh_token set is
        # deliberate: google-auth transparently exchanges the refresh
        # token for a fresh, short-lived access token on first use (and
        # again whenever it expires), via token_uri — no access token ever
        # needs to be stored. This is the standard recipe for a
        # long-running service acting as a fixed, already-consented user.
        return Credentials(
            token=None,
            refresh_token=refresh_token,
            client_id=client_id,
            client_secret=client_secret,
            token_uri="https://oauth2.googleapis.com/token",
            scopes=SCOPES,
        )

    # ------------------------------------------------------------------
    # Spreadsheet / sheet access
    # ------------------------------------------------------------------
    def spreadsheet(self):
        self._ensure_client()
        if self._spreadsheet is None:
            if not self.config.SPREADSHEET_ID:
                raise RuntimeError("SPREADSHEET_ID is not configured — see docs/SETUP_GUIDE.md, Step 3.")
            self._spreadsheet = self._gc.open_by_key(self.config.SPREADSHEET_ID)
        return self._spreadsheet

    def get_or_create_sheet(self, sheet_name, required_headers):
        """Opens (or creates) a named tab and makes sure its header row
        contains every required column. Mirrors Utils.getOrCreateSheet_."""
        cache_key = sheet_name
        ss = self.spreadsheet()
        try:
            sheet = ss.worksheet(sheet_name)
        except gspread.exceptions.WorksheetNotFound:
            sheet = ss.add_worksheet(title=sheet_name, rows=200, cols=max(26, len(required_headers) + 5))
        self.ensure_sheet_headers(sheet, required_headers)
        self._sheet_cache[cache_key] = sheet
        return sheet

    def ensure_sheet_headers(self, sheet, required_headers):
        """Writes headers on a brand-new sheet, or migrates an existing
        sheet by appending any headers it's missing — mirrors
        Utils.ensureSheetHeaders_. Never removes or reorders columns."""
        values = sheet.get_all_values()
        if not values:
            sheet.update("A1", [required_headers])
            sheet.format(f"A1:{gspread.utils.rowcol_to_a1(1, len(required_headers))}", {"textFormat": {"bold": True}})
            return list(required_headers)

        existing_headers = values[0]
        missing = [h for h in required_headers if h not in existing_headers]
        if missing:
            start_col = len(existing_headers) + 1
            end_col = start_col + len(missing) - 1
            rng = f"{gspread.utils.rowcol_to_a1(1, start_col)}:{gspread.utils.rowcol_to_a1(1, end_col)}"
            sheet.update(rng, [missing])
            sheet.format(rng, {"textFormat": {"bold": True}})
            return existing_headers + missing
        return existing_headers

    def headers(self, sheet):
        values = sheet.row_values(1)
        return values

    # ------------------------------------------------------------------
    # Row <-> dict mapping (always by header NAME, never by position)
    # ------------------------------------------------------------------
    @staticmethod
    def row_to_dict(headers, row):
        obj = {}
        for i, h in enumerate(headers):
            obj[h] = row[i] if i < len(row) else ""
        return obj

    def get_all_rows_as_dicts(self, sheet, headers):
        values = sheet.get_all_values()
        if len(values) < 2:
            return []
        rows = values[1:]
        return [self.row_to_dict(headers, r) for r in rows if any(cell.strip() for cell in r)]

    def find_row_index_by_column(self, sheet, headers, column_name, value):
        """1-indexed sheet row where column_name == value (case-insensitive,
        trimmed). Returns -1 if not found. Mirrors
        Utils.findRowIndexByColumn_ — the one relational lookup every
        service should use, never a positional match."""
        if column_name not in headers:
            return -1
        col_idx = headers.index(column_name)
        values = sheet.get_all_values()
        target = str(value).strip().lower()
        for i, row in enumerate(values[1:], start=2):
            cell = row[col_idx] if col_idx < len(row) else ""
            if str(cell).strip().lower() == target:
                return i
        return -1

    def append_row(self, sheet, headers, data_map):
        """Builds a row by HEADER NAME (so column order/migrations never
        misalign data) and appends it."""
        row = [data_map.get(h, "") for h in headers]
        sheet.append_row(row, value_input_option="USER_ENTERED")
        return row

    def update_row(self, sheet, headers, row_index, data_map):
        """Overwrites specific columns of an existing row, by header name.
        Only columns present in data_map are touched."""
        for h, value in data_map.items():
            if h in headers:
                col = headers.index(h) + 1
                sheet.update_cell(row_index, col, value)

    def set_cell(self, sheet, headers, row_index, header_name, value):
        if header_name not in headers:
            return
        col = headers.index(header_name) + 1
        sheet.update_cell(row_index, col, value)

    # ------------------------------------------------------------------
    # Files (Drive) — mirrors Utils.saveBase64ToDrive_ / toDirectImageUrl_
    # ------------------------------------------------------------------
    def _get_or_create_folder(self, folder_name):
        self._ensure_client()
        query = (
            f"name = '{folder_name}' and mimeType = 'application/vnd.google-apps.folder' "
            "and trashed = false"
        )
        if self.config.DRIVE_PARENT_FOLDER_ID:
            query += f" and '{self.config.DRIVE_PARENT_FOLDER_ID}' in parents"
        resp = self._drive.files().list(q=query, fields="files(id, name)").execute()
        files = resp.get("files", [])
        if files:
            return files[0]["id"]

        metadata = {"name": folder_name, "mimeType": "application/vnd.google-apps.folder"}
        if self.config.DRIVE_PARENT_FOLDER_ID:
            metadata["parents"] = [self.config.DRIVE_PARENT_FOLDER_ID]
        folder = self._drive.files().create(body=metadata, fields="id").execute()
        return folder["id"]

    def save_base64_to_drive(self, base64_string, folder_name, file_name_prefix):
        """Decodes a data: URL (or bare base64 payload) and uploads it to
        (or creates) the named Drive folder, making the file link-shareable.
        Returns the standard Drive "share" URL — mirrors
        Utils.saveBase64ToDrive_."""
        if not base64_string:
            return ""

        if "," in base64_string and base64_string.strip().startswith("data:"):
            header, b64data = base64_string.split(",", 1)
            content_type = header.split(";")[0].split(":")[1] if ":" in header else "application/octet-stream"
        else:
            b64data = base64_string
            content_type = "application/octet-stream"

        raw = base64.b64decode(b64data)
        folder_id = self._get_or_create_folder(folder_name)

        ext = self._extension_for_mime(content_type)
        safe_name = re.sub(r"[^A-Za-z0-9_\-]+", "_", file_name_prefix)[:120]
        file_metadata = {"name": f"{safe_name}{ext}", "parents": [folder_id]}
        media = MediaIoBaseUpload(io.BytesIO(raw), mimetype=content_type, resumable=False)
        file = self._drive.files().create(body=file_metadata, media_body=media, fields="id, webViewLink").execute()

        file_id = file["id"]
        # Make link-shareable (anyone with the link can view) so staff and
        # the app itself can render it without per-file ACL headaches —
        # same posture the original Drive folders used.
        try:
            self._drive.permissions().create(
                fileId=file_id, body={"type": "anyone", "role": "reader"}
            ).execute()
        except Exception:
            pass

        return file.get("webViewLink") or f"https://drive.google.com/file/d/{file_id}/view"

    @staticmethod
    def _extension_for_mime(mime):
        return {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/webp": ".webp",
            "application/pdf": ".pdf",
        }.get(mime, "")

    @staticmethod
    def to_direct_image_url(drive_share_url):
        """The sheet stores the standard Drive "share" link so staff can
        open it directly — that link doesn't render as an <img> on its own.
        Derives a directly-embeddable image URL from the same file ID.
        Mirrors Utils.toDirectImageUrl_."""
        if not drive_share_url:
            return ""
        match = re.search(r"[-\w]{25,}", drive_share_url)
        return f"https://lh3.googleusercontent.com/d/{match.group(0)}" if match else ""

    # ------------------------------------------------------------------
    # Dates
    # ------------------------------------------------------------------
    @staticmethod
    def now_iso():
        return datetime.now(timezone.utc).isoformat()
