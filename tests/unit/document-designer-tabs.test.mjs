import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const src=read('frontend/js/pages/admin-dashboard.js');
const sql=read('supabase/migrations/035_document_designer_tabs_safe_deletion.sql');
const pdf=read('supabase/functions/student-document/index.ts');
const styles=read('frontend/css/admin-dashboard-inline-1.css');
const types=[['admission_letter','Admission letter'],['deferment_letter','Deferment letter'],['payment_receipt','Payment receipt'],['academic_transcript','Transcript'],['result_statement','Result statement'],['certificate','Certificate']];
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const viewSource=src.slice(src.indexOf(' V.docTemplates=()=>'),src.indexOf(' V.intelligence=()=>'));
assert.ok(viewSource.includes('V.docTemplates='),'designer view located');
const html=new Function('DOC_TEMPLATE_TYPES','designerSelectedKind','esc',`const V={};${viewSource};return V.docTemplates()`)(types,'admission_letter',esc);
for(const [key,label] of types){assert.ok(html.includes(`data-template-tab="${key}"`),`missing ${label} tab`);assert.ok(html.includes(label),`${label} caption`);}
assert.equal((html.match(/role="tab"/g)||[]).length,6);
assert.ok(html.includes('id="deleteDocDraft"'));
assert.ok(html.includes('role="tabpanel"'));
assert.ok(styles.includes('.doc-template-tab[aria-selected="true"]'));
console.log('PASS six document tabs, keyboard roles, independent editor and delete control');

class E {
 constructor(id=''){this.id=id;this.children=[];this.events={};this.dataset={};this.attributes={};this.style={};this.value='';this.disabled=false;this.textContent='';this.tabIndex=-1;}
 addEventListener(type,fn){(this.events[type]??=[]).push(fn);}
 click(){for(const handler of this.events.click||[])handler({target:this,currentTarget:this,preventDefault(){}});if(this.onclick)return this.onclick({target:this,currentTarget:this,preventDefault(){}});}
 setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k]??null;}
 append(...children){this.children.push(...children);}replaceChildren(...children){this.children=[...children];}
 focus(){this.focused=true;}
}
const ids=['docKind','docTemplateEditor','docTemplateHeading','docTemplateCurrentLabel','templateStatus','deleteDocDraft','docVersionHistory','docBody','docSign','docTitle','docFooter','insertDocField','docField','retryOfficialReceipts','receiptWorkerFeedback','saveDocTemplate','publishDocTemplate','previewDocTemplate'];
const els=new Map(ids.map(id=>[id,new E(id)]));els.get('docKind').value='admission_letter';els.get('docField').value='student_name';
const tabs=types.map(([key])=>{const tab=new E('doc-tab-'+key);tab.dataset.templateTab=key;tab.setAttribute('aria-selected',String(key==='admission_letter'));return tab;});
const document={querySelector:selector=>els.get(selector.slice(1))??null,querySelectorAll:selector=>selector==='[data-template-tab]'?tabs:[],createElement:name=>new E(name),contains:element=>element instanceof E};
const $=document.querySelector;
const state=Object.fromEntries(types.map(([key],i)=>[key,{published:2,hasDraft:i===0,draftBody:`${key} DRAFT`,currentBody:`${key} PUBLISHED`,versions:[2,1]}]));
const calls=[];
const sb={rpc:async (name,args)=>{
 calls.push([name,args]);const t=state[args.p_key];
 if(!t)return {error:{message:'Missing key'}};
 if(name==='admin_read_document_draft')return {data:{published_version:t.published,has_draft:t.hasDraft,body_text:t.hasDraft?t.draftBody:t.currentBody,signatory_name:'',signatory_title:'',footer_text:''}};
 if(name==='admin_list_document_template_versions')return {data:t.versions.map(version=>({version,date:'2026-10-28T10:00:00Z',restorable:true}))};
 if(name==='admin_delete_document_template_draft'){t.hasDraft=false;return {data:true};}
 if(name==='admin_retire_document_template_revision'){
  if(args.p_version===t.published)return {error:{message:'Cannot retire published version'}};
  t.versions=t.versions.filter(v=>v!==args.p_version);return {data:true};
 }
 if(name==='admin_save_document_template_draft'){t.hasDraft=true;t.draftBody=args.p_body;return {data:null};}
 if(name==='admin_publish_document_template_draft'){if(!t.hasDraft)return {error:{message:'Save a draft first'}};t.currentBody=t.draftBody;t.hasDraft=false;t.published++;t.versions.unshift(t.published);return {data:t.published};}
 if(name==='admin_restore_document_version_as_draft'){t.hasDraft=true;t.draftBody='RESTORED';return {data:null};}
 return {error:{message:'Unexpected RPC'}};
}};
const notices=[];let confirmations=true;
const wireSource=src.slice(src.indexOf("  if(view==='docTemplates'&&isAdmin){"),src.indexOf("    const brandingUrl=fnUrl('document-branding')"));
assert.ok(wireSource.includes("admin_retire_document_template_revision"));
const wire=new Function('document','$','sb','toast','confirm','askNote','DOC_TEMPLATE_TYPES','designerSelectedKind','view','isAdmin','fnUrl','api','C','modal',wireSource+'\n}');
wire(document,$,sb,(msg,err)=>notices.push([msg,err]),()=>confirmations,async()=> 'Remove old unused revision from designer',types,'admission_letter','docTemplates',true,()=>'',()=>({}),{},()=>new E('modal'));
const tick=async()=>{for(let i=0;i<5;i++)await new Promise(res=>setImmediate(res));};
await tick();
assert.equal($('#docBody').value,'admission_letter DRAFT');
assert.match($('#templateStatus').textContent,/Saved unpublished draft/);
assert.equal($('#docVersionHistory').children.length,2);
const buttonsFor=row=>row.children.filter(c=>c instanceof E&&c.id==='button');
assert.equal(buttonsFor($('#docVersionHistory').children[0]).some(x=>x.textContent==='Delete revision'),false,'current published revision cannot be deleted');
assert.equal(buttonsFor($('#docVersionHistory').children[1]).some(x=>x.textContent==='Delete revision'),true,'old revision has Delete button');
console.log('PASS draft and published revision load independently; current revision protected');
// Switch to the Deferment template without leaking the admission letter draft.
tabs[1].click();await tick();
assert.equal($('#docKind').value,'deferment_letter');
assert.equal($('#docBody').value,'deferment_letter PUBLISHED');
assert.equal(tabs[1].getAttribute('aria-selected'),'true');
console.log('PASS switching tabs loads only selected template');
// Switch back and delete the saved draft; published template should become visible again.
tabs[0].click();await tick();
$('#deleteDocDraft').click();await tick();
assert.equal(state.admission_letter.hasDraft,false);
assert.equal($('#docBody').value,'admission_letter PUBLISHED');
console.log('PASS saved draft deletion reverts editor to current published content');
// Delete the superseded revision; the active one is unchanged.
const oldRow=$('#docVersionHistory').children[1];
const deleteBtn=buttonsFor(oldRow).find(b=>b.textContent==='Delete revision');
await deleteBtn.click();await tick();
assert.deepEqual(state.admission_letter.versions,[2]);
assert.equal(state.admission_letter.published,2);
assert.equal($('#docVersionHistory').children.length,1);
assert.ok(calls.some(([n,a])=>n==='admin_retire_document_template_revision'&&a.p_key==='admission_letter'&&a.p_version===1));
console.log('PASS old revision deletion is scoped to one document; published version remains unchanged');
// Save a replacement draft and deliberately publish it, leaving other tabs unchanged.
$('#docBody').value='New approved admission letter';
for(const fn of $('#docBody').events.input||[])fn();
await $('#saveDocTemplate').click();await tick();
assert.equal(state.admission_letter.hasDraft,true);
await $('#publishDocTemplate').click();await tick();
assert.equal(state.admission_letter.published,3);
assert.equal(state.admission_letter.currentBody,'New approved admission letter');
assert.equal(state.deferment_letter.published,2);
console.log('PASS draft save and publish affect selected document type only');
// Source-level database and PDF guards (SQL execution requires Supabase/Postgres).
assert.ok(sql.includes("public.has_role('administrator')"),'server-side admin role gate');
assert.ok(sql.includes('if t.version=p_version then'),'live revision cannot be retired');
assert.ok(sql.includes('retired_at=now()'),'retirement is logical, not destructive');
assert.ok(!sql.includes('delete from public.document_templates'),'canonical template never deleted');
assert.ok(sql.includes('document_revision_deleted'),'audit event recorded');
assert.ok(sql.includes('and retired_at is null'),'retired versions excluded from visible histories and restore');
assert.ok(pdf.includes('.eq("key",key).eq("active",true)'),'renderer loads only active published version');
assert.ok(pdf.includes('if(savedPath && !currentStyle)return (await readArchived())!') && pdf.includes('document_style_reprints'),'original PDF remains immutable; updated style copy is separate');
console.log('PASS server-side deletion, audit, and shared renderer safeguards (source checks)');
