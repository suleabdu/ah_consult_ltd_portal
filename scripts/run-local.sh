#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"
PORT="${PORT:-8888}"
echo "AH STUDENT HUB local frontend: http://localhost:${PORT}"
python3 -m http.server "$PORT"
