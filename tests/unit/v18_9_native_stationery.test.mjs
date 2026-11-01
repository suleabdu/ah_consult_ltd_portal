import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(path,'utf8');
const migration=read('supabase/migrations/046_ah_consult_native_stationery.sql');
const branding=read('supabase/functions/document-branding/index.ts');
const renderer=read('supabase/functions/student-document/index.ts');
const admin=read('frontend/js/pages/admin-dashboard.js');
const officialDocuments=read('frontend/js/official-documents.js');
const guide=read('docs/NATIVE_DOCUMENT_STUDIO.md');

assert.match(migration,/add column if not exists stationery_style text not null default 'ah_consult_diagonal'/);
assert.match(migration,/institution_document_identity_profiles/);
assert.match(migration,/stationery_style=p\.stationery_style/);
assert.match(migration,/revoke all on function public\.ahct_publish_document_identity/);
assert.ok(!migration.includes('institution-letterheads'),'native stationery must not restore raster letterhead storage');

assert.match(branding,/STATIONERY_STYLES/);
assert.match(branding,/stationery_style:p\.stationery_style\|\|'ah_consult_diagonal'/);
assert.match(branding,/Choose an approved native stationery style/);
assert.match(admin,/id="nativeStationery"/);
assert.match(admin,/AH Consult diagonal stationery/);

assert.match(renderer,/const useAhConsultStationery = identity\.stationery_style !== "native"/);
assert.match(renderer,/drawStationery\(target\)/);
assert.match(renderer,/scanned letterhead into an ungoverned document background/);
assert.match(renderer,/const isAdmissionUpdate=doc\.document_type==="admission_letter"/);
assert.match(renderer,/Revised Admission Letter/);
assert.match(renderer,/requestedKey !== rawDocumentKey/);
assert.match(officialDocuments,/const isAdmissionUpdate=doc=>doc\?\.document_type==='admission_letter'/);
assert.match(officialDocuments,/Revised Admission Letter/);
assert.match(guide,/vector-native charcoal\/orange diagonal bands/);
console.log('PASS AH Consult vector stationery and immutable admission-update rendering safeguards');
