import {source as pageSource} from './source.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const read=x=>fs.readFileSync(new URL('../../'+x,import.meta.url),'utf8');
const app=pageSource('frontend/apply.html'),ad=pageSource('frontend/admin-dashboard.html'),docs=read('frontend/js/official-documents.js'),s=read('supabase/functions/submit-application/index.ts'),pdf=read('supabase/functions/student-document/index.ts'),brand=read('supabase/functions/document-branding/index.ts'),mig=read('supabase/migrations/034_v18_6_age_receipts_branding_history.sql'),supabaseConfig=read('supabase/config.toml');
const cases=[
 ['age is validated client side',app.includes('validApplicantAge')&&app.includes('maxEligibleDob()')],
 ['age is validated server side',s.includes('birthday>cutoff')],
 ['age is validated within SQL finalizer',mig.includes('eligible_applicant_dob(p_form->>\'dob\')')],
 ['age corrections protected by database trigger',mig.includes('v18_6_minimum_applicant_age')],
 ['dedicated applicant receipts tab',app.includes('id="nvReceipts"')&&app.includes('async function receiptsView()')],
 ['receipt reconciliation reads only verified payments',mig.includes('student_repair_verified_receipts')&&mig.includes('p.verified_at is not null')],
 ['receipt preview download print actions',docs.includes("['preview','download','print']")],
 ['close preview button has visible text',docs.includes('color:#111827!important')],
 ['admin finance receipt register',ad.includes('admin_verified_receipt_register')],
 ['admin receipt reissue requires audit reason',mig.includes('receipt_reissued_certified_copy')],
 ['admin staff PDF access only verified roles',pdf.includes('staffCanView')&&pdf.includes("'finance'&&doc.document_type!=='payment_receipt'" )],
 ['native identity replaces letterhead history UI',brand.includes('institution_document_identity')&&!ad.includes('letterheadLibrary')],
 ['issued PDFs are not deleted when retiring letterheads',!brand.includes('remove([v.file_path])')],
 ['history maintenance requires administrator privileges',mig.includes('admin_clean_orphan_application_state')&&mig.includes('Administrator required')],
 ['student number never reset when reserved',mig.includes('admin_reset_unused_intake_counter')&&mig.includes('existing applications, historic ID reservations')],
 ['auth behavior requires email confirmation',app.includes('Check your inbox (and spam folder) for the confirmation link')&&supabaseConfig.includes('enable_confirmations = true')]
];
let failed=0;for(const [label,ok] of cases){if(!ok){console.error('FAIL',label);failed++}else console.log('PASS',label)}console.log(`${cases.length-failed}/${cases.length} passed`);if(failed)process.exit(1);
