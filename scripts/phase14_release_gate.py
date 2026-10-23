#!/usr/bin/env python3
"""AH Student Hub Phase 14 local release gate.

This gate is intentionally safe: it performs static/source checks only and
never mutates Supabase, payment providers, or student data.
"""
from pathlib import Path
import re, subprocess, sys

ROOT = Path(__file__).resolve().parents[1]
FRONT = ROOT / 'frontend'
MIG = ROOT / 'supabase' / 'migrations'
TEST = ROOT / 'tests' / 'e2e' / 'student-smoke.spec.js'
errors=[]; warnings=[]

def check(ok, msg, warn=False):
    (warnings if warn else errors).append(('PASS' if ok else 'WARN' if warn else 'FAIL') + ': ' + msg) if not ok else print('PASS: '+msg)

required = ['apply.html','student-login.html','portal.html','staff-login.html','admin-dashboard.html','tutor.html','forgot-password.html','reset-password.html','404.html','vercel.json']
for f in required:
    if not (FRONT/f).exists(): errors.append('FAIL: missing frontend/'+f)
    else: print('PASS: frontend/'+f+' exists')

# Route source portability: internal app routes should point to physical .html files.
text='\n'.join(p.read_text(errors='ignore') for p in FRONT.rglob('*') if p.suffix in {'.html','.js'})
for route in ['apply','portal','student-login','staff-login','admin-dashboard','tutor','forgot-password','reset-password','setup-password','payment-success']:
    bad = re.findall(r"(?:href|location(?:\.href|\.assign|\.replace)|window\.open)\s*=?\s*['\"]/"+re.escape(route)+r"(?:[?#'\"]|$)", text)
    if bad: errors.append(f'FAIL: extensionless internal route reference remains for {route}')
print('PASS: extensionless internal route scan') if not any('extensionless internal' in e for e in errors) else None

# JavaScript syntax checks.
for p in sorted(FRONT.rglob('*.js')):
    r=subprocess.run(['node','--check',str(p)],capture_output=True,text=True)
    if r.returncode: errors.append(f'FAIL: JS syntax {p.relative_to(ROOT)}: {r.stderr.strip()}')
print('PASS: external JS syntax') if not any(e.startswith('FAIL: JS syntax') for e in errors) else None

# Migration ledger + dollar quote sanity.
nums=[]
for p in sorted(MIG.glob('*.sql')):
    m=re.match(r'(\d+)_',p.name)
    if m: nums.append(int(m.group(1)))
    s=p.read_text(errors='ignore')
    if s.count('$$') % 2: errors.append(f'FAIL: unbalanced $$ in {p.name}')
if nums != list(range(1,len(nums)+1)): errors.append(f'FAIL: migration sequence is {nums}')
else: print(f'PASS: migrations 001 through {len(nums)} are continuous')

# QA harness must remain staging-only and parameterized.
qa=TEST.read_text(errors='ignore') if TEST.exists() else ''
for token in ['E2E_BASE_URL','E2E_STUDENT_EMAIL','E2E_STUDENT_PASSWORD']:
    if token not in qa: errors.append(f'FAIL: QA harness missing {token}')
if 'staging' not in qa.lower(): warnings.append('WARN: QA harness does not explicitly mention staging')
else: print('PASS: E2E harness is staging-oriented')

# Detect accidental service-role credentials in frontend source.
if re.search(r'SERVICE_ROLE_KEY|service_role', text, re.I):
    errors.append('FAIL: service-role credential reference found in frontend source')
else: print('PASS: no service-role credential reference in frontend source')

print('\nPHASE 14 LOCAL RELEASE GATE')
print('errors:', len(errors), 'warnings:', len(warnings))
for x in errors+warnings: print(x)
if errors:
    sys.exit(1)
print('PASS: local release gate')
