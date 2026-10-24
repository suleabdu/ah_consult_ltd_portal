#!/usr/bin/env python3
"""Canonical AH Student Hub release gate. Static checks only."""
from pathlib import Path
import re, subprocess, sys, json
ROOT=Path(__file__).resolve().parents[1]; FRONT=ROOT/'frontend'; MIG=ROOT/'supabase'/'migrations'; FUN=ROOT/'supabase'/'functions'; errors=[]
def ok(x): print('PASS:',x)
def fail(x): errors.append('FAIL: '+x)
required=['index.html','apply.html','student-login.html','portal.html','staff-login.html','admin-dashboard.html','tutor.html','forgot-password.html','404.html','vercel.json']
for f in required:
    if (FRONT/f).exists(): ok('frontend/'+f+' exists')
    else: fail('missing frontend/'+f)
for f in ['netlify.toml','staff-login-legacy.html']:
    if (FRONT/f).exists(): fail('obsolete frontend/'+f+' remains')
for d in ['backend','sheets']:
    if (ROOT/d).exists(): fail('obsolete '+d+'/ remains')
active='\n'.join(p.read_text(errors='ignore') for p in list(FRONT.rglob('*'))+list((ROOT/'js').rglob('*')) if p.is_file() and p.suffix in {'.html','.js','.json'})
for token in ['onrender.com','netlify.app','staff-login-legacy']:
    if token.lower() in active.lower(): fail('legacy runtime reference: '+token)
if re.search(r'SERVICE_ROLE_KEY|service_role',active,re.I): fail('service-role reference in browser source')
for p in sorted(FRONT.rglob('*.js'))+sorted((ROOT/'js').glob('*.js')):
    r=subprocess.run(['node','--check',str(p)],capture_output=True,text=True)
    if r.returncode: fail(f'JS syntax {p.relative_to(ROOT)}: {r.stderr.strip()}')
if not any('JS syntax' in x for x in errors): ok('JavaScript syntax scan')
nums=[]
for p in sorted(MIG.glob('*.sql')):
    m=re.match(r'(\d+)_',p.name)
    if m: nums.append(int(m.group(1)))
    if p.read_text(errors='ignore').count('$$')%2: fail('unbalanced $$ in '+p.name)
if nums==list(range(1,len(nums)+1)): ok(f'migrations 001 through {len(nums):03d} are continuous')
else: fail('migration sequence is '+str(nums))
crypto=(FUN/'_shared'/'crypto.ts').read_text(errors='ignore'); review=(FUN/'sheet-review'/'index.ts').read_text(errors='ignore')
if 'hmacSha256Hex' in crypto and 'x-sheet-signature' in review and 'sheet_webhook_events' in review: ok('signed Sheet webhook + replay protection present')
else: fail('signed Sheet webhook hardening incomplete')
lib=(FUN/'_shared'/'lib.ts').read_text(errors='ignore')
if 'request_id' in lib and 'detail:' not in lib: ok('generic production error wrapper present')
else: fail('production error wrapper may leak internal detail')
try: json.loads((FRONT/'vercel.json').read_text()); ok('Vercel configuration is valid JSON')
except Exception as e: fail('invalid Vercel JSON: '+str(e))
qa=ROOT/'tests/e2e/student-smoke.spec.js'; q=qa.read_text(errors='ignore') if qa.exists() else ''
for token in ['E2E_BASE_URL','E2E_STUDENT_EMAIL','E2E_STUDENT_PASSWORD']:
    if token not in q: fail('E2E harness missing '+token)
if 'staging' in q.lower(): ok('E2E harness is staging-oriented')
print('\nCANONICAL RELEASE GATE'); print('errors:',len(errors))
for x in errors: print(x)
if errors: sys.exit(1)
print('PASS: canonical release gate')
