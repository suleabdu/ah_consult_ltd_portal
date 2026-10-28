import {source as pageSource} from './source.mjs';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const migration=read('supabase/migrations/033_institutional_document_studio_receipt_integrity.sql');
const renderer=read('supabase/functions/student-document/index.ts');
const worker=read('supabase/functions/document-issue/index.ts');
const shared=read('frontend/js/official-documents.js');
const admin=pageSource('frontend/admin-dashboard.html');
const app=pageSource('frontend/apply.html');
const portal=pageSource('frontend/portal.html');
const verifyPay=read('supabase/functions/_shared/pay.ts');
const webhook=read('supabase/functions/payment-webhook/index.ts');
const assertContains=(source,needle,msg)=>assert.ok(source.includes(needle),msg);
const checks=[
 ['per-payment document instance key',migration.includes("'payment_receipt:'||new.id::text")],
 ['immutable receipt payment identification',migration.includes('student_document_receipt_payment_unique')&&migration.includes('guard_canonical_receipt')],
 ['archive required prior to deleting application',migration.includes('detach_canonical_receipts_before_app_delete')],
 ['template content versions are captured',migration.includes('snapshot_complete')&&migration.includes('document_template_versions')],
 ['template draft, deliberate publish, version rollback-to-draft',migration.includes('admin_save_document_template_draft')&&migration.includes('admin_publish_document_template_draft')&&migration.includes('admin_restore_document_version_as_draft')&&admin.includes('publishDocTemplate')],
 ['allowlisted placeholders resolved only in PDF engine',renderer.includes('templateFields:Record<string,string>')&&migration.includes('unknown dynamic field')&&admin.includes('insertDocField')],
 ['staging safe areas are configurable',migration.includes('top_safe_mm')&&migration.includes('bottom_safe_mm')],
 ['receipt job starts on provider verification',verifyPay.includes('scheduleReceiptIssuance()')&&webhook.includes('scheduleReceiptIssuance()')],
 ['issuance worker restricted to staff or internal service role',worker.includes("['administrator','finance'].includes")&&worker.includes('service_role_key')===false&&worker.includes('trusted=')],
 ['PDF renderer verifies full payment coverage',renderer.includes('Number(p.paid_ngn) >= Number(p.expected_ngn)')],
 ['PDF archived with SHA-256 before status becomes available',renderer.indexOf(".upload(storagePath,bytes")<renderer.indexOf("status:'available',issued_at")],
 ['archived PDF integrity verified on delivery',renderer.includes('doc.metadata.sha256!==actual')],
 ['preview explicitly non-issuance',renderer.includes('SAMPLE PREVIEW - NOT VALID FOR OFFICIAL USE')&&renderer.includes('if(preview){')],
 ['admin template designer has PDF preview and queue recovery',admin.includes('previewDocTemplate')&&admin.includes('retryOfficialReceipts')],
 ['applicant documents integrated into application page',app.includes('appOfficialDocs')&&app.includes('AHOfficialDocuments.renderList')],
 ['student portal and application use shared PDF client',portal.includes('AHOfficialDocuments.action')&&shared.includes("functions/v1/student-document")],
 ['PDF preview opens inside existing portal without popups',shared.includes('aria-modal')&&!shared.includes('window.open(')],
 ['old independent renderer removed',!existsSync(new URL('../../supabase/functions/document-render',import.meta.url))],
 ['no extra HTML document pages',!['admission-letter','deferment-letter','payment-receipt','result','transcripts','transcrpts'].some(x=>existsSync(new URL('../../frontend/'+x+'.html',import.meta.url)))],
];
for(const [name,passed] of checks){assert.ok(passed,`FAIL: ${name}`);console.log('PASS',name)}
console.log(`${checks.length} institutional document integrity checks passed.`);
