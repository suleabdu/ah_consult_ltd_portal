"""
extensions.py
==============================================================================
Holds the single shared instance of each service (Sheets client, security,
email, data joins, settings) created once at app startup — mirrors how the
original Apps Script project had exactly one CONFIG/Utils/Security object
shared by every file, rather than each request re-authenticating to Google
Sheets from scratch.
==============================================================================
"""

from .config import CONFIG
from .services.sheets import SheetsClient
from .services.security import SecurityService
from .services.email_service import EmailService
from .services.data_service import DataService
from .services.settings_service import SettingsService

sheets_client: SheetsClient = None
security: SecurityService = None
email_service: EmailService = None
data_service: DataService = None
settings_service: SettingsService = None


def init_services(config=CONFIG):
    global sheets_client, security, email_service, data_service, settings_service
    sheets_client = SheetsClient(config)
    security = SecurityService(config)
    email_service = EmailService(config)
    data_service = DataService(config, sheets_client)
    settings_service = SettingsService(config, sheets_client)
    return {
        "sheets_client": sheets_client,
        "security": security,
        "email_service": email_service,
        "data_service": data_service,
        "settings_service": settings_service,
    }
