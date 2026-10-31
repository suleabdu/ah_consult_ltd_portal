import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const root=process.cwd();
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const page=read('frontend/js/pages/apply.js');
const backend=read('supabase/functions/student-document/index.ts');
const sql=read('supabase/migrations/036_manual_and_provider_receipt_provenance.sql');
const verify=read('supabase/functions/verify-payment/index.ts');
const upper=read('supabase/functions/upperlink-webhook/index.ts');
const pay=read('supabase/functions/_shared/pay.ts');

assert.match(page,/excludeReceipts:true,actions:\['print'\]/,'Application status must not display preview/download controls');
assert.match(page,/AHOfficialDocuments\.fetchRecords\(sb,a\.id,\{receiptsOnly:true,skipRepair:true\}\)/,'Receipt lookup must preserve verified records without rendering the removed register');
assert.doesNotMatch(page,/Official payment receipts/,'Detailed receipt register removed from applicant page');
assert.doesNotMatch(page,/Print Manual Receipt/,'Applicant print button must have neutral label');
assert.match(page,/provider,source,provider_transaction_id/,'Student receipt summary must read verified payment provenance');
for(const word of ['Manual Payment Receipt','Electronic Payment Receipt','Payment provider','Provider reference / transaction ID','AH Consult Finance'])assert.ok(backend.includes(word),`Missing PDF field: ${word}`);
assert.match(backend,/\.not\("verified_at", "is", null\)/,'Never issue an unverified receipt');
assert.match(backend,/pdf_path/,'Archived PDF preservation must remain');
assert.match(verify,/provider_evidence:result\.evidence/);
assert.match(upper,/provider_evidence: v\.evidence/);
assert.match(pay,/const evidence=paid\?/,'Never trust unverified provider responses');
assert.match(sql,/set search_path=public,pg_temp/);
assert.match(sql,/from public\.applications where id=p_app for update/);
assert.match(sql,/from public\.course_additions where id=p_id for update/);
assert.match(sql,/provider='manual',source='admin_manual'/);
assert.match(sql,/verified_at=coalesce/);
assert.match(sql,/source='admin_manual_legacy'/);
assert.match(sql,/p\.raw_event->>'source'='admin'/,'Backfill must be limited to previously admin-approved records');
assert.match(sql,/grant execute on function public\.admin_review_payment\(uuid,text,text\) to authenticated/);

// Runtime test the existing document renderer without jsdom or production credentials.
class Elem{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.style={};this.className='';this.dataset={};this.textContent='';}
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=[...items];}
 addEventListener(name,cb){this.listeners[name]=cb;}
}
const context={window:{},document:{createElement:t=>new Elem(t)},console};
vm.runInNewContext(read('frontend/js/official-documents.js'),context);
const docs=context.window.AHOfficialDocuments;
const fakeRows=[{id:'receipt01',application_id:'app01',document_key:'admission_letter',document_type:'admission_letter',status:'available',issued_at:'2026-10-28T00:00:00Z',metadata:{}},
 {id:'receipt02',application_id:'app01',document_key:'payment_receipt:pay01',document_type:'payment_receipt',status:'pending',metadata:{payment_id:'pay01',payment_reference:'BANK-0001'}}];
const sb={from:()=>({select:()=>({eq:()=>({in:()=>({order:async()=>({data:fakeRows,error:null})})})})}),rpc:async()=>({data:0,error:null})};
const status=new Elem(),receipt=new Elem();
await docs.renderList(status,sb,{},'app01',{excludeReceipts:true,actions:['print']});
assert.equal(status.children.length,1);
assert.deepEqual(status.children[0].children[1].children.map(n=>n.textContent),['Print Admission Letter']);
await docs.renderList(receipt,sb,{},'app01',{receiptsOnly:true,payments:[{id:'pay01',source:'admin_manual',provider:'manual',reference:'BANK-0001',paid_ngn:10000,verified_at:'2026-10-28T00:00:00Z'}]});
assert.equal(receipt.children.length,1);
assert.equal(receipt.children[0].children[0].children[0].textContent,'Manual Payment Receipt');
assert.deepEqual(receipt.children[0].children[1].children.map(n=>n.textContent),['Preview PDF','Download PDF','Print Receipt']);
console.log('PASS payment receipt provenance: compact UI, safe manual origin and PDF access');
