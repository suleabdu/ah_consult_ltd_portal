(function(){
 'use strict';
 const cfg=window.APPLY_CONFIG||{},list=document.getElementById('vacancies'),detail=document.getElementById('vacancy-detail'),content=document.getElementById('detail-content');
 document.getElementById('yr').textContent=String(new Date().getFullYear());
 const escapeText=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=v=>v?new Date(v).toLocaleDateString('en-NG',{day:'numeric',month:'long',year:'numeric'}):'Until further notice';
 if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||!window.supabase){list.textContent='Career opportunities are temporarily unavailable. Please check back later.';return;}
 const sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
 async function loadVacancies(){
  list.textContent='Loading opportunities…';
  const r=await sb.rpc('recruitment_public_vacancies');
  if(r.error){list.innerHTML='<div class="career-notice">Opportunities could not be loaded. Please try again shortly.</div>';return;}
  const rows=Array.isArray(r.data)?r.data:[];
  if(!rows.length){list.innerHTML='<div class="career-notice"><strong>Thank you for your interest in joining AH Consult.</strong><br>There are no open positions at the moment. Please visit this page again for future opportunities.</div>';return;}
  list.innerHTML=rows.map(v=>`<article class="vacancy-card"><h3>${escapeText(v.title)}</h3><div class="vacancy-meta"><span>${escapeText(v.department||'AH Consult Ltd')}</span><span>${escapeText(v.location||'Nigeria')}</span><span>${escapeText(v.employment_type||'')}</span><span>Closes: ${escapeText(date(v.closes_at))}</span></div><p>${escapeText(v.summary||'')}</p><button class="btn" type="button" data-vacancy="${escapeText(v.id)}">View position</button></article>`).join('');
  list.querySelectorAll('[data-vacancy]').forEach(b=>b.addEventListener('click',()=>showVacancy(b.dataset.vacancy)));
 }
 async function showVacancy(id){
  detail.hidden=false;content.innerHTML='<p>Loading position…</p>';detail.scrollIntoView({behavior:'smooth'});
  const r=await sb.rpc('recruitment_public_vacancy',{p_vacancy:id}),v=r.data;
  if(r.error||!v){content.innerHTML='<div class="career-notice">This position is no longer available. Please review the current opportunities above.</div>';await loadVacancies();return;}
  const section=(label,value)=>value?`<h3>${label}</h3><div class="career-description">${escapeText(value)}</div>`:'';
  content.innerHTML=`<button type="button" class="career-back" id="careerBack">Back to opportunities</button><p class="eyebrow">CURRENT OPPORTUNITY</p><h2>${escapeText(v.title)}</h2><div class="vacancy-meta"><span>${escapeText(v.department||'AH Consult Ltd')}</span><span>${escapeText(v.location||'Nigeria')}</span><span>${escapeText(v.employment_type||'')}</span><span>Closes: ${escapeText(date(v.closes_at))}</span></div>${section('About the role',v.description||v.summary)}${section('Responsibilities',v.responsibilities)}${section('Requirements',v.requirements)}<div id="apply-area"><p>Checking your account…</p></div>`;
  content.querySelector('#careerBack').onclick=()=>{detail.hidden=true;document.getElementById('opportunities').scrollIntoView({behavior:'smooth'});};
  await renderApplication(v);
 }
 async function renderApplication(v){
  const area=content.querySelector('#apply-area'),session=(await sb.auth.getSession()).data.session;
  if(!session){
   area.innerHTML='<h3>Apply for this position</h3><p>Sign in or create an account to submit your application securely.</p><form class="career-form" id="careerAuth"><label>Email address<input type="email" name="email" autocomplete="email" required></label><label>Password<input type="password" name="password" autocomplete="current-password" minlength="8" required></label><div><button class="btn btn-primary" type="submit">Sign in</button> <button class="btn" type="button" id="createAccount">Create account</button></div><p role="status" class="career-error" id="authMessage"></p></form>';
   const f=area.querySelector('#careerAuth'),msg=area.querySelector('#authMessage');
   async function authenticate(signup){if(!f.reportValidity())return;const email=f.elements.email.value.trim(),password=f.elements.password.value;msg.textContent=signup?'Creating your account…':'Signing in…';const res=signup?await sb.auth.signUp({email,password}):await sb.auth.signInWithPassword({email,password});if(res.error){msg.textContent=res.error.message;return;}if(!res.data.session){msg.textContent='Check your email to confirm your account, then return here to sign in.';return;}await renderApplication(v);}
   f.onsubmit=e=>{e.preventDefault();authenticate(false)};area.querySelector('#createAccount').onclick=()=>authenticate(true);return;
  }
  const questions=Array.isArray(v.questions)?v.questions:[];
  const fields=questions.map(q=>{
   const req=q.required?' required':'',id=escapeText(q.id),label=escapeText(q.prompt)+(q.required?' *':'');
   if(q.kind==='file')return `<label>${label}<input type="file" data-question="${id}" accept=".pdf,.docx,.jpg,.jpeg,.png"${req}></label>`;
   if(q.kind==='select'&&Array.isArray(q.options))return `<label>${label}<select data-question="${id}"${req}><option value="">Choose an option</option>${q.options.map(o=>`<option value="${escapeText(o)}">${escapeText(o)}</option>`).join('')}</select></label>`;
   if(q.kind==='text')return `<label>${label}<input type="text" data-question="${id}" maxlength="4000"${req}></label>`;
   return `<label>${label}<textarea data-question="${id}" maxlength="4000"${req}></textarea></label>`;
  }).join('');
  area.innerHTML=`<h3>Apply for this position</h3><p>Signed in as ${escapeText(session.user.email||'your account')}. Fields marked * are required.</p><form class="career-form" id="careerApplication"><label>Full name *<input name="full_name" autocomplete="name" maxlength="160" required></label><label>Email address *<input name="email" type="email" autocomplete="email" value="${escapeText(session.user.email||'')}" maxlength="254" required></label><label>Phone number *<input name="phone" type="tel" autocomplete="tel" maxlength="30" required></label>${fields}${v.requires_cv?'<label>CV or résumé *<input name="cv" type="file" accept=".pdf,.docx" required></label>':''}${v.requires_passport?'<label>Passport photograph *<input name="passport" type="file" accept=".jpg,.jpeg,.png" required></label>':''}<label><span><input name="consent" type="checkbox" required> I agree to the processing of my application in accordance with the <a href="privacy.html">privacy notice</a>. *</span></label><p>Files must be PDF, DOCX, JPG or PNG and no larger than 10 MB each.</p><button class="btn btn-primary" type="submit">Submit application</button><p role="status" id="applicationMessage"></p></form>`;
  const form=area.querySelector('#careerApplication'),message=area.querySelector('#applicationMessage');
  form.onsubmit=async e=>{
   e.preventDefault();if(!form.reportValidity())return;const button=form.querySelector('[type=submit]');button.disabled=true;message.textContent='Submitting your application…';
   try{
    const answers={},attachments=[];
    async function upload(file){if(!file)return null;if(file.size>10*1024*1024)throw Error('Each file must be no larger than 10 MB.');const ext=file.name.split('.').pop().toLowerCase(),types={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png'};if(!types[ext])throw Error('Use PDF, DOCX, JPG or PNG files.');const path=session.user.id+'/'+v.id+'/'+crypto.randomUUID()+'.'+ext;const result=await sb.storage.from('recruitment-applications').upload(path,file,{contentType:types[ext],upsert:false});if(result.error)throw result.error;return path;}
    for(const el of form.querySelectorAll('[data-question]')){if(el.type==='file'){const path=await upload(el.files[0]);if(path)answers[el.dataset.question]=path;}else answers[el.dataset.question]=el.value.trim();}
    const cv=await upload(form.elements.cv?.files[0]),passport=await upload(form.elements.passport?.files[0]);
    const result=await sb.rpc('recruitment_submit_application',{p_vacancy:v.id,p_application:{full_name:form.elements.full_name.value.trim(),email:form.elements.email.value.trim(),phone:form.elements.phone.value.trim(),answers,cv_path:cv,passport_path:passport,attachments,consent:true}});
    if(result.error)throw result.error;area.innerHTML='<div class="career-notice"><strong>Application submitted.</strong><br>Thank you for your interest in AH Consult. Our team will review your application.</div>';await loadVacancies();
   }catch(err){message.className='career-error';message.textContent=err.message||'We could not submit your application. Please try again.';button.disabled=false;}
  };
 }
 const linkedJob=new URLSearchParams(location.search).get('job');
 loadVacancies().then(()=>{if(linkedJob&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(linkedJob))showVacancy(linkedJob)});
})();
