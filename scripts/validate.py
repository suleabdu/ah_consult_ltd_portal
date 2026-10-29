#!/usr/bin/env python3
"""Static release gate for AHCT SMS Hub. Fast, offline, no dependencies beyond Python 3 (+ Node for JS syntax checks).

Runs structural checks that catch real regressions: committed secrets, drifted deploy lists, broken page links,
CDN script creep, missing security headers, JavaScript syntax errors and stale documentation links.
Database behaviour is covered separately by scripts/test-sql.sh and Edge Function logic by `deno test`.
Exit code 0 = pass. Usage: python3 scripts/validate.py
"""
import json, re, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONT, FUNCS, MIGS = ROOT / "frontend", ROOT / "supabase" / "functions", ROOT / "supabase" / "migrations"
failures, passed = [], 0

def check(name, ok, detail=""):
    global passed
    if ok: passed += 1; print(f"  PASS  {name}")
    else: failures.append(name); print(f"  FAIL  {name}" + (f"  -> {detail}" if detail else ""))

def text(p): return p.read_text(encoding="utf-8", errors="replace")
def tracked_files():
    skip = {"node_modules", ".git"}
    return [p for p in ROOT.rglob("*") if p.is_file() and not (skip & set(p.relative_to(ROOT).parts))]

print("Repository hygiene")
bad = [str(p.relative_to(ROOT)) for p in tracked_files() if p.suffix in {".pyc", ".zip", ".pem", ".p12"} or p.name in {".env", "client_secret.json"} or "__pycache__" in p.parts]
check("no caches, archives, keys or .env files", not bad, ", ".join(bad[:5]))
check("no legacy Flask backend or duplicate root js/css", not any((ROOT / d).exists() for d in ("backend", "js", "css", "apps-script")))

print("Secrets")
pat = {
    "service-role JWT": re.compile(r"eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}"),
    "private key block": re.compile(r"-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "google service account": re.compile(r'"type"\s*:\s*"service_account"'),
    "payment live key": re.compile(r"\b(sk_live|MK_PROD|FLWSECK-)[A-Za-z0-9_-]{8,}"),
}
leaks = []
for p in tracked_files():
    if p.suffix.lower() not in {".js", ".ts", ".html", ".sql", ".md", ".json", ".toml", ".env", ".txt", ".gs", ".py", ".sh", ".ps1", ".yml", ".yaml"} or p.name == "package-lock.json" or "vendor" in p.parts or p.name == "validate.py": continue
    s = text(p)
    for label, rx in pat.items():
        for m in rx.finditer(s):
            if label == "service-role JWT":   # a JWT is fine ONLY if its role is anon
                try:
                    import base64; seg = m.group(0).split(".")[1]; role = json.loads(base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4))).get("role")
                except Exception: role = "?"
                if role == "anon": continue
            leaks.append(f"{p.relative_to(ROOT)} ({label})")
check("no service-role keys, private keys or live payment keys committed", not leaks, "; ".join(leaks[:4]))

print("Migrations")
nums = sorted(int(m.group(1)) for p in MIGS.glob("*.sql") if (m := re.match(r"(\d{3})_", p.name)))
check("migration numbers are contiguous from 001", nums == list(range(1, len(nums) + 1)), str(nums[-3:]))

print("Edge Functions")
fn_dirs = sorted(p.name for p in FUNCS.iterdir() if p.is_dir() and not p.name.startswith("_"))
check("every function has index.ts", all((FUNCS / d / "index.ts").exists() for d in fn_dirs))
cfg = text(ROOT / "supabase" / "config.toml")
open_fns = sorted(re.findall(r"\[functions\.([a-z-]+)\]\s*verify_jwt\s*=\s*false", cfg))
# document-branding performs verified user auth + admin role checks inside the handler.
check("only explicitly expected gateway JWT exceptions (all with handler-side checks)", open_fns == ["admin-register", "document-branding", "document-verify", "payment-webhook", "upperlink-webhook"] and "userFrom(req)" in text(FUNCS / "document-branding" / "index.ts"), str(open_fns))
check("sheet-review (two-way sheet control) is gone", "sheet-review" not in fn_dirs and "sheet-review" not in cfg)
for name in ("deploy-functions.sh", "deploy-functions.ps1", "check-setup.sh", "check-setup.ps1"):
    listed = set(re.findall(r"[a-z]+(?:-[a-z]+)+", text(ROOT / "scripts" / name)))
    check(f"scripts/{name} lists every function", set(fn_dirs) <= listed, str(sorted(set(fn_dirs) - listed)))
src = "\n".join(text(p) for p in FUNCS.rglob("*.ts"))
check("supabase-js is pinned (no unpinned CDN imports)", "esm.sh" not in src and "npm:@supabase/supabase-js@2.45.4" in src)
check("no internal error text returned to browsers", not re.search(r"detail:\s*(e\b|e2\b|error\.message|e\.message|e instanceof)", src))
check("CORS has no wildcard default", '?? "*"' not in src and 'Allow-Origin": "*"' not in src)

print("Frontend")
pages = sorted(FRONT.glob("*.html"))
ext_scripts = [(p.name, u) for p in pages for u in re.findall(r'<script[^>]+src="(https?://[^"]+)"', text(p))]
check("no third-party <script> sources (all vendored)", not ext_scripts, str(ext_scripts[:3]))
broken = []
for p in pages:
    for ref in re.findall(r'(?:src|href)="((?:js|css|vendor)/[^"?#]+)', text(p)):
        if not (FRONT / ref).exists(): broken.append(f"{p.name}->{ref}")
check("all local script/style references resolve", not broken, ", ".join(broken[:4]))
vj = json.loads(text(FRONT / "vercel.json"))
hdr = {h["key"]: h["value"] for r in vj.get("headers", []) for h in r["headers"]}
for k in ("Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"):
    check(f"vercel.json sets {k}", k in hdr)
csp = hdr.get("Content-Security-Policy", "")
check("CSP forbids framing, plugins and foreign base URIs", all(x in csp for x in ("frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'")))
check("CSP connect-src limited to Supabase", re.search(r"connect-src 'self' https://\*\.supabase\.co", csp) is not None and "*;" not in csp.replace("*.supabase.co", ""))
rewrites = {r["source"].strip("/") for r in vj.get("rewrites", [])}
check("every page has a clean-URL rewrite", all(p.stem in rewrites for p in pages if p.stem not in {"index", "404"}))
cfgjs = text(FRONT / "js" / "config.js")
check("config.js exposes only the anon key", "service_role" not in cfgjs and "onrender.com" not in cfgjs)
check("checked-in frontend config does not target a live Supabase instance", not re.search(r"https://[a-z0-9-]{10,}\.supabase\.co", cfgjs) and "PUBLIC_ANON_KEY_NOT_CONFIGURED" in cfgjs)

print("Public homepage privacy")
home_html, home_js = text(FRONT / "index.html"), text(FRONT / "js" / "home.js")
check("homepage shows no individual student records or marks", not re.search(r"Examination Record|Grade:|\b\d{1,3}\s*/\s*100\b|Reg(istration)?\.? ?No", home_html))
endpoints = set(re.findall(r"rest\(\s*'([a-z_/]+)", home_js))
check("homepage reads only the three public endpoints", endpoints <= {"rpc/public_impact_stats", "courses", "gallery_items"} and len(endpoints) == 3, str(sorted(endpoints)))
check("homepage never references service-role keys", "service_role" not in home_js and "service_role" not in home_html)
check("gallery request filters status=published", "status=eq.published" in home_js)
check("homepage has no inline event handlers or third-party scripts", not re.search(r"\son[a-z]+=\"", home_html) and not re.search(r"<script[^>]+src=\"https?:", home_html))
check("all pages avoid executable inline scripts and handlers", all(not re.search(r"\son[a-z]+\s*=\s*[\"\']", text(p), re.I) and not re.search(r"<script(?![^>]*\bsrc=)(?![^>]*\btype=[\"\']application/ld\+json)[^>]*>\s*\S", text(p), re.I) for p in pages))
check("CSP blocks inline JavaScript", "script-src 'self'; script-src-attr 'none'" in csp)

print("JavaScript syntax")
node = shutil.which("node")
if node:
    errs = []
    with tempfile.TemporaryDirectory() as td:
        jobs = [(p, p.name) for p in (FRONT / "js").rglob("*.js")]
        for page in pages:
            for i, (attrs, body) in enumerate(re.findall(r"<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>", text(page), re.S)):
                if body.strip() and "json" not in attrs.lower():   # skip JSON-LD / data blocks
                    f = Path(td) / f"{page.stem}_{i}.js"; f.write_text(body); jobs.append((f, f"{page.name}#inline{i}"))
        for f, label in jobs:
            r = subprocess.run([node, "--check", str(f)], capture_output=True, text=True)
            if r.returncode: errs.append(f"{label}: {r.stderr.strip().splitlines()[0] if r.stderr.strip() else 'syntax error'}")
    check(f"{len(jobs)} scripts (files + inline) parse without syntax errors", not errs, "; ".join(errs[:3]))
else:
    print("  SKIP  node not installed")

print("Undefined names (ESLint no-undef over every page's scripts)")
if node and (ROOT / "node_modules" / "eslint").exists():
    r = subprocess.run([node, str(ROOT / "scripts" / "lint-pages.mjs")], capture_output=True, text=True, cwd=ROOT)
    check("no undefined functions or variables in any page", r.returncode == 0, (r.stdout.strip().splitlines() or ["lint failed"])[0])
else:
    print("  SKIP  run `npm ci` to enable (CI always runs it)")

print("Documentation")
dead = []
for md in list(ROOT.glob("*.md")) + list((ROOT / "docs").glob("*.md")):
    for target in re.findall(r"\]\((?!https?:|#|mailto:)([^)#\s]+)", text(md)):
        if not (md.parent / target).exists(): dead.append(f"{md.name}->{target}")
check("relative links in Markdown resolve", not dead, ", ".join(dead[:4]))
stale = [p.name for p in list(ROOT.glob("*.md")) + list((ROOT / "docs").glob("*.md")) if re.search(r"netlify|render\.com|onrender|sheet-review|SHEET_WEBHOOK", text(p), re.I) and p.name not in {"CHANGELOG.md", "SECURITY.md"}]
check("docs do not describe removed infrastructure", not stale, ", ".join(stale))

print(f"\n{passed} passed, {len(failures)} failed")
sys.exit(1 if failures else 0)
