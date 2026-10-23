"""
services/payment_service.py
AHCT Student Hub — Optional live payment gateway (Monnify)
==============================================================================
The supplied Code.gs already had a getTemporaryAccountDetails() that
returned a STATIC settlement account (Section 5, Stage 3) with a comment
noting Monnify as the intended real integration. This module implements
that integration for real, but keeps it OFF by default (MONNIFY_ENABLED=false)
so the project runs immediately with the same static-account behaviour the
original had, and can be switched to live reserved accounts later — see
docs/SETUP_GUIDE.md, "Setting up Monnify" for the full walkthrough.

Every endpoint path and response shape below was verified against Monnify's
own current API documentation (developers.monnify.com /
teamapt.atlassian.net/wiki/spaces/MON) — not assumed — including fixing two
real bugs found while doing that: create_monnify_reserved_account had a
dead line that would have crashed it (indexing a dict by itself), and the
original verify function called a made-up endpoint
("/api/v2/transactions/{ref}") that doesn't exist in Monnify's API at all.
This app uses the CUSTOMER RESERVED ACCOUNT payment method (a dedicated
account number per applicant), not Monnify's "Initialize Transaction"
checkout flow — those are two different Monnify products with different
verification endpoints, which is exactly where the original mix-up was.

THE "PAUSED" / TEMPORARY ACCOUNT CONCEPT — what this app calls a
"temporary account" is, in Monnify's own terms, a Reserved Account created
fresh per registration attempt (accountReference = the app's own generated
paymentReference), used exactly once. Monnify's own term for retiring one
isn't "pause" — it's "deallocate," and it is immediate and irreversible
(there's no way to later reactivate a deallocated account; if this
matters, keep the same reference and create a new one instead). See
deallocate_monnify_reserved_account() below and
docs/ARCHITECTURE_AND_DECISIONS.md, Section 18.
==============================================================================
"""

import base64
import logging

import requests

logger = logging.getLogger(__name__)


def _get_access_token(config):
    """POST {base}/api/v1/auth/login, Basic auth (base64 "apiKey:secretKey").
    Returns a short-lived Bearer token used by every other call below."""
    credentials = base64.b64encode(f"{config.MONNIFY_API_KEY}:{config.MONNIFY_SECRET_KEY}".encode()).decode()
    resp = requests.post(
        f"{config.MONNIFY_BASE_URL}/api/v1/auth/login",
        headers={"Authorization": f"Basic {credentials}"},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["responseBody"]["accessToken"]


def create_monnify_reserved_account(config, reference, customer_email, customer_name):
    """POST {base}/api/v2/bank-transfer/reserved-accounts — creates a
    dedicated account number for this one applicant (accountReference =
    our own paymentReference). Returns the first bank account offered
    (Moniepoint is Monnify's default partner bank)."""
    token = _get_access_token(config)
    resp = requests.post(
        f"{config.MONNIFY_BASE_URL}/api/v2/bank-transfer/reserved-accounts",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={
            "accountReference": reference,
            "accountName": customer_name or "AH Student Hub Applicant",
            "currencyCode": "NGN",
            "contractCode": config.MONNIFY_CONTRACT_CODE,
            "customerEmail": customer_email or config.ADMIN_EMAIL,
            "customerName": customer_name or "AH Student Hub Applicant",
        },
        timeout=20,
    )
    resp.raise_for_status()
    body = resp.json()["responseBody"]
    accounts = body.get("accounts", [body])  # V2 nests accounts[]; fall back to V1's flat shape defensively
    primary = accounts[0] if accounts else body
    return {
        "bankName": primary.get("bankName", ""),
        "accountNumber": primary.get("accountNumber", ""),
        "accountName": body.get("accountName", ""),
        "reference": reference,
    }


def get_reserved_account_transactions(config, account_reference, page=0, size=10):
    """GET {base}/api/v1/bank-transfer/reserved-accounts/transactions
    ?accountReference=...&page=...&size=... — every transfer that has
    landed on this one reserved account, newest activity included.
    Returns the list from responseBody.content (each item has amount,
    paymentStatus, transactionReference, paymentReference, completedOn)."""
    token = _get_access_token(config)
    resp = requests.get(
        f"{config.MONNIFY_BASE_URL}/api/v1/bank-transfer/reserved-accounts/transactions",
        headers={"Authorization": f"Bearer {token}"},
        params={"accountReference": account_reference, "page": page, "size": size},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["responseBody"].get("content", [])


def has_received_payment(config, account_reference, expected_amount=None, tolerance=1.0):
    """The actual server-side payment check this app uses (polling, not
    webhooks — see the module docstring's note on the trade-off). Returns
    True only if at least one transaction on this reserved account has
    paymentStatus == "PAID" and (when expected_amount is given) its
    amount is within `tolerance` naira of what was expected — so a
    trivial underpayment can't be waved through as a full payment.
    Never raises; a Monnify API error is treated as "not yet confirmed"
    (logged, not surfaced) so a transient Monnify outage reads as
    "please wait and try again" rather than a hard failure."""
    try:
        transactions = get_reserved_account_transactions(config, account_reference)
    except Exception:
        logger.exception("Could not check Monnify transactions for account %s", account_reference)
        return False

    for txn in transactions:
        if txn.get("paymentStatus") != "PAID":
            continue
        if expected_amount is not None:
            try:
                if abs(float(txn.get("amount", 0)) - float(expected_amount)) > tolerance:
                    continue
            except (TypeError, ValueError):
                continue
        return True
    return False


def deallocate_monnify_reserved_account(config, account_reference):
    """DELETE {base}/api/v1/bank-transfer/reserved-accounts/reference/
    {accountReference} — retires a reserved account immediately. Monnify
    calls this "deallocating"; there is no "pause" that can later be
    resumed — this is a one-way action. This app's reserved accounts are
    single-use (one per registration attempt), so calling this right
    after a payment is confirmed keeps the Monnify dashboard from
    accumulating thousands of stale, no-longer-watched accounts, and
    stops anyone from being able to transfer into that same account
    number again later. Never raises — called as a best-effort cleanup
    step after registration has already succeeded, so a failure here
    must never affect the applicant."""
    try:
        token = _get_access_token(config)
        resp = requests.delete(
            f"{config.MONNIFY_BASE_URL}/api/v1/bank-transfer/reserved-accounts/reference/{account_reference}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        resp.raise_for_status()
        return True
    except Exception:
        logger.exception("Could not deallocate Monnify reserved account %s", account_reference)
        return False
