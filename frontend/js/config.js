/* =============================================================================
   js/config.js  -  ONE file for every environment. It contains only the public
   Supabase URL and anon key; private provider credentials never belong here.

   How it decides:
     - Opened from localhost / 127.0.0.1 / a home-network address / file  ->  "local"
     - Opened from any real website address (Vercel, your domain)        ->  "production"
   "local" uses LOCAL below. When LOCAL is null, local pages deliberately have no
   backend connection. Add a separate staging project only when it is available.

   Only the project URL and the public "anon" key belong here. They are safe to
   publish; real protection comes from the database security rules.
   Do not use localhost to test the production project. Use the approved staging
   environment for authenticated and payment-flow verification.
   ============================================================================= */
(function () {
  const PRODUCTION = {
    SUPABASE_URL: "https://loultswskhdqkrufwxpv.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxvdWx0c3dza2hkcWtydWZ3eHB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4NTE5MjUsImV4cCI6MjEwODQyNzkyNX0.cl6QkZvLi6NwjS2H66UAYP8jBG-J-5kAIif6AK9PLu8"
  };
  var LOCAL = null;   // e.g. { SUPABASE_URL: "https://YOUR-STAGING-REF.supabase.co", SUPABASE_ANON_KEY: "YOUR-STAGING-ANON-KEY" }

  var h = location.hostname;
  var isLocal = location.protocol === "file:" || h === "localhost" || h === "127.0.0.1" || h === "[::1]" || /\.local$/.test(h) ||
    /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
  var env = isLocal ? "local" : "production";

  var cfg = (env === "local" && LOCAL) ? LOCAL : PRODUCTION;
  var usingLive = env === "production" || cfg === PRODUCTION;
  // Fail closed when no separate staging project is configured.
  if (isLocal && !LOCAL) {
    cfg = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "" };
    usingLive = false;
  }
  window.APP_ENV = env;
  window.APPLY_CONFIG = { SUPABASE_URL: cfg.SUPABASE_URL, SUPABASE_ANON_KEY: cfg.SUPABASE_ANON_KEY, ENV: env, LIVE_DATA: usingLive };

  // Visible warning ribbon whenever you are not on the live website (never shown to the public)
  if (env === "local") {
    document.addEventListener("DOMContentLoaded", function () {
      var r = document.createElement("div");
      r.setAttribute("role", "status");
      r.textContent = LOCAL ? "LOCAL / STAGING - test data only" : "LOCAL DEMO NOT CONFIGURED — connect a staging project";
      r.style.cssText = "position:fixed;bottom:0;left:0;z-index:2147483000;padding:3px 10px;font:700 11px Arial,sans-serif;letter-spacing:.04em;border-top-right-radius:6px;color:#fff;pointer-events:none;background:#15803d";
      document.body.appendChild(r);
    });
  }
})();
