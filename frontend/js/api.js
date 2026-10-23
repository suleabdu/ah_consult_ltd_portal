/* =============================================================================
   js/api.js
   AH Student Hub — fetch wrapper

   Replaces every `google.script.run.withSuccessHandler(...).withFailureHandler
   (...).someFunction(args)` call from the original Apps Script pages with a
   plain fetch() against the Flask API (js/config.js's API_BASE_URL). Kept
   deliberately callback-shaped (onSuccess/onFailure) rather than switched to
   async/await everywhere, so each page's script file could be ported with
   minimal structural change from its original google.script.run call —
   compare any call site here with its original in the extracted Apps
   Script project.

   SELF-DIAGNOSING MISCONFIGURATION CHECK — added after a reported case
   where the app was deployed to Netlify without updating config.js's
   API_BASE_URL away from its local-dev default (http://localhost:5000).
   Every visitor's browser then tried to fetch an address that either
   doesn't exist on their machine, or gets hard-blocked as "mixed content"
   (an https:// page is never allowed to call an http:// address) — both
   produce the exact same unhelpful browser error, a bare
   "TypeError: Failed to fetch", surfaced on EVERY page that calls the API
   (the public form's intake cards, every login page, every dashboard).
   checkApiBaseUrlConfigured() below runs once, at load, and — only when
   it looks like this exact mistake — shows a fixed, unmissable banner
   naming the problem and the one file to fix, instead of leaving each
   page to fail with a generic, unexplained error. See
   docs/ARCHITECTURE_AND_DECISIONS.md, Section 22.
   ============================================================================= */

function checkApiBaseUrlConfigured() {
  const pageIsLocal = ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
  if (pageIsLocal) return; // this IS local development — API_BASE_URL pointing at localhost is correct here

  let apiHost = "";
  try { apiHost = new URL(API_BASE_URL).hostname; } catch (e) { /* fall through */ }
  const apiPointsAtLocalhost = ["localhost", "127.0.0.1"].includes(apiHost);
  if (!apiPointsAtLocalhost) return; // looks like a real backend URL — nothing to warn about

  const banner = document.createElement("div");
  banner.setAttribute(
    "style",
    "position:fixed;top:0;left:0;right:0;z-index:99999;background:#b91c1c;color:#fff;" +
    "font-family:sans-serif;font-size:14px;line-height:1.5;padding:14px 20px;text-align:center;" +
    "box-shadow:0 2px 8px rgba(0,0,0,0.3);"
  );
  banner.innerHTML =
    "<strong>Setup issue:</strong> this site is still pointing at <code>" + API_BASE_URL + "</code> " +
    "instead of the real backend. Every page that calls the server (login, the application form, every " +
    "dashboard) will fail with \u201cFailed to fetch\u201d until this is fixed &mdash; " +
    "edit <code>frontend/js/config.js</code>, set <code>API_BASE_URL</code> to your deployed Render " +
    "backend's URL, then redeploy. See docs/SETUP_GUIDE.md, Step 11.";
  document.addEventListener("DOMContentLoaded", function () {
    document.body.prepend(banner);
  });
  if (document.readyState !== "loading") document.body.prepend(banner);
}
checkApiBaseUrlConfigured();

// A bare "TypeError: Failed to fetch" (or the Firefox/Safari equivalents)
// means the request never got a response at all — the backend is
// unreachable, misconfigured (see the check above), blocked by CORS, or
// blocked as mixed content. That raw browser string means nothing to an
// end user, so it's replaced with an explanation of what it usually
// means instead of being shown verbatim.
function friendlyNetworkErrorMessage_(err) {
  const raw = (err && err.message) || String(err || "");
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return "Could not reach the server. This usually means the app isn't configured correctly, or the " +
      "server is temporarily down — please try again shortly, or contact AH Consult Ltd if this continues.";
  }
  return raw || "Network error — please check your connection and try again.";
}

const Api = {
  /**
   * @param {string} path e.g. "/api/auth/login"
   * @param {object} body JSON body (sent as-is)
   * @param {function} onSuccess called with the parsed JSON response
   * @param {function} onFailure called with an Error-like {message}
   * @param {string|null} token optional bearer session token
   */
  call(path, body, onSuccess, onFailure, token) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;

    fetch(API_BASE_URL + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body || {}),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data };
        });
      })
      .then(function (result) {
        if (!result.ok || result.data.success === false) {
          onFailure && onFailure({ message: result.data.error || "Something went wrong. Please try again." });
          return;
        }
        onSuccess && onSuccess(result.data);
      })
      .catch(function (err) {
        onFailure && onFailure({ message: friendlyNetworkErrorMessage_(err) });
      });
  },

  get(path, onSuccess, onFailure) {
    fetch(API_BASE_URL + path)
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          onFailure && onFailure({ message: result.data.error || "Something went wrong." });
          return;
        }
        onSuccess && onSuccess(result.data);
      })
      .catch(function (err) {
        onFailure && onFailure({ message: friendlyNetworkErrorMessage_(err) });
      });
  },
};
