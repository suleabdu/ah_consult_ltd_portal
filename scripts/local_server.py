#!/usr/bin/env python3
"""Small local preview server with the clean URLs used by Vercel."""
from __future__ import annotations
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
ROUTES = {
    "/": "index.html",
    "/index": "index.html",
    "/apply": "apply.html",
    "/student-login": "student-login.html",
    "/staff-login": "staff-login.html",
    "/admin-register": "admin-register.html",
    "/tutor": "tutor.html",
    "/admin-dashboard": "admin-dashboard.html",
    "/portal": "portal.html",
    "/payment-success": "payment-success.html",
    "/forgot-password": "forgot-password.html",
}

class CleanURLHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND), **kwargs)

    def translate_path(self, path: str) -> str:
        # Match Vercel's extensionless routes while preserving normal asset paths.
        request_path = urlsplit(path).path
        normalized = request_path.rstrip("/") or "/"
        if normalized in ROUTES:
            path = "/" + ROUTES[normalized]
        return super().translate_path(path)

    def log_message(self, fmt: str, *args) -> None:
        print("[local] " + (fmt % args))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Serve AH Student Hub with Vercel-style clean routes.")
    parser.add_argument("--port", type=int, default=8888)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), CleanURLHandler)
    print(f"AH Student Hub local frontend: http://localhost:{args.port}")
    print("Clean URLs enabled; Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping local server…")
    finally:
        server.server_close()
