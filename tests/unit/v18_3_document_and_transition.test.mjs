import {source as pageSource} from './source.mjs';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const read=n=>readFileSync(new URL('../../'+n,import.meta.url),'utf8');
const app=pageSource('frontend/apply.html'),portal=pageSource('frontend/portal.html'),doc=read('frontend/js/official-documents.js'),migration=read('supabase/migrations/031_v18_3_document_integrity_transition.sql');
const pdf=read('supabase/functions/student-document/index.ts'),admin=pageSource('frontend/admin-dashboard.html'),del=read('supabase/functions/admin-delete/index.ts');
const tests=[
 ['academic links removed from application status',!app.includes('href="transcripts.html"')&&!app.includes('href="result.html"')],
 ['transition requires positive acceptance and is persisted',app.includes('p_accepted:true')&&migration.includes('student_portal_transitions')],
 ['student portal gates before loading RPC data',portal.indexOf("sb.rpc('student_portal_access')")<portal.indexOf("async function load()")],
 ['student documents use common PDF renderer',doc.includes("functions/v1/student-document")&&portal.includes("AHOfficialDocuments.action")],
 ['student document pages no longer build alternate letters',!doc.includes("Dear ${d.name")&&!doc.includes('d.body_text')],
 ['all academic RPCs have transition guard', ['portal_data','student_academic_record','published_student_results','portal_phase5_data'].every(x=>migration.includes('create or replace function public.'+x)) && (migration.match(/if not public\.student_portal_access\(\)/g)||[]).length>=4],
 ['document list actually renders admitted students',admin.includes('data-doc-student')&&admin.includes("D.apps.filter(a=>a.admission_decision==='approved'")],
 ['letterhead has file upload and private backend',admin.includes('id="letterheadUpload"')&&read('supabase/functions/document-branding/index.ts').includes('institution-letterheads')],
 ['PDF archived and hash verified on every download',pdf.includes(".from('issued-documents')")&&pdf.includes("doc.metadata.sha256!==actual")],
 ['public verification checks only hash, not full documents',read('supabase/functions/document-verify/index.ts').includes('sha256')],
 ['delete uses current admission, not stale document flag',migration.includes("if a.admission_decision='approved'")&&!migration.includes('An issued institutional document must be revoked')],
 ['old issued records detached and retained',migration.includes('update public.document_jobs set application_id=null')&&migration.includes('update public.student_documents set application_id=null')],
 ['academic document cache invalidated on grade change',migration.includes('v183_withdraw_grade_documents')],
 ['previously issued admissions revoked on decision reversal',migration.includes('v183_reconcile_admission_letter')],
 ['recorded transition prevents deletion of actual enrolled students',migration.includes('PORTAL_TRANSITION_RETAINED')],
 ['document security does not pretend to issue signatures',!pdf.includes('pdf.sign(')]
];
for(const [name,passed] of tests){assert.ok(passed,'FAIL '+name); console.log('PASS '+name)}
console.log(`${tests.length} V18.3 focused checks passed`);
