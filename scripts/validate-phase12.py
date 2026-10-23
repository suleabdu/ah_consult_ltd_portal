#!/usr/bin/env python3
"""Dependency-light static release audit for AH STUDENT HUB Phase 12.

This validates source structure and regressions. It does NOT execute SQL against PostgreSQL
or prove live RLS/edge-provider behavior; run tests/phase12_preflight.sql in staging too.
"""
from __future__ import annotations
import csv, html.parser, json, re, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
MIGRATIONS = ROOT / "supabase" / "migrations"
errors: list[str] = []
checks: list[str] = []

def ok(msg: str) -> None: checks.append(msg)
def fail(msg: str) -> None: errors.append(msg)

def sql_fragment_balance(text: str) -> tuple[int, str | None]:
    """Check parentheses and SQL quote/comment/dollar delimiter structure recursively."""
    depth = 0
    state = "code"
    i = 0
    block_depth = 0
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if state == "line_comment":
            if ch == "\n": state = "code"
            i += 1; continue
        if state == "block_comment":
            if ch == "/" and nxt == "*": block_depth += 1; i += 2; continue
            if ch == "*" and nxt == "/":
                block_depth -= 1; i += 2
                if block_depth == 0: state = "code"
                continue
            i += 1; continue
        if state == "single":
            if ch == "'" and nxt == "'": i += 2; continue
            if ch == "'": state = "code"
            i += 1; continue
        if state == "double":
            if ch == '"' and nxt == '"': i += 2; continue
            if ch == '"': state = "code"
            i += 1; continue
        if state == "code":
            if ch == "-" and nxt == "-": state = "line_comment"; i += 2; continue
            if ch == "/" and nxt == "*": state = "block_comment"; block_depth = 1; i += 2; continue
            if ch == "'": state = "single"; i += 1; continue
            if ch == '"': state = "double"; i += 1; continue
            if ch == "$":
                match = re.match(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$", text[i:])
                if match:
                    tag = match.group(0)
                    body_start = i + len(tag)
                    body_end = text.find(tag, body_start)
                    if body_end < 0:
                        return depth, f"unclosed dollar quote {tag} at character {i}"
                    inner_depth, inner_error = sql_fragment_balance(text[body_start:body_end])
                    if inner_error:
                        return depth, f"inside dollar body {tag}: {inner_error}"
                    if inner_depth != 0:
                        return depth, f"inside dollar body {tag}: parentheses end at depth {inner_depth}"
                    i = body_end + len(tag)
                    continue
            if ch == "(": depth += 1
            elif ch == ")":
                depth -= 1
                if depth < 0: return depth, f"unexpected closing parenthesis at character {i}"
            i += 1
    if state == "single": return depth, "unclosed single-quoted string"
    if state == "double": return depth, "unclosed quoted identifier"
    if state == "block_comment": return depth, "unclosed block comment"
    if depth != 0: return depth, f"unbalanced parentheses; final depth {depth}"
    return depth, None

# 1. Full migration sequence and lexical structure.
files = sorted(MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql"))
nums = [int(p.name[:3]) for p in files]
if not files or nums != list(range(1, max(nums) + 1)):
    fail(f"Migration sequence contains gaps or duplicates: {nums}")
else:
    ok(f"Migration chain is continuous from 001 through {max(nums):03d}")
for path in files:
    _, err = sql_fragment_balance(path.read_text(encoding="utf-8"))
    if err: fail(f"SQL lexical structure error in {path.name}: {err}")
if not any(e.startswith("SQL lexical structure error") for e in errors):
    ok(f"All {len(files)} migration files have balanced SQL quotes, dollar bodies and parentheses")
# Each SECURITY DEFINER declaration in the complete source chain should pin its
# search path. The forward migration also enforces the setting for installed functions.
missing_definer_paths=[]
for path in files:
    src=path.read_text(encoding="utf-8", errors="ignore")
    for match in re.finditer(r"create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(",src,re.I):
        end=src.find("as $$",match.end())
        if end < 0: continue
        header=src[match.start():end]
        if re.search(r"security\s+definer",header,re.I) and not re.search(r"set\s+search_path\s*=\s*public\s*,\s*pg_temp",header,re.I):
            missing_definer_paths.append(f"{path.name}:{match.group(1)}")
if not missing_definer_paths: ok("All SECURITY DEFINER function declarations pin search_path to public, pg_temp")
else: fail(f"SECURITY DEFINER declarations missing fixed search_path: {missing_definer_paths}")

m001 = (MIGRATIONS / "001_apply.sql").read_text(encoding="utf-8")
m008 = (MIGRATIONS / "008_roles.sql").read_text(encoding="utf-8")
m012 = (MIGRATIONS / "012_integrity_engine.sql").read_text(encoding="utf-8")
m013 = (MIGRATIONS / "013_phase3_academic_engine.sql").read_text(encoding="utf-8")
m014 = (MIGRATIONS / "014_phase4_hardening.sql").read_text(encoding="utf-8")
m020 = (MIGRATIONS / "020_reported_bug_fixes.sql").read_text(encoding="utf-8")
m017 = (MIGRATIONS / "017_institutional_operations.sql").read_text(encoding="utf-8")
m019 = (MIGRATIONS / "019_production_automation_governance.sql").read_text(encoding="utf-8")
m021 = (MIGRATIONS / "021_academic_integrity_release_readiness.sql").read_text(encoding="utf-8")
m022 = (MIGRATIONS / "022_system_audit_catalog_reconciliation.sql").read_text(encoding="utf-8")

# 2. Exact reported defects / database privilege guards.
for constraint in ("exam_results_attendance_check", "exam_results_ca_30_check", "exam_results_exams_30_check"):
    if re.search(r"if\s+not\s+exists\s*\([^)]*conname\s*=\s*'" + constraint + r"'", m013, re.I):
        ok(f"Migration 013 conditionally creates {constraint}")
    else: fail(f"Migration 013 is not repeat-safe for {constraint}")
if "column_name='grading_model'" in m013 and "Migration 013 must not be replayed after grading_model exists" in m013:
    ok("Migration 013 guards against replaying the legacy baseline after grading-model migration")
else: fail("Migration 013 lacks a downgrade/replay guard")
portal_fn = m021[m021.lower().find("create or replace function public.portal_data()"):m021.lower().find("revoke all on function public.portal_data()")]
if portal_fn and "when er.id is null or er.published_at is null or er.grading_model='needs_review' then null" in portal_fn and "e.published_at is not null" in portal_fn:
    ok("portal_data limits student score components to published, source-safe records")
else: fail("portal_data publication/source-safety checks were not found")
if all("qi.question_ordinal" in src for src in (m014,m020,m021)):
    ok("Assessment and assignment answer indexing uses explicit ordinality aliases in migrations 014/020/021")
else: fail("Qualified ordinality alias fix is missing")
if "system_audit_snapshot()" in m022 and "missing_rls" in m022 and "unsafe_definers" in m022 and "public_execute_definers" in m022 and "alter function %s set search_path = public, pg_temp" in m022:
    ok("Database audit RPC checks RLS, forces public,pg_temp search paths and checks PUBLIC/anon execute exposure")
else: fail("System audit RPC does not include required database security checks")

for func in ("claim_sheet_jobs", "complete_sheet_job", "fail_sheet_job"):
    if re.search(r"grant execute on function public\." + func + r"\([^;]+?\) to service_role", m022, re.I):
        ok(f"{func} is explicitly available to service_role in forward repair")
    else: fail(f"{func} missing service_role EXECUTE grant in migration 022")
for func in ("claim_communication_jobs", "complete_communication_job", "fail_communication_job"):
    if re.search(r"grant execute on function public\." + func + r"\([^;]+?\) to service_role", m022, re.I):
        ok(f"{func} is explicitly available to service_role in forward repair")
    else: fail(f"{func} missing service_role EXECUTE grant in migration 022")
if "revoke all on function public.emit_student_notification(uuid,text,text,uuid,jsonb) from public, anon, authenticated" in m022:
    ok("Raw notification emitter is not callable by browser roles")
else: fail("Raw notification emitter still appears exposed to authenticated users")
if "revoke all on function public.notify_result_published(uuid) from public, anon, authenticated" in m022:
    ok("Internal result-notification helper is not an arbitrary authenticated RPC")
else: fail("notify_result_published still has a browser EXECUTE grant")
if "grant execute on function public.next_student_id(uuid) to service_role" in m001 and "revoke all on function public.next_student_id(uuid) from public, anon, authenticated" in m022:
    ok("Student ID serial allocation is restricted to the trusted server role")
else: fail("Student ID allocation permissions need review")
# Removing implicit PUBLIC EXECUTE is only safe if all intended client RPCs receive
# explicit authenticated grants. Cross-check actual frontend rpc() names against the
# forward migration, and protect policy helper functions too.
all_frontend_text = "\n".join(p.read_text(encoding="utf-8", errors="ignore") for p in FRONTEND.rglob("*") if p.suffix in {".js", ".html"})
frontend_rpcs = set(re.findall(r"\.rpc\(\s*['\"]([^'\"]+)['\"]", all_frontend_text))
forward_grants = set(re.findall(r"grant\s+execute\s+on\s+function\s+public\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", m022, re.I))
missing_rpc_grants = sorted(frontend_rpcs - forward_grants)
if not missing_rpc_grants and len(frontend_rpcs) >= 45:
    ok(f"All {len(frontend_rpcs)} frontend RPCs receive explicit authenticated grants after PUBLIC revocation")
else:
    fail(f"Missing explicit authenticated grants for frontend RPCs: {missing_rpc_grants}")
# Validate the actual granted argument types against function declarations as well as
# names, so an overload typo does not silently leave the intended RPC unavailable.
def sql_split_top_level(src: str) -> list[str]:
    parts=[]; start=0; depth=0; quoted=False; i=0
    while i < len(src):
        ch=src[i]
        if ch == "'":
            if quoted and i+1 < len(src) and src[i+1] == "'": i += 2; continue
            quoted = not quoted
        elif not quoted:
            if ch == "(": depth += 1
            elif ch == ")": depth -= 1
            elif ch == "," and depth == 0: parts.append(src[start:i].strip()); start=i+1
        i += 1
    if src[start:].strip(): parts.append(src[start:].strip())
    return parts
def sql_paren_content(src: str, open_pos: int) -> str | None:
    depth=0; quoted=False; i=open_pos
    while i < len(src):
        ch=src[i]
        if ch == "'":
            if quoted and i+1 < len(src) and src[i+1] == "'": i += 2; continue
            quoted = not quoted
        elif not quoted:
            if ch == "(": depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0: return src[open_pos+1:i]
        i += 1
    return None
def norm_arg_type(t: str) -> str:
    t = re.sub(r"\s+", " ", t.strip().lower())
    return {"int":"integer", "int4":"integer", "bool":"boolean", "int8":"bigint", "float8":"double precision"}.get(t,t)
def function_signature_set(src: str) -> set[tuple[str, tuple[str,...]]]:
    result=set()
    for match in re.finditer(r"create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", src, re.I):
        opening=match.end()-1; inner=sql_paren_content(src,opening)
        if inner is None: continue
        types=[]
        for arg in sql_split_top_level(inner):
            arg=re.split(r"\s+default\s+|\s*=\s*",arg,flags=re.I)[0].strip()
            tokens=arg.split()
            if not tokens: continue
            if tokens[0].lower() in ("in","out","inout","variadic"): tokens=tokens[1:]
            typ=" ".join(tokens[1:]) if len(tokens)>1 else tokens[0]
            types.append(norm_arg_type(typ))
        result.add((match.group(1).lower(), tuple(types)))
    return result
def granted_signature_set(src: str) -> set[tuple[str, tuple[str,...]]]:
    result=set()
    for match in re.finditer(r"grant\s+execute\s+on\s+function\s+(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", src, re.I):
        inner=sql_paren_content(src,match.end()-1)
        if inner is not None: result.add((match.group(1).lower(),tuple(norm_arg_type(a) for a in sql_split_top_level(inner))))
    return result
all_sql_migrations="\n".join(p.read_text(encoding="utf-8", errors="ignore") for p in sorted(MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql")))
unknown_grants=sorted(granted_signature_set(m022)-function_signature_set(all_sql_migrations))
if not unknown_grants and len(granted_signature_set(m022)) >= 60:
    ok(f"All {len(granted_signature_set(m022))} explicit migration-022 grant signatures match declared function argument types")
else: fail(f"Function grants reference missing/mismatched signatures: {unknown_grants}")
for helper in ("has_role", "staff_role", "my_lecturer_ids", "perm", "can_read", "can_write"):
    if re.search(r"grant\s+execute\s+on\s+function\s+public\."+helper+r"\s*\([^;]*?\)\s+to\s+authenticated",m022,re.I):
        ok(f"RLS helper {helper} remains executable by authenticated policies/users")
    else: fail(f"RLS helper {helper} lacks an explicit authenticated grant in migration 022")
if m022.find("grant execute on function public.system_audit_snapshot() to authenticated;") > m022.find("create or replace function public.system_audit_snapshot()"):
    ok("system_audit_snapshot grant occurs after the function definition")
else: fail("system_audit_snapshot grant is ordered before its definition")
if re.search(r"^begin;",m013,re.I|re.M) and re.search(r"^commit;\s*$",m013,re.I|re.M) and re.search(r"^begin;",m021,re.I|re.M) and re.search(r"^commit;\s*$",m021,re.I|re.M) and re.search(r"^begin;",m022,re.I|re.M) and re.search(r"^commit;\s*$",m022,re.I|re.M):
    ok("Migrations 013, 021 and 022 are transaction-wrapped")
else: fail("A corrected critical migration is missing explicit BEGIN/COMMIT")

# 3. Check exact catalog agreement with the user-provided CSV.
csv_candidates = [ROOT / "sheets" / "courses_rows.csv", Path("/mnt/data/courses_rows.csv")]
csv_path = next((p for p in csv_candidates if p.exists()), None)
if csv_path:
    with csv_path.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    expected_rows = {(r["code"], r["name"], r["category"], int(r["fee_ngn"]), r["is_active"].strip().lower() == "true") for r in rows}
    if len(rows) == 18 and len(expected_rows) == 18:
        ok("Source course CSV contains 18 unique course/category records")
    else: fail(f"Source course CSV should contain 18 unique records; found rows={len(rows)}, unique={len(expected_rows)}")
    for label, src in (("baseline migration 001", m001), ("forward migration 022", m022)):
        found = set()
        for code, name, category, fee, active in expected_rows:
            pattern = re.escape(f"('{code}','{name}','{category}',{fee},{str(active).lower()})")
            if re.search(pattern, src, re.I): found.add(code)
        if len(found) == len(expected_rows): ok(f"{label} seeds match all supplied course codes/names/categories/fees")
        else: fail(f"{label} misses or alters catalog rows: {sorted({r[0] for r in expected_rows} - found)}")
else:
    fail("Could not find supplied courses_rows.csv for catalog reconciliation")

# 4. JavaScript syntax checks: all frontend external JS and inline scripts.
node = shutil.which("node")
if not node:
    fail("Node.js unavailable; frontend JavaScript syntax cannot be validated")
else:
    js_files = sorted(FRONTEND.rglob("*.js"))
    js_errors = []
    for path in js_files:
        result = subprocess.run([node, "--check", str(path)], capture_output=True, text=True)
        if result.returncode: js_errors.append(f"{path.relative_to(ROOT)}: {result.stderr.strip()}")
    if js_errors:
        for item in js_errors: fail(f"JavaScript syntax error: {item}")
    else: ok(f"All {len(js_files)} external frontend JavaScript files pass Node syntax checks")

    class InlineParser(html.parser.HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=False); self.inside=False; self.attrs={}; self.buf=[]; self.items=[]
        def handle_starttag(self, tag, attrs):
            if tag.lower()=="script": self.inside=True; self.attrs=dict(attrs); self.buf=[]
        def handle_data(self, data):
            if self.inside: self.buf.append(data)
        def handle_endtag(self, tag):
            if tag.lower()=="script" and self.inside:
                if not self.attrs.get("src"): self.items.append((self.attrs, "".join(self.buf)))
                self.inside=False; self.attrs={}; self.buf=[]
    html_files = sorted(FRONTEND.glob("*.html"))
    inline_count = 0; inline_errors=[]
    for page in html_files:
        parser = InlineParser()
        try: parser.feed(page.read_text(encoding="utf-8"))
        except Exception as exc:
            fail(f"HTML parser error in {page.name}: {exc}"); continue
        for index,(attrs,code) in enumerate(parser.items,1):
            typ=(attrs.get("type") or "").lower()
            if typ and typ not in ("text/javascript","application/javascript","module"): continue
            if not code.strip(): continue
            inline_count += 1
            temp=page.parent/f".phase12_inline_{page.stem}_{index}.js"
            temp.write_text(code,encoding="utf-8")
            try:
                result=subprocess.run([node,"--check",str(temp)],capture_output=True,text=True)
                if result.returncode: inline_errors.append(f"{page.name} script {index}: {result.stderr.strip()}")
            finally: temp.unlink(missing_ok=True)
    if inline_errors:
        for item in inline_errors: fail(f"Inline JavaScript syntax error: {item}")
    else: ok(f"All {inline_count} inline frontend JavaScript blocks pass Node syntax checks")

# 5. Python syntax checks.
py_files = sorted(p for base in (ROOT / "backend", ROOT / "scripts") for p in base.rglob("*.py") if p.name != "__init__.py")
py_errors=[]
for path in py_files:
    try: compile(path.read_text(encoding="utf-8"), str(path), "exec")
    except Exception as exc: py_errors.append(f"{path.relative_to(ROOT)}: {exc}")
if py_errors:
    for item in py_errors: fail(f"Python syntax error: {item}")
else: ok(f"All {len(py_files)} backend and validation Python files compile")

# 6. Clean URL configuration and internal link normalization.
try:
    vercel=json.loads((FRONTEND/"vercel.json").read_text(encoding="utf-8"))
    if vercel.get("cleanUrls") is True: ok("Vercel cleanUrls is enabled")
    else: fail("Vercel cleanUrls is not true")
except Exception as exc: fail(f"Vercel route config is invalid JSON: {exc}")
netlify=(FRONTEND/"netlify.toml").read_text(encoding="utf-8")
route_pages=[p.stem for p in FRONTEND.glob("*.html") if p.stem!="index"]
route_errors=[]
for page in route_pages:
    redirect=re.search(rf'from\s*=\s*"/{re.escape(page)}\.html"\s*\n\s*to\s*=\s*"/{re.escape(page)}"\s*\n\s*status\s*=\s*301',netlify)
    rewrite=re.search(rf'from\s*=\s*"/{re.escape(page)}"\s*\n\s*to\s*=\s*"/{re.escape(page)}\.html"\s*\n\s*status\s*=\s*200',netlify)
    if not redirect or not rewrite: route_errors.append(page)
if route_errors: fail(f"Netlify lacks canonical extensionless redirect/rewrite pair for: {route_errors}")
else: ok(f"Netlify has extensionless redirect/rewrite pairs for {len(route_pages)} HTML pages")
links_re=re.compile(r"(?:location\.(?:href|assign|replace)\s*=\s*|href\s*=\s*|redirectTo\s*:\s*)['\"]([^'\"]+\.html(?:[?#][^'\"]*)?)['\"]",re.I)
link_errors=[]
for page in html_files:
    for m in links_re.finditer(page.read_text(encoding="utf-8")):
        target=m.group(1)
        if not target.startswith(("http://","https://","mailto:","tel:")): link_errors.append(f"{page.name}: {target}")
if link_errors:
    for item in link_errors: fail(f"Internal route exposes .html: {item}")
else: ok("No direct internal href/redirect path exposes an .html URL")

# 7. Previous regression checks and exposed-secret scan.
apply_html=(FRONTEND/"apply.html").read_text(encoding="utf-8")
portal_core=(FRONTEND/"js"/"portal-core.js").read_text(encoding="utf-8")
tutor_html=(FRONTEND/"tutor.html").read_text(encoding="utf-8")
portal_html=(FRONTEND/"portal.html").read_text(encoding="utf-8")
admin_html=(FRONTEND/"admin-dashboard.html").read_text(encoding="utf-8")
regressions=[
    ("function esc(" in apply_html,"Apply page defines the esc HTML-escape helper"),
    ("function cleanup(" in apply_html,"Apply flow provides realtime/timer cleanup"),
    ("clearLocalAuthToken();" in portal_core and "location.replace(target);" in portal_core,"Student/tutor logout clears local token before route redirect"),
    ("data-legacy=\"${requiresReentry}\"" in tutor_html,"Tutor UI warns for legacy/ambiguous grading records"),
    ("Attendance, CA and Exams are all required" in tutor_html,"Bulk grade entry requires all score components"),
    ("gradingLabel" in portal_html and "needs_review" in portal_html,"Student UI labels ambiguous grades without implying publication"),
    ("Review required" in admin_html and "admin_legacy_result_archive" in admin_html,"Admin UI exposes legacy result review"),
    ("system_audit_snapshot" in admin_html and "release_readiness_snapshot" in admin_html,"Admin UI combines system audit and release-readiness diagnostics"),
]
for cond,label in regressions:
    if cond: ok(label)
    else: fail(f"Regression missing: {label}")
secret_patterns=[re.compile(r"\bservice_role\b",re.I),re.compile(r"SUPABASE_SERVICE_ROLE_KEY",re.I),re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")]
secret_hits=[]
for asset in [*FRONTEND.rglob("*.html"),*FRONTEND.rglob("*.js"),*FRONTEND.rglob("*.json")]:
    source=asset.read_text(encoding="utf-8",errors="ignore")
    for pat in secret_patterns:
        if pat.search(source): secret_hits.append(f"{asset.relative_to(ROOT)} matched {pat.pattern}")
if secret_hits:
    for hit in secret_hits: fail(f"Potential frontend secret: {hit}")
else: ok("Frontend HTML/JS/JSON contains no known service-role/private-key markers")

# 8. SQL release handoff files are present.
for rel,label in [
    ("tests/phase12_preflight.sql","read-only Supabase staging preflight SQL"),
    ("PHASE_12_SYSTEM_AUDIT_AND_RELEASE_HARDENING.md","Phase 12 audit and upgrade notes"),
    ("tests/PHASE_12_ACCEPTANCE_PLAN.md","Phase 12 end-to-end acceptance plan"),
]:
    if (ROOT/rel).exists(): ok(f"Includes {label}")
    else: fail(f"Missing {label}: {rel}")

report = ["AH STUDENT HUB — PHASE 12 STATIC VALIDATION REPORT", "", *[f"PASS  {x}" for x in checks], *[f"FAIL  {x}" for x in errors], "", f"SUMMARY: {len(checks)} passed, {len(errors)} failed", "", "Scope: static source checks only. SQL has not been executed by PostgreSQL; staging validation is mandatory."]
report_path=Path("/mnt/data/AHCT_PHASE12_VALIDATION_REPORT.txt")
report_path.write_text("\n".join(report)+"\n",encoding="utf-8")
print("\n".join(report))
sys.exit(1 if errors else 0)
