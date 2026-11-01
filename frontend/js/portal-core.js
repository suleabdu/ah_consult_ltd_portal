/* =============================================================================
   js/portal-core.js  -  shared code for the Student Portal (portal.html) and Tutor Portal (tutor.html)

   SETUP
     1. Put this file in the js folder next to js/config.js and js/theme.js.
     2. The pages load it for you. There is nothing to configure here.
     3. Needs database scripts 009_portals.sql and 010_settings.sql (Supabase SQL Editor).

   WHAT IT DOES: signs the person in (or sends them to the login page), builds the page frame
   (header, side menu, footer), signs them out after 30 minutes of inactivity, and provides small
   helpers (safe text, money, dates, pop-ups, messages).
   ============================================================================= */
(function () {
  var C = window.APPLY_CONFIG;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var naira = function (n) { return "\u20A6" + Number(n || 0).toLocaleString(); };
  var day = function (x) { return x ? new Date(x).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""; };
  var dt = function (x) { return x ? new Date(x).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; };
  function toast(m, e) { var t = document.createElement("div"); t.className = "toast" + (e ? " e" : ""); t.textContent = m; document.body.appendChild(t); setTimeout(function () { t.remove(); }, e ? 7000 : 3500); }
  function modal(html) { var m = document.createElement("div"); m.className = "mdl"; m.innerHTML = '<div class="mbox">' + html + "</div>"; m.addEventListener("click", function (e) { if (e.target === m) m.remove(); }); document.body.appendChild(m); return m; }
  var BANDS = function (t) { return t >= 70 ? "Distinction" : t >= 60 ? "Credit" : t >= 50 ? "Pass" : "Fail"; };
  var bandPill = function (b) { return '<span class="pill ' + (b === "Distinction" ? "ok" : b === "Credit" ? "info" : b === "Pass" ? "wait" : "bad") + '">' + esc(b) + "</span>"; };

  // Sign-in gate. role "tutor" additionally needs an approved tutor staff record.
  async function boot(o) {
    var root = document.getElementById("root");
    if (!window.supabase || !C || !C.SUPABASE_URL) { root.innerHTML = '<div class="gate">Setup problem: js/config.js did not load.</div>'; return null; }
    var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY), r = await sb.auth.getSession(), session = r.data.session;
    if (!session) { location.replace(o.loginUrl); return null; }
    var staff = null;
    if (o.role === "tutor") {
      var s = await sb.from("staff").select("*").eq("id", session.user.id).maybeSingle(); staff = s.data;
      if (!staff || staff.status !== "approved" || staff.role !== "tutor") {
        try { await sb.auth.signOut({ scope: "local" }); } catch (e) { console.warn("Could not sign out an unapproved tutor session:", e); }
        clearLocalAuthToken();
        location.replace(o.loginUrl);
        return null;
      }
    }
    function clearLocalAuthToken() {
      try { var ref = new URL(C.SUPABASE_URL).hostname.split('.')[0], key = "sb-" + ref + "-auth-token"; [localStorage, sessionStorage].forEach(function (store) { store.removeItem(key); store.removeItem(key + "-code-verifier"); }); } catch (_) { /* Continue to the sign-in screen even when storage is blocked. */ }
    }
    var out = function (expired) {
      try { var pending = sb.auth.signOut({ scope: "local" }); if (pending && typeof pending.catch === "function") pending.catch(function () {}); } catch (_) {}
      clearLocalAuthToken();
      var parts = String(o.loginUrl || "apply.html#signin").split("#"), target = parts[0];
      if (expired) target += (target.indexOf("?") > -1 ? "&" : "?") + "expired=1";
      if (parts[1]) target += "#" + parts[1];
      location.replace(target);
    };
    var idle; var bump = function () { clearTimeout(idle); idle = setTimeout(function () { out(true); }, 30 * 60 * 1000); };
    ["click", "keydown", "touchstart", "mousemove"].forEach(function (e) { addEventListener(e, bump, { passive: true }); }); bump();
    return { sb: sb, user: session.user, staff: staff, signOut: out };
  }

  // Page frame + navigation. render(id) returns HTML; wire(id, main) attaches events.
  function shell(o) {
    var root = document.getElementById("root"), cur = o.start;
    root.innerHTML = '<header class="top"><button id="burger" type="button" aria-label="Open menu">☰</button><img class="lg" alt="" src="https://lh3.googleusercontent.com/d/1Qp_nbC6oekgdzjJqGBHwHw125t1ABYUf" onerror="this.style.display=\'none\'"><span class="org" data-org>AH Consult</span><span class="sp"></span><span class="me">' + esc(o.who) + '</span><a href="/" style="color:#fdba74;text-decoration:none;font-size:12.5px;font-weight:700">Website</a><button id="so" type="button" class="top-signout">Sign out</button></header>' +
      '<div class="shell"><nav id="nav"></nav><main id="main"></main></div><footer>&copy; ' + new Date().getFullYear() + " AH Consult Ltd &middot; " + esc(o.footer || "") + "</footer>";
    var nav = document.getElementById("nav"), main = document.getElementById("main");
    // Pages can return the legacy flat list, or grouped entries in the form
    // { label: "Learning", items: [[id, label, icon, badge], ...] }. Keeping
    // the flat-list path makes this navigation upgrade non-breaking for pages
    // that have not yet adopted contextual groups.
    var collapsedGroups = Object.create(null);
    function navGroups() {
      var entries = o.nav() || [];
      if (!entries.length || Array.isArray(entries[0])) return [{ key: "legacy", label: "", items: entries }];
      return entries.map(function (group, index) { return { key: "group-" + index, label: group.label || "", items: Array.isArray(group.items) ? group.items : [] }; }).filter(function (group) { return group.items.length; });
    }
    function navItems() { return navGroups().reduce(function (all, group) { return all.concat(group.items); }, []); }
    function navButton(n) { return '<button data-v="' + n[0] + '" class="' + (n[0] === cur ? "act" : "") + '">' + (n[2] || "") + " " + esc(n[1]) + (n[3] ? '<span class="b">' + n[3] + "</span>" : "") + "</button>"; }
    function expandActiveGroup(groups) {
      groups.forEach(function (group) {
        if (group.items.some(function (item) { return item[0] === cur; })) collapsedGroups[group.key] = false;
      });
    }
    function paintNav(keepActiveVisible) {
      var groups = navGroups();
      if (keepActiveVisible) expandActiveGroup(groups);
      nav.innerHTML = '<div class="cap">' + esc(o.cap) + "</div>" + groups.map(function (group, i) {
        var groupId = "nav-group-" + i, isCollapsed = group.label && collapsedGroups[group.key] === true;
        var title = group.label ? '<h2 class="nav-group-title"><button class="nav-group-toggle" type="button" id="' + groupId + '" data-group="' + group.key + '" aria-controls="' + groupId + '-items" aria-expanded="' + (!isCollapsed) + '"><span>' + esc(group.label) + '</span><span class="nav-group-chevron" aria-hidden="true">⌄</span></button></h2>' : "";
        return '<section class="nav-group' + (isCollapsed ? ' is-collapsed' : '') + '"' + (group.label ? ' aria-labelledby="' + groupId + '"' : "") + ">" + title + '<div class="nav-group-items" id="' + groupId + '-items"' + (isCollapsed ? ' hidden' : '') + ">" + group.items.map(navButton).join("") + "</div></section>";
      }).join("");
      nav.querySelectorAll("[data-v]").forEach(function (b) { b.onclick = function () { go(b.dataset.v); nav.classList.remove("open"); }; });
      nav.querySelectorAll(".nav-group-toggle").forEach(function (b) { b.onclick = function () { collapsedGroups[b.dataset.group] = b.getAttribute("aria-expanded") === "true"; paintNav(false); }; });
    }
    function go(id) { var entries = navItems(), ok = entries.some(function (n) { return n[0] === id; }); cur = ok ? id : (entries[0] ? entries[0][0] : o.start); paintNav(true); main.innerHTML = o.render(cur); o.wire(cur, main); window.scrollTo(0, 0); }
    document.getElementById("burger").onclick = function () { nav.classList.toggle("open"); };
    document.getElementById("so").onclick = function () { o.signOut(); };
    window.PCgo = go; paintNav(true); main.innerHTML = o.render(cur); o.wire(cur, main);
    return { go: go, refresh: function () { go(cur); } };
  }
  window.PC = { esc: esc, naira: naira, day: day, dt: dt, toast: toast, modal: modal, boot: boot, shell: shell, band: BANDS, bandPill: bandPill };
})();
