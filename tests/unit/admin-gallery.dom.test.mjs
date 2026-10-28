// Tests the gallery manager embedded in frontend/admin-dashboard.html against an in-memory fake of the gallery_items table.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const src = readFileSync(new URL('../../frontend/js/pages/admin-dashboard.js', import.meta.url), 'utf8');
const a = src.indexOf('async function galleryManager(M){'), endMark = 'await load();\n }';
const fnSrc = src.slice(a, src.indexOf(endMark, a) + endMark.length);
if (!fnSrc.startsWith('async function galleryManager')) throw new Error('galleryManager not found');

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function setup(rows, { denyWrites = false } = {}) {
  const dom = new JSDOM('<div id="m"><div id="galMgr"></div></div>', { pretendToBeVisual: true }), w = dom.window, d = w.document;
  const db = rows.map((r) => ({ ...r })), log = [], toasts = [], uploads = [];
  let seq = 100;
  const ordered = () => [...db].sort((x, y) => x.sort_order - y.sort_order);
  const q = (rowsFn) => { const o = { _eq: null, order() { return o; }, eq(_c, v) { o._eq = v; return o; }, select() { return o; }, single() { return o; }, then(res) { return Promise.resolve(rowsFn(o)).then(res); } }; return o; };
  const sb = { from: () => ({
    select: () => q(() => ({ data: ordered(), error: null })),
    update: (patch) => q((o) => { log.push(['update', o._eq, patch]); if (denyWrites) return { data: null, error: { message: 'new row violates row-level security policy' } }; const r = db.find((x) => x.id === o._eq); Object.assign(r, patch); return { data: { ...r }, error: null }; }),
    insert: (row) => q(() => { log.push(['insert', row]); if (denyWrites) return { data: null, error: { message: 'permission denied' } }; const r = { id: 'n' + seq++, caption: '', alt_text: '', featured: false, ...row }; db.push(r); return { data: { ...r }, error: null }; }),
    delete: () => q((o) => { log.push(['delete', o._eq]); const i = db.findIndex((x) => x.id === o._eq); if (i >= 0) db.splice(i, 1); return { error: null }; }),
  }) };
  const env = { sb, esc: (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])), toast: (m, e) => toasts.push([m, !!e]), uploadAsset: async (_f, file) => { uploads.push(file.name); return 'https://cdn.example/' + file.name; }, confirm: () => env._confirm, _confirm: true };
  const run = new Function('document', 'sb', 'esc', 'toast', 'uploadAsset', 'confirm', fnSrc + '; return galleryManager;')(d, sb, env.esc, env.toast, env.uploadAsset, () => env._confirm);
  return { d, w, db, log, toasts, env, start: () => run(d.getElementById('m')) };
}
const base = [
  { id: 'a', image_url: 'https://x/a.jpg', caption: 'A', category: 'training', status: 'published', featured: true, sort_order: 10, alt_text: '' },
  { id: 'b', image_url: 'https://x/b.jpg', caption: 'B', category: 'events', status: 'draft', featured: false, sort_order: 20, alt_text: '' },
  { id: 'c', image_url: 'https://x/c.jpg', caption: 'C', category: 'projects', status: 'archived', featured: false, sort_order: 30, alt_text: '' },
];
const cards = (d) => [...d.querySelectorAll('#galList [data-id]')];
const fire = (w, el, type = 'change') => el.dispatchEvent(new w.Event(type, { bubbles: true }));

{ const t = setup(base); await t.start(); const { d } = t;
  ok('lists ALL photos for the administrator, including drafts and archived', cards(d).length === 3);
  ok('shows the published count', /1 published · 3 total/.test(d.getElementById('galMgr').textContent));
  ok('explains visibility per photo', /Hidden: not published yet/.test(cards(d)[1].textContent) && /Visible on the homepage/.test(cards(d)[0].textContent));
  const f = d.getElementById('galFilter'); f.value = 'draft'; fire(t.w, f); ok('filter shows only drafts', cards(d).length === 1 && cards(d)[0].dataset.id === 'b');
  const f2 = d.getElementById('galFilter'); f2.value = 'all'; fire(t.w, f2);   // the list re-rendered, so fetch the fresh control
  // publish
  const sel = cards(d)[1].querySelector('[data-f=status]'); sel.value = 'published'; fire(t.w, sel); await tick();
  ok('publishing saves status=published', t.log.some((l) => l[0] === 'update' && l[1] === 'b' && l[2].status === 'published') && t.db.find((x) => x.id === 'b').status === 'published');
  ok('count updates after publish', /2 published/.test(d.getElementById('galMgr').textContent));
  // archive / unpublish
  const s2 = cards(d)[0].querySelector('[data-f=status]'); s2.value = 'archived'; fire(t.w, s2); await tick();
  ok('unpublishing/archiving saves', t.db.find((x) => x.id === 'a').status === 'archived');
  // caption, category, featured
  const cap = cards(d)[0].querySelector('[data-f=caption]'); cap.value = '  New caption  '; fire(t.w, cap); await tick();
  ok('caption is trimmed and saved', t.db.find((x) => x.id === 'a').caption === 'New caption');
  const cat = cards(d)[0].querySelector('[data-f=category]'); cat.value = 'graduation'; fire(t.w, cat); await tick();
  ok('category saved', t.db.find((x) => x.id === 'a').category === 'graduation');
  const ft = cards(d)[0].querySelector('[data-f=featured]'); ft.checked = false; fire(t.w, ft); await tick();
  ok('featured flag saved as a boolean', t.db.find((x) => x.id === 'a').featured === false);
  // reorder
  const order0 = cards(d).map((c) => c.dataset.id).join('');
  cards(d)[0].querySelector('[data-act=down]').click(); await tick(40);
  const order1 = cards(d).map((c) => c.dataset.id).join('');
  ok('move down swaps with the next photo', order0 === 'abc' && order1 === 'bac' && t.db.find((x) => x.id === 'a').sort_order === 20 && t.db.find((x) => x.id === 'b').sort_order === 10);
  ok('first photo cannot move up, last cannot move down', cards(d)[0].querySelector('[data-act=up]').disabled && cards(d)[2].querySelector('[data-act=down]').disabled);
  // delete
  t.env._confirm = false; cards(d)[2].querySelector('[data-act=del]').click(); await tick();
  ok('delete is cancelled when the admin declines', t.db.length === 3);
  t.env._confirm = true; cards(d)[2].querySelector('[data-act=del]').click(); await tick();
  ok('delete removes the record when confirmed', t.db.length === 2 && cards(d).length === 2);
}
{ // uploads
  const t = setup(base); await t.start(); const { d, w } = t;
  const input = d.getElementById('galAdd'); Object.defineProperty(input, 'files', { value: [{ name: 'one.jpg' }, { name: 'two.jpg' }], configurable: true });
  fire(w, input); await tick(60);
  const ins = t.log.filter((l) => l[0] === 'insert').map((l) => l[1]);
  ok('uploads are saved as DRAFTS by default (never auto-published)', ins.length === 2 && ins.every((r) => r.status === 'draft' && r.category === 'other' && r.image_url.startsWith('https://cdn.example/')));
  ok('new photos go to the end of the order', ins[0].sort_order === 40 && ins[1].sort_order === 50);
  ok('uploaded drafts appear in the list', cards(d).length === 5);
  d.getElementById('galPubNow').checked = true; const input2 = d.getElementById('galAdd'); Object.defineProperty(input2, 'files', { value: [{ name: 'three.jpg' }], configurable: true }); fire(w, input2); await tick(60);   // list re-rendered: use the fresh control
  ok('"Publish immediately" publishes the upload', t.log.filter((l) => l[0] === 'insert').pop()[1].status === 'published');
}
{ // security: server refuses (RLS) -> admin sees the real message, UI stays consistent
  const t = setup(base, { denyWrites: true }); await t.start(); const { d, w } = t;
  const sel = cards(d)[1].querySelector('[data-f=status]'); sel.value = 'published'; fire(w, sel); await tick(40);
  ok('a server-side permission denial is shown to the user', t.toasts.some(([m, e]) => e && /row-level security/.test(m)));
  ok('after a denied change the list reloads to the true state (still a draft)', cards(d)[1].querySelector('[data-f=status]').value === 'draft');
}
{ // duplicate sort orders are normalised once
  const dup = base.map((r) => ({ ...r, sort_order: 10 })); const t = setup(dup); await t.start();
  const orders = t.db.map((r) => r.sort_order).sort((x, y) => x - y);
  ok('duplicate sort_order values are normalised so reordering works', new Set(orders).size === 3);
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
