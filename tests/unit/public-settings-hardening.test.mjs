import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const theme = read('../../frontend/js/theme.js');
const migration = read('../../supabase/migrations/045_public_settings_least_privilege.sql');

assert.match(theme, /SAFE_FONTS/, 'Public theme settings must use a fixed font allow-list.');
assert.match(theme, /function publicUrl\(value\)/, 'Public image URLs must be validated before use.');
assert.match(theme, /key=in\.\(branding,theme,images,location,gallery\)/, 'Browser should request only public setting keys.');
assert.doesNotMatch(theme, /site_settings\?select=key,value["']/, 'Browser must not request every site-setting row.');
assert.match(migration, /create policy ss_public_read on public\.site_settings for select to anon/, 'Anonymous setting read policy must be explicit.');
assert.match(migration, /array\['branding', 'theme', 'images', 'location', 'gallery'\]/, 'Anonymous policy must be a public-key allow-list.');
assert.match(migration, /or public\.is_admin\(\)/, 'Administrators must retain access to operational settings.');
assert.match(migration, /create policy ss_write on public\.site_settings for all to authenticated/, 'Write policy must not apply to anonymous users.');
console.log('PASS public settings least-privilege regression guards');
