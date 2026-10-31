/* =============================================================================
   js/home.js : behaviour for the AH Student Hub page (student-hub.html).
   - Learning Impact figures  <- rpc/public_impact_stats  (aggregates only)
   - Training programmes      <- courses (public catalogue), with an explicit unavailable/empty state
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

  /* ---------- Training programmes (DB-driven; the HTML shows a loading state until the public catalogue returns) ---------- */
  (function programmes() {
    var list = $('#programs-list');
    if (!list) return;
    var RANK = ['beginner', 'intermediate', 'advanced', 'professional'];
    var rk = function (c) { var i = RANK.indexOf(String(c).toLowerCase()); return i < 0 ? 99 : i; };
    rest('courses?select=name,category&is_active=eq.true&workflow_status=eq.published&order=name.asc').then(function (rows) {
      if (!rows || !rows.length) { list.textContent = ''; var empty=el('li',{'class':'prog'}); empty.appendChild(el('h3',{},'No published courses are available yet.')); list.appendChild(empty); return; }
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
    }).catch(function () { list.textContent=''; var li=el('li',{'class':'prog'}); li.appendChild(el('h3',{},'Course catalogue temporarily unavailable')); var note=el('div',{'class':'levels'},'Please return later or contact admissions.'); li.appendChild(note); list.appendChild(li); });
  })();

  /* ---------- Gallery: five-card focus carousel backed by published Supabase gallery_items ---------- */
  (function gallery() {
    var stage = $('#gal-grid'), tabs = $('#gal-tabs'), stateEl = $('#gal-state');
    var controls = $('#gal-controls'), playBtn = $('#gal-play'), prevBtn = $('#gal-prev'), nextBtn = $('#gal-next');
    var posEl = $('#gal-position'), capEl = $('#gal-caption'), dlg = $('#lightbox');
    if (!stage || !controls) return;
    var CATS = [['training', 'Training'], ['projects', 'Projects'], ['graduation', 'Graduation'], ['events', 'Events'], ['other', 'Other']];
    var CACHE = 'ahct_gallery_student_v1', all = [], view = [], filter = 'all', active = 0;
    var signature = '', lastFetch = 0, pending = null, nodes = new Map(), lastTrigger = null;
    var reduced = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var paused = reduced, hovering = false, rotating = null, touchedAt = null;
    var isGoogle = function (u) { return /^https:\/\/lh3\.googleusercontent\.com\/d\/[^=?#]+$/.test(u); };
    var sized = function (u, w) { return isGoogle(u) ? u + '=w' + w : u; };
    var wrap = function (i, n) { return (i % n + n) % n; };

    function updatePlay() {
      playBtn.textContent = paused ? 'Play slideshow' : 'Pause slideshow';
      playBtn.setAttribute('aria-label', paused ? 'Start automatic slideshow' : 'Pause automatic slideshow');
      playBtn.setAttribute('aria-pressed', String(!paused));
      playBtn.disabled = view.length < 2;
    }
    function setState(msg, retry) {
      stateEl.hidden = false; stateEl.textContent = '';
      stateEl.appendChild(el('span', {}, msg));
      if (retry) { var b = el('button', { type: 'button', 'class': 'btn' }, 'Retry'); b.addEventListener('click', function () { setState('Loading photographs…'); refresh(true); }); stateEl.appendChild(b); }
      stage.hidden = controls.hidden = tabs.hidden = true; capEl.textContent = '';
    }
    function applyFilter() {
      view = all.filter(function (g) { return !g.broken && (filter === 'all' || g.category === filter); });
      view.sort(function (a, b) { return (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || a.sort_order - b.sort_order; });
      active = view.length ? wrap(active, view.length) : 0;
    }
    function buildTabs() {
      var present = CATS.filter(function (c) { return all.some(function (g) { return !g.broken && g.category === c[0]; }); });
      tabs.textContent = '';
      if (present.length < 2) { tabs.hidden = true; return; }
      [['all', 'All']].concat(present).forEach(function (c) {
        var b = el('button', { type: 'button', 'class': 'gal-tab', 'aria-pressed': String(filter === c[0]) }, c[1]);
        b.addEventListener('click', function () { filter = c[0]; active = 0; nodes.clear(); stage.textContent = ''; render(); });
        tabs.appendChild(b);
      });
      tabs.hidden = false;
    }
    function makeCard(g, index, offset) {
      var b = el('button', { type: 'button', 'class': 'gal-item', 'data-photo': String(g.id),
        'aria-label': 'View photograph: ' + (g.alt_text || g.caption || ('Photograph ' + (index + 1))) });
      var img = el('img', { alt: g.alt_text || g.caption || 'AH Consult Ltd photograph', loading: 'lazy',
        decoding: 'async', width: '960', height: '640' });
      var retried = false;
      img.addEventListener('error', function () {
        if (!retried && isGoogle(g.image_url)) { retried = true; img.removeAttribute('srcset'); img.src = g.image_url; return; }
        g.broken = true;
        nodes.delete(String(g.id));
        b.remove();
        applyFilter(); if (active >= view.length) active = 0; render();
      });
      img.src = sized(g.image_url, Math.abs(offset) <= 1 ? 1000 : 560);
      b.appendChild(img);
      b.addEventListener('click', function () {
        var currentIndex = view.findIndex(function (item) { return item.id === g.id; });
        if (currentIndex < 0) return;
        if (currentIndex === active) { lastTrigger = b; openLb(active); }
        else { paused = true; updatePlay(); active = currentIndex; drawSlides(); }
      });
      return b;
    }
    function drawSlides() {
      if (!view.length) return;
      var desired = new Map();
      [-3, -2, -1, 0, 1, 2, 3].forEach(function (offset) {
        // On Next, the photo just viewed moves right into a blurred position.
        var index = wrap(active - offset, view.length), g = view[index], key = String(g.id);
        // With fewer than seven photographs, don't duplicate the same accessible image/button.
        if (!desired.has(key) || Math.abs(offset) < Math.abs(desired.get(key).offset)) desired.set(key, { g: g, index: index, offset: offset });
      });
      nodes.forEach(function (node, key) {
        if (!desired.has(key)) {
          node.setAttribute('data-offset', Number(node.getAttribute('data-offset')) < 0 ? '-3' : '3');
          node.setAttribute('aria-hidden', 'true'); node.tabIndex = -1;
          node.classList.add('gal-departing');
          setTimeout(function () { if (node.classList.contains('gal-departing') && node.parentNode) { node.remove(); nodes.delete(key); } }, reduced ? 0 : 600);
        }
      });
      desired.forEach(function (item, key) {
        var node = nodes.get(key), entering = !node;
        if (!node) {
          node = makeCard(item.g, item.index, item.offset);
          node.setAttribute('data-offset', item.offset < 0 ? '-3' : '3');
          stage.appendChild(node); nodes.set(key, node);
        }
        node.classList.remove('gal-departing');
        node.setAttribute('aria-hidden', String(item.offset !== 0));
        node.tabIndex = item.offset === 0 ? 0 : -1;
        node.classList.toggle('is-current', item.offset === 0);
        // Move the existing image node instead of rebuilding it; CSS animates into the next slot.
        var target = function () { node.setAttribute('data-offset', String(item.offset)); };
        if (entering && window.requestAnimationFrame && !reduced) window.requestAnimationFrame(target);
        else target();
        if (item.offset === 0 && isGoogle(item.g.image_url)) {
          var img = node.querySelector('img');
          if (img && img.src !== sized(item.g.image_url, 1200) && !img.dataset.full) { img.src = sized(item.g.image_url, 1200); img.dataset.full = '1'; }
        }
      });
      posEl.setAttribute('aria-live', paused ? 'polite' : 'off');
      posEl.textContent = (active + 1) + ' of ' + view.length;
      capEl.setAttribute('aria-live', paused ? 'polite' : 'off');
      capEl.textContent = view[active].caption || view[active].alt_text || '';
      prevBtn.disabled = nextBtn.disabled = view.length < 2;
      updatePlay();
    }
    function render() {
      applyFilter(); buildTabs();
      if (!view.length) { nodes.clear(); stage.textContent = ''; setState(all.length ? 'No photographs in this category yet.' : 'New photographs are coming soon.'); if (all.length) tabs.hidden = false; return; }
      stage.hidden = controls.hidden = stateEl.hidden = false;
      stateEl.hidden = true;
      drawSlides();
    }
    function move(n) { if (view.length < 2) return; active = wrap(active + n, view.length); drawSlides(); }
    prevBtn.addEventListener('click', function () { move(-1); });
    nextBtn.addEventListener('click', function () { move(1); });
    playBtn.addEventListener('click', function () { paused = !paused; updatePlay(); });
    stage.addEventListener('mouseenter', function () { hovering = true; });
    stage.addEventListener('mouseleave', function () { hovering = false; });
    controls.addEventListener('mouseenter', function () { hovering = true; });
    controls.addEventListener('mouseleave', function () { hovering = false; });
    stage.addEventListener('focusin', function () { paused = true; updatePlay(); });
    controls.addEventListener('focusin', function () { paused = true; updatePlay(); });
    stage.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); move(e.key === 'ArrowRight' ? 1 : -1); }
    });
    stage.addEventListener('touchstart', function (e) { touchedAt = e.changedTouches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (touchedAt == null) return;
      var delta = e.changedTouches[0].clientX - touchedAt; touchedAt = null;
      if (Math.abs(delta) > 45) { paused = true; updatePlay(); move(delta < 0 ? 1 : -1); }
    }, { passive: true });
    rotating = setInterval(function () { if (!paused && !hovering && !document.hidden && (!dlg || !dlg.open)) move(1); }, 7200);

    /* Fullscreen viewer remains available; the center card opens it. */
    var cur = 0;
    function show(i) {
      if (!view.length) return;
      cur = wrap(i, view.length);
      var g = view[cur], img = $('#lb-img');
      img.alt = g.alt_text || g.caption || 'AH Consult Ltd photograph';
      img.src = sized(g.image_url, 1600);
      img.onerror = function () { img.onerror = null; img.src = g.image_url; };
      $('#lb-cap').textContent = g.caption || '';
      $('#lb-count').textContent = (cur + 1) + ' / ' + view.length;
      [1, -1].forEach(function (d) { var n = view[wrap(cur + d, view.length)]; if (n && typeof Image !== 'undefined') new Image().src = sized(n.image_url, 1200); });
      $('#lb-prev').disabled = $('#lb-next').disabled = view.length < 2;
    }
    function openLb(i) {
      if (!dlg) return;
      paused = true; updatePlay(); show(i);
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
      dlg.addEventListener('close', function () { if (view.length) { active = cur; drawSlides(); } if (lastTrigger && lastTrigger.isConnected) lastTrigger.focus(); if (pending) { var p = pending; pending = null; ingest(p); } });
    }

    /* Cache-first published data; retain existing polling and Realtime synchronization. */
    function ingest(rows) {
      var sig = JSON.stringify(rows.map(function (r) { return [r.id, r.image_url, r.caption, r.alt_text, r.category, r.featured, r.sort_order]; }));
      if (sig === signature) return;
      if (dlg && dlg.open) { pending = rows; return; }
      signature = sig; all = rows.filter(function (r) { return !stage.dataset.scope || stage.dataset.scope !== 'student' || ['training','graduation','events'].includes(r.category); }).map(function (r) { r.broken = false; return r; });
      nodes.clear(); stage.textContent = ''; active = 0; render();
    }
    function refresh(manual) {
      lastFetch = Date.now();
      return rest('gallery_items?select=id,image_url,caption,alt_text,category,featured,sort_order&status=eq.published&category=in.(training,graduation,events)&order=sort_order.asc,created_at.asc&limit=200')
        .then(function (rows) {
          try { localStorage.setItem(CACHE, JSON.stringify({ t: Date.now(), rows: rows })); } catch (e) { /* private mode */ }
          if (!rows.length) { signature = '[]'; all = []; nodes.clear(); stage.textContent = ''; setState('New photographs are coming soon.'); return; }
          ingest(rows);
        }).catch(function () { if (!all.length) setState('Photographs could not be loaded right now.', true); else if (manual) setState('Photographs could not be refreshed.', true); });
    }
    try { var c = JSON.parse(localStorage.getItem(CACHE) || 'null'); if (c && c.rows && c.rows.length) ingest(c.rows); } catch (e) { /* ignore */ }
    refresh();
    setInterval(function () { if (!document.hidden) refresh(); }, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden && Date.now() - lastFetch > 30000) refresh(); });
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
