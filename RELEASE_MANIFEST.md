# AH Student Hub v16 — Release Manifest

Canonical deployment: GitHub → Vercel (`frontend/`) → Supabase.
Google Sheets is a controlled mirror/integration.

Database migrations: 001–024.
Security hardening: signed Sheet callbacks, replay protection, generic production errors, Vercel security headers, and production-safe localhost behaviour.
Legacy tracks removed: Flask/Render, Netlify and duplicate Sheets scripts.

Live provider/auth/payment/E2E verification remains a staging responsibility because it requires deployment-specific credentials.
