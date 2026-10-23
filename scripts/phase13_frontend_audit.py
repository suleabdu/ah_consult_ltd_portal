#!/usr/bin/env python3
"""AH STUDENT HUB Phase 13 frontend release audit.

Static gate only: route references, required files, inline JS syntax, and obvious
extensionless internal links. Live browser/Auth/DB tests are deliberately separate.
"""
from pathlib import Path
import re, subprocess, sys

ROOT = Path(__file__).resolve().parents[1]
FRONT = ROOT / 'frontend'
ROUTES = {
    'apply':'apply.html','student-login':'student-login.html','staff-login':'staff-login.html',
    'staff-login-legacy':'staff-login-legacy.html','admin-register':'admin-register.html',
    'setup-password':'setup-password.html','tutor':'tutor.html','admin-dashboard':'admin-dashboard.html',
    'portal':'portal.html','payment-success':'payment-success.html','forgot-password':'forgot-password.html',
    'reset-password':'reset-password.html'
}
errors=[]; warnings=[]
for name,file in ROUTES.items():
    if not (FRONT/file).exists(): errors.append(f'Missing route target: {file}')

# Internal route source audit.
for p in FRONT.rglob('*'):
    if p.suffix not in {'.html','.js'}: continue
    s=p.read_text(errors='replace')
    for route in ROUTES:
        if re.search(rf'href=["\']{re.escape(route)}(?:[?#"\'])', s) or re.search(rf'location\.(?:replace|href|assign)\(["\']{re.escape(route)}(?:[?#"\'])', s):
            errors.append(f'Extensionless internal route reference: {p.relative_to(ROOT)} -> {route}')

# JS syntax gate. JSON-LD script blocks are not JavaScript.
for p in FRONT.rglob('*.js'):
    r=subprocess.run(['node','--check',str(p)],capture_output=True,text=True)
    if r.returncode: errors.append(f'JS syntax failure: {p.relative_to(ROOT)}: {r.stderr.strip()}')
for p in FRONT.rglob('*.html'):
    s=p.read_text(errors='replace')
    for i,m in enumerate(re.finditer(r'<script([^>]*)>(.*?)</script>',s,re.I|re.S),1):
        attrs,code=m.group(1),m.group(2)
        if re.search(r'\bsrc\s*=',attrs,re.I) or re.search(r'type\s*=\s*["\']application/(?:ld\+json|json)',attrs,re.I): continue
        if not code.strip(): continue
        tmp=Path('/tmp/ah_phase13_inline.js'); tmp.write_text(code)
        r=subprocess.run(['node','--check',str(tmp)],capture_output=True,text=True)
        if r.returncode: errors.append(f'Inline JS syntax failure: {p.relative_to(ROOT)} block {i}: {r.stderr.strip()}')

# Specific regression assertions for reported bugs.
apply=(FRONT/'apply.html').read_text()
assertions={
    'new_student_content_target': "function showApp(){view=$('#content')" in apply,
    'wizard_targets_content': "async function wizard(){view=$('#content')" in apply,
    'wizard_back_button_type': '<button type="button" class="btn2" id="bk"' in apply,
    'wizard_continue_button_type': '<button type="button" id="nx">Continue' in apply,
    'wizard_back_handler': "$('#bk').onclick=e=>{e.preventDefault();" in apply,
    'wizard_nav_changes_stage': 'S.w.n=n;wizard();' in apply,
    'signin_redirect_has_html': 'apply.html#signin' in apply,
}
for k,ok in assertions.items():
    if not ok: errors.append(f'Regression assertion failed: {k}')

print('PHASE 13 FRONTEND AUDIT')
print('errors:',len(errors),'warnings:',len(warnings))
for e in errors: print('FAIL:',e)
for w in warnings: print('WARN:',w)
if not errors: print('PASS: static frontend release gate')
sys.exit(1 if errors else 0)
