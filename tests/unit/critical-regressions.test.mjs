import {source as pageSource} from './source.mjs';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const apply = pageSource('frontend/apply.html');
const homepageSql = read('../sql/homepage_test.sql');
const postureSql = read('../sql/security_posture.sql');
const stubSql = read('../sql/supabase_stub.sql');
const migration = read('../../supabase/migrations/027_secure_public_homepage_metrics.sql');

assert.match(apply, /function progressHtml\(current\)/, 'New application must have a three-stage progress indicator');
assert.match(apply, /renderProgrammeStage/, 'Applicant starts with programme selection');
assert.match(apply, /renderDetailsStage/, 'Applicant can review their personal information');
assert.match(apply, /renderReviewStage/, 'Applicant reviews details before payment');
assert.match(apply, /async function completePaidApplication\(/, 'Application submission is attempted after verified payment');
assert.doesNotMatch(apply, /\$\('#nx'\)\.onclick=/, 'Removed wizard Continue control must not return');
assert.match(homepageSql, /where user_id in \([\s\S]*?\)\s+and intake_id in \(select id from intakes where label in \('Impact test intake', 'Impact test intake 2'\)\)/, 'Fixture-count assertion must be scoped to test records');
assert.match(homepageSql, /string_agg\(name, '; ' order by name\)/, 'Homepage SQL failures should identify failed assertions');
assert.match(postureSql, /array\['public_impact_stats', 'public_homepage_metrics'\]/, 'Both reviewed aggregate-only public RPCs should be allow-listed');
assert.match(migration, /security definer[\s\S]*set search_path = public, pg_temp/i, 'Compatibility aggregate RPC must pin search_path');
assert.match(stubSql, /only for plain PostgreSQL test databases/i, 'Platform stub must refuse to imitate Supabase auth');
console.log('PASS critical SQL and payment-stage regression guards');
