import { readFileSync } from 'node:fs';
export function source(rel) {
  const path = new URL('../../' + rel, import.meta.url);
  const raw = readFileSync(path, 'utf8');
  if (!rel.startsWith('frontend/') || !rel.endsWith('.html')) return raw;
  const page = rel.split('/').at(-1).replace(/\.html$/, '');
  return raw + '\n' + readFileSync(new URL('../../frontend/js/pages/' + page + '.js', import.meta.url), 'utf8');
}
