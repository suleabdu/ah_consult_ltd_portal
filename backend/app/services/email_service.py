"""
services/email_service.py
AHCT Student Hub — Outbound transactional email
==============================================================================
Python equivalent of EmailService.gs, sent over SMTP instead of GmailApp.
Every outbound email in the system goes through this module. Templates are
carried over from the original project close to verbatim (same subject
lines, same visual structure) so the emails a registrant/tutor receives
look the way AH Consult Ltd already expects.

FAILURES ARE NEVER SILENT: every send_* method returns a result dict,
{"sent": bool, "reason": str | None} — "reason" is None on success, or a
short, specific explanation on failure ("EMAIL_ENABLED is false", "SMTP
credentials not configured", or the actual SMTP exception message, e.g.
an authentication failure). Registration/etc. still never FAILS just
because mail isn't configured or a send didn't go through — callers
(blueprints/registration.py) log this result to SystemLogs either way,
so "why didn't the applicant get an email" is answerable by reading
SystemLogs directly, instead of only a Python log line on Render that
may never get checked. See docs/ARCHITECTURE_AND_DECISIONS.md, Section 17.
==============================================================================
"""

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)


class EmailService:
    def __init__(self, config):
        self.config = config

    def send_email(self, to_email, subject, html_body, cc=None, reply_to=None):
        """Returns {"sent": bool, "reason": str | None}. Never raises —
        every failure mode (disabled, unconfigured, or an actual SMTP
        error) is captured into "reason" instead."""
        if not self.config.EMAIL_ENABLED:
            reason = "EMAIL_ENABLED is false"
            logger.info("%s — skipping send to %s: %s", reason, to_email, subject)
            return {"sent": False, "reason": reason}
        if not self.config.SMTP_USERNAME or not self.config.SMTP_PASSWORD:
            reason = "SMTP_USERNAME/SMTP_PASSWORD not configured"
            logger.warning("%s — skipping send to %s: %s", reason, to_email, subject)
            return {"sent": False, "reason": reason}
        if not to_email:
            reason = "No recipient email address was provided"
            logger.warning("%s — skipping send: %s", reason, subject)
            return {"sent": False, "reason": reason}

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{self.config.MAIL_FROM_NAME} <{self.config.MAIL_FROM_ADDRESS}>"
        msg["To"] = to_email
        if cc:
            msg["Cc"] = cc if isinstance(cc, str) else ", ".join(cc)
        if reply_to:
            msg["Reply-To"] = reply_to
        msg.attach(MIMEText(html_body, "html"))

        recipients = [to_email]
        if cc:
            recipients += cc.split(",") if isinstance(cc, str) else list(cc)

        try:
            with smtplib.SMTP(self.config.SMTP_HOST, self.config.SMTP_PORT, timeout=20) as server:
                if self.config.SMTP_USE_TLS:
                    server.starttls()
                server.login(self.config.SMTP_USERNAME, self.config.SMTP_PASSWORD)
                server.sendmail(self.config.MAIL_FROM_ADDRESS, recipients, msg.as_string())
            return {"sent": True, "reason": None}
        except smtplib.SMTPAuthenticationError as e:
            reason = (
                f"SMTP login was rejected ({e.smtp_code}: {e.smtp_error!r}). For Gmail, this almost always "
                "means SMTP_PASSWORD is a regular account password instead of a 16-character App Password — "
                "see docs/SETUP_GUIDE.md, Step 10."
            )
            logger.exception("SMTP authentication failed sending to %s", to_email)
            return {"sent": False, "reason": reason}
        except Exception as e:
            reason = f"{type(e).__name__}: {e}"
            logger.exception("Failed to send email to %s", to_email)
            return {"sent": False, "reason": reason}

    def send_test_email(self, to_email):
        """Used by the Admin Dashboard's "Send Test Email" diagnostic
        (blueprints/admin.py's /email/test) so a broken SMTP setup can be
        confirmed and diagnosed in seconds, without needing a full
        registration round-trip."""
        html = (
            "<div style=\"font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#374151; "
            "max-width: 480px; margin: 0 auto; padding: 30px; border: 1px solid #e5e7eb; border-radius: 12px;\">"
            "<h2 style=\"color:#ea580c; margin:0 0 16px 0;\">AH STUDENT HUB</h2>"
            "<p>This is a test email from your AH Student Hub backend — if you're reading this, "
            "outbound email is configured correctly.</p>"
            "</div>"
        )
        return self.send_email(to_email, "AH Student Hub — Test Email", html)

    # --- Password reset ----------------------------------------------------

    def send_password_reset_email(self, to_email, display_name, reset_link):
        hours = self.config.SECURITY["RESET_TOKEN_VALID_HOURS"]
        html = f"""
        <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #374151; max-width: 500px; margin: 0 auto; background-color: #ffffff; padding: 35px; border-radius: 12px; border: 1px solid #e5e7eb;">
          <h2 style="color: #ea580c; margin: 0 0 20px 0; font-size: 22px;">AH STUDENT HUB</h2>
          <p style="font-size: 15px;">Hello {display_name or 'there'},</p>
          <p style="font-size: 15px; line-height: 1.6; color: #4b5563;">We received a request to reset your password. This link is valid for {hours} hours and can only be used once:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="{reset_link}" target="_blank" style="display: inline-block; background-color: #ea580c; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px;">Reset My Password</a>
          </div>
          <p style="font-size: 13px; color: #6b7280;">If you didn't request this, you can safely ignore this email — your password will stay unchanged.</p>
        </div>
        """
        return self.send_email(to_email, "Reset Your AH Student Hub Password", html)

    # --- Registration confirmation ------------------------------------------

    def send_confirmation_email(self, form_data, student_id, enrolled_courses, total_fee, login_url):
        subject = f"Registration Confirmation - {student_id}"

        courses_list_html = "".join(
            f'<li style="margin-bottom: 6px;"><b>{c["course"]}</b> '
            f'<span style="color:#6b7280;">({c["category"]})</span> — ₦{c["fee"]:,}</li>'
            for c in enrolled_courses
        )

        html = f"""
        <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #374151; max-width: 750px; margin: 0 auto; background-color: #ffffff; padding: 40px; border-radius: 12px; border: 1px solid #e5e7eb;">
          <div style="text-align: center; margin-bottom: 40px;">
            <h2 style="color: #ea580c; margin: 0; font-size: 28px; letter-spacing: 0.5px;">AH STUDENT HUB</h2>
            <div style="height: 2px; width: 60px; background-color: #ea580c; margin: 15px auto;"></div>
            <h3 style="color: #111827; margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 2px;">{form_data.get('intakeMode', '')} Application</h3>
          </div>
          <p style="font-size: 16px; margin-bottom: 20px;">Hello <b>{form_data.get('fullName', '')}</b>,</p>
          <p style="font-size: 16px; line-height: 1.7; color: #4b5563;">Thank you for registering. Your payment has been verified and your enrollment is officially confirmed for:</p>
          <ul style="font-size: 16px; line-height: 1.6; color: #374151; padding-left: 22px; margin: 12px 0 6px 0;">
            {courses_list_html}
          </ul>
          <p style="font-size: 16px; font-weight: 700; color: #111827; margin: 6px 0 20px 0;">Total Fee: ₦{total_fee:,}</p>
          <p style="font-size: 16px; line-height: 1.7; color: #4b5563;">You will be contacted via Email, WhatsApp or your phone number to further guide you on when to start your lectures.</p>
          <div style="background-color: #f8fafc; padding: 25px; border-left: 5px solid #ea580c; margin: 30px 0; border-radius: 6px; text-align: center;">
            <p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Your Student ID</p>
            <strong style="color: #111827; font-size: 24px; letter-spacing: 2px;">{student_id}</strong>
          </div>
          <div style="background-color: #fff7ed; border: 1px solid #fed7aa; padding: 30px; text-align: center; border-radius: 8px; margin: 35px 0;">
            <p style="font-size: 16px; margin: 0 0 8px 0; color: #9a3412; font-weight: 600;">Your Student Portal Login Details</p>
            <p style="font-size: 14px; margin: 0 0 20px 0; color: #9a3412;">Use these details to log in to the Student Portal.</p>
            <table style="margin: 0 auto; text-align: left; font-size: 15px; color: #374151;">
              <tr><td style="padding: 4px 12px; font-weight: 600;">Student ID:</td><td style="padding: 4px 12px; font-family: monospace;">{student_id}</td></tr>
              <tr><td style="padding: 4px 12px; font-weight: 600;">Temporary Password:</td><td style="padding: 4px 12px; font-family: monospace;">{self.config.SECURITY['DEFAULT_PASSWORD']}</td></tr>
            </table>
            <p style="font-size: 12px; margin: 16px 0 12px 0; color: #9a3412;">You'll be asked to choose your own password the first time you log in.</p>
            <a href="{login_url}" target="_blank" style="display: inline-block; background-color: #ea580c; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">Log In to Student Portal</a>
          </div>
          <p style="font-size: 15px; line-height: 1.7; color: #4b5563; margin-top: 30px;">
            Please keep your Student ID secure. You may use it to refer 5 friends, which qualifies you for a <b>20% refund</b> on your registration fee.
          </p>
          <div style="margin-top: 40px; border-top: 1px solid #e5e7eb; padding-top: 30px;">
            <p style="font-size: 15px; margin-bottom: 5px;">Best Regards,</p>
            <p style="font-size: 16px; font-weight: bold; margin: 0;">AH Student Hub Team</p>
          </div>
        </div>
        """
        cc = self.config.ADMIN_EMAIL
        return self.send_email(form_data.get("email"), subject, html, cc=cc, reply_to=self.config.ADMIN_EMAIL)

    # --- Chat-style student message notification (Messages sheet) ---------

    def send_chat_notification(self, student_name, student_id, student_email, message_text):
        subject = f"New Student Portal Message — {student_name} ({student_id})"
        html = (
            f"<p>{student_name} ({student_id}) sent a message via the Student Portal:</p>"
            f'<p style="padding:12px;background:#f8fafc;border-left:4px solid #ea580c;">{message_text}</p>'
            f"<p>Reply directly to this email to respond — it will go straight to the student's inbox.</p>"
        )
        return self.send_email(self.config.ADMIN_EMAIL, subject, html, reply_to=student_email)
