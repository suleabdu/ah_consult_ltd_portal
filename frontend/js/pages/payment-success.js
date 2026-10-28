const m=document.getElementById('m'),esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),naira=n=>'\u20A6'+Number(n).toLocaleString();
const show=(k,t,p,extra)=>{m.innerHTML=`<div class="tick ${k}">${k==='x'?'!':k==='w'?'&hellip;':'&#10003;'}</div><h1>${t}</h1><p>${p}</p>${extra||''}`};
const isAuthFailure=e=>!!e&&(Number(e.status||e.statusCode||(e.context&&e.context.status)||0)===401||/invalid jwt|jwt expired|unauthorized|not authenticated|session.*expired/i.test(String(e.message||'')));
const clearAuth=()=>{try{const ref=new URL(window.APPLY_CONFIG.SUPABASE_URL).hostname.split('.')[0],key='sb-'+ref+'-auth-token';[localStorage,sessionStorage].forEach(s=>{s.removeItem(key);s.removeItem(key+'-code-verifier')})}catch(_){}};
const home='<div class="btns"><a href="apply.html">Back to my dashboard</a></div>';
(async function(){
 const C=window.APPLY_CONFIG;if(!window.supabase||!C||!C.SUPABASE_URL)return show('x','Setup problem','js/config.js or the Supabase library did not load.');
 document.querySelectorAll('.lg').forEach(i=>{if(C.LOGO_URL)i.src=C.LOGO_URL;else i.style.display='none'});
 const sb=supabase.createClient(C.SUPABASE_URL,C.SUPABASE_ANON_KEY),{data:{session}}=await sb.auth.getSession();
 if(!session)return show('x','Please sign in','Sign in to see your payment confirmation.','<div class="btns"><a href="apply.html">Sign in</a></div>');
 const P=new URLSearchParams(location.search),fromGateway=P.has('paymentReference')||P.has('transactionReference')||P.has('reference'),OK=['paid','submitted','under_review','approved'];
 let app=null,pays=[];
 for(let i=0;i<12;i++){ // payment provider/webhook updates can arrive a few seconds after redirect
  const {data,error:lookupError}=await sb.from('applications').select('*').eq('user_id',session.user.id).not('status','in','(expired,rejected)').order('created_at',{ascending:false}).limit(1).maybeSingle();if(lookupError){if(isAuthFailure(lookupError)){try{const pending=sb.auth.signOut({scope:'local'});if(pending&&typeof pending.catch==='function')pending.catch(()=>{})}catch(_){}clearAuth();return show('x','Please sign in again','Your login session expired or could not be verified. Sign in to check your payment status.','<div class="btns"><a href="apply.html#signin">Sign in</a></div>')}throw lookupError}app=data;
  if(app&&app.status==='pending_payment'&&app.pay_url){try{await fetch(C.SUPABASE_URL+'/functions/v1/verify-payment',{method:'POST',headers:{'Content-Type':'application/json',apikey:C.SUPABASE_ANON_KEY,Authorization:'Bearer '+session.access_token},body:JSON.stringify({applicationId:app.id})});const r2=await sb.from('applications').select('*').eq('id',app.id).maybeSingle();app=r2.data||app}catch(e){}}
  if(app&&OK.includes(app.status)){const r=await sb.from('payments').select('*').eq('application_id',app.id);if(r.error){if(isAuthFailure(r.error)){clearAuth();return show('x','Please sign in again','Your login session expired or could not be verified. Sign in to check your payment status.','<div class="btns"><a href="apply.html#signin">Sign in</a></div>')}throw r.error}pays=r.data||[];if(pays.length)break}
  const shouldWait=fromGateway||(app&&app.status==='pending_payment');if(!shouldWait||i===11)break;
  show('w','Confirming your payment','Your payment is being checked securely. Please do not pay twice.');await new Promise(r=>setTimeout(r,5000))}
 // Only database-verified payments are accepted; gateway query parameters are never trusted.
 if(!app||!OK.includes(app.status)||!pays.length)return show('x','No confirmed payment yet','This page opens only after a payment has been confirmed. If you have just paid, your confirmation may still be processing.',home);
 // Paid applications are submitted automatically. This database RPC is safe to retry for an already-submitted application.
 const finishSubmission=async()=>{
  if(app.status!=='paid')return true;
  const {data,error}=await sb.rpc('submit_application',{p_app:app.id});
  if(error){
   show('w','Payment confirmed — one more check needed','Your payment is verified. We could not finish the final submission check, and you do not need to pay again. Please retry below.',`<div class="kv"><div><span>Payment reference</span><b>${esc(pays[0]?.reference||app.pay_reference||'—')}</b></div></div><div class="btns"><button id="retrySubmission">Retry submission</button><a class="o" href="apply.html">Open application status</a></div>`);
   document.getElementById('retrySubmission')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;e.currentTarget.textContent='Checking…';const ok=await finishSubmission();if(ok)location.href='apply.html'});
   return false;
  }
  if(data)app=data;return true;
 };
 if(!(await finishSubmission()))return;
 try{localStorage.setItem('ahct_paid_seen_'+app.id,'1');localStorage.removeItem('ahct_flow_'+session.user.id);localStorage.removeItem('ahct_draft_'+app.id)}catch(_){}
 const [ac,cs,pr]=await Promise.all([sb.from('application_courses').select('course_code,fee_ngn').eq('application_id',app.id),sb.from('courses').select('code,name,category'),sb.from('profiles').select('full_name').eq('id',session.user.id).maybeSingle()]);
 const nm=Object.fromEntries((cs.data||[]).map(c=>[c.code,c.name+' ('+c.category+')'])),p=pays[0];
 const submitted=['submitted','under_review','approved'].includes(app.status);
 show('ok',submitted?'Application submitted successfully':'Payment confirmed','Thank you'+(pr.data?.full_name?', '+esc(pr.data.full_name):'')+'. '+(submitted?'Your application has been submitted. You can now track your admission status.':'Your payment is confirmed.'),
  `<div class="kv"><div><span>Application reference</span><b>${esc(app.student_id||String(app.id).slice(0,8).toUpperCase())}</b></div><div><span>Payment reference</span><b>${esc(p.reference)}</b></div><div><span>Payment date</span><b>${new Date(p.paid_at||app.paid_at).toLocaleString()}</b></div><div><span>Application status</span><b>${esc(app.admission_decision||app.status)}</b></div><div><span>Programme</span><b>${app.package_code?'Full Package':'Selected courses'}</b></div>${(ac.data||[]).map(x=>`<div><span>${esc(nm[x.course_code]||x.course_code)}</span><b>${app.package_code?'Included':naira(x.fee_ngn)}</b></div>`).join('')}</div>
   <div class="total"><span>Amount paid</span><span>${naira(p.paid_ngn)}</span></div>
   <div class="btns"><a href="apply.html">Track application status</a><button class="o" style="background:#fff;color:#1f2937;border:1px solid #d1d5db" id="printReceipt">Print payment receipt</button></div>`);
 document.getElementById('printReceipt')?.addEventListener('click',()=>window.print());
 // Keep the receipt on screen until the applicant chooses to continue.
})().catch(e=>show('x','Something went wrong',esc(e.message)+'.',home));
