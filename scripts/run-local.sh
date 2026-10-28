#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8888}"
python3 "$ROOT/scripts/local_server.py" --port "$PORT"
