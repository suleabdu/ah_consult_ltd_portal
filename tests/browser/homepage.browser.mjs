#!/usr/bin/env node
/**
 * Real-browser check of the public homepage at desktop, tablet and mobile sizes (headless Chromium).
 * Serves ./frontend itself and SIMULATES the network (Supabase responses and Google-hosted photos are fakes; photos are
 * flat-colour placeholders), so it verifies layout and behaviour, not live data.
 *
 * One-time setup (kept out of package.json because the browser download is large):
 *     npm i --no-save @sparticuz/chromium puppeteer-core
 * Run:  node tests/browser/homepage.browser.mjs        Screenshots go to tests/browser/out/ (git-ignored).
 * Fails (exit 1) on: horizontal overflow, tap targets under 44px, missing/duplicate h1, broken viewer keyboard/focus handling.
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium, puppeteer;
try { chromium = (await import('@sparticuz/chromium')).default; puppeteer = (await import('puppeteer-core')).default; }
catch { console.error('Missing browser packages. Run:  npm i --no-save @sparticuz/chromium puppeteer-core'); process.exit(2); }

const FRONT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'frontend'), OUT = join(fileURLToPath(new URL('.', import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const p = normalize(join(FRONT, decodeURIComponent(new URL(req.url, 'http://x').pathname === '/' ? '/index.html' : new URL(req.url, 'http://x').pathname)));
  if (!p.startsWith(FRONT) || !existsSync(p)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(readFileSync(p));
}).listen(0);
const base = `http://localhost:${server.address().port}`;

const colors = ['#c9b79c', '#8a9a8c', '#b86b3a', '#6d7f94', '#a58b6f', '#7d6b5e', '#9aa7b0', '#c58f5c', '#566a5d', '#b39b86'];
const PHOTOS = colors.map((c, i) => ({ id: 'g' + i, image_url: 'https://lh3.googleusercontent.com/d/PLACEHOLDER' + i, caption: i % 2 ? '' : 'Photograph ' + (i + 1), alt_text: '', category: ['graduation', 'training', 'events', 'projects'][i % 4], featured: i < 3, sort_order: i }));
const COURSES = ['ArchiCAD', 'AutoCAD', 'Graphic Design', 'Lumion/Animation', 'Revit', 'SketchUp'].flatMap((name) => ['Beginner', 'Intermediate', 'Professional'].map((category) => ({ name, category })));
const svg = (i) => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="${colors[i % colors.length]}"/><text x="50%" y="50%" font-family="Arial" font-size="28" fill="#fff" text-anchor="middle">placeholder photo</text></svg>`;
const json = (body) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : '  -> ' + detail}`); };

for (const [name, vp] of Object.entries({ desktop: { width: 1440, height: 900 }, tablet: { width: 820, height: 1180 }, mobile: { width: 390, height: 844, isMobile: true, hasTouch: true } })) {
  console.log(`\n${name} ${vp.width}x${vp.height}`);
  const page = await browser.newPage(); await page.setViewport(vp);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/rest/v1/rpc/public_impact_stats')) return r.respond(json({ learners_enrolled: 1240, graduates: null, programmes: 6, active_intakes: 1 }));
    if (u.includes('/rest/v1/courses')) return r.respond(json(COURSES));
    if (u.includes('/rest/v1/gallery_items')) return r.respond(json(PHOTOS));
    if (u.includes('/rest/v1/site_settings')) return r.respond(json([]));
    if (u.includes('.supabase.co')) return r.abort();
    if (u.includes('lh3.googleusercontent.com')) { const m = u.match(/PLACEHOLDER(\d)/); return r.respond({ status: 200, contentType: 'image/svg+xml', body: svg(m ? +m[1] : 0) }); }
    return u.startsWith(base) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  await page.goto(base + '/index.html', { waitUntil: 'networkidle0', timeout: 60000 }); await new Promise((r) => setTimeout(r, 500));
  const m = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth, h1: document.querySelectorAll('h1').length, metrics: document.querySelectorAll('.metric').length,
    small: [...document.querySelectorAll('a.btn,button,.chip,.gal-tab,input:not([type=checkbox]),select')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && getComputedStyle(e).visibility !== 'hidden' && (b.height < 44 || b.width < 44); }).map((e) => (e.textContent || e.id).trim().slice(0, 24)),
    tiles: document.querySelectorAll('.gal-item').length, lead: document.querySelectorAll('.gal-item.feat').length, tall: document.querySelectorAll('.gal-item.tall').length,
  }));
  check('no horizontal scrolling', m.overflow <= 0, m.overflow + 'px');
  check('every tap target is at least 44x44px', m.small.length === 0, m.small.join(', '));
  check('exactly one h1', m.h1 === 1);
  check('impact figures render (database values, omitted ones absent)', m.metrics === 3);
  check('gallery: 9 tiles, one lead + two tall', m.tiles === 9 && m.lead === 1 && m.tall === 2);
  check('no uncaught script errors', pageErrors.length === 0, pageErrors.join('; '));
  for (const [sel, f] of [['#home', '01_hero'], ['#services', '02_services'], ['#programs', '04_programs'], ['#gallery', '06_gallery'], ['#consult', '08_consult']]) { await page.evaluate((s) => document.querySelector(s).scrollIntoView(), sel); await new Promise((r) => setTimeout(r, 200)); await page.screenshot({ path: join(OUT, `${name}_${f}.png`) }); }
  await page.evaluate(() => document.querySelector('#gallery').scrollIntoView()); await (await page.$('.gal-item')).click(); await new Promise((r) => setTimeout(r, 300));
  const c1 = await page.$eval('#lb-count', (e) => e.textContent); await page.keyboard.press('ArrowRight'); const c2 = await page.$eval('#lb-count', (e) => e.textContent);
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); const c3 = await page.$eval('#lb-count', (e) => e.textContent);
  await page.screenshot({ path: join(OUT, `${name}_10_viewer.png`) }); await page.keyboard.press('Escape'); await new Promise((r) => setTimeout(r, 150));
  check('viewer: opens, ArrowRight/ArrowLeft navigate and wrap', c1 === '1 / 10' && c2 === '2 / 10' && c3 === '10 / 10', [c1, c2, c3].join(' '));
  check('viewer: Escape closes and focus returns to the photo that opened it', !(await page.$eval('#lightbox', (e) => e.open)) && (await page.evaluate(() => document.activeElement.classList.contains('gal-item'))));
  if (name === 'mobile') { await page.evaluate(() => scrollTo(0, 0)); await page.tap('#menuBtn'); check('mobile menu opens (aria-expanded)', (await page.$eval('#menuBtn', (e) => e.getAttribute('aria-expanded'))) === 'true'); await page.screenshot({ path: join(OUT, 'mobile_00_menu.png') }); }
  await page.close();
}
await browser.close(); server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll browser checks passed');
process.exit(failures ? 1 : 0);
