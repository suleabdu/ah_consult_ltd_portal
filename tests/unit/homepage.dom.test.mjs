// DOM test of the real frontend/student-hub.html + js/home.js (jsdom, simulated network). No browser or Supabase required.
import { readFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const ROOT = new URL('../../frontend/', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const html = read('student-hub.html'), corporateHtml = read('index.html'), homeJs = read('js/home.js');
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const PHOTOS = Array.from({ length: 12 }, (_, i) => ({
  id: 'g' + i, image_url: 'https://img.example/p' + i + '.jpg', caption: i % 3 === 0 ? 'Caption ' + i : '', alt_text: i === 1 ? 'Alt text one' : '',
  category: ['graduation', 'training', 'events'][i % 3], featured: i < 4, sort_order: i,
}));
const COURSES = [['AutoCAD', 'Professional'], ['AutoCAD', 'Beginner'], ['AutoCAD', 'Intermediate'], ['Revit', 'Beginner'], ['Lumion/Animation', 'Beginner']].map(([name, category]) => ({ name, category }));

function boot(routes) {
  const dom = new JSDOM(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g, (m) => (m.includes('ld+json') ? m : '')), { runScripts: 'outside-only', url: 'https://hub.example.test/', pretendToBeVisual: true });
  const w = dom.window, calls = [], opened = [];
  w.APPLY_CONFIG = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon' };
  w.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', headers: opts.headers || {} });
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    const r = key ? await (typeof routes[key] === 'function' ? routes[key](url, opts) : routes[key]) : { status: 404, body: [] };
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body };
  };
  w.open = (...a) => { opened.push(a); };
  const dlg = w.document.getElementById('lightbox');
  dlg.showModal = function () { this.setAttribute('open', ''); };
  dlg.close = function () { this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
  Object.defineProperty(dlg, 'open', { get() { return this.hasAttribute('open'); } });
  w.eval(homeJs);
  return { w, d: w.document, calls, opened };
}
const $ = (d, s) => d.querySelector(s), $$ = (d, s) => [...d.querySelectorAll(s)];

/* ---------- static structure, links and accessibility ---------- */
{
  const d = new JSDOM(html).window.document;
  ok('exactly one <h1>', $$(d, 'h1').length === 1);
  ok('document language set', d.documentElement.lang === 'en');
  ok('all images have alt text', $$(d, 'img').every((i) => i.hasAttribute('alt')));
  ok('original logo present (data-slot=logo, theme-controllable)', !!$(d, 'header img[data-slot=logo][src*="1Qp_nbC6oekgdzjJqGBHwHw125t1ABYUf"]'));
  ok('no student names, marks or grades on the public page', !/Abbass|Bajama|Grade:|\/100|Examination Record/i.test(html));
  const hrefs = $$(d, 'a[href]').map((a) => a.getAttribute('href'));
  for (const h of ['apply.html', 'apply.html#signin', 'staff-login.html']) ok('link to ' + h + ' present', hrefs.includes(h));
  ok('all local page links exist on disk', hrefs.filter((h) => /\.html(\?|$)/.test(h)).every((h) => existsSync(new URL(h.split('?')[0], ROOT))));
  ok('all in-page anchors resolve', hrefs.filter((h) => h.startsWith('#') && h.length > 1).every((h) => d.getElementById(h.slice(1))));
  ok('skip link target exists', !!d.getElementById('main'));
  ok('Student Hub landing page owns academic catalogue', !!$(d,'#training #programs-list'));
  ok('Student Hub training image remains theme-manageable', !!$(d, 'img[data-slot=training]'));
  ok('student contact details preserved', hrefs.includes('mailto:ahconsultltd02@gmail.com') && hrefs.some((h)=>h.startsWith('https://wa.me/')));
  ok('student hub has a clear return path to corporate services', hrefs.includes('index.html'));
  ok('portal access has application, student and staff entry points', ['apply.html', 'apply.html#signin', 'staff-login.html'].every(h => $$(d, '#portal-access a[href]').some(a => a.getAttribute('href') === h)));
  ok('every form control has a label', $$(d, '#consultForm input, #consultForm select, #consultForm textarea').every((c) => d.querySelector('label[for="' + c.id + '"]')));
  ok('mobile menu button is labelled and wired', $(d, '#menuBtn').getAttribute('aria-controls') === 'siteMenu' && $(d, '#menuBtn').getAttribute('aria-expanded') === 'false');
  ok('social + SEO metadata present', ['og:title', 'og:image', 'og:description'].every((p) => $(d, `meta[property="${p}"]`)) && !!$(d, 'meta[name=description]') && !!$(d, 'meta[name="twitter:card"]') && !!$(d, 'link[rel=icon]'));
  ok('unpublished static course listings are not fabricated', $$(d, '#programs-list .prog').length === 1 && /Loading approved courses/.test($(d,'#programs-list').textContent));
  ok('no inline event handlers (CSP-friendly)', !/\son[a-z]+="/i.test(html));
  ok('no third-party scripts on the page', !/<script[^>]+src="https?:/i.test(html));
}


/* ---------- corporate landing navigation / service separation ---------- */
{
 const d = new JSDOM(corporateHtml).window.document;
 const corporateHrefs = $$(d, 'a[href]').map(a=>a.getAttribute('href'));
 ok('corporate homepage has only one h1', $$(d, 'h1').length === 1);
 ok('corporate homepage offers professional and learning paths immediately', $$(d,'.corporate-hero .journey-choice').length === 1 && !!$(d,'.corporate-hero .hero-media .hero-hub-card[href="student-hub.html"]') && corporateHrefs.includes('student-hub.html') && corporateHrefs.includes('#services'));
 ok('corporate homepage contains no direct apply or login links', !corporateHrefs.some(h=>/^(apply|student-login|staff-login)\.html/.test(h)));
 ok('corporate homepage retains professional-service enquiry', !!$(d,'#consultForm'));
 ok('corporate homepage retains four focused service pages', $$(d,'.corp-card a[href^=services-]').length === 4);
}

/* ---------- Learning Impact ---------- */
{
  const { d, calls } = boot({ 'rpc/public_impact_stats': { body: { learners_enrolled: null, graduates: null, programmes: 6, active_intakes: 1, as_of: 'x' } } });
  await tick();
  ok('impact: only reliable figures are shown (2 of 4)', $$(d, '#impact .metric').length === 2 && !d.getElementById('impact').hidden);
  ok('impact: omitted figures (and their footnotes) do not appear', !/Learners enrolled|Graduates/i.test($(d, '#impact').textContent));
  ok('impact: uses POST rpc with the public key only', calls.some((c) => c.url.endsWith('/rpc/public_impact_stats') && c.method === 'POST' && c.headers.apikey === 'anon'));
  ok('impact: never touches student tables', !calls.some((c) => /applications|exam_results|profiles|document_jobs|student/.test(c.url)));
}
{
  const { d } = boot({ 'rpc/public_impact_stats': { body: { learners_enrolled: 1240, graduates: 310, programmes: 6, active_intakes: 2 } } });
  await tick();
  const nums = $$(d, '#impact .metric b').map((b) => b.textContent);
  ok('impact: 4 figures, formatted', nums.length === 4 && nums[0] === '1,240');
}
{
  const { d } = boot({ 'rpc/public_impact_stats': { body: { learners_enrolled: null, graduates: null, programmes: null, active_intakes: null } } });
  await tick(); ok('impact: section hidden when nothing can be stated', d.getElementById('impact').hidden === true);
}
{
  let fail = true;
  const { d } = boot({ 'rpc/public_impact_stats': () => (fail ? { status: 500, body: {} } : { body: { programmes: 6 } }) });
  await tick();
  ok('impact: error state with Retry', /temporarily unavailable/.test($(d, '#impact').textContent) && !!$(d, '#impact-body button'));
  fail = false; $(d, '#impact-body button').click(); await tick();
  ok('impact: Retry recovers', $$(d, '#impact .metric').length === 1);
}

/* ---------- Programmes ---------- */
{
  const { d } = boot({ 'courses?select': { body: COURSES } });
  await tick();
  const rows = $$(d, '#programs-list .prog');
  ok('programmes: built from approved database catalogue only', rows.map((r) => r.querySelector('h3').textContent).join('|') === 'AutoCAD|Lumion/Animation|Revit');
  ok('programmes: levels sorted Beginner < Intermediate < Professional', $$(rows[0], '.chip').map((c) => c.textContent).join('|') === 'Beginner|Intermediate|Professional');
  const u = new URL($$(rows[0], '.chip')[1].getAttribute('href'), 'https://x.test/');
  ok('programmes: deep link carries course + level', u.pathname === '/apply.html' && u.searchParams.get('course') === 'AutoCAD' && u.searchParams.get('category') === 'Intermediate');
  const l = new URL($$(rows[1], '.chip')[0].getAttribute('href'), 'https://x.test/');
  ok('programmes: slash in names is URL-encoded safely', l.searchParams.get('course') === 'Lumion/Animation');
}
{
  const { d } = boot({ 'courses?select': { status: 500, body: {} } });
  await tick(); ok('programmes: outage has an explicit unavailable message', /temporarily unavailable/.test($(d,'#programs-list').textContent));
}

/* ---------- Gallery ---------- */
{
  const { d, w, calls } = boot({ 'gallery_items?select': { body: PHOTOS } });
  await tick();
  ok('gallery: requests only status=eq.published', calls.some((c) => c.url.includes('gallery_items') && c.url.includes('status=eq.published')));
  ok('gallery: at most seven image nodes (five visible plus two buffered)', $$(d, '#gal-grid .gal-item').length <= 7 && $$(d, '#gal-grid .gal-item').length >= 5);
  ok('gallery: one sharp center and four soft neighbouring positions', $$(d, '#gal-grid .gal-item[data-offset="0"]').length === 1 && [-2,-1,1,2].every((n) => !!$(d, '#gal-grid .gal-item[data-offset="' + n + '"]')));
  ok('gallery: category tabs built from published photos', $$(d, '#gal-tabs .gal-tab').map((b) => b.textContent).join('|') === 'All|Training|Graduation|Events');
  ok('gallery: images lazy-load with explicit size', $$(d, '#gal-grid img').every((i) => i.getAttribute('loading') === 'lazy' && i.getAttribute('width') && i.getAttribute('height')));
  ok('gallery: alt text falls back caption -> default', $$(d, '#gal-grid img').every((i) => i.alt.length > 0));
  ok('gallery: counter and controls provided', $(d, '#gal-position').textContent === '1 of 12' && !!$(d, '#gal-play') && !!$(d, '#gal-next') && !!$(d, '#gal-prev'));
  $(d, '#gal-next').click(); ok('gallery: Next moves center image', $(d, '#gal-position').textContent === '2 of 12' && !!$(d, '#gal-grid .gal-item.is-current'));
  $(d, '#gal-prev').click(); ok('gallery: Previous restores original image', $(d, '#gal-position').textContent === '1 of 12');
  $(d, '#gal-play').click(); ok('gallery: slideshow pause control works', $(d, '#gal-play').getAttribute('aria-pressed') === 'false');
  $$(d, '#gal-tabs .gal-tab')[1].click();
  ok('gallery: filter by category (aria-pressed updates)', $$(d, '#gal-grid .gal-item').length === 4 && $$(d, '#gal-tabs .gal-tab')[1].getAttribute('aria-pressed') === 'true' && $$(d, '#gal-tabs .gal-tab')[0].getAttribute('aria-pressed') === 'false');
  $$(d, '#gal-tabs .gal-tab')[0].click();

  // viewer
  const dlg = d.getElementById('lightbox'), tiles = () => $$(d, '#gal-grid .gal-item');
  $(d, '#gal-grid .is-current').click();
  ok('viewer: opens with counter, image and caption', dlg.open && /^1 \/ 12$/.test($(d, '#lb-count').textContent) && $(d, '#lb-img').src.includes('img.example'));
  const key = (k) => dlg.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
  key('ArrowRight'); ok('viewer: ArrowRight goes forward', /^2 \/ 12$/.test($(d, '#lb-count').textContent));
  key('ArrowLeft'); key('ArrowLeft'); ok('viewer: ArrowLeft wraps to the last photo', /^12 \/ 12$/.test($(d, '#lb-count').textContent));
  $(d, '#lb-next').click(); ok('viewer: Next button wraps to the first', /^1 \/ 12$/.test($(d, '#lb-count').textContent));
  ok('viewer: controls are labelled', !!$(d, '#lb-prev[aria-label]') && !!$(d, '#lb-next[aria-label]') && $(d, '#lb-close').textContent === 'Close');
  $(d, '#lb-close').click(); ok('viewer: Close button closes', !dlg.open);

  // broken image handling
  const before = tiles().length; const img = $(d, '#gal-grid .is-current img');
  img.dispatchEvent(new w.Event('error'));   // resized variant (not applicable here) -> tile is dropped
  ok('gallery: an unavailable image is excluded from the current slideshow', $(d, '#gal-position').textContent.endsWith('of 11') && !tiles().some((n) => n.getAttribute('data-photo') === 'g0'));
}
{
  const { d } = boot({ 'gallery_items?select': { body: [] } }); await tick();
  ok('gallery: empty state message', /coming soon/.test($(d, '#gal-state').textContent) && $(d, '#gal-grid').hidden);
}
{
  let down = true;
  const { d } = boot({ 'gallery_items?select': () => (down ? { status: 500, body: {} } : { body: PHOTOS.slice(0, 3) }) }); await tick();
  ok('gallery: error state offers Retry', /could not be loaded/.test($(d, '#gal-state').textContent) && !!$(d, '#gal-state button'));
  down = false; $(d, '#gal-state button').click(); await tick(60);
  ok('gallery: Retry recovers and renders', $$(d, '#gal-grid .gal-item').length === 3);
}
{
  const only = [PHOTOS[0], PHOTOS[3]];   // same category -> no tab bar needed
  const { d } = boot({ 'gallery_items?select': { body: only } }); await tick();
  ok('gallery: a single category shows no filter bar', $(d, '#gal-tabs').hidden === true);
}

/* ---------- Consultation form, menu ---------- */
{
  const { d, w, opened } = boot({});
  $(d, '#consultForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  ok('consult: empty form shows an accessible error and does not open WhatsApp', !$(d, '#cErr').hidden && $(d, '#cErr').getAttribute('role') === 'alert' && opened.length === 0);
  $(d, '#cName').value = 'Amina Yusuf'; $(d, '#cPhone').value = '08012345678'; $(d, '#cSvc').value = 'Professional Training'; $(d, '#cMsg').value = 'Need a course';
  $(d, '#consultForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  const url = opened[0]?.[0] ?? '';
  ok('consult: opens WhatsApp to the existing number with the message', url.startsWith('https://wa.me/2348037155105?text=') && decodeURIComponent(url).includes('Amina Yusuf') && decodeURIComponent(url).includes('Professional Training') && opened[0][2] === 'noopener');
  $(d, '#cSvc').value = '';
  ok('consult: category placeholder is not a selectable service', $(d, '#cSvc').querySelector('option[value=""]').disabled);
  const b = $(d, '#menuBtn'), nav = $(d, '#siteMenu');
  b.click(); ok('menu: opens (aria-expanded=true)', nav.classList.contains('open') && b.getAttribute('aria-expanded') === 'true');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); ok('menu: Escape closes it', !nav.classList.contains('open') && b.getAttribute('aria-expanded') === 'false');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
