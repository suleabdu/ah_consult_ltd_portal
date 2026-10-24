/* AH Student Hub — public runtime configuration.
 * Only the Supabase public URL + anon key belong here. Never place service-role,
 * Google, payment, or webhook secrets in browser code.
 *
 * Configure LOCAL with a separate staging Supabase project before local testing.
 * If LOCAL is null, localhost deliberately refuses to start instead of silently
 * writing to production data.
 */
(function () {
  var PRODUCTION = {
    SUPABASE_URL: "https://xwieiqrnlvcjajdeinqc.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3aWVpcXJubHZjamFqZGVpbmFjIiwiaWF0IjoxNzkxMjYxNTM5LCJleHAiOjIxMDY4Mzc1MzN9.dCdmn69bi0oznIOmEWgXQrz_-HHNT2MYGxY8n8ydukI"
  };
  var LOCAL = null; // { SUPABASE_URL: "https://YOUR-STAGING-REF.supabase.co", SUPABASE_ANON_KEY: "YOUR-STAGING-ANON-KEY" }
  var h = location.hostname;
  var isLocal = location.protocol === "file:" || h === "localhost" || h === "127.0.0.1" || h === "[::1]" || /\.local$/.test(h) || /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
  var env = isLocal ? "local" : "production";
  var forced = new URLSearchParams(location.search).get("env");
  if (isLocal && (forced === "production" || forced === "local")) env = forced;
  if (env === "local" && !LOCAL) {
    window.APP_ENV = "local"; window.APPLY_CONFIG = null;
    document.addEventListener("DOMContentLoaded", function () {
      var r = document.createElement("div"); r.setAttribute("role", "alert");
      r.innerHTML = "<strong>Local setup required.</strong> Configure a separate staging Supabase project in <code>frontend/js/config.js</code>; production data is intentionally blocked on localhost.";
      r.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:2147483000;padding:8px 12px;font:600 12px Arial,sans-serif;color:#7f1d1d;background:#fee2e2;border-top:1px solid #fecaca;text-align:center";
      document.body.appendChild(r);
    }); return;
  }
  var cfg = env === "local" ? LOCAL : PRODUCTION;
  window.APP_ENV = env;
  window.APPLY_CONFIG = { SUPABASE_URL: cfg.SUPABASE_URL, SUPABASE_ANON_KEY: cfg.SUPABASE_ANON_KEY, ENV: env, LIVE_DATA: env === "production" };
})();
