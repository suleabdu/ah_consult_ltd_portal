import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('../../frontend/', import.meta.url);
for (const name of readdirSync(root).filter(x=>x.endsWith('.html'))) {
  const page = readFileSync(new URL(name,root),'utf8');
  assert.doesNotMatch(page, /<style\b/i, `${name} still contains inline CSS blocks`);
  assert.doesNotMatch(page, /\son[a-z]+\s*=/i, `${name} still contains inline event attributes`);
  assert.doesNotMatch(page, /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i, `${name} contains inline JavaScript`);
  for (const match of page.matchAll(/(?:src|href)="((?:js|css|vendor)\/[^"?#]+)"/g)) {
    assert.ok(existsSync(new URL(match[1],root)), `missing ${name}: ${match[1]}`);
  }
}
const vercel = JSON.parse(readFileSync(new URL('vercel.json',root),'utf8'));
const csp = vercel.headers.flatMap(x=>x.headers).find(x=>x.key==='Content-Security-Policy').value;
assert.match(csp,/script-src 'self'; script-src-attr 'none'/);
assert.doesNotMatch(csp,/script-src [^;]*unsafe-inline/);
assert.ok(existsSync(new URL('css/components.css',root)));
assert.ok(existsSync(new URL('css/home.css',root)));
console.log('PASS: external-only scripts and style blocks, resolvable assets, strict script CSP');
