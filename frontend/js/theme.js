/* =============================================================================
   js/theme.js  -  applies the settings saved in Admin Dashboard > Website & Branding
   to whatever page loads it: colours, fonts, text size, logo, favicon, hero/side
   photos, service images and the home-page gallery. Load it after js/config.js.
   Uses a one-minute browser cache, so pages stay fast and a change reaches every
   visitor within about a minute. If anything fails the page simply keeps its
   built-in look, so it can never break a page.
   ============================================================================= */
(function () {
  var C = window.APPLY_CONFIG; if (!C || !C.SUPABASE_URL) return;
  var KEY = "ahct_site", S = {}, cache = null;
  try { cache = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { cache = null; }
  var rgb = function (h) { var m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return null; var n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(" "); };
  var gfont = function (f) { return f ? "https://fonts.googleapis.com/css2?family=" + encodeURIComponent(f).replace(/%20/g, "+") + ":wght@300;400;500;700;900&display=swap" : ""; };

  function applyCss(t) {
    if (!t) return;
    var css = ":root{", r;
    if (t.primary) { css += "--orange:" + t.primary + ";--brand:" + t.primary + ";"; if ((r = rgb(t.primary))) css += "--brand-rgb:" + r + ";"; }
    if (t.primaryDark) css += "--orange-d:" + t.primaryDark + ";";
    if (t.dark) { css += "--black:" + t.dark + ";"; if ((r = rgb(t.dark))) css += "--black-rgb:" + r + ";"; }
    if (t.fontBody) css += "--font:'" + t.fontBody + "',Arial,sans-serif;--font-body:'" + t.fontBody + "',Arial,sans-serif;";
    if (t.fontHeading) css += "--font-heading:'" + t.fontHeading + "',Arial,sans-serif;";
    css += "}";
    var tw = !!window.tailwind, base = parseFloat(t.baseSize) || 0, hs = parseFloat(t.headingScale) || 1;
    if (t.fontBody) css += "body{font-family:var(--font-body)!important}";
    if (t.fontHeading) css += "h1,h2,h3,h4,.nav-link{font-family:var(--font-heading)!important}";
    if (base) css += tw ? "html{font-size:" + (base / 14 * 100).toFixed(1) + "%}" : "body{font-size:" + base + "px!important}";
    if (hs !== 1) css += "@supports(zoom:1){h1,h2,h3{zoom:" + hs + "}}";
    var st = document.getElementById("theme-css"); if (!st) { st = document.createElement("style"); st.id = "theme-css"; document.head.appendChild(st); }
    st.textContent = css;
    [t.fontHeading, t.fontBody].forEach(function (f) { if (!f || document.getElementById("gf-" + f.replace(/\W/g, ""))) return; var l = document.createElement("link"); l.id = "gf-" + f.replace(/\W/g, ""); l.rel = "stylesheet"; l.href = gfont(f); document.head.appendChild(l); });
  }
  function paint() {
    var b = S.branding || {}, im = S.images || {};
    if (b.logo) document.querySelectorAll("img.lg, img[data-slot=logo], .top > img, .hbrand img").forEach(function (i) { i.src = b.logo; i.style.display = ""; });
    if (b.favicon) { var l = document.querySelector("link[rel~=icon]"); if (!l) { l = document.createElement("link"); l.rel = "icon"; document.head.appendChild(l); } l.href = b.favicon; }
    if (b.org) document.querySelectorAll("[data-org]").forEach(function (e) { e.textContent = b.org; });
    if (im.hero) document.querySelectorAll("img[data-slot=hero]").forEach(function (i) { i.src = im.hero; });
    if (im.auth) document.querySelectorAll("body.ahds .hero").forEach(function (h) { h.style.backgroundImage = "linear-gradient(180deg,rgba(17,24,39,.55),rgba(17,24,39,.85)),url('" + im.auth + "')"; });
    document.querySelectorAll("[data-img]").forEach(function (card) {
      var u = im[card.getAttribute("data-img")], ex = card.querySelector(":scope > .theme-card-img");
      if (!u) { if (ex) ex.remove(); return; }
      if (!ex) { ex = document.createElement("img"); ex.className = "theme-card-img"; ex.alt = ""; ex.loading = "lazy"; ex.style.cssText = "width:100%;height:150px;object-fit:cover;border-radius:12px;margin-bottom:14px"; card.insertBefore(ex, card.firstChild); }
      ex.src = u;
    });
    window.SITE_GALLERY = (S.gallery || []).filter(function (g) { return g && g.url; });
    window.dispatchEvent(new CustomEvent("site-settings", { detail: S }));
  }
  function applyAll(v) { S = v || {}; window.SITE = S; applyCss(S.theme); if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paint); else paint(); }
  if (cache && cache.v) applyAll(cache.v);
  if (!cache || Date.now() - cache.t > 60000) {
    fetch(C.SUPABASE_URL + "/rest/v1/site_settings?select=key,value", { headers: { apikey: C.SUPABASE_ANON_KEY } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { if (!rows.length && !cache) return; var v = {}; rows.forEach(function (r) { v[r.key] = r.value; }); try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), v: v })); } catch (e) { /* storage full or blocked */ } applyAll(v); })
      .catch(function () { /* keep the built-in look */ });
  }
})();
