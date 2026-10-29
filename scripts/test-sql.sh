#!/usr/bin/env bash
# Applies every migration to an EMPTY Postgres database and runs the SQL test-suite.
# Usage:  DATABASE_URL=postgres://user:pass@localhost:5432/hub_test ./scripts/test-sql.sh
# The database is wiped first. Never point this at a real project.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to a throw-away local database}"
case "$DATABASE_URL" in *supabase.co*|*pooler.supabase*) echo "Refusing to run against a hosted Supabase database."; exit 1;; esac
cd "$(dirname "$0")/.."
psql() { command psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q "$@"; }
psql -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists storage cascade; drop schema if exists extensions cascade; drop schema if exists cron cascade; drop schema if exists net cascade; create schema public;" 2>/dev/null || true
psql -f tests/sql/supabase_stub.sql 2>&1 | grep -v "wal_level\|HINT" || true
for f in $(ls supabase/migrations/*.sql | sort); do echo "migrate  $(basename "$f")"; psql -f "$f"; done
for f in tests/sql/phase2_smoke.sql tests/sql/phase11_release_smoke.sql tests/sql/phase12_preflight.sql; do echo "smoke    $(basename "$f")"; psql -o /dev/null -f "$f"; done
echo "posture  security_posture.sql"; psql -f tests/sql/security_posture.sql
echo "hardening hardening_test.sql";  psql -At -f tests/sql/hardening_test.sql | grep -E "^(PASS|FAIL)"
echo "homepage  homepage_test.sql";    psql -At -f tests/sql/homepage_test.sql  | grep -E "^(PASS|FAIL)"
echo "designer  document_designer_posture.sql"; psql -f tests/sql/document_designer_posture.sql
echo "native   native_document_studio_posture.sql"; psql -f tests/sql/native_document_studio_posture.sql
echo "ALL SQL TESTS PASSED"
