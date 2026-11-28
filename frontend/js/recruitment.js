(function(){
 'use strict';
 const cfg=window.APPLY_CONFIG||{},list=document.getElementById('vacancies'),detail=document.getElementById('vacancy-detail'),content=document.getElementById('detail-content'),count=document.getElementById('career-count');
 document.getElementById('yr').textContent=String(new Date().getFullYear());
 const escapeText=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=v=>v?new Date(v).toLocaleDateString('en-NG',{day:'numeric',month:'long',year:'numeric'}):'Until further notice';
 const updateCount=value=>{if(count)count.textContent=value};
 if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||!window.supabase){updateCount('Unavailable');list.textContent='Career opportunities are temporarily unavailable. Please check back later.';return;}
 const sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
 async function loadVacancies(){
  list.textContent='Loading opportunities…';updateCount('Checking…');
  let r;try{r=await sb.rpc('recruitment_public_vacancies')}catch(_){r={error:true}}
  if(r.error){updateCount('Unavailable');list.innerHTML='<div class="career-notice">Opportunities could not be loaded. Please try again shortly.</div>';return;}
  const rows=Array.isArray(r.data)?r.data:[];updateCount(String(rows.length));
  if(!rows.length){list.innerHTML='<div class="career-notice"><strong>Thank you for your interest in joining AH Consult.</strong><br>There are no open positions at the moment. Please visit this page again for future opportunities.</div>';return;}
  list.innerHTML=rows.map(v=>`<article class="vacancy-card"><h3><a href="?job=${encodeURIComponent(v.id)}#vacancy-detail" data-vacancy="${escapeText(v.id)}">${escapeText(v.title)}</a></h3><div class="vacancy-meta"><span>${escapeText(v.department||'AH Consult Ltd')}</span><span>${escapeText(v.location||'Nigeria')}</span><span>${escapeText(v.employment_type||'')}</span><span>Closes: ${escapeText(date(v.closes_at))}</span></div><p>${escapeText(v.summary||'')}</p><div class="vacancy-actions"><a class="btn btn-primary career-apply" href="?job=${encodeURIComponent(v.id)}#vacancy-detail" data-vacancy="${escapeText(v.id)}">Apply for this role <span aria-hidden="true">→</span></a><a class="btn" href="?job=${encodeURIComponent(v.id)}#vacancy-detail" data-vacancy="${escapeText(v.id)}">View position</a></div></article>`).join('');
  list.querySelectorAll('[data-vacancy]').forEach(link=>link.addEventListener('click',event=>{if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();showVacancy(link.dataset.vacancy)}));
 }
 let detailRequest=0;
 async function showVacancy(id){
  const request=++detailRequest;
  detail.hidden=false;content.innerHTML='<p>Loading position…</p>';detail.scrollIntoView({behavior:'smooth'});
  let r;try{r=await sb.rpc('recruitment_public_vacancy',{p_vacancy:id})}catch(_){r={error:true}}if(request!==detailRequest)return;const v=r.data;
  if(r.error||!v){content.innerHTML='<div class="career-notice">This position is no longer available. Please review the current opportunities above.</div>';await loadVacancies();return;}
  const section=(label,value)=>value?`<h3>${label}</h3><div class="career-description">${escapeText(value)}</div>`:'';
  content.innerHTML=`<button type="button" class="career-back" id="careerBack">← Back to opportunities</button><p class="eyebrow">CURRENT OPPORTUNITY</p><h2>${escapeText(v.title)}</h2><div class="vacancy-meta"><span>${escapeText(v.department||'AH Consult Ltd')}</span><span>${escapeText(v.location||'Nigeria')}</span><span>${escapeText(v.employment_type||'')}</span><span>Closes: ${escapeText(date(v.closes_at))}</span></div><a class="btn btn-primary career-apply" href="#apply-area">Apply now <span aria-hidden="true">↓</span></a>${section('About the role',v.description||v.summary)}${section('Responsibilities',v.responsibilities)}${section('Requirements',v.requirements)}<div id="apply-area" class="career-form-section"></div>`;
  content.querySelector('#careerBack').onclick=()=>{detailRequest++;detail.hidden=true;document.getElementById('opportunities').scrollIntoView({behavior:'smooth'});};
  renderApplication(v);
 }
 function renderApplication(v){
  const area=content.querySelector('#apply-area'),questions=Array.isArray(v.questions)?v.questions:[],submissionId=crypto.randomUUID();
  const fields=questions.map(q=>{
   const req=q.required?' required':'',id=escapeText(q.id),label=escapeText(q.prompt)+(q.required?' *':'');
   if(q.kind==='file')return `<label>${label}<input type="file" data-question="${id}" accept=".pdf,.docx,.jpg,.jpeg,.png"${req}></label>`;
   if(q.kind==='select'&&Array.isArray(q.options))return `<label>${label}<select data-question="${id}"${req}><option value="">Choose an option</option>${q.options.map(o=>`<option value="${escapeText(o)}">${escapeText(o)}</option>`).join('')}</select></label>`;
   if(q.kind==='text')return `<label>${label}<input type="text" data-question="${id}" maxlength="4000"${req}></label>`;
   return `<label>${label}<textarea data-question="${id}" maxlength="4000"${req}></textarea></label>`;
  }).join('');
  area.innerHTML=`<h3>Apply for this position</h3><p>Complete the form below. No account is required. Fields marked * are required.</p><form class="career-form" id="careerApplication"><label>Full name *<input name="full_name" autocomplete="name" maxlength="160" required></label><label>Email address *<input name="email" type="email" autocomplete="email" maxlength="254" required></label><label>Phone number *<input name="phone" type="tel" autocomplete="tel" maxlength="30" required></label>${fields}${v.requires_cv?'<label>CV or résumé *<input name="cv" type="file" accept=".pdf,.docx" required></label>':''}${v.requires_passport?'<label>Passport photograph *<input name="passport" type="file" accept=".jpg,.jpeg,.png" required></label>':''}<label><span><input name="consent" type="checkbox" required> I agree to the processing of my application in accordance with the <a href="privacy.html">privacy notice</a>. *</span></label><p>Files must be PDF, DOCX, JPG or PNG and no larger than 10 MB each; combined files must be no larger than 24 MB.</p><button class="btn btn-primary career-apply" type="submit">Submit application <span aria-hidden="true">→</span></button><p role="status" id="applicationMessage"></p></form>`;
  const form=area.querySelector('#careerApplication'),message=area.querySelector('#applicationMessage');
  form.onsubmit=async e=>{
   e.preventDefault();if(!form.reportValidity())return;const button=form.querySelector('[type=submit]');button.disabled=true;message.textContent='Submitting your application…';
   try{
    const answers={},payload=new FormData();let total=0;
    function addFile(key,file){if(!file)return;if(file.size>10*1024*1024)throw Error('Each file must be no larger than 10 MB.');const ext=file.name.split('.').pop().toLowerCase();if(!['pdf','docx','jpg','jpeg','png'].includes(ext))throw Error('Use PDF, DOCX, JPG or PNG files.');total+=file.size;if(total>24*1024*1024)throw Error('The combined file size must be under 24 MB.');payload.append(key,file);}
    for(const el of form.querySelectorAll('[data-question]')){if(el.type==='file')addFile('question:'+el.dataset.question,el.files[0]);else answers[el.dataset.question]=el.value.trim();}
    addFile('cv',form.elements.cv?.files[0]);addFile('passport',form.elements.passport?.files[0]);
    payload.append('payload',JSON.stringify({submission_id:submissionId,vacancy_id:v.id,full_name:form.elements.full_name.value.trim(),email:form.elements.email.value.trim(),phone:form.elements.phone.value.trim(),answers,consent:true}));
    const result=await sb.functions.invoke('recruitment-apply',{body:payload});
    if(result.error){let detail;try{detail=await result.error.context?.json()}catch(_){}throw Error(detail?.error||'We could not confirm your submission. Please contact the recruitment team before trying again.');}
    if(result.data?.error)throw Error(result.data.error);
    area.innerHTML='<div class="career-notice" role="status"><strong>Application submitted.</strong><br>Thank you for your interest in AH Consult. Our team will review your application.</div>';await loadVacancies();
   }catch(err){message.className='career-error';message.textContent=err.message||'We could not submit your application. Please try again.';button.disabled=false;}
  };
 }
 const linkedJob=new URLSearchParams(location.search).get('job');
 loadVacancies().then(()=>{if(linkedJob&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(linkedJob))showVacancy(linkedJob)});
})();
