/* =============================================================================
   js/home.js : behaviour for the public homepage (index.html).
   - Learning Impact figures  <- rpc/public_impact_stats  (aggregates only)
   - Training programmes      <- courses (public catalogue), with a built-in fallback list in the HTML
   - Gallery                  <- gallery_items WHERE status='published' (RLS enforces this server-side as well)
   Everything degrades gracefully: if the network or Supabase is unavailable the page still works.
   Only the PUBLIC anon key is used. No student data is ever requested.
   ============================================================================= */
(function () {
  'use strict';
  var C = window.APPLY_CONFIG || {};
  var BASE = String(C.SUPABASE_URL || '').replace(/\/$/, '');
  var KEY = C.SUPABASE_ANON_KEY || '';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var el = function (tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  };

  /** GET/POST against the Supabase REST API with the public key. Rejects on any non-2xx. */
  function rest(path, opts) {
    opts = opts || {};
    if (!BASE || !KEY) return Promise.reject(new Error('not configured'));
    var headers = { apikey: KEY };
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(BASE + '/rest/v1/' + path, { method: opts.method || 'GET', headers: headers, body: opts.body, cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  /* Public contact address is published from Website Settings (never an assumed office location). */
  function publishedLocation(settings){
    var l=settings?.location||{},row=$('#publicAddressRow'),address=$('#publicAddress'),map=$('#publicMap');
    if(!row||!address||!map)return;
    if(!l.published_at||!l.address||!l.city||!l.state){row.hidden=true;return;}
    address.textContent=[l.address,l.city,l.lga,l.state,'Nigeria'].filter(Boolean).join(', ');
    var lat=Number(l.lat),lon=Number(l.lon),valid=l.lat!=null&&l.lon!=null&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
    map.hidden=!valid;if(valid)map.href='https://www.openstreetmap.org/?mlat='+encodeURIComponent(lat)+'&mlon='+encodeURIComponent(lon)+'#map=16/'+encodeURIComponent(lat)+'/'+encodeURIComponent(lon);
    row.hidden=false;
  }
  window.addEventListener('site-settings',function(e){publishedLocation(e.detail||{})});
  if(window.SITE)publishedLocation(window.SITE);

  /* ---------- Navigation (mobile menu) ---------- */
  (function menu() {
    var btn = $('#menuBtn'), nav = $('#siteMenu');
    if (!btn || !nav) return;
    var set = function (open) { nav.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open)); btn.textContent = open ? 'Close' : 'Menu'; };
    btn.addEventListener('click', function () { set(!nav.classList.contains('open')); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && nav.classList.contains('open')) { set(false); btn.focus(); } });
    window.addEventListener('resize', function () { if (window.innerWidth > 1180) set(false); });
  })();

  /* ---------- Service pre-select + WhatsApp consultation ---------- */
  (function consult() {
    var form = $('#consultForm'), sel = $('#cSvc');
    document.addEventListener('click', function (e) {
      var a = e.target.closest('[data-service]');
      if (a && sel) sel.value = a.getAttribute('data-service');
    });
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var n = $('#cName').value.trim(), p = $('#cPhone').value.trim(), s = sel.value, m = $('#cMsg').value.trim(), err = $('#cErr');
      if (!n || !s) {
        err.textContent = 'Please enter your name and choose a service.'; err.hidden = false;
        (!n ? $('#cName') : sel).focus();
        return;
      }
      err.hidden = true;
      var t = 'Hello AH Consult, my name is ' + n + (p ? ' (' + p + ')' : '') + '. I am interested in: ' + s + '.' + (m ? ' ' + m : '');
      window.open('https://wa.me/2348037155105?text=' + encodeURIComponent(t), '_blank', 'noopener');
    });
  })();

  var yr = $('#yr'); if (yr) yr.textContent = new Date().getFullYear();

  /* ---------- Learning Impact ---------- */
  (function impact() {
    var sec = $('#impact'), body = $('#impact-body'), note = $('#impact-note');
    if (!sec || !body) return;
    var METRICS = [
      ['learners_enrolled', 'Learners enrolled', 'Approved admissions with confirmed payment', 'Learners enrolled counts students whose admission is approved and whose payment is confirmed.'],
      ['graduates', 'Graduates', 'Certificates of Completion issued', 'Graduates counts students who have been issued a Certificate of Completion.'],
      ['programmes', 'Training programmes', 'Currently offered', ''],
      ['active_intakes', 'Open intakes', 'Accepting applications', '']
    ];
    function state(msg, retry) {
      body.textContent = '';
      var box = el('div', { 'class': 'impact-state' }, msg);
      if (retry) { var b = el('button', { type: 'button', 'class': 'btn' }, 'Retry'); b.addEventListener('click', load); box.appendChild(b); }
      body.appendChild(box); note.hidden = true;
    }
    function load() {
      sec.hidden = false;
      body.innerHTML = '<div class="skel" aria-hidden="true"></div><span class="sr-only">Loading figures</span>'; note.hidden = true;
      rest('rpc/public_impact_stats', { method: 'POST', body: '{}' }).then(function (d) {
        // A figure is shown only when the database can state it reliably (a positive number). Otherwise it is omitted.
        var items = METRICS.filter(function (m) { return typeof d[m[0]] === 'number' && d[m[0]] > 0; });
        if (!items.length) { sec.hidden = true; return; }
        var grid = el('div', { 'class': 'metrics' });
        items.forEach(function (m) {
          var c = el('div', { 'class': 'metric' });
          c.appendChild(el('b', {}, Number(d[m[0]]).toLocaleString('en-NG')));
          c.appendChild(el('span', {}, m[1])); c.appendChild(el('small', {}, m[2]));
          grid.appendChild(c);
        });
        body.textContent = ''; body.appendChild(grid);
        // The footnote explains only the figures that are actually displayed.
        note.textContent = 'Live figures from our records. ' + items.map(function (m) { return m[3]; }).filter(Boolean).join(' ') + ' No individual records are shown.';
        note.hidden = false;
      }).catch(function () { state('Our figures are temporarily unavailable.', true); });
    }
    load();
  })();

  /* ---------- Training programmes (DB-driven; the static list in the HTML is the fallback) ---------- */
  (function programmes() {
    var list = $('#programs-list');
    if (!list) return;
    var RANK = ['beginner', 'intermediate', 'advanced', 'professional'];
    var rk = function (c) { var i = RANK.indexOf(String(c).toLowerCase()); return i < 0 ? 99 : i; };
    rest('courses?select=name,category&is_active=eq.true&order=name.asc').then(function (rows) {
      if (!rows || !rows.length) return;
      var by = {}, order = [];
      rows.forEach(function (r) { if (!by[r.name]) { by[r.name] = []; order.push(r.name); } if (by[r.name].indexOf(r.category) < 0) by[r.name].push(r.category); });
      list.textContent = '';
      order.sort(function (a, b) { return a.localeCompare(b); });
      order.forEach(function (name) {
        var li = el('li', { 'class': 'prog' }), levels = el('div', { 'class': 'levels' });
        li.appendChild(el('h3', {}, name));
        by[name].sort(function (a, b) { return rk(a) - rk(b) || String(a).localeCompare(b); }).forEach(function (lv) {
          levels.appendChild(el('a', { 'class': 'chip', href: 'apply.html?' + new URLSearchParams({ course: name, category: lv }).toString() }, lv));
        });
        li.appendChild(levels); list.appendChild(li);
      });
      // VRAY was listed on the original homepage but is not a registrable course: keep it as an enquiry-only entry.
      var v = el('li', { 'class': 'prog' }), vl = el('div', { 'class': 'levels' }), va = el('a', { 'class': 'chip', href: '#consult', 'data-service': 'Training Hub' }, 'Ask about VRAY');
      v.appendChild(el('h3', {}, 'VRAY')); vl.appendChild(va); v.appendChild(vl); list.appendChild(v);
    }).catch(function () { /* keep the fallback list already in the page */ });
  })();

  /* ---------- Gallery ---------- */
  (function gallery() {
    var grid = $('#gal-grid'), tabs = $('#gal-tabs'), stateEl = $('#gal-state'), moreWrap = $('#gal-more'), moreBtn = $('#gal-more-btn');
    var dlg = $('#lightbox');
    if (!grid) return;
    var CATS = [['training', 'Training'], ['projects', 'Projects'], ['graduation', 'Graduation'], ['events', 'Events'], ['other', 'Other']];
    var PAGE = 9, CACHE = 'ahct_gallery_v2';
    var all = [], view = [], filter = 'all', shown = PAGE, signature = '', lastFetch = 0, pending = null;

    /** Google-hosted photos accept a size suffix; everything else is used as-is. Falls back to the original on error. */
    var isGoogle = function (u) { return /^https:\/\/lh3\.googleusercontent\.com\/d\/[^=?#]+$/.test(u); };
    var sized = function (u, w) { return isGoogle(u) ? u + '=w' + w : u; };

    function setState(msg, retry) {
      stateEl.hidden = false; stateEl.textContent = '';
      stateEl.appendChild(el('span', {}, msg));
      if (retry) { var b = el('button', { type: 'button', 'class': 'btn' }, 'Retry'); b.addEventListener('click', function () { setState('Loading photographs…'); refresh(true); }); stateEl.appendChild(b); }
      grid.hidden = true; moreWrap.hidden = true; tabs.hidden = true;
    }

    function applyFilter() {
      var f = all.filter(function (g) { return !g.broken && (filter === 'all' || g.category === filter); });
      f.sort(function (a, b) { return (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || a.sort_order - b.sort_order; });
      // Featured photographs shape the composition: the first becomes the large lead tile, the next two tall companions
      // (at most three in total keeps it balanced). Any further featured photographs are shown as ordinary tiles.
      var nFeat = 0; f.forEach(function (g) { g._feat = g._tall = false; if (g.featured) { if (nFeat === 0) g._feat = true; else if (nFeat < 3) g._tall = true; nFeat++; } });
      view = f;
    }

    function buildTabs() {
      var present = CATS.filter(function (c) { return all.some(function (g) { return g.category === c[0]; }); });
      tabs.textContent = '';
      if (present.length < 2) { tabs.hidden = true; return; }
      [['all', 'All']].concat(present).forEach(function (c) {
        var b = el('button', { type: 'button', 'class': 'gal-tab', 'aria-pressed': String(filter === c[0]) }, c[1]);
        b.addEventListener('click', function () { filter = c[0]; shown = PAGE; render(); });
        tabs.appendChild(b);
      });
      tabs.hidden = false;
    }

    function render() {
      applyFilter(); buildTabs();
      if (!view.length) { setState(all.length ? 'No photographs in this category yet.' : 'New photographs are coming soon.'); if (all.length) tabs.hidden = false; return; }
      stateEl.hidden = true; grid.hidden = false; grid.textContent = '';
      view.slice(0, shown).forEach(function (g, i) {
        var b = el('button', { type: 'button', 'class': 'gal-item' + (g._feat ? ' feat' : g._tall ? ' tall' : ''), 'aria-label': 'View photograph' + (g.caption ? ': ' + g.caption : ' ' + (i + 1)) });
        var img = el('img', { alt: g.alt_text || g.caption || 'AH Consult Ltd photograph', loading: 'lazy', decoding: 'async', width: g._feat ? '800' : '400', height: g._feat ? '800' : '400' });
        var tried = false;
        img.addEventListener('error', function () {
          if (!tried && isGoogle(g.image_url)) { tried = true; img.removeAttribute('srcset'); img.src = g.image_url; return; }   // resized variant failed: try the original once
          g.broken = true; b.remove();                                                                                         // unavailable image: drop the tile, never show a broken icon
          if (!grid.children.length) render();
        });
        if (isGoogle(g.image_url)) { img.src = sized(g.image_url, g._feat ? 900 : 500); img.srcset = sized(g.image_url, g._feat ? 600 : 360) + ' 360w, ' + sized(g.image_url, g._feat ? 1000 : 640) + ' 640w'; img.sizes = g._feat ? '(max-width:640px) 100vw, 50vw' : '(max-width:640px) 50vw, 25vw'; }
        else img.src = g.image_url;
        b.appendChild(img);
        if (g.caption) b.appendChild(el('span', { 'class': 'gal-cap', 'aria-hidden': 'true' }, g.caption));
        b.addEventListener('click', function () { openLb(i); });
        grid.appendChild(b);
      });
      moreWrap.hidden = view.length <= shown;
    }
    moreBtn.addEventListener('click', function () { shown += PAGE; render(); });

    /* --- accessible viewer (native <dialog>: focus trap, Esc to close, focus returns to the thumbnail) --- */
    var cur = 0;
    function show(i) {
      if (!view.length) return;
      cur = (i + view.length) % view.length;
      var g = view[cur], img = $('#lb-img');
      img.alt = g.alt_text || g.caption || 'AH Consult Ltd photograph';
      img.src = sized(g.image_url, 1600);
      img.onerror = function () { img.onerror = null; img.src = g.image_url; };
      $('#lb-cap').textContent = g.caption || '';
      $('#lb-count').textContent = (cur + 1) + ' / ' + view.length;
      [1, -1].forEach(function (d) { var n = view[(cur + d + view.length) % view.length]; if (n) new Image().src = sized(n.image_url, 1600); });   // warm the neighbours
      $('#lb-prev').disabled = $('#lb-next').disabled = view.length < 2;
    }
    function openLb(i) {
      if (!dlg) return;
      show(i);
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      $('#lb-close').focus();
    }
    function closeLb() { if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); }
    if (dlg) {
      $('#lb-close').addEventListener('click', closeLb);
      $('#lb-prev').addEventListener('click', function () { show(cur - 1); });
      $('#lb-next').addEventListener('click', function () { show(cur + 1); });
      dlg.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft') { e.preventDefault(); show(cur - 1); } else if (e.key === 'ArrowRight') { e.preventDefault(); show(cur + 1); } });
      dlg.addEventListener('click', function (e) { if (e.target === dlg || e.target.classList.contains('lb-stage')) closeLb(); });
      var x0 = null;
      dlg.addEventListener('touchstart', function (e) { x0 = e.changedTouches[0].clientX; }, { passive: true });
      dlg.addEventListener('touchend', function (e) { if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) show(cur + (dx < 0 ? 1 : -1)); }, { passive: true });
      dlg.addEventListener('close', function () { if (pending) { var p = pending; pending = null; ingest(p); } });   // apply any update that arrived while the viewer was open
    }

    /* --- data: cache first, then revalidate; poll + realtime keep it fresh --- */
    function ingest(rows) {
      var sig = JSON.stringify(rows.map(function (r) { return [r.id, r.image_url, r.caption, r.alt_text, r.category, r.featured, r.sort_order]; }));
      if (sig === signature) return;
      if (dlg && dlg.open) { pending = rows; return; }
      signature = sig; all = rows.map(function (r) { r.broken = false; return r; }); render();
    }
    function refresh(manual) {
      lastFetch = Date.now();
      return rest('gallery_items?select=id,image_url,caption,alt_text,category,featured,sort_order&status=eq.published&order=sort_order.asc,created_at.asc&limit=200')
        .then(function (rows) {
          try { localStorage.setItem(CACHE, JSON.stringify({ t: Date.now(), rows: rows })); } catch (e) { /* private mode */ }
          if (!rows.length) { signature = '[]'; all = []; setState('New photographs are coming soon.'); return; }
          ingest(rows);
        })
        .catch(function () { if (!all.length) setState('Photographs could not be loaded right now.', true); else if (manual) setState('Photographs could not be refreshed.', true); });
    }
    try { var c = JSON.parse(localStorage.getItem(CACHE) || 'null'); if (c && c.rows && c.rows.length) ingest(c.rows); } catch (e) { /* ignore */ }
    refresh();

    setInterval(function () { if (!document.hidden) refresh(); }, 60000);                                                     // reliable fallback
    document.addEventListener('visibilitychange', function () { if (!document.hidden && Date.now() - lastFetch > 30000) refresh(); });

    // Supabase Realtime accelerates updates; it is loaded lazily after the page is idle and is optional.
    var debounce = null, onChange = function () { clearTimeout(debounce); debounce = setTimeout(refresh, 600); };
    function subscribe() {
      try {
        var cl = window.supabase.createClient(BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
        cl.channel('home-gallery').on('postgres_changes', { event: '*', schema: 'public', table: 'gallery_items' }, onChange).subscribe();
      } catch (e) { /* polling continues */ }
    }
    function startRealtime() {
      var conn = navigator.connection || {};
      if (!BASE || conn.saveData) return;
      if (window.supabase && window.supabase.createClient) return subscribe();
      var s = el('script', { src: 'vendor/supabase.min.js' }); s.onload = subscribe; document.head.appendChild(s);
    }
    window.addEventListener('load', function () { (window.requestIdleCallback || function (f) { setTimeout(f, 2500); })(startRealtime); });
  })();
})();
