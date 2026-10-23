"""
wsgi.py
==============================================================================
Entry point gunicorn (and Render) run: `gunicorn wsgi:app`. Also runnable
directly for local development: `python wsgi.py`.

load_dotenv() MUST run before `from app import create_app` — Config's
class body reads os.environ.get(...) the moment app.config is imported,
so anything .env would set has to already be in the environment by then.
On Render (no .env file present) this is a harmless no-op; Render injects
real environment variables directly, which os.environ.get() picks up
either way.
==============================================================================
"""

from dotenv import load_dotenv
load_dotenv()

from app import create_app  # noqa: E402 — must follow load_dotenv()

app = create_app()

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
