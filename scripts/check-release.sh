#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python3 scripts/release_gate.py
python3 - <<'PY'
from pathlib import Path
import urllib.request, subprocess, time, socket
root=Path('frontend').resolve()
s=socket.socket(); s.bind(('127.0.0.1',0)); port=s.getsockname()[1]; s.close()
proc=subprocess.Popen(['python3','-m','http.server',str(port)],cwd=root,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    deadline=time.time()+5
    while time.time()<deadline:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/',timeout=1) as r:
                if r.status==200: break
        except Exception: time.sleep(.1)
    else: raise RuntimeError('local static server did not start')
    for p in ['/','/apply.html','/student-login.html','/portal.html','/staff-login.html','/admin-dashboard.html','/tutor.html','/forgot-password.html','/404.html']:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}'+p,timeout=5) as r:
            assert r.status==200, (p,r.status)
        print('PASS route',p)
finally:
    proc.terminate(); proc.wait(timeout=3)
print('LOCAL STATIC RELEASE SMOKE: PASS')
PY
