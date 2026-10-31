import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../../frontend/js/theme.js', import.meta.url), 'utf8');
const dom = new JSDOM('<!doctype html><head><link rel="icon" href="/favicon.ico"></head><body><img class="lg" src="/original-logo.svg"><img data-slot="hero" src="/original-hero.jpg"></body>', {
  runScripts: 'outside-only', url: 'https://panel.example/', pretendToBeVisual: true,
});
const { window } = dom;
let requested = '';
window.APPLY_CONFIG = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'public-anon-key' };
window.fetch = async (url) => {
  requested = String(url);
  return { ok: true, json: async () => [
    { key: 'theme', value: { primary: '#123456;body{display:none}', fontBody: "Roboto');body{display:none", baseSize: '999' } },
    { key: 'branding', value: { logo: 'https://untrusted.example/logo.svg', favicon: 'javascript:alert(1)' } },
    { key: 'images', value: { hero: 'https://project.supabase.co/storage/v1/object/public/site-assets/hero.jpg', auth: 'https://untrusted.example/evil.jpg' } },
    { key: 'official_website', value: 'https://private.example' },
  ] };
};
window.eval(source);
await new Promise((resolve) => setTimeout(resolve, 20));

assert.match(requested, /key=in\.\(branding,theme,images,location,gallery\)/, 'Only public setting keys are requested.');
assert.equal(window.document.querySelector('img.lg').getAttribute('src'), '/original-logo.svg', 'Untrusted logo URL is ignored.');
assert.match(window.document.querySelector('img[data-slot="hero"]').src, /^https:\/\/project\.supabase\.co\//, 'Configured Supabase media URL is accepted.');
assert.doesNotMatch(window.document.getElementById('theme-css').textContent, /display:none|999|Roboto'\)/, 'Theme CSS is built only from allow-listed values.');
assert.equal(window.SITE.official_website, undefined, 'Non-public settings are discarded client-side.');
console.log('PASS public theme settings reject untrusted CSS, URLs and keys');
