/* Published, editor-selected photographs for the careers and service pages. */
(function () {
  'use strict';
  var config = window.APPLY_CONFIG || {};
  var locationName = document.body.classList.contains('service-page') ? 'services' :
    /(?:^|\/)recruitment(?:\.html)?$/.test(window.location.pathname) ? 'recruitment' : '';
  var main = document.querySelector('main'), base = String(config.SUPABASE_URL || '').replace(/\/$/, '');
  if (!locationName || !main || !base || !config.SUPABASE_ANON_KEY) return;
  function safeImage(value) {
    try { var u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; }
    catch (_) { return ''; }
  }
  var query = '/rest/v1/gallery_items?select=image_url,caption,alt_text&status=eq.published&display_locations=cs.%7B' + locationName + '%7D&order=sort_order.asc,created_at.asc&limit=12';
  fetch(base + query, { headers: { apikey: config.SUPABASE_ANON_KEY }, cache: 'no-store' })
    .then(function (response) { if (!response.ok) throw new Error('Gallery unavailable'); return response.json(); })
    .then(function (rows) {
      if (!Array.isArray(rows)) return;
      var valid = rows.filter(function (row) { return row && safeImage(row.image_url); });
      if (!valid.length) return;
      var section = document.createElement('section'), wrap = document.createElement('div'), heading = document.createElement('h2'), grid = document.createElement('div');
      section.className = 'placement-gallery'; wrap.className = 'wrap'; grid.className = 'placement-gallery-grid';
      heading.textContent = locationName === 'services' ? 'Our work in pictures' : 'Life at AH Consult';
      wrap.appendChild(heading); wrap.appendChild(grid); section.appendChild(wrap);
      valid.forEach(function (row) {
        var figure = document.createElement('figure'), img = document.createElement('img');
        img.src = safeImage(row.image_url); img.alt = String(row.alt_text || row.caption || 'AH Consult photograph'); img.loading = 'lazy'; img.decoding = 'async';
        figure.appendChild(img);
        if (row.caption) { var caption = document.createElement('figcaption'); caption.textContent = String(row.caption); figure.appendChild(caption); }
        grid.appendChild(figure);
      });
      main.appendChild(section);
    }).catch(function () { /* Keep the rest of the page usable when the gallery is unavailable. */ });
})();
