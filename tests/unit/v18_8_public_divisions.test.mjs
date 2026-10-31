import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend');
const read = (name) => readFileSync(path.join(ROOT, name), 'utf8');
const corporate = ['index.html','services-architecture.html','services-construction.html','services-interior.html','services-consultancy.html'];
const hub = read('student-hub.html');
const hrefs = (html) => [...html.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map(m=>m[1]);
for (const name of corporate) {
  const html = read(name), links = hrefs(html);
  assert.ok(!links.some(l => /^(apply|staff-login|student-login)\.html/.test(l)), `${name} must not skip the Student Hub for an educational portal`);
  assert.ok(links.includes('student-hub.html'), `${name} links to Student Hub`);
  assert.ok(html.includes('index.html#services'), `${name} links to professional services`);
  assert.ok(!/<script[^>]+src="https?:/.test(html), `${name} does not load third-party script`);
  assert.ok(!/\son[a-z]+="/i.test(html), `${name} has no inline event handlers`);
}
assert.ok(read('index.html').includes('class="journey-choices"'));
assert.ok(read('index.html').includes('FOR CLIENTS AND PROJECTS'));
assert.ok(read('index.html').includes('FOR LEARNERS AND APPLICANTS'));
const hubLinks = hrefs(hub);
for (const href of ['apply.html', 'apply.html#signin', 'staff-login.html'])
  assert.ok(hubLinks.includes(href), `Student Hub provides ${href}`);
assert.ok(hub.includes('id="portal-access"'));
assert.equal((hub.match(/class="portal-entry"/g) || []).length, 3);
assert.ok(hub.includes('id="programs-list"'), 'Governed course catalogue still on Student Hub');
assert.ok(hub.includes('id="gal-grid"'), 'Published gallery still on Student Hub');
const routes = JSON.parse(read('vercel.json'));
for (const route of ['/student-hub', '/services/architecture','/services/construction','/services/interior-design','/services/consultancy'])
  assert.ok(routes.rewrites.some(r=>r.source===route), `${route} has a rewrite`);
for (const name of [...corporate,'student-hub.html']) {
 const html=read(name);
 for (const href of hrefs(html)) {
   if (/^(https?:|mailto:|tel:|#)/.test(href)) continue;
   const relative = href.split(/[?#]/)[0];
   if (relative.endsWith('.html')) assert.ok(existsSync(path.join(ROOT,relative)), `${name}: ${href} exists`);
 }
}
assert.ok(read('css/home.css').includes('--content-max: 1240px'), 'Corporate and Student Hub retain global content width');
assert.ok(read('js/home.js').includes('workflow_status=eq.published'), 'Only published courses enter Student Hub');
assert.ok(read('js/home.js').includes('status=eq.published'), 'Only published gallery items enter Student Hub');
console.log('PASS  Public division split and corporate-to-Student-Hub navigation, 6 pages and all authorized destinations');
