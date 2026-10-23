#!/usr/bin/env python3
"""Dependency-light legacy regression checks for current AH STUDENT HUB releases."""
from __future__ import annotations

import html.parser
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
MIGRATIONS = ROOT / "supabase" / "migrations"
errors: list[str] = []
checks: list[str] = []


def ok(message: str) -> None:
    checks.append(message)


def fail(message: str) -> None:
    errors.append(message)


# 1. Migration sequence.
nums = sorted(int(p.name[:3]) for p in MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql"))
expected = list(range(1, max(nums) + 1)) if nums else []
if not nums or nums != expected:
    fail(f"Migration sequence is {nums}; expected a continuous sequence starting at 001.")
else:
    ok(f"SQL migrations are numbered continuously from 001 through {max(nums):03d}")

# 2. Migration safeguards and the explicit alias regression fix.
m021 = (MIGRATIONS / "021_academic_integrity_release_readiness.sql").read_text(encoding="utf-8")
for token, label in [
    ("qi.question_ordinal", "qualified WITH ORDINALITY alias"),
    ("legacy_exam_results_archive", "durable legacy results archive"),
    ("grading_model", "model-aware result grading"),
    ("needs_review", "ambiguous grading model safeguards"),
    ("release_readiness_snapshot", "release-readiness diagnostic RPC"),
    ("admin_legacy_result_archive", "restricted legacy archive reader"),
    ("enable row level security", "row-level security on legacy archive"),
    ("revoke all on public.legacy_exam_results_archive", "direct archive access revoked"),
    ("student_score_privacy_ok", "student draft-score privacy diagnostic"),
    ("reopen_result_for_correction", "controlled result correction workflow"),
]:
    if token not in m021:
        fail(f"Migration 021 is missing {label} ({token}).")
    else:
        ok(f"Migration 021 contains {label}")

# 3. JavaScript syntax checks, external files and inline scripts.
node = shutil.which("node")
if not node:
    fail("Node.js is not available; JavaScript syntax could not be verified.")
else:
    for js in sorted(FRONTEND.rglob("*.js")):
        r = subprocess.run([node, "--check", str(js)], capture_output=True, text=True)
        if r.returncode:
            fail(f"JavaScript syntax error in {js.relative_to(ROOT)}: {r.stderr.strip()}")
    if not any(e.startswith("JavaScript syntax error") for e in errors):
        ok("External frontend JavaScript passes Node syntax checks")

    class InlineScriptParser(html.parser.HTMLParser):
        def __init__(self) -> None:
            super().__init__(convert_charrefs=False)
            self.in_script = False
            self.attrs: dict[str, str | None] = {}
            self.buf: list[str] = []
            self.blocks: list[tuple[dict[str, str | None], str]] = []

        def handle_starttag(self, tag: str, attrs) -> None:
            if tag.lower() == "script":
                self.in_script = True
                self.attrs = dict(attrs)
                self.buf = []

        def handle_data(self, data: str) -> None:
            if self.in_script:
                self.buf.append(data)

        def handle_endtag(self, tag: str) -> None:
            if tag.lower() == "script" and self.in_script:
                if not self.attrs.get("src"):
                    self.blocks.append((self.attrs, "".join(self.buf)))
                self.in_script = False
                self.attrs = {}
                self.buf = []

    html_files = sorted(FRONTEND.glob("*.html"))
    inline_total = 0
    for html_path in html_files:
        parser = InlineScriptParser()
        try:
            parser.feed(html_path.read_text(encoding="utf-8"))
        except Exception as exc:
            fail(f"Could not parse HTML {html_path.name}: {exc}")
            continue
        for idx, (attrs, code) in enumerate(parser.blocks, 1):
            typ = (attrs.get("type") or "").lower()
            if typ and typ not in ("text/javascript", "application/javascript", "module"):
                continue
            if not code.strip():
                continue
            inline_total += 1
            tmp = html_path.parent / f".phase11_inline_{html_path.stem}_{idx}.js"
            tmp.write_text(code, encoding="utf-8")
            try:
                r = subprocess.run([node, "--check", str(tmp)], capture_output=True, text=True)
                if r.returncode:
                    fail(f"Inline JavaScript syntax error in {html_path.name} script {idx}: {r.stderr.strip()}")
            finally:
                tmp.unlink(missing_ok=True)
    if not any(e.startswith("Inline JavaScript syntax error") for e in errors):
        ok(f"{inline_total} inline HTML JavaScript blocks pass syntax checks")

# 4. Python parser checks without creating pyc artifacts.
py_files = sorted((ROOT / "backend").rglob("*.py"))
for py in py_files:
    try:
        compile(py.read_text(encoding="utf-8"), str(py), "exec")
    except Exception as exc:
        fail(f"Python syntax error in {py.relative_to(ROOT)}: {exc}")
if not any(e.startswith("Python syntax error") for e in errors):
    ok(f"{len(py_files)} backend Python files compile")

# 5. Static route consistency for the Vercel and Netlify deployment targets.
try:
    vercel = json.loads((FRONTEND / "vercel.json").read_text(encoding="utf-8"))
    if vercel.get("cleanUrls") is not True:
        fail("Vercel cleanUrls must be true.")
    else:
        ok("Vercel cleanUrls is enabled")
except Exception as exc:
    fail(f"Vercel route config is invalid JSON: {exc}")

netlify = (FRONTEND / "netlify.toml").read_text(encoding="utf-8")
route_pages = [p.stem for p in FRONTEND.glob("*.html") if p.stem != "index"]
for page in route_pages:
    legacy_redirect = re.search(rf'from\s*=\s*"/{re.escape(page)}\.html"\s*\n\s*to\s*=\s*"/{re.escape(page)}"\s*\n\s*status\s*=\s*301', netlify)
    clean_rewrite = re.search(rf'from\s*=\s*"/{re.escape(page)}"\s*\n\s*to\s*=\s*"/{re.escape(page)}\.html"\s*\n\s*status\s*=\s*200', netlify)
    if not legacy_redirect or not clean_rewrite:
        fail(f"Netlify does not consistently canonicalize/rewrite {page}.")
if not any("Netlify does not consistently" in e for e in errors):
    ok(f"Netlify has extensionless redirect/rewrite pairs for {len(route_pages)} HTML pages")

# Internal navigation/redirect assignments must not direct the browser to .html URLs.
route_patterns = re.compile(r"(?:location\.(?:href|assign|replace)\s*=\s*|href\s*=\s*|redirectTo\s*:\s*)['\"]([^'\"]+\.html(?:[?#][^'\"]*)?)['\"]", re.I)
for html_path in html_files:
    source = html_path.read_text(encoding="utf-8")
    for match in route_patterns.finditer(source):
        target = match.group(1)
        if target.startswith(("http://", "https://", "mailto:", "tel:")):
            continue
        fail(f"Internal link/redirect still exposes an .html URL in {html_path.name}: {target}")
if not any("still exposes an .html URL" in e for e in errors):
    ok("Frontend internal href/redirect targets do not directly expose .html paths")

# 6. Reported regression and academic data-safety checks.
apply_html = (FRONTEND / "apply.html").read_text(encoding="utf-8")
portal_core = (FRONTEND / "js" / "portal-core.js").read_text(encoding="utf-8")
tutor_html = (FRONTEND / "tutor.html").read_text(encoding="utf-8")
portal_html = (FRONTEND / "portal.html").read_text(encoding="utf-8")
admin_html = (FRONTEND / "admin-dashboard.html").read_text(encoding="utf-8")
for cond, message in [
    ("function esc(" in apply_html, "Application page defines HTML escaping helper"),
    ("function cleanup(" in apply_html, "Application flow has realtime/timer cleanup"),
    ("sb.rpc('mark_welcomed'" in apply_html and ".catch(" not in apply_html[apply_html.find("sb.rpc('mark_welcomed'"):apply_html.find("sb.rpc('mark_welcomed'")+500], "Welcome-marker RPC is awaited without query-builder .catch misuse"),
    ("clearLocalAuthToken();" in portal_core and "location.replace(target);" in portal_core, "Student/tutor sign-out clears local token then redirects"),
    ("data-legacy=\"${requiresReentry}\"" in tutor_html, "Tutor UI identifies legacy/ambiguous results for explicit re-entry"),
    ("Number.isFinite(Number(v))" in tutor_html and "Attendance, CA and Exams are all required" in tutor_html, "Bulk result import rejects blank/invalid scores rather than silently zeroing them"),
    ("gradingLabel" in portal_html and "needs_review" in portal_html, "Student portal labels ambiguous academic results"),
    ("Review required" in admin_html and "admin_legacy_result_archive" in admin_html, "Admin Student 360/release screen surfaces legacy review"),
    ("'published',er.published_at is not null" in m021, "Student home result payload includes publication marker"),
    ("and er.published_at is not null" in m021 and "when er.published_at is null then jsonb_build_object" in m021, "Draft result components are withheld at the student RPC layer"),
    ("review_rows" in m021 and "grading_review" in m021, "Release readiness includes ambiguous result count"),
]:
    if cond:
        ok(message)
    else:
        fail(f"Regression check failed: {message}")

# 7. Frontend secret scan.
secret_patterns = [
    re.compile(r"\bservice_role\b", re.I),
    re.compile(r"SUPABASE_SERVICE_ROLE_KEY", re.I),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
]
for asset in [*FRONTEND.rglob("*.html"), *FRONTEND.rglob("*.js"), *FRONTEND.rglob("*.json")]:
    source = asset.read_text(encoding="utf-8", errors="ignore")
    for pattern in secret_patterns:
        if pattern.search(source):
            fail(f"Potential secret marker {pattern.pattern} found in frontend asset {asset.relative_to(ROOT)}")
if not any("Potential secret marker" in e for e in errors):
    ok("Frontend static assets contain no known service-role/private-key markers")

print("LEGACY REGRESSION VALIDATION (CURRENT MIGRATION CHAIN)")
for check in checks:
    print(f"PASS  {check}")
for error in errors:
    print(f"FAIL  {error}")
print(f"SUMMARY: {len(checks)} passed, {len(errors)} failed")
sys.exit(1 if errors else 0)
