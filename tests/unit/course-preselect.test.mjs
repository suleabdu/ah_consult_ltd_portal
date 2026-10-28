// Behavioural test for the homepage deep-link handler (?course=&category=) in frontend/apply.html.
// Uses the seed catalogue (supabase/seed/courses_rows.csv), so it needs no database.
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../frontend/js/pages/apply.js', import.meta.url), 'utf8');
const fnSrc = html.slice(html.indexOf('function applyCoursePref(w){'), html.indexOf('// Small helpers that were referenced'));
if (!fnSrc.startsWith('function applyCoursePref')) throw new Error('applyCoursePref not found in apply.html');

const COURSES = readFileSync(new URL('../../supabase/seed/courses_rows.csv', import.meta.url), 'utf8')
  .trim().split(/\r?\n/).slice(1)
  .map((line) => { const [code, name, category, , active] = line.split(','); return { code, name, category, is_active: active === 'true' }; })
  .filter((c) => c.is_active);

const RANK = ['beginner', 'intermediate', 'advanced', 'professional'];
const rk = (c) => { const i = RANK.indexOf(String(c).toLowerCase()); return i < 0 ? 99 : i; };
const store = {};
const sessionStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } };
const build = new Function('S', 'rk', 'sessionStorage', fnSrc + '; return applyCoursePref;');

function run(pref) {
  Object.keys(store).forEach((k) => delete store[k]);
  if (pref) store.ahct_pref = JSON.stringify(pref);
  const S = { courses: COURSES, picked: new Set() }, w = { n: 1, mode: '', cat: '' };
  build(S, rk, sessionStorage)(w);
  return { S, w };
}
const picked = (r) => [...r.S.picked].map((code) => COURSES.find((c) => c.code === code));

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };
const one = (r, name, level) => { const p = picked(r); return p.length === 1 && p[0].name === name && p[0].category === level && r.w.cat === level && r.w.mode === 'cat'; };

ok('catalogue loaded (18 active courses)', COURSES.length === 18);
ok('AutoCAD + Beginner', one(run({ course: 'AutoCAD', category: 'Beginner' }), 'AutoCAD', 'Beginner'));
ok('Lumion matches "Lumion/Animation"', one(run({ course: 'Lumion', category: 'Intermediate' }), 'Lumion/Animation', 'Intermediate'));
ok('SketchUP is case-insensitive', one(run({ course: 'SketchUP', category: 'Professional' }), 'SketchUp', 'Professional'));
ok('Graphic Design + Beginner', one(run({ course: 'Graphic Design', category: 'Beginner' }), 'Graphic Design', 'Beginner'));
ok('ArchiCAD + Professional', one(run({ course: 'ArchiCAD', category: 'Professional' }), 'ArchiCAD', 'Professional'));
ok('Revit with no level picks the lowest level', one(run({ course: 'Revit', category: '' }), 'Revit', 'Beginner'));
{ const r = run({ course: 'VRAY', category: 'Beginner' }); ok('VRAY (not registrable) selects nothing', r.S.picked.size === 0 && r.w.cat === ''); }
ok('unknown level selects nothing', run({ course: 'AutoCAD', category: 'Wizard' }).S.picked.size === 0);
ok('hostile value is harmless', run({ course: '<script>alert(1)</script>', category: 'Beginner' }).S.picked.size === 0);
ok('no preference leaves the wizard untouched', run(null).S.picked.size === 0);
{ const r = run({ course: 'AutoCAD', category: 'Beginner' }); ok('preference is consumed exactly once', store.ahct_pref === undefined && r.w.prefDone === true); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
