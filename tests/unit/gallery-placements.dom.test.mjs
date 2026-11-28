import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
const script = readFileSync(new URL('../../frontend/js/gallery-placements.js', import.meta.url), 'utf8');
async function render(path, bodyClass, rows) {
  const dom = new JSDOM(`<body class="${bodyClass}"><main></main></body>`, { url: `https://example.org/${path}`, runScripts: 'outside-only' });
  dom.window.APPLY_CONFIG = { SUPABASE_URL:'https://project.supabase.co', SUPABASE_ANON_KEY:'public' };
  let requested = '';
  dom.window.fetch = async (url) => { requested=url; return { ok:true, json:async()=>rows }; };
  dom.window.eval(script);
  await new Promise(resolve => setTimeout(resolve, 20));
  return { document: dom.window.document, requested };
}
let page = await render('services-interior.html', 'service-page', [{image_url:'https://project.supabase.co/photo.jpg',caption:'<b>Studio</b>',alt_text:'A studio'}]);
assert.match(page.requested, /status=eq\.published/);
assert.match(page.requested, /display_locations=cs\.%7Bservices%7D/);
assert.equal(page.document.querySelector('.placement-gallery img').alt, 'A studio');
assert.equal(page.document.querySelector('figcaption').textContent, '<b>Studio</b>');
assert.equal(page.document.querySelector('figcaption b'), null);
page = await render('recruitment.html', '', [{image_url:'javascript:alert(1)',caption:'bad'}]);
assert.match(page.requested, /display_locations=cs\.%7Brecruitment%7D/);
assert.equal(page.document.querySelector('.placement-gallery'), null);
page = await render('recruitment.html', '', []);
assert.equal(page.document.querySelector('.placement-gallery'), null);
console.log('Gallery placements: public page selection, safety and empty state passed');
