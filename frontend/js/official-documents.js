/* One authenticated PDF route for Application and Student portals. No separate HTML document pages. */
(function(g){'use strict';
 const keys=new Set(['admission_letter','payment_receipt','academic_transcript','result_statement','deferment_letter','certificate']);
 const normalKey=doc=>doc.document_type==='payment_receipt'?'payment_receipt':doc.document_key;
 const cache=new Map(), MAX_PDF_CACHE=3, MAX_CACHE_BYTES=5*1024*1024;
 const title=key=>({admission_letter:'Admission Letter',payment_receipt:'Official Payment Receipt',academic_transcript:'Academic Transcript',result_statement:'Result Statement',deferment_letter:'Deferment Letter',certificate:'Certificate of Completion'})[key]||'Official Document';
 // Keep only a few already verified PDFs in memory, scoped to the signed-in user.
 // A cached copy is never persisted to browser storage; SHA-256 revision identifies the bytes.
 async function pdf(sb,config,record,currentStyle=false){
  const {data:{session}}=await sb.auth.getSession();if(!session)throw Error('Your session expired. Please sign in again.');
  const key=[session.user?.id,record.id,record.metadata?.sha256||''].join(':');
  if(!currentStyle&&record.metadata?.sha256&&cache.has(key))return cache.get(key);
  const response=await fetch(config.SUPABASE_URL.replace(/\/$/,'')+'/functions/v1/student-document',{
   method:'POST',headers:{'Content-Type':'application/json',apikey:config.SUPABASE_ANON_KEY,Authorization:'Bearer '+session.access_token},
   body:JSON.stringify({document_id:record.id,document_key:normalKey(record),current_style:currentStyle})
  });
  if(!response.ok){const message=await response.json().catch(()=>({}));throw Error(message.error||'Official PDF could not be prepared. Please contact the records office.');}
  const blob=await response.blob();if(blob.type!=='application/pdf'&&!blob.type.startsWith('application/pdf;'))throw Error('Unexpected document format.');
  if(!currentStyle&&record.metadata?.sha256&&blob.size<=MAX_CACHE_BYTES){cache.set(key,blob);while(cache.size>MAX_PDF_CACHE)cache.delete(cache.keys().next().value);}
  return blob;
 }
 const pending=new Map();
 async function getPdf(sb,config,record,currentStyle=false){
  // Deduplicate pointer-hover prefetch and immediate print clicks.
  const {data:{session}}=await sb.auth.getSession();if(!session)throw Error('Please sign in again.');
  const key=session.user?.id+':'+record.id+':'+(record.metadata?.sha256||'')+':'+(currentStyle?'style':'original');
  if(!pending.has(key))pending.set(key,pdf(sb,config,record,currentStyle).finally(()=>pending.delete(key)));
  return pending.get(key);
 }
 function warmOnIntent(button,sb,config,record){
  if(!button||!record?.metadata?.sha256)return;
  // Set handlers, not repeated listeners, as the receipts view refreshes.
  const warm=()=>{getPdf(sb,config,record).catch(()=>{});};
  button.onpointerenter=warm;
  button.onfocus=warm;
 }
 function open(blob,record,mode){
  const url=URL.createObjectURL(blob);
  if(mode==='preview'||mode==='print'){
   // Stay in the existing application/student portal: no pop-up blockers,
   // external viewer tab or additional HTML document page required.
   const lastFocus=document.activeElement;
   const overlay=document.createElement('div');overlay.className='official-document-preview';
   overlay.setAttribute('role','presentation');
   overlay.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.73);z-index:10000;padding:12px;display:flex;align-items:center;justify-content:center';
   const panel=document.createElement('div');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',title(normalKey(record))+' PDF preview');
   panel.style.cssText='background:white;width:min(960px,100%);height:min(93vh,960px);display:flex;flex-direction:column;border-radius:12px;padding:12px;gap:8px;box-sizing:border-box';
   const heading=document.createElement('h2');heading.textContent=title(normalKey(record));heading.style.cssText='font-size:17px;line-height:1.3;margin:0';
   const close=document.createElement('button');close.type='button';close.textContent='Close preview';close.setAttribute('aria-label','Close PDF preview');close.style.cssText='align-self:flex-end;padding:7px 12px;border:1px solid #cbd5e1;background:#ffffff;color:#111827!important;border-radius:6px;cursor:pointer;font-weight:700';
   const iframe=document.createElement('iframe');iframe.src=url;iframe.title=title(normalKey(record));iframe.style.cssText='border:1px solid #e5e7eb;width:100%;flex:1;min-height:0';
   const onKey=e=>{if(e.key==='Escape'){e.preventDefault();cleanup();}};
   const cleanup=()=>{document.removeEventListener('keydown',onKey);URL.revokeObjectURL(url);overlay.remove();lastFocus?.focus?.();};
   close.addEventListener('click',cleanup);overlay.addEventListener('click',e=>{if(e.target===overlay)cleanup();});document.addEventListener('keydown',onKey);
   panel.append(heading,close,iframe);overlay.append(panel);document.body.append(overlay);close.focus();if(mode==='print'){iframe.addEventListener('load',()=>{try{iframe.contentWindow?.focus();iframe.contentWindow?.print();}catch(_){window.alert('Use the PDF viewer Print button or download the PDF to print.');}},{once:true});}
  }else{
   const a=document.createElement('a');a.href=url;a.download='AHCT-'+normalKey(record)+'-'+record.id.slice(0,8)+'.pdf';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
  }
 }
 async function action(sb,config,record,mode,button){
  const previous=button?.textContent;if(button){button.disabled=true;button.textContent='Preparing secure PDF…';}
  try{open(await getPdf(sb,config,record,mode==='print'),record,mode);return true;}
  finally{if(button){button.disabled=false;button.textContent=previous;}}
 }
 async function fetchRecords(sb,applicationId,options={}){
  let repairFailed=false;
  if(options.receiptsOnly&&!options.skipRepair){const recovered=await sb.rpc('student_repair_verified_receipts',{p_application:applicationId});if(recovered.error){repairFailed=true;console.warn('Receipt reconciliation unavailable:',recovered.error.message);}}
  const {data,error}=await sb.from('student_documents').select('id,application_id,title,document_type,document_key,status,issued_at,metadata')
    .eq('application_id',applicationId).in('document_type',['payment_receipt','admission_letter','academic_transcript','result_statement','deferment_letter','certificate']).order('created_at',{ascending:false});
  if(error)throw new Error('Official document register could not be accessed. Contact Finance if this persists.');
  const docs=(data||[]).filter(d=>(!options.receiptsOnly||d.document_type==='payment_receipt')&&(!options.excludeReceipts||d.document_type!=='payment_receipt')&&keys.has(normalKey(d)) && (d.document_key!=='payment_receipt'||!(data||[]).some(x=>x.document_key?.startsWith('payment_receipt:'))));
  if(!docs.length&&repairFailed)throw new Error('Receipt recovery is unavailable. Finance must verify migration 034 and receipt permissions.');
  return docs;
 }
 async function renderList(container,sb,config,applicationId,options={}){
  if(!container)return;
  container.textContent='Loading your verified documents…';
  let docs;
  try{docs=await fetchRecords(sb,applicationId,options);}catch(e){container.textContent='Document list unavailable. Please refresh or contact the office.';throw e;}
  container.replaceChildren();
  if(!docs.length){const p=document.createElement('p');p.className='sub';p.textContent=options.receiptsOnly?'No verified payment receipts are available yet. Use Verify/Refresh payment to check your transaction.':options.excludeReceipts?'Your admission and academic documents will appear here when issued.':'Official documents will appear automatically after payment verification or authorization.';container.append(p);return [];}
  for(const doc of docs){
   const row=document.createElement('div');row.className='official-document-row';row.style.cssText='display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;border-top:1px solid #e5e7eb;padding:12px 0';
   const info=document.createElement('div'),strong=document.createElement('strong'),meta=document.createElement('small');
   strong.textContent=title(normalKey(doc));meta.style.cssText='display:block;color:#6b7280;margin-top:4px';
   meta.textContent=(doc.status==='available'?'Issued '+(doc.issued_at?new Date(doc.issued_at).toLocaleDateString('en-GB'):'—'):normalKey(doc)==='payment_receipt'?'Verified payment · preparing receipt PDF':'Official document being prepared')+(doc.metadata?.payment_reference?' · '+doc.metadata.payment_reference:'');
   info.append(strong,meta);
   const payment=options.receiptsOnly?(options.payments||[]).find(p=>String(p.id)===String(doc.metadata?.payment_id)):null;
   const isManual=!!payment&&String(payment.source||'').startsWith('admin_manual');
   if(options.receiptsOnly){
    strong.textContent=isManual?'Manual Payment Receipt':payment?'Online Payment Receipt':title(normalKey(doc));
    const grid=document.createElement('div');grid.className='receipt-row-details';
    const detail=(label,value)=>{const box=document.createElement('div'),small=document.createElement('small'),v=document.createElement('strong');small.textContent=label;v.textContent=String(value??'—');box.append(small,v);grid.append(box);};
    detail('Payment reference',payment?.reference||doc.metadata?.payment_reference||'—');
    if(payment){
     detail('Amount received','NGN '+Number(payment.paid_ngn||0).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2}));
     detail('Verified date',new Date(payment.verified_at).toLocaleDateString('en-GB'));
     detail(isManual?'Approved by':'Payment provider',isManual?'AH Consult Finance':payment.provider||'Verified payment');
     if(!isManual&&payment.provider_transaction_id)detail('Provider transaction ID',payment.provider_transaction_id);
    }
    detail('Receipt status',doc.status==='available'&&doc.metadata?.pdf_path?'Issued':'Preparing official PDF');
    info.append(grid);
   }
   row.append(info);
   const actions=document.createElement('div');actions.className='row';actions.style.cssText='display:flex;gap:6px;flex-wrap:wrap';
   // The status page may expose Print only; the dedicated Receipts page keeps all actions.
   const modes=(Array.isArray(options.actions)?options.actions:['preview','download','print']).filter(mode=>['preview','download','print'].includes(mode));
   for(const mode of modes){
    const b=document.createElement('button');b.type='button';b.className='btn2';b.textContent=mode==='preview'?'Preview PDF':mode==='print'?(normalKey(doc)==='payment_receipt'?'Print Receipt':'Print '+title(normalKey(doc))):'Download PDF';
    // Pending verified receipts can be generated and archived by the authenticated PDF endpoint.
    b.addEventListener('click',async()=>{try{await action(sb,config,doc,mode,b);if(doc.status==='pending')await renderList(container,sb,config,applicationId,options);}catch(e){window.alert(e.message||'Document could not be opened.');}});actions.append(b);
   }
   row.append(actions);container.append(row);
  }
  return docs;
 }
 g.AHOfficialDocuments=Object.freeze({normalKey,title,action,renderList,fetchRecords,warmOnIntent});
})(window);
