/* Generate public browser configuration at deploy time. Do not commit generated values. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(root,'scripts/templates/public-config.template.js'),'utf8');
function validPublic(label,url,key){
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url||'')) throw Error(`${label}: expected a Supabase HTTPS project URL`);
  const parts = String(key||'').split('.');
  if(parts.length!==3) throw Error(`${label}: expected Supabase public anon JWT`);
  let data;
  try { data=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8')); }catch {throw Error(`${label}: invalid JWT payload`);}
  if (data.role !== 'anon') throw Error(`${label}: only the public anon key is permitted, never a privileged key`);
  return {url,key};
}
const pub=validPublic('Production / deploy',process.env.AHCT_SUPABASE_URL,process.env.AHCT_SUPABASE_ANON_KEY);
const stage=(process.env.AHCT_STAGING_URL || process.env.AHCT_STAGING_ANON_KEY)
  ? validPublic('Local staging',process.env.AHCT_STAGING_URL,process.env.AHCT_STAGING_ANON_KEY) : null;
const quoted=(v)=>JSON.stringify(v);
let out=src.replace("SUPABASE_URL: 'https://unconfigured.invalid'",'SUPABASE_URL: '+quoted(pub.url))
  .replace("SUPABASE_ANON_KEY: 'PUBLIC_ANON_KEY_NOT_CONFIGURED'",'SUPABASE_ANON_KEY: '+quoted(pub.key))
  .replace('const LOCAL = null;',stage ? 'const LOCAL = { SUPABASE_URL: '+quoted(stage.url)+', SUPABASE_ANON_KEY: '+quoted(stage.key)+' };' : 'const LOCAL = null;');
if(out===src)throw Error('Template replacement failed');
writeFileSync(resolve(root,'frontend/js/config.js'),out);
console.log('Frontend configured with public anon credentials (values intentionally not printed).');
