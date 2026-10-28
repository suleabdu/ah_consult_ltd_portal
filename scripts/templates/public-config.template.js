/* Public-only Supabase configuration. Generated from environment variables on deployment.
   This source checkout is deliberately UNCONFIGURED to prevent accidental production access.
   Never put a service-role key, payment secret or Google private key in this file. */
(function () {
  'use strict';
  const PRODUCTION = {
    SUPABASE_URL: 'https://unconfigured.invalid',
    SUPABASE_ANON_KEY: 'PUBLIC_ANON_KEY_NOT_CONFIGURED'
  };
  // Local previews use staging ONLY. Missing staging settings never fall back to production.
  const LOCAL = null;
  const host = location.hostname;
  const isLocal = location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || /\.local$/.test(host) ||
    /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  const env = isLocal ? 'local' : 'production';
  const cfg = isLocal ? (LOCAL || { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }) : PRODUCTION;
  window.APP_ENV = env;
  window.APPLY_CONFIG = { SUPABASE_URL: cfg.SUPABASE_URL, SUPABASE_ANON_KEY: cfg.SUPABASE_ANON_KEY,
    ENV: env, LIVE_DATA: !isLocal && !!cfg.SUPABASE_URL && cfg.SUPABASE_URL !== 'https://unconfigured.invalid' };
  if (isLocal) document.addEventListener('DOMContentLoaded', function () {
    const r = document.createElement('div');
    r.setAttribute('role', 'status');
    r.textContent = LOCAL ? 'LOCAL / STAGING — synthetic data only' : 'LOCAL DEMO NOT CONFIGURED — connect a staging project';
    r.style.cssText = 'position:fixed;bottom:0;left:0;z-index:2147483000;padding:3px 10px;font:700 11px Arial,sans-serif;letter-spacing:.04em;border-top-right-radius:6px;color:#fff;pointer-events:none;background:#15803d';
    document.body.appendChild(r);
  });
})();
