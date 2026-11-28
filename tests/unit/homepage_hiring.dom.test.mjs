// Exercise the real homepage and script against simulated vacancy responses.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = path => readFileSync(new URL('../../frontend/' + path, import.meta.url), 'utf8');
const html = read('index.html'), script = read('js/corporate.js'), css = read('css/corporate.css');
const tick = () => new Promise(resolve => setTimeout(resolve, 20));

async function checkVacancies(response, expectedOpen) {
 const dom = new JSDOM(html, { url: 'https://ah-consult.example/', runScripts: 'outside-only' });
 const { window } = dom, calls = [];
 window.APPLY_CONFIG = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'public-key' };
 window.fetch = async (url, options) => {
  calls.push({ url: String(url), options });
  if (String(url).includes('/rpc/recruitment_featured_vacancies')) {
   if (response instanceof Error) throw response;
   return { ok: response.ok, json: async () => response.body };
  }
  return { ok: true, json: async () => [] };
 };
 const entry = window.document.getElementById('hiring-entry'), notice = window.document.getElementById('hiring-notice');
 assert.ok(entry, 'homepage has a recruitment entry');
 assert.equal(entry.hidden, true, 'entry starts hidden while availability is unknown');
 window.eval(script);
 await tick();
 const links = [...window.document.querySelectorAll('#siteMenu .links a')].filter(a => a.getAttribute('href') === 'recruitment.html');
 assert.equal(entry.hidden, !expectedOpen, 'hero availability matches the open-vacancy response');
 assert.equal(links.length, 1, 'Join Us navigation is always available');
 assert.equal(links[0].textContent, 'Join Us');
 assert.equal(notice.hidden, !expectedOpen, 'hiring notice only appears for open vacancies');
 if(expectedOpen){assert.equal(notice.querySelector('.hiring-notice-heading').textContent,'Architect');assert.equal(notice.querySelector('.hiring-notice-text').textContent,'Bauchi');assert.equal(notice.querySelector('a').getAttribute('href'),'recruitment.html?job=11111111-1111-4111-8111-111111111111');notice.querySelector('button').click();assert.equal(notice.hidden,true,'hiring notice can be dismissed');}
 assert.equal(entry.getAttribute('href'), 'recruitment.html');
 const vacancyCalls = calls.filter(c => c.url.endsWith('/rpc/recruitment_featured_vacancies'));
 assert.equal(vacancyCalls.length, 1, 'one availability request controls the hiring announcement');
 assert.equal(vacancyCalls[0].options.method, 'POST');
 assert.equal(JSON.parse(vacancyCalls[0].options.body).p_surface,'homepage');
 dom.window.close();
}

assert.match(css, /\.hiring-hero-card\[hidden\]\s*\{\s*display\s*:\s*none/i, 'hidden card must remain hidden despite display styling');
await checkVacancies({ ok: true, body: [{ id: '11111111-1111-4111-8111-111111111111',title:'Architect',location:'Bauchi' }] }, true);
await checkVacancies({ ok: true, body: [] }, false);
await checkVacancies({ ok: true, body: {} }, false);
await checkVacancies({ ok: false, body: {} }, false);
await checkVacancies(new Error('Network unavailable'), false);
console.log('PASS permanent Join Us navigation and conditional dismissible hiring announcement');
