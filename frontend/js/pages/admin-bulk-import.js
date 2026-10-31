/* AHCT manual paper-registration importer. Original file is parsed locally; only verified rows are staged. */
(function(){'use strict';
const HEADERS=['Source Reference','First Name','Surname','Email','Phone','Intake','Course Codes','Date of Birth','Gender','Registration Note'];
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parseCsv=text=>{const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){
 const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
 else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell='';}else if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}else cell+=c;
 }if(quoted)throw new Error('CSV has an unfinished quote.');if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}return rows;};
const displayDate=x=>x instanceof Date&&!isNaN(+x)?x.toISOString().slice(0,10):String(x??'').trim();
function page(courses,intakes){const published=(courses||[]).filter(x=>x.is_active&&x.workflow_status==='published');
 return `<h1>Bulk manual registration</h1><p class="sub">Import paper applications using the official Excel or CSV template. Authorized admissions staff review every row before creating <b>unpaid, unapproved application drafts</b>. No Student ID, approved payment or admission is invented.</p>
 <div class="panel"><h3>1. Download the template</h3><p class="sub">Use the <b>Registrations</b> sheet. Keep the column headings unchanged; use one row per applicant. Unique email and paper Source Reference are required. Never add passwords or identity-document numbers to the spreadsheet.</p><div class="row"><a class="btn" href="templates/AHCT_Manual_Application_Bulk_Template.xlsx" download>Download Excel (.xlsx)</a><a class="btn g" href="templates/AHCT_Manual_Application_Bulk_Template.csv" download>Download CSV</a></div>
 <details><summary>Current intake and published course codes</summary><div class="grid"><div><h4>Intakes</h4>${(intakes||[]).map(x=>`<div><code>${safe(x.label)}</code></div>`).join('')||'No intakes configured'}</div><div><h4>Courses</h4>${published.map(x=>`<div><code>${safe(x.code)}</code> · ${safe(x.name)} (${safe(x.category)})</div>`).join('')||'No approved published courses'}</div></div></details></div>
 <div class="panel"><h3>2. Upload and validate</h3><p class="sub">Up to 100 rows per file; CSV or XLSX, 1 MB maximum. The spreadsheet is read in your browser and the validated rows are staged securely for confirmation.</p><input id="importFile" class="in" type="file" accept=".xlsx,.csv" aria-label="Select bulk application spreadsheet"><div class="row"><button class="btn" id="importPreview" type="button">Validate and preview</button><span id="importBusy" class="sub" role="status" aria-live="polite"></span></div><div id="importReport" aria-live="polite"></div><div class="row"><button class="btn g s" id="importHistory" type="button">View recent import batches</button><button class="btn g s" id="importDiscard" type="button" disabled>Discard preview</button></div><div id="importHistoryList"></div></div>
 <div class="panel"><h3>3. Confirm registration</h3><label class="chk" style="display:flex;gap:8px;align-items:flex-start"><input id="importConfirm" type="checkbox"><span>I have authorization to record these students and their contact details, reviewed the errors, verified the paper applications, and understand that email invitations will be sent when I confirm.</span></label><div class="row"><button class="btn" id="importCommit" type="button" disabled>Confirm and create application drafts</button></div><p class="sub">Payment verification, official Student ID allocation and admission approval remain separate controlled processes. Applicants must complete their remaining requirements through the portal.</p></div>`;
}
function mount({root,api,toast,load,render}){
 const fileInput=root.querySelector('#importFile'),preview=root.querySelector('#importPreview'),commit=root.querySelector('#importCommit'),confirm=root.querySelector('#importConfirm'),busy=root.querySelector('#importBusy'),report=root.querySelector('#importReport'),history=root.querySelector('#importHistory'),historyList=root.querySelector('#importHistoryList'),discard=root.querySelector('#importDiscard');if(!fileInput)return;
 let batchId='',processing=false;
 const renderErrors=errors=>`<div class="warnbox"><b>${errors.length} row issue(s) — no records imported.</b><div style="max-height:260px;overflow:auto">${errors.map(e=>`<p style="margin:6px 0">Row ${Number(e.row)}: ${safe(e.reason)}</p>`).join('')}</div></div>`;
 const setProcessing=(value,label)=>{processing=value;preview.disabled=value;commit.disabled=value||!batchId||!confirm.checked;discard.disabled=value||!batchId;fileInput.disabled=value;busy.textContent=label||'';};
 confirm.onchange=()=>{commit.disabled=processing||!batchId||!confirm.checked;};
 fileInput.onchange=()=>{batchId='';confirm.checked=false;commit.disabled=true;discard.disabled=true;report.textContent='';};
 history.onclick=async()=>{history.disabled=true;try{const j=await api('admin-bulk-import',{action:'history'});historyList.innerHTML=(j.batches||[]).map(b=>`<div class="row" style="justify-content:space-between"><small>${safe(b.file_name)} · ${safe(b.status)} · ${Number(b.row_count)} rows · ${safe(new Date(b.created_at).toLocaleString())}</small>${['partial','validated'].includes(b.status)?`<button class="btn g s" data-import-resume="${safe(b.id)}">Select batch</button>`:b.status==='processing'?`<button class="btn g s" data-import-recover="${safe(b.id)}">Recover if interrupted</button>`:''}</div>`).join('')||'<p class="sub">No previous batches for your account.</p>';historyList.querySelectorAll('[data-import-resume]').forEach(b=>b.onclick=()=>{batchId=b.dataset.importResume;confirm.checked=false;setProcessing(false,'Selected existing batch; confirm to continue.');});historyList.querySelectorAll('[data-import-recover]').forEach(b=>b.onclick=async()=>{try{await api('admin-bulk-import',{action:'recover',batchId:b.dataset.importRecover});toast('Interrupted import is eligible for a controlled retry.');history.click();}catch(e){toast(e.message,1);}});}catch(e){toast(e.message||'Could not load history',1);}finally{history.disabled=false;}};
 discard.onclick=async()=>{if(!batchId||!window.confirm('Discard this staged preview? No applications will be created.'))return;try{await api('admin-bulk-import',{action:'cancel',batchId});batchId='';confirm.checked=false;setProcessing(false,'Preview discarded');report.textContent='';toast('Preview discarded.');}catch(e){toast(e.message,1);}};
 preview.onclick=async()=>{const file=fileInput.files?.[0];if(!file)return toast('Choose the completed template first.',1);
  if(file.size>1024*1024)return toast('File exceeds 1 MB. Split it into smaller batches.',1);
  if(!/\.(csv|xlsx)$/i.test(file.name))return toast('Only Excel (.xlsx) or CSV files are supported.',1);
  setProcessing(true,'Validating rows…');batchId='';report.textContent='';
  try{const grid=/\.csv$/i.test(file.name)?parseCsv(await file.text()):await window.readXlsxFile(file);
   const headers=(grid[0]||[]).map(x=>String(x??'').replace(/^\uFEFF/,'').trim());
   if(headers.length!==HEADERS.length||headers.some((h,i)=>h!==HEADERS[i]))throw new Error('The spreadsheet headings were changed. Download the current template.');
   const raw=grid.slice(1).filter(r=>r.some(v=>String(v??'').trim()));
   if(raw.length<1||raw.length>100)throw new Error('Include 1–100 application rows (without blank rows).');
   const rows=raw.map(r=>Object.fromEntries(HEADERS.map((key,i)=>[key,displayDate(r[i])])));
   const result=await api('admin-bulk-import',{action:'preview',fileName:file.name,columns:headers,rows});
   if(!result.ready){report.innerHTML=renderErrors(result.errors||[{row:0,reason:'This import has already been started. Check with an administrator before retrying.'}]);return;}
   batchId=result.batchId;report.innerHTML=`<div class="notice i"><b>${result.valid} verified row(s) ready for confirmation.</b> No applications have been created yet.</div>`+
    `<div style="overflow-x:auto"><table><thead><tr><th>Row</th><th>Paper reference</th><th>Applicant</th><th>Courses</th></tr></thead><tbody>${(result.preview||[]).map(r=>`<tr><td>${Number(r.row)}</td><td>${safe(r.source)}</td><td>${safe(r.name)}</td><td>${safe(r.courses)}</td></tr>`).join('')}</tbody></table></div>`+
    (result.valid>10?`<p class="sub">First 10 shown; all ${result.valid} rows were validated.</p>`:'')+((result.warnings||[]).length?`<div class="warnbox"><b>Review possible phone duplicates:</b>${result.warnings.map(x=>`<p>Row ${Number(x.row)}: ${safe(x.reason)}</p>`).join('')}</div>`:'');
  }catch(err){report.innerHTML=renderErrors([{row:0,reason:err.message||'File could not be validated'}]);toast(err.message||'Validation failed',1);}finally{setProcessing(false,'');}
 };
 commit.onclick=async()=>{if(!batchId||!confirm.checked||processing)return;
  if(!window.confirm('Create the validated application drafts and email invitations? This action is recorded in the audit log.'))return;
  setProcessing(true,'Creating applications and sending invitations…');
  try{let result;for(let round=0;round<10;round++){result=await api('admin-bulk-import',{action:'commit',batchId,confirm:true});busy.textContent=`${Number(result.imported)} created; ${Number(result.pending||0)} awaiting processing…`;if(!result.pending)break;}
   report.innerHTML=`<div class="notice i"><b>Import ${safe(result.status)}</b> · ${Number(result.imported)} created · ${Number(result.failed)} require attention · ${Number(result.pending||0)} remaining.</div>`+(result.errors?.length?renderErrors(result.errors):'');
   if(result.status==='completed'){batchId='';confirm.checked=false;await load();toast('Applications created as drafts.');}else toast('Some rows require reconciliation. Keep this result for follow-up.',1);
  }catch(err){report.innerHTML=`<div class="warnbox">${safe(err.message||'Import was interrupted. Verify the import batch before retrying.')}</div>`;toast(err.message||'Import failed',1);}finally{setProcessing(false,'');}
 };
}
window.AHCTBulkRegistration={HEADERS,page,mount,parseCsv};
})();
