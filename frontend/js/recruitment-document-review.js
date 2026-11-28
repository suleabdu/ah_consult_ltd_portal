(function () {
 'use strict';

 // Identifiers are assigned when the application is submitted. The snapshot
 // preserves the same filename even if HR later renames the vacancy.
 function part(value, fallback, max) {
  const clean=String(value||'').normalize('NFKC').replace(/[\\/:*?"<>|\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,max).trim().replace(/[. ]+$/g,'');
  return clean||fallback;
 }
 function filenameFor(doc) {
  const ext=(String(doc.storage_path||'').match(/\.([a-z0-9]{1,8})$/i)||[])[1]||'bin';
  const serial=String(doc.serial||'').replace(/\D/g,'').padStart(3,'0');
  return part(doc.job_title_snapshot,'Position',80).toUpperCase()+'-'+part(doc.applicant_name_snapshot,'Applicant',90)+'-'+serial+'.'+ext.toLowerCase();
 }
 function labelFor(path,a) {
  if(path===a.cv_path)return 'CV or résumé';
  if(path===a.passport_path)return 'Passport photograph';
  const question=(Array.isArray(a.question_snapshot)?a.question_snapshot:[]).find(q=>q.kind==='file'&&a.answers&&a.answers[q.id]===path);
  return question?String(question.prompt||'Question attachment'):'Additional attachment';
 }

 function open({application:a,sb,modal,escape:esc}) {
  const snapshot=Array.isArray(a.question_snapshot)?a.question_snapshot:[];
  const m=modal(`<h3>Application review · ${esc(a.full_name)}</h3><p class="sub">${esc(a.email)} · ${esc(a.phone)}</p>${snapshot.map(q=>`<div class="item"><b>${esc(q.prompt)}</b><p>${q.kind==='file'?'See submitted documents below':esc(a.answers?.[q.id]||'—')}</p></div>`).join('')}<section class="recruitment-documents" aria-label="Submitted documents"><h3>Submitted documents</h3><p class="sub">Select a document to preview, print or download it.</p><div data-document-list aria-live="polite">Loading documents…</div><div data-document-preview class="recruitment-preview" hidden></div></section><div class="row"><button type="button" class="btn g" data-close>Close</button></div>`);
  m.classList.add('recruitment-review-modal');
  const list=m.querySelector('[data-document-list]'),panel=m.querySelector('[data-document-preview]');
  let docs=[],currentUrl='',generation=0;
  function release() {generation++;if(currentUrl){URL.revokeObjectURL(currentUrl);currentUrl='';}}
  function close() {release();m.remove();}
  m.querySelector('[data-close]').onclick=close;
  m.addEventListener('click',e=>{if(e.target===m)release()});
  function printable(type,text,url,name,frame,status) {
   if(type==='pdf'){
    try {if(!frame?.contentWindow)throw Error();frame.contentWindow.focus();frame.contentWindow.print();}
    catch (_) {status.textContent='Use the PDF viewer’s print control, or download the file and print it.';}
    return;
   }
   const win=window.open('','_blank');
   if(!win){status.textContent='Allow pop-ups to print, or download the file and print it.';return;}
   win.opener=null;win.document.title=name;
   const body=win.document.body;body.style.margin='24px';
   if(type==='image'){
    const img=win.document.createElement('img');img.alt=name;img.style.maxWidth='100%';
    img.onload=()=>{win.focus();win.print();};img.onerror=()=>{status.textContent='The image could not be printed. Download it and try again.';};img.src=url;body.appendChild(img);
   } else {
    const pre=win.document.createElement('pre');pre.textContent=text;pre.style.whiteSpace='pre-wrap';pre.style.font='14px/1.5 sans-serif';body.appendChild(pre);win.focus();win.print();
   }
  }
  async function show(index) {
   const doc=docs[index];if(!doc)return;
   release();const request=generation;panel.hidden=false;panel.innerHTML='<p role="status">Loading document…</p>';
   const result=await sb.storage.from('recruitment-applications').download(doc.storage_path).catch(()=>({error:true}));
   if(request!==generation||!m.isConnected)return;
   if(result.error||!result.data){panel.innerHTML='<p class="recruitment-preview-error" role="status">This document could not be loaded. Please try again.</p>';return;}
   const blob=result.data,name=filenameFor(doc),ext=(name.split('.').pop()||'').toLowerCase();
   // Do not let a storage response choose an executable HTML MIME type for a
   // document preview. Only the expected inert file types are rendered.
   const types={pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
   currentUrl=URL.createObjectURL(new Blob([blob],{type:types[ext]||'application/octet-stream'}));
   panel.innerHTML=`<div class="recruitment-preview-head"><div><strong>${esc(labelFor(doc.storage_path,a))}</strong><span>${esc(name)}</span></div><div class="row"><button type="button" class="btn s g" data-print disabled>Print</button><button type="button" class="btn s" data-download>Download</button></div></div><div class="recruitment-preview-body" data-document-body></div><p class="sub" data-preview-status role="status"></p>`;
   const body=panel.querySelector('[data-document-body]'),status=panel.querySelector('[data-preview-status]'),print=panel.querySelector('[data-print]');
   panel.querySelector('[data-download]').onclick=()=>{const link=document.createElement('a');link.href=currentUrl;link.download=name;link.rel='noopener';document.body.appendChild(link);link.click();link.remove();};
   let kind='',frame=null,text='';
   if(ext==='pdf') {kind='pdf';frame=document.createElement('iframe');frame.title='Preview: '+labelFor(doc.storage_path,a);frame.src=currentUrl;body.appendChild(frame);print.disabled=false;}
   else if(['jpg','jpeg','png'].includes(ext)) {kind='image';const img=document.createElement('img');img.alt='Preview: '+labelFor(doc.storage_path,a);img.src=currentUrl;body.appendChild(img);print.disabled=false;}
   else if(ext==='docx'&&window.AHDocxText){
    status.textContent='Preparing a text-only Word preview…';
    try {text=await window.AHDocxText(new File([blob],name,{type:blob.type}),{maxFileBytes:10*1024*1024,maxXmlBytes:4*1024*1024,maxChars:200000});if(request!==generation||!m.isConnected)return;const pre=document.createElement('pre');pre.textContent=text;body.appendChild(pre);kind='text';print.disabled=false;status.textContent='Text-only preview. Download the original Word file to see its complete formatting.';}
    catch (_) {if(request!==generation||!m.isConnected)return;status.textContent='This Word file cannot be previewed here. Download the original to review and print it.';}
   } else status.textContent='This file cannot be previewed here. Download it to review and print it.';
   print.onclick=()=>printable(kind,text,currentUrl,name,frame,status);
  }
  (async()=>{
   try {
    const result=await sb.from('recruitment_application_documents').select('storage_path,serial,job_title_snapshot,applicant_name_snapshot').eq('application_id',a.id).order('serial');
    if(!m.isConnected)return;
    if(result.error)throw result.error;
    docs=Array.isArray(result.data)?result.data:[];
    if(!docs.length){list.textContent='No documents were submitted with this application.';return;}
    list.innerHTML=docs.map((doc,i)=>`<div class="recruitment-document-row"><div><strong>${esc(labelFor(doc.storage_path,a))}</strong><small>${esc(filenameFor(doc))}</small></div><button type="button" class="btn s g" data-document-index="${i}">Open document</button></div>`).join('');
    list.querySelectorAll('[data-document-index]').forEach(button=>button.onclick=()=>show(Number(button.dataset.documentIndex)));
   } catch (_) {if(m.isConnected)list.textContent='The document list is unavailable. Please try again or contact an administrator.';}
  })();
 }
 window.AHRecruitmentDocumentReview={open,filenameFor};
})();
