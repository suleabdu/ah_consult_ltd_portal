function esc(value){return String(value==null?'':value).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
function fatal(m){document.getElementById('auth').hidden=false;var v=document.getElementById('authForm');v.innerHTML='<h2>Setup problem</h2><p class="sub" style="color:#b91c1c">'+esc(m)+'</p><p class="sub">Open the browser console (F12) for more detail.</p>'}
window.addEventListener('error',function(e){fatal('Script error: '+e.message)});
window.addEventListener('unhandledrejection',function(e){
 var reason=e.reason||{},message=String(reason.message||reason||''),status=Number(reason.status||reason.statusCode||(reason.context&&reason.context.status)||0);
 var authFailure=status===401||/invalid jwt|jwt expired|unauthorized|not authenticated|session.*expired/i.test(message);e.preventDefault();
 if(authFailure){try{var cfg=window.APPLY_CONFIG,ref=cfg&&new URL(cfg.SUPABASE_URL).hostname.split('.')[0],key=ref&&('sb-'+ref+'-auth-token');if(key){localStorage.removeItem(key);sessionStorage.removeItem(key)}}catch(_){}try{sessionStorage.setItem('ahct_auth_flash','Your session has expired. Please sign in again.')}catch(_){}location.replace(location.pathname.replace(/[^/]*$/,'')+'apply.html#signin');return}
 console.error('Unhandled application promise:',reason);var app=document.getElementById('app'),target=(!app||app.hidden)?document.getElementById('msgA'):document.getElementById('msgB');if(target)target.innerHTML='<div class="notice e" role="alert">We could not complete that action. Please try again. If the problem continues, contact the training office.</div>';
});
(function(){
 var c=window.APPLY_CONFIG;
 if(!window.supabase)return fatal('The Supabase library did not load (blocked by a Content-Security-Policy, ad blocker, or network). Check Netlify _headers allows https://cdn.jsdelivr.net.');
 if(!c)return fatal('js/config.js did not load or does not define window.APPLY_CONFIG. Confirm the file exists at frontend/js/config.js and the page path is correct.');
 if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(c.SUPABASE_URL||''))return fatal('SUPABASE_URL is not set correctly in js/config.js. It must look like https://abcdxyz.supabase.co (no trailing slash, no /rest/v1).');
 if(!c.SUPABASE_ANON_KEY||c.SUPABASE_ANON_KEY.indexOf('YOUR')===0)return fatal('SUPABASE_ANON_KEY is missing in js/config.js.');
 startApp();
})();
function startApp(){
const C=window.APPLY_CONFIG,sb=supabase.createClient(C.SUPABASE_URL,C.SUPABASE_ANON_KEY);
document.querySelectorAll('.lg').forEach(i=>{if(C.LOGO_URL)i.src=C.LOGO_URL;else i.style.display='none'});
let view,ch=null,poll=null,payPollToken=0,signOutRunning=false;const $=s=>document.querySelector(s),naira=n=>'₦'+Number(n).toLocaleString();
function cleanup(){payPollToken++;if(poll){clearInterval(poll);poll=null}if(ch){try{sb.removeChannel(ch)}catch(e){console.warn('Could not remove realtime channel:',e)}ch=null}}
const S={catalog:null,intakeAll:[],photoUrl:null,previewCourses:[],previewCoursesFor:null,previewCoursesError:null,pre:null,w:null,pkgs:[],user:null,profile:null,nav:0,app:null,intakes:[],courses:[],picked:new Set(),intakeId:null,detailsReady:false};
const STATES=["Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara"];
function step(n){if(S.user)markNav(n-1)}
function note(t,k='e'){$(S.user?'#msgB':'#msgA').innerHTML=t?`<div class="notice ${k}" role="alert">${t}</div>`:''}
function fe(f,errs){document.querySelectorAll('.err').forEach(e=>e.textContent='');document.querySelectorAll('.bad').forEach(e=>e.classList.remove('bad'));
 for(const k in errs){const el=$('#e_'+k);if(el)el.textContent=errs[k];const i=$('#'+k);if(i)i.classList.add('bad')}
 const first=document.querySelector('.bad');if(first)first.focus()}
async function call(fn,body){const {data:{session}}=await sb.auth.getSession();
 if(!session){redirectToSignIn('Your session has expired. Please sign in again.');return {ok:false,status:401,error:'Your session has expired. Please sign in again.'}}
 const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),45000);
 try{const r=await fetch(`${C.SUPABASE_URL}/functions/v1/${fn}`,{method:'POST',signal:ctl.signal,headers:{'Content-Type':'application/json',apikey:C.SUPABASE_ANON_KEY,Authorization:'Bearer '+session.access_token},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));return {ok:r.ok,status:r.status,...j}}
 catch(e){console.error('Request to '+fn+' failed:',e);
  if(e.name==='AbortError')return {ok:false,error:'This is taking too long. Please check your connection and try again. Your progress is saved.'};
  if(e&&e.name==='TypeError')return {ok:false,error:'We could not reach the server. Check your internet connection and try again.'+(DEBUG?' [Debug: the request to "'+fn+'" failed before reaching Supabase. Check 1) the function is deployed, 2) the ALLOWED_ORIGIN secret is not blocking this site, 3) your internet.]':' If it keeps happening, contact support.')};
  return {ok:false,error:'Something unexpected went wrong. Please try again.'}}finally{clearTimeout(t)}}
function busy(b,t){b.disabled=true;b.dataset.t=b.textContent;b.textContent=t}function idle(b){b.disabled=false;b.textContent=b.dataset.t}

/* STEP 0: account (sign in / create account) */
const authBase=()=>location.origin+location.pathname.replace(/[^/]*$/,'');
const fld=(id,label,type,ac,ph,val)=>`<label for="${id}">${label}</label><input id="${id}" type="${type}" autocomplete="${ac}" ${ph?`placeholder="${ph}"`:''} ${val?`value="${esc(val)}"`:''}><div class="err" id="e_${id}"></div>`;
const pwField=(id,label,ac,ph)=>`<label for="${id}">${label}</label><div class="pwbox"><input id="${id}" type="password" autocomplete="${ac}" ${ph?`placeholder="${ph}"`:''}><button type="button" class="eye" data-t="${id}" aria-label="Show or hide password">Show</button></div><div class="err" id="e_${id}"></div>`;
function pwScore(p){let s=0;if(p.length>=8)s++;if(/[A-Z]/.test(p)&&/[a-z]/.test(p))s++;if(/\d/.test(p))s++;if(/[^A-Za-z0-9]/.test(p)||p.length>=12)s++;return s}
function authView(mode='up'){view=$('#authForm');const up=mode==='up';let saved='';try{saved=localStorage.getItem('ahct_email')||''}catch(_){}
 view.innerHTML=`<div class="seg" role="tablist"><button type="button" role="tab" class="${up?'on':''}" data-m="up">Create account</button><button type="button" role="tab" class="${up?'':'on'}" data-m="in">Sign in</button></div>
 <h2>${up?'Start your application':'Welcome back'}</h2><p class="sub">${up?'Create a free account to apply. It takes about a minute.':'Sign in to continue your application or open your student portal.'}</p>
 ${up?fld('full_name','Full name','text','name')+fld('phone','Phone number','tel','tel','08012345678'):''}
 ${fld('email','Email address','email',up?'email':'username','',saved)}
 ${pwField('pw','Password',up?'new-password':'current-password',up?'At least 8 characters':'')}
 ${up?'<div class="meter"><i id="mt"></i></div><div class="hint" id="mh">Use 8+ characters with letters and numbers.</div>'+pwField('pw2','Confirm password','new-password'):'<div class="row2"><label class="chk"><input type="checkbox" id="rem" '+(saved?'checked':'')+'> Remember my email</label><button type="button" class="lnk" id="fp">Forgot password?</button></div>'}
 <div class="warn" id="caps" hidden>Caps Lock is on.</div>
 <button id="go" type="button" class="cta">${up?'Create my account':'Sign in'}</button>
 <p class="fine">${up?'By creating an account you agree to receive messages about your application. ':''}Need help? <a href="mailto:ahconsultltd02@gmail.com">Contact us</a> &middot; <a href="/">Back to home</a></p>`;
 const keep=()=>{const e=$('#email');return e?e.value.trim():''};
 view.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>{const v=keep();if(v){try{localStorage.setItem('ahct_email',v)}catch(_){}}note('');authView(b.dataset.m)});
 view.querySelectorAll('.eye').forEach(b=>b.onclick=()=>{const i=$('#'+b.dataset.t);i.type=i.type==='password'?'text':'password';b.textContent=i.type==='password'?'Show':'Hide'});
 $('#pw').addEventListener('keyup',e=>{$('#caps').hidden=!(e.getModifierState&&e.getModifierState('CapsLock'))});
 if(up)$('#pw').oninput=()=>{const sc=pwScore($('#pw').value);$('#mt').style.width=(sc*25)+'%';$('#mt').style.background=['#dc2626','#dc2626','#f59e0b','#84cc16','#16a34a'][sc];$('#mh').textContent=['Use 8+ characters with letters and numbers.','Weak','Fair','Good','Strong'][sc]};
 if($('#fp'))$('#fp').onclick=async()=>{const e=keep();if(!/^\S+@\S+\.\S+$/.test(e))return fe(0,{email:'Enter your email first.'});
  const r=await sb.auth.resetPasswordForEmail(e,{redirectTo:authBase()+'forgot-password.html?next=apply'});note(r.error?esc(r.error.message):'If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.',r.error?'e':'i')};
 const submit=async e=>{const b=$('#go'),v=id=>($('#'+id)?.value||'').trim(),er={};
  if(up&&v('full_name').length<3)er.full_name='Enter your full name.';
  if(up&&!/^(\+234|0)[789][01]\d{8}$/.test(v('phone').replace(/\s/g,'')))er.phone='Enter a valid Nigerian phone number.';
  if(!/^\S+@\S+\.\S+$/.test(v('email')))er.email='Enter a valid email address.';
  if(($('#pw').value||'').length<8)er.pw='Use at least 8 characters.';
  if(up&&$('#pw').value!==$('#pw2').value)er.pw2='The two passwords do not match.';
  if(Object.keys(er).length)return fe(0,er);
  busy(b,up?'Creating your account...':'Signing in...');note('');
  const r=up?await sb.auth.signUp({email:v('email'),password:$('#pw').value,options:{emailRedirectTo:location.origin+location.pathname,data:{full_name:v('full_name'),phone:v('phone')}}}):await sb.auth.signInWithPassword({email:v('email'),password:$('#pw').value});
  idle(b);
  if(r.error){const m=r.error.message||'';return note(/invalid login/i.test(m)?'Email or password is incorrect.':/rate limit|too many/i.test(m)?'Too many attempts. Please wait a few minutes and try again.':/already registered|already been registered/i.test(m)?'This email already has an account. Use the Sign in tab.':/not confirmed/i.test(m)?'Please confirm your email first. Check your inbox for the verification link.':esc(m))}
  if(!up){try{if($('#rem')?.checked)localStorage.setItem('ahct_email',v('email'));else localStorage.removeItem('ahct_email')}catch(_){}}
  if(!r.data.session){note('Account created, but this Supabase project still requires email confirmation. An administrator must disable Confirm Email in Supabase Auth settings to allow automatic login. Email verification is optional only when configured at the authentication provider.','i');return authView('in')}
  boot()};
 $('#go').onclick=submit;view.querySelectorAll('input:not([type=checkbox])').forEach(i=>i.addEventListener('keydown',e=>{if(e.key==='Enter')submit()}))}
function initHero(){const sl=[...document.querySelectorAll('#slides .slide')],dots=$('#dots');if(!sl.length)return;let i=0,t;
 dots.innerHTML=sl.map((_,k)=>`<button type="button" aria-label="Slide ${k+1}" data-k="${k}"></button>`).join('');
 const show=k=>{i=k;sl.forEach((s,j)=>s.classList.toggle('on',j===k));dots.querySelectorAll('button').forEach((d,j)=>d.classList.toggle('on',j===k))};show(0);if(sl.length===1){dots.hidden=true;return;}
 dots.querySelectorAll('button').forEach(d=>d.onclick=()=>{show(+d.dataset.k);clearInterval(t)});
 if(!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)){t=setInterval(()=>show((i+1)%sl.length),5500);const h=$('.hero');h.onmouseenter=()=>clearInterval(t)}}

/* MINIMAL APPLICATION FLOW: Programme -> Your information -> Review & pay -> Status */
const DEBUG=new URLSearchParams(location.search).has('debug'),NEWAPP=new URLSearchParams(location.search).has('new'),RANK=['beginner','intermediate','advanced','professional'],rk=c=>{const i=RANK.indexOf(String(c).toLowerCase());return i<0?99:i};
const cats=()=>[...new Set(S.courses.map(x=>x.category))].sort((a,b)=>rk(a)-rk(b)||a.localeCompare(b));
const picked=()=>S.courses.filter(x=>S.picked.has(x.code));
const pkg=()=>S.w?.mode==='pkg'?S.pkgs[0]:null;
const total=()=>pkg()?pkg().fee_ngn:picked().reduce((s,x)=>s+Number(x.fee_ngn||0),0);
async function loadCatalog(){const [i,c,p]=await Promise.all([sb.from('intakes').select('*').eq('is_active',true),sb.from('courses').select('*').eq('is_active',true),sb.from('packages').select('*').eq('is_active',true)]);const now=Date.now();S.intakes=(i.data||[]).filter(x=>(!x.opens_at||now>=+new Date(x.opens_at))&&(!x.closes_at||now<=+new Date(x.closes_at))&&!(NEWAPP&&(S.myIntakes||[]).includes(x.id)));S.courses=c.data||[];S.pkgs=p.data||[];}
function flowKey(){return 'ahct_flow_'+(S.user?.id||'guest')}
function readFlowState(){try{return JSON.parse(localStorage.getItem(flowKey())||'null')}catch(_){return null}}
function saveFlowState(){if(!S.user||!S.w)return;try{localStorage.setItem(flowKey(),JSON.stringify({n:S.w.n,intake:S.w.intake,mode:S.w.mode,cat:S.w.cat,picked:[...S.picked],appId:S.app?.id||null}))}catch(e){console.warn('Could not save application progress locally:',e)}}
async function pickView(){
 await loadCatalog();
 if(!S.intakes.length){view=$('#content');view.innerHTML=`<div class="empty-state"><p class="eyebrow">APPLICATIONS</p><h2>${NEWAPP?'No new intake available':'Applications are currently closed'}</h2><p class="sub">${NEWAPP?'You already have an application for each open intake.':'There is no open intake right now. Please check back soon.'}</p><a class="text-link" href="/">Back to AH Consult home</a></div>`;return}
 const saved=readFlowState();
 const savedMatchesApp=!saved?.appId||!S.app?.id||saved.appId===S.app.id;
 const restore=saved&&savedMatchesApp?saved:null;
 const appIntake=(S.app?.status==='draft'&&S.app?.intake_id)?S.app.intake_id:null;
 const intakeList=S.intakes.map(x=>x.id);
 const chosenIntake=(appIntake&&intakeList.includes(appIntake))?appIntake:((restore?.intake&&intakeList.includes(restore.intake))?restore.intake:S.intakes[0].id);
 S.w={n:restore&&[1,2,3].includes(Number(restore.n))?Number(restore.n):1,intake:chosenIntake,mode:restore?.mode||'',cat:restore?.cat||'',appId:S.app?.id||null};
 S.picked=new Set((restore?.picked||[]).filter(code=>S.courses.some(c=>c.code===code)));
 if(!restore)applyCoursePref(S.w);
 saveFlowState();
 await continuousWizard();
}
async function ensureDraft(){
 if(S.app&&S.app.status==='draft'&&S.app.intake_id===S.w.intake){S.w.appId=S.app.id;return S.app;}
 if(S.app&&S.app.status!=='draft')throw new Error('This application has already moved to payment or review. Please open your application status to continue.');
 const r=await sb.rpc('start_application',{p_intake:S.w.intake});
 if(r.error)throw new Error(/not open|intake/i.test(r.error.message)?'This intake is no longer open. Please choose an available intake.':r.error.message);
 S.app=r.data;S.w.appId=S.app.id;saveFlowState();return S.app;
}
// Course deep-links from the homepage, e.g. apply.html?course=AutoCAD&category=Beginner. The choice is remembered for this browser
// tab (sign-up / sign-in may navigate away) and applied once, when the application wizard starts. Unknown values are ignored.
(function(){try{const q=new URLSearchParams(location.search),c=(q.get('course')||'').trim();if(c)sessionStorage.setItem('ahct_pref',JSON.stringify({course:c.slice(0,60),category:(q.get('category')||'').trim().slice(0,40)}))}catch(_){}})();
function applyCoursePref(w){
  try{
    const raw=sessionStorage.getItem('ahct_pref');if(!raw||!w||w.prefDone)return;
    w.prefDone=true;sessionStorage.removeItem('ahct_pref');
    const pref=JSON.parse(raw),norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]+/g,''),want=norm(pref.course),lvl=String(pref.category||'').toLowerCase();
    if(!want)return;
    const sameName=S.courses.filter(x=>{const n=norm(x.name);return n===want||n.startsWith(want)||want.startsWith(n)});   // "Lumion" matches "Lumion/Animation"
    const hit=lvl?sameName.find(x=>String(x.category).toLowerCase()===lvl):sameName.slice().sort((a,b)=>rk(a.category)-rk(b.category))[0];
    if(hit){w.mode='cat';w.cat=hit.category;S.picked.clear();S.picked.add(hit.code)}
  }catch(_){}
}
// Small helpers that were referenced but never defined (their absence broke payment creation and the deferment screen).
function uid(){ // idempotency key for create-application (must be 8-200 chars)
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const a = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = Math.floor(Math.random() * 256));
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}
function toast(message, isError){ // accessible, self-removing notification
  const t = document.createElement('div');
  t.setAttribute('role', isError ? 'alert' : 'status');
  t.textContent = message;
  t.style.cssText = 'position:fixed;right:14px;bottom:14px;max-width:min(92vw,380px);z-index:300;padding:11px 16px;border-radius:10px;color:#fff;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.2);background:' + (isError ? '#b42318' : '#111827');
  document.body.appendChild(t);
  setTimeout(() => t.remove(), isError ? 6000 : 3500);
}
// Passport photo: validate, auto-rotate, flatten transparency, then resize + re-encode as JPEG under the storage bucket's 100 KB limit.
async function compress(file){
  const MAX_BYTES = 95 * 1024, MAX_INPUT = 15 * 1024 * 1024, MAX_SIDE = 600, MIN_SIDE = 200;
  if (!file) throw new Error('Choose a passport photograph.');
  if (!/^image\/(jpeg|png)$/i.test(file.type)) throw new Error('Please upload a JPEG or PNG photograph.');
  if (file.size > MAX_INPUT) throw new Error('That photo is too large. Please choose one under 15 MB.');
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (_) {
    src = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image. Please choose another photograph.')); };
      img.src = url;
    });
  }
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
  if (!w0 || !h0) throw new Error('That file could not be read as an image. Please choose another photograph.');
  if (Math.min(w0, h0) < MIN_SIDE) throw new Error('That photo is too small. Use one at least ' + MIN_SIDE + ' pixels wide and tall.');
  let scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const g = canvas.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(src, 0, 0, w, h);   // white behind transparent PNGs
      for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', q));
        if (!blob) throw new Error('Your browser could not process that photo. Please try another photo or browser.');
        if (blob.size <= MAX_BYTES) return blob;
      }
      scale *= 0.8;                                   // still too big: shrink the picture and try again
    }
  } finally { if (src.close) src.close(); }
  throw new Error('That photo could not be reduced to under 100 KB. Please choose a simpler or smaller photograph.');
}
async function saveFormDraft(){if(!S.app?.id)throw new Error('Start your application before saving your details.');const f=collectDetails();if(!$('#pp')?.files?.[0]&&!S.app.passport_path)throw new Error('Upload your passport photograph.');let path=S.app.passport_path;const file=$('#pp')?.files?.[0];if(file){const blob=await compress(file);const {data:{user}}=await sb.auth.getUser();path=`${user.id}/${S.app.id}/passport.jpg`;const up=await sb.storage.from('passports').upload(path,blob,{contentType:'image/jpeg',upsert:true});if(up.error)throw new Error('Photo upload failed: '+up.error.message);}const r=await sb.rpc('save_application_form',{p_app:S.app.id,p_form:f,p_passport:path});if(r.error)throw new Error(userFacingError(r.error.message));S.app=r.data||S.app;S.app.form_data=S.app.form_data||f;S.app.passport_path=path;try{localStorage.setItem('ahct_draft_'+S.app.id,JSON.stringify(S.app.form_data));}catch(_){}if(file&&$('#pp')){ $('#pp').value='';const pv=$('#pv');if(pv)pv.innerHTML='<span class="pill ok">Passport photo saved</span>'; }return true;}
function formHtml(){
 let local={};try{local=JSON.parse(localStorage.getItem('ahct_draft_'+(S.app?.id||''))||'{}')}catch(_){}
 const profile=S.profile||{},meta=S.user?.user_metadata||{},rawName=String(profile.full_name||meta.full_name||'').trim(),parts=rawName.split(/\s+/).filter(Boolean);
 const defaults={firstName:parts[0]||'',surname:parts.length>1?parts[parts.length-1]:'',otherNames:parts.length>2?parts.slice(1,-1).join(' '):'',phone:profile.phone||meta.phone||''};
 const d={...defaults,...profile,...meta,...(S.app?.form_data||{}),...local};
 const field=(id,label,control,required=true)=>`<div class="form-field"><label for="${id}">${label}${required?' <span class="required-mark">*</span>':''}</label>${control}<div class="err" id="e_${id}"></div></div>`;
 return `<div class="form-intro"><h3>Your details</h3><p>Some details are already filled in from your account. Please check them and complete anything missing.</p></div>
 <div class="field-grid">
 ${field('surname','Surname',`<input id="surname" value="${esc(d.surname||'')}" autocomplete="family-name" required>`)}
 ${field('firstName','First name',`<input id="firstName" value="${esc(d.firstName||'')}" autocomplete="given-name" required>`)}
 ${field('otherNames','Other names',`<input id="otherNames" value="${esc(d.otherNames||'')}" autocomplete="additional-name">`,false)}
 ${field('phone','Phone number',`<input id="phone" value="${esc(d.phone||'')}" autocomplete="tel" inputmode="tel" placeholder="080…" required>`)}
 ${field('dob','Date of birth',`<input id="dob" type="date" max="${maxEligibleDob()}" value="${esc(d.dob||'')}" autocomplete="bday" required>`)}
 ${field('gender','Gender',`<select id="gender" required><option value="">Select gender</option><option ${d.gender==='Male'?'selected':''}>Male</option><option ${d.gender==='Female'?'selected':''}>Female</option></select>`)}
 ${field('state','State of residence',`<select id="state" required><option value="">Select state</option>${STATES.map(x=>`<option ${d.state===x?'selected':''}>${x}</option>`).join('')}</select>`)}
 <div class="form-field form-field-wide">${field('address','Home address',`<textarea id="address" rows="2" autocomplete="street-address" required>${esc(d.address||'')}</textarea>`)}</div>
 <div class="form-field form-field-wide passport-field"><label for="pp">Passport photograph <span class="required-mark">*</span></label><p class="field-help">Upload a clear JPEG or PNG photo. Maximum original file size: 15 MB.</p><div class="passport-upload"><input id="pp" type="file" accept="image/jpeg,image/png"><div id="pv">${S.app?.passport_path?'<span class="pill ok">Passport photo already saved</span>':'No photo selected yet'}</div></div><div class="err" id="e_passport"></div></div>
 </div><div class="autosave-row"><span class="save-dot" aria-hidden="true"></span><span id="autosaveState" role="status">Your progress saves as you work.</span></div>`;
}
function wizard(){return continuousWizard()}
function progressHtml(current){
 const labels=['Programme','Your information','Review & pay'];
 return `<ol class="application-progress" aria-label="Application progress">${labels.map((label,i)=>`<li class="${i+1===current?'current':i+1<current?'complete':''}" ${i+1===current?'aria-current="step"':''}><span class="progress-number">${i+1<current?'&#10003;':i+1}</span><span class="progress-label">${label}</span></li>`).join('')}</ol>`;
}
function flowTitle(kicker,title,copy,n){return `${progressHtml(n)}<header class="stage-heading"><p class="eyebrow">${kicker}</p><h1>${title}</h1><p>${copy}</p></header>`}
function courseSelectionValid(){
 if(!S.w)return false;
 if(S.w.mode==='pkg'){const categories=cats();return categories.length>0&&categories.every(c=>S.courses.some(x=>x.category===c&&S.picked.has(x.code)));}
 return S.w.mode==='cat'&&!!S.w.cat&&S.picked.size>0&&[...S.picked].every(code=>S.courses.some(x=>x.code===code&&x.category===S.w.cat));
}
function programmeChoicesHtml(){
 const categoryChoices=cats().map((c,i)=>`<label class="programme-choice ${S.w.cat===c&&S.w.mode==='cat'?'selected':''}" data-programme-choice="${esc(c)}"><input type="radio" name="programmePath" value="${esc(c)}" ${S.w.cat===c&&S.w.mode==='cat'?'checked':''}><span class="choice-copy"><strong>${esc(c)}</strong><small>${S.courses.filter(x=>x.category===c).length} course options</small></span><span class="choice-mark" aria-hidden="true"></span></label>`).join('');
 const p=S.pkgs[0];const packageChoice=p?`<label class="programme-choice package-choice ${S.w.mode==='pkg'?'selected':''}" data-programme-choice="__FULL__"><input type="radio" name="programmePath" value="__FULL__" ${S.w.mode==='pkg'?'checked':''}><span class="choice-copy"><strong>${esc(p.name)}</strong><small>Choose one course from each category</small></span><span class="choice-price">${naira(p.fee_ngn)}</span></label>`:'';
 return categoryChoices+packageChoice;
}
function renderCoursePicker(){
 const target=$('#coursePicker');if(!target)return;
 if(!S.w.mode){target.innerHTML='<div class="empty-hint">Choose a programme above to see the available courses.</div>';updateProgrammeSummary();return;}
 const list=S.w.mode==='pkg'?cats():[S.w.cat];
 target.innerHTML=list.filter(Boolean).map(c=>`${S.w.mode==='pkg'?`<div class="course-group-title">${esc(c)}</div>`:''}${S.courses.filter(x=>x.category===c).map(x=>`<label class="course-option ${S.picked.has(x.code)?'selected':''}"><input type="checkbox" value="${esc(x.code)}" ${S.picked.has(x.code)?'checked':''}><span class="course-copy"><strong>${esc(x.name)}</strong><small>${S.w.mode==='pkg'?'Included in package':esc(c)}</small></span><span class="course-price">${S.w.mode==='pkg'?'Included':naira(x.fee_ngn)}</span></label>`).join('')}`).join('')||'<div class="empty-hint">There are no courses available for this option. Please choose another category.</div>';
 target.querySelectorAll('input[type="checkbox"]').forEach(input=>input.addEventListener('change',()=>{
  const code=input.value,course=S.courses.find(x=>x.code===code);
  if(S.w.mode==='pkg'&&input.checked&&course){for(const old of [...S.picked]){const item=S.courses.find(x=>x.code===old);if(item&&item.category===course.category)S.picked.delete(old)}}
  if(input.checked)S.picked.add(code);else S.picked.delete(code);
  target.querySelectorAll('.course-option').forEach(label=>{const box=label.querySelector('input[type=checkbox]');if(!box)return;box.checked=S.picked.has(box.value);label.classList.toggle('selected',box.checked)});
  saveFlowState();updateProgrammeSummary();
 }));
 updateProgrammeSummary();
}
function updateProgrammeSummary(){
 const count=$('#selectedCount'),sum=$('#selectedTotal'),hint=$('#selectionHint'),next=$('#toDetails');
 if(count)count.textContent=`${S.picked.size} course${S.picked.size===1?'':'s'} selected`;
 if(sum)sum.textContent=naira(total());
 if(next)next.disabled=!courseSelectionValid()||!S.w.intake;
 if(hint){if(!S.w.mode)hint.textContent='Choose a programme to continue.';else if(S.w.mode==='pkg'&&!courseSelectionValid())hint.textContent='Choose one course under every category to continue.';else if(!courseSelectionValid())hint.textContent='Select at least one course to continue.';else hint.textContent='Your selection is ready. You can review everything before paying.';}
 document.querySelectorAll('[data-programme-choice]').forEach(label=>{const inp=label.querySelector('input');label.classList.toggle('selected',!!inp&&inp.checked)});
}
async function renderProgrammeStage(){
 view=$('#content');
 const lockIntake=!!(S.app?.status==='draft'&&S.app?.intake_id===S.w.intake);
 view.innerHTML=`<div class="application-flow">${flowTitle('STEP 1 OF 3','Choose your training','Select an intake, then choose a programme and course. You will see the full cost before payment.',1)}<section class="stage-card"><div class="form-field"><label for="intake">Training intake <span class="required-mark">*</span></label><select id="intake" ${lockIntake?'disabled':''}>${S.intakes.map(x=>`<option value="${x.id}" ${x.id===S.w.intake?'selected':''}>${esc(x.label)}</option>`).join('')}</select>${lockIntake?'<p class="field-help">This intake is attached to your saved application.</p>':''}</div><div class="stage-section"><div class="section-title-row"><div><h2>What would you like to study?</h2><p class="field-help">Choose a category or the Full Package.</p></div></div><div class="programme-grid">${programmeChoicesHtml()}</div></div><div class="stage-section course-section"><div class="section-title-row"><div><h2>Choose your course</h2><p class="field-help">Select one or more courses. For the Full Package, select one course from every category.</p></div></div><div id="coursePicker"></div></div><div class="selection-footer"><div><span id="selectedCount">0 courses selected</span><strong id="selectedTotal">${naira(total())}</strong><small id="selectionHint">Choose a programme to continue.</small></div><button type="button" id="toDetails" disabled>Continue to your details <span aria-hidden="true">&#8594;</span></button></div></section><p class="privacy-note">Your application progress is saved while you work. You can review your choices before you pay.</p></div>`;
 const intake=$('#intake');if(intake)intake.onchange=()=>{S.w.intake=intake.value;saveFlowState();updateProgrammeSummary()};
 document.querySelectorAll('input[name="programmePath"]').forEach(input=>input.addEventListener('change',()=>{
  const value=input.value;
  if(value==='__FULL__'){S.w.mode='pkg';S.w.cat=''}else{S.w.mode='cat';S.w.cat=value}
  S.picked.clear();saveFlowState();document.querySelectorAll('[data-programme-choice]').forEach(label=>{const r=label.querySelector('input');label.classList.toggle('selected',!!r&&r.checked)});renderCoursePicker();updateProgrammeSummary();
 }));
 renderCoursePicker();
 $('#toDetails').onclick=async e=>{
  const b=e.currentTarget;if(!courseSelectionValid())return;
  busy(b,'Saving your application…');
  try{await ensureDraft();S.w.n=2;saveFlowState();await continuousWizard();}
  catch(err){note(esc(userFacingError(err.message)));idle(b);}
 };
}
function collectDetails(){const get=id=>String($('#'+id)?.value||'').trim();let legacy={};try{legacy=JSON.parse(localStorage.getItem('ahct_draft_'+(S.app?.id||''))||'{}')}catch(_){}legacy={...(S.app?.form_data||{}),...legacy};return {surname:get('surname'),firstName:get('firstName'),otherNames:get('otherNames'),phone:get('phone').replace(/\s/g,''),dob:get('dob'),gender:get('gender'),state:get('state'),address:get('address'),education:legacy.education||'',occupation:legacy.occupation||'',skills:legacy.skills||'',laptop:legacy.laptop||'',battery:legacy.battery||''}}
function validApplicantAge(dob){if(!/^\d{4}-\d{2}-\d{2}$/.test(dob||''))return false;const date=new Date(dob+'T00:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==dob)return false;const t=new Date(),cutoff=new Date(Date.UTC(t.getUTCFullYear()-16,t.getUTCMonth(),t.getUTCDate()));return date<=cutoff}
function maxEligibleDob(){const d=new Date();return new Date(Date.UTC(d.getUTCFullYear()-16,d.getUTCMonth(),d.getUTCDate())).toISOString().slice(0,10)}
function detailErrors(){
 const f=collectDetails(),errors={};
 if(!f.surname)errors.surname='Enter your surname.';if(!f.firstName)errors.firstName='Enter your first name.';
 if(!/^(\+234|0)[789][01]\d{8}$/.test(f.phone))errors.phone='Enter a valid Nigerian phone number, e.g. 08012345678.';
 if(!validApplicantAge(f.dob))errors.dob='Applicants must be at least 16 years old. Enter a valid date of birth.';
 if(!['Male','Female'].includes(f.gender))errors.gender='Select your gender.';if(!STATES.includes(f.state))errors.state='Select your state.';
 if(f.address.length<3)errors.address='Enter your home address.';
 if(!$('#pp')?.files?.[0]&&!S.app?.passport_path)errors.passport='Upload your passport photograph.';
 return errors;
}
function persistLocalDetails(){if(!S.app?.id)return;try{localStorage.setItem('ahct_draft_'+S.app.id,JSON.stringify(collectDetails()))}catch(e){console.warn('Could not save details locally:',e)}}
async function renderDetailsStage(){
 view=$('#content');
 view.innerHTML=`<div class="application-flow">${flowTitle('STEP 2 OF 3','Your information','Confirm your details. We have prefilled what we know from your account, so you only need to complete or correct the rest.',2)}<section class="stage-card">${formHtml()}<div class="stage-actions"><button type="button" class="secondary-action" id="backProgramme">&#8592; Back</button><button type="button" id="toReview">Review details &amp; payment <span aria-hidden="true">&#8594;</span></button></div></section><p class="privacy-note">Your details are used to process your application. You can check them again before payment.</p></div>`;
 document.querySelectorAll('#content input:not([type="file"]),#content select,#content textarea').forEach(el=>{el.addEventListener('input',()=>{persistLocalDetails();scheduleAutoSave()});el.addEventListener('change',()=>{persistLocalDetails();scheduleAutoSave()})});
 $('#pp').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;const pv=$('#pv');try{const blob=await compress(file);if(pv)pv.innerHTML=`<span class="pill ok">${esc(file.name)} · ${Math.max(1,Math.round(blob.size/1024))} KB ready</span>`;persistLocalDetails();scheduleAutoSave()}catch(err){if(pv)pv.textContent='';fe(0,{passport:err.message})}});
 $('#backProgramme').onclick=()=>{clearTimeout(autoSaveTimer);S.w.n=1;saveFlowState();continuousWizard()};
 $('#toReview').onclick=async e=>{const b=e.currentTarget,errors=detailErrors();if(Object.keys(errors).length){fe(0,errors);return}busy(b,'Saving your details…');clearTimeout(autoSaveTimer);try{await autoSavePromise.catch(()=>{});await saveFormDraft();S.w.n=3;saveFlowState();await continuousWizard()}catch(err){note(esc(userFacingError(err.message)));idle(b)}};
}
function userFacingError(message){const m=String(message||'');if(/duplicate key|unique constraint|already exists/i.test(m))return 'We found an existing application. Open Application status or contact the training office for help.';if(/not signed in|jwt|session/i.test(m))return 'Your session has expired. Please sign in again to continue.';if(/network|fetch|timeout|timed out/i.test(m))return 'We could not reach the server. Your details are saved on this device; check your connection and try again.';if(/payment has not been confirmed/i.test(m))return 'Your payment has not been verified yet. We will complete submission as soon as it is confirmed.';return m||'Something went wrong. Please try again.'}
let autoSaveTimer=null,autoSavePromise=Promise.resolve();
function scheduleAutoSave(){
 clearTimeout(autoSaveTimer);if(!$('#surname')||!S.app?.id)return;
 persistLocalDetails();const errors=detailErrors();if(Object.keys(errors).length)return;
 autoSaveTimer=setTimeout(async()=>{const state=$('#autosaveState');if(state)state.textContent='Saving your details…';autoSavePromise=saveFormDraft().then(()=>{const current=$('#autosaveState');if(current)current.textContent='Saved securely';}).catch(err=>{console.warn('Background application save:',err.message);const current=$('#autosaveState');if(current)current.textContent='Saved on this device; sync will retry when you continue.'});await autoSavePromise;},1200);
}
async function renderReviewStage(){
 view=$('#content');
 if(S.app?.passport_path&&!S.photoUrl){try{const r=await sb.storage.from('passports').createSignedUrl(S.app.passport_path,1800);if(r.data?.signedUrl)S.photoUrl=r.data.signedUrl}catch(e){console.warn('Could not preview passport:',e)}}
 const f=S.app?.form_data||collectDetails(),name=[f.firstName,f.otherNames,f.surname].filter(Boolean).join(' '),it=S.intakes.find(x=>x.id===S.w.intake)||S.intakeAll.find(x=>x.id===S.w.intake),P=pkg(),courses=picked();
 const coursesHtml=courses.map(c=>`<div class="review-course"><div><strong>${esc(c.name)}</strong><small>${esc(c.category)}</small></div><b>${P?'Included':naira(c.fee_ngn)}</b></div>`).join('');
 view.innerHTML=`<div class="application-flow">${flowTitle('STEP 3 OF 3','Review before you pay','Please check the important details below. Once your payment is verified, your application will be submitted automatically.',3)}<section class="stage-card review-stage"><div class="review-section"><div class="review-section-head"><div><h2>Applicant</h2><p class="field-help">Your personal details</p></div><button type="button" class="inline-edit" id="editDetails">Edit</button></div><div class="review-person">${S.photoUrl?`<img src="${esc(S.photoUrl)}" alt="Passport photograph">`:'<div class="review-photo-placeholder">Photo</div>'}<div class="review-data-grid"><div><span>Full name</span><strong>${esc(name)}</strong></div><div><span>Email</span><strong>${esc(S.user?.email)}</strong></div><div><span>Phone</span><strong>${esc(f.phone)}</strong></div><div><span>Date of birth</span><strong>${esc(f.dob)}</strong></div><div><span>State</span><strong>${esc(f.state)}</strong></div></div></div></div><div class="review-section"><div class="review-section-head"><div><h2>Training selection</h2><p class="field-help">${esc(it?.label||'Selected intake')}</p></div><button type="button" class="inline-edit" id="editProgramme">Edit</button></div><div class="review-programme"><div><span>Programme</span><strong>${esc(P?.name||(S.w.mode==='pkg'?'Full Package':S.w.cat))}</strong></div><div><span>Courses selected</span><strong>${courses.length}</strong></div></div>${coursesHtml}</div><div class="review-total"><div><span>Total to pay</span><small>Secure payment · Application submission follows payment verification</small></div><strong>${naira(total())}</strong></div><label class="review-consent" for="confirmDetails"><input type="checkbox" id="confirmDetails"><span><strong>I confirm that these details are correct.</strong><small>I understand that AH Consult will submit my application after my payment is successfully verified.</small></span></label><div class="stage-actions"><button type="button" class="secondary-action" id="backDetails">&#8592; Back</button><button type="button" id="paySubmit" disabled>Pay &amp; submit application <span aria-hidden="true">&#8594;</span></button></div></section><p class="privacy-note">Never share your password or payment confirmation code with anyone. AH Consult will update your status here.</p></div>`;
 $('#editDetails').onclick=()=>{S.w.n=2;saveFlowState();continuousWizard()};$('#backDetails').onclick=()=>{S.w.n=2;saveFlowState();continuousWizard()};$('#editProgramme').onclick=()=>{S.w.n=1;saveFlowState();continuousWizard()};
 $('#confirmDetails').onchange=e=>{$('#paySubmit').disabled=!e.target.checked};
 $('#paySubmit').onclick=async e=>{const b=e.currentTarget;if(!$('#confirmDetails').checked)return;busy(b,'Preparing secure payment…');
  try{await sb.rpc('save_application_form',{p_app:S.app.id,p_form:S.app.form_data||f,p_passport:S.app.passport_path}).then(r=>{if(r.error)throw new Error(r.error.message)});
   const r=await call('create-application',{applicationId:S.app.id,intakeId:S.w.intake,courseCodes:[...S.picked],packageCode:P?.code||null,key:uid(),returnUrl:authBase()+'payment-success'});
   if(!r.ok)throw new Error(r.error||'We could not prepare your payment. Please try again.');
   S.app=r.application||S.app;saveFlowState();
   if(S.app.status==='paid'){await finalizeAndShowStatus();return;}
   if(S.app.pay_url){location.href=S.app.pay_url;return;}
   payView();
  }catch(err){note(esc(userFacingError(err.message)));idle(b)}
 };
}
async function continuousWizard(){
 if(!S.w){await pickView();return;}
 if(!S.courses.length||!S.intakes.length)await loadCatalog();
 if(S.w.n===1)await renderProgrammeStage();else if(S.w.n===2)await renderDetailsStage();else {S.w.n=3;await renderReviewStage();}
 saveFlowState();markNav(S.w.n);
}
async function completePaidApplication(){
 if(!S.app?.id)return S.app;
 if(S.app.status==='paid'){
  const {data,error}=await sb.rpc('submit_application',{p_app:S.app.id});
  if(error)throw new Error(error.message||'Application submission could not be completed.');
  if(data)S.app=data;
 }
 if(S.app?.status==='submitted'||S.app?.status==='under_review'||S.app?.admission_decision==='approved'){try{localStorage.removeItem('ahct_draft_'+S.app.id);localStorage.removeItem(flowKey())}catch(_){}}
 return S.app;
}
async function finalizeAndShowStatus(){
 try{await completePaidApplication();cleanup();await statusView()}
 catch(err){renderCompletionError(err)}
}
function renderCompletionError(err){view=$('#content');view.innerHTML=`<div class="application-flow"><section class="stage-card completion-message"><div class="status-icon pending">&#8987;</div><p class="eyebrow">PAYMENT VERIFIED</p><h1>Your payment is safe</h1><p>We have verified your payment, but a final submission check did not finish. You do not need to pay again. Retry the submission check below.</p><div class="reference-box"><span>Application reference</span><strong>${esc(S.app?.student_id||String(S.app?.id||'').slice(0,8).toUpperCase())}</strong></div><button id="retrySubmission" type="button">Retry application submission</button><p class="field-help">If this message remains, contact the AH Consult training office and share the reference above.</p></section></div>`;$('#retrySubmission').onclick=async e=>{busy(e.currentTarget,'Checking…');await finalizeAndShowStatus()}}
function payView(){
 cleanup();const a=S.app;view=$('#content');
 view.innerHTML=`<div class="application-flow">${progressHtml(3)}<section class="stage-card payment-wait"><p class="eyebrow">PAYMENT</p><h1>Complete your payment</h1><p class="stage-copy">Use the payment details below. Your application will be submitted automatically after AH Consult verifies the payment.</p><div class="payment-amount"><span>Amount to pay</span><strong>${naira(a.total_ngn||total())}</strong></div>${a.pay_url?`<a class="payment-link" href="${esc(a.pay_url)}" target="_blank" rel="noopener">Open secure payment page</a>`:`<div class="bank-details"><div><span>Bank</span><strong>${esc(a.pay_bank||'Details will appear here')}</strong></div><div><span>Account number</span><strong>${esc(a.pay_account||'—')}</strong></div><div><span>Payment reference</span><strong>${esc(a.pay_reference||'—')}</strong></div><button type="button" class="secondary-action" id="copyReference">Copy reference</button></div>`}<div class="payment-wait-note" id="ps" role="status">Waiting for payment confirmation… Do not pay twice.</div><button type="button" class="check-payment" id="chk">I've paid — check status</button><button type="button" class="text-button" id="backToStatus">Return to application status</button></section></div>`;
 $('#copyReference')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(a.pay_reference||'');toast('Payment reference copied.')}catch(_){toast('Please copy the reference manually.',1)}});
 let checking=false;const check=async()=>{if(checking)return;checking=true;try{const {data,error}=await sb.from('applications').select('*').eq('id',a.id).single();if(error)throw error;if(data){S.app=data;await renderApplicantIdentity();if(data.status==='paid'||data.status==='submitted'||data.status==='under_review'||data.admission_decision==='approved'){cleanup();await finalizeAndShowStatus();return;}const ps=$('#ps');if(ps)ps.textContent='Payment is not confirmed yet. If you have just paid, wait a moment and check again.'}}catch(err){console.warn('Payment status check failed:',err.message);const ps=$('#ps');if(ps)ps.textContent='We could not check right now. Confirm your internet connection and try again.'}finally{checking=false}};
 $('#chk').onclick=async e=>{busy(e.currentTarget,'Checking…');if(a.pay_url){const r=await call('verify-payment',{applicationId:a.id});if(!r.ok)toast(userFacingError(r.error),1);}else{const r=await claimPayment(a.id);if(!r.ok)toast(userFacingError(r.error),1);}await check();if($('#chk'))idle($('#chk'))};$('#backToStatus').onclick=()=>statusView();
 ch=sb.channel('app-'+a.id).on('postgres_changes',{event:'UPDATE',schema:'public',table:'applications',filter:`id=eq.${a.id}`},()=>check()).subscribe();
 // Realtime is primary; backoff is a fallback for temporary websocket failures.
 // Never poll a background tab every 12 seconds across thousands of students.
 const token=payPollToken;
 let delay=30000;
 const schedule=()=>{
  if(token!==payPollToken)return;
  poll=setTimeout(async()=>{
   if(token!==payPollToken)return;
   if(!document.hidden)await check();
   if(token!==payPollToken)return;
   delay=Math.min(120000,Math.round(delay*1.5));
   schedule();
  },delay+Math.round(Math.random()*8000));
 };
 schedule();
}
async function claimPayment(id){let timer;const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve({error:{message:'timeout'}}),15000)});const result=await Promise.race([sb.rpc('claim_payment',{p_app:id}),timeout]);clearTimeout(timer);if(result.error){console.error('claim_payment failed:',result.error);return {ok:false,error:result.error.message==='timeout'?'This is taking too long. Please check your connection and try again.':(DEBUG?result.error.message:'We could not send your payment notice. Please try again.')}}return {ok:true,application:result.data}}

function applicationStatusText(a){if(!a)return 'No application started';if(a.admission_decision==='approved')return 'Admitted';if(a.admission_decision==='rejected')return 'Decision recorded';if(a.admission_decision==='under_review'||a.status==='under_review')return 'Under review';if(a.status==='pending_payment')return 'Awaiting payment';if(a.status==='paid')return 'Payment confirmed';if(a.status==='submitted')return 'Submitted for review';return 'Application in progress'}
async function renderApplicantIdentity(){const box=$('#applicantIdentity');if(!box||!S.user)return;const a=S.app||{},f=a.form_data||{},name=[f.firstName,f.otherNames,f.surname].filter(Boolean).join(' ').trim()||S.profile?.full_name||S.user.user_metadata?.full_name||S.user.email||'Applicant';const photo=$('#identityPhoto'),initials=$('#identityInitials');$('#identityName').textContent=name;$('#identityReference').textContent=a.student_id?('Student ID '+a.student_id):(a.id?('Application '+String(a.id).slice(0,8).toUpperCase()):'Applicant account');$('#identityStatus').textContent=applicationStatusText(a);$('#menuEmail').textContent=S.user.email||name;initials.textContent=(name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('')||'AH').toUpperCase();box.hidden=false;photo.hidden=true;photo.removeAttribute('src');initials.hidden=false;if(a.passport_path){try{const r=await sb.storage.from('passports').createSignedUrl(a.passport_path,1800);if(r.data?.signedUrl){photo.onload=()=>{photo.hidden=false;initials.hidden=true};photo.onerror=()=>{photo.hidden=true;initials.hidden=false};photo.src=r.data.signedUrl}}catch(e){console.warn('Could not load applicant passport for sidebar:',e)}}}
function isAuthFailure(err){if(!err)return false;const status=Number(err.status||err.statusCode||(err.context&&err.context.status)||0),message=String(err.message||err.details||err.hint||'');return status===401||/invalid jwt|jwt expired|unauthorized|not authenticated|session.*expired/i.test(message)}
async function refreshApp(){if(signOutRunning||!S.user)return null;const sessionCheck=await sb.auth.getSession(),session=sessionCheck.data?.session;if(!session||session.user?.id!==S.user.id){redirectToSignIn('Your session has expired. Please sign in again.');return null}const {data,error}=await sb.from('applications').select('*').eq('user_id',S.user.id).not('status','eq','expired').order('created_at',{ascending:false}).limit(1).maybeSingle();if(error){if(isAuthFailure(error)){redirectToSignIn('Your session has expired. Please sign in again.');return null}throw error}S.app=data;await renderApplicantIdentity();return data;}
function documentationVerified(a){if(!a)return false;const key=Object.prototype.hasOwnProperty.call(a,'documentation_status')?'documentation_status':(Object.prototype.hasOwnProperty.call(a,'docs_status')?'docs_status':null);if(!key)return false;return String(a[key]||'').toLowerCase() in {'verified':1,'successful':1,'approved':1,'complete':1,'completed':1};}
async function enterStudentPortal(){
 if(!S.app||S.app.admission_decision!=='approved')return toast('Admission approval is required.',1);
 if(!documentationVerified(S.app) && (Object.prototype.hasOwnProperty.call(S.app,'documentation_status')||Object.prototype.hasOwnProperty.call(S.app,'docs_status')))return toast('Your onboarding documents must be verified first.',1);
 let prior=null;
 try{const access=await sb.rpc('student_portal_access');if(access.error)throw access.error;prior=access.data===true}catch(e){return toast(e.message||'Unable to verify student portal access.',1)}
 if(!prior){
  const okay=confirm('Permanent transition to Student Portal\n\nOnce you enter the learning platform, this becomes your primary workspace. Your application stays on record and you can still download your admission letter and payment receipt.\n\nThis transition cannot be reversed through your account. Do you accept and continue?');
  if(!okay)return;
  const r=await sb.rpc('accept_student_portal_transition',{p_application:S.app.id,p_accepted:true});
  if(r.error)return toast(r.error.message||'Transition could not be recorded.',1);
 }
 window.location.assign('portal.html');
}
function statusMessage(a){if(!a)return ['none','No active application','You have not started an application yet.'];if(a.status==='draft')return ['wait','Your application is saved','Your details are saved. Resume when you are ready to finish your application.'];if(a.status==='pending_payment')return ['wait','Payment is still pending','Your application details are saved. Complete payment to submit your application.'];if(a.admission_decision==='approved'&&!documentationVerified(a)&&(Object.prototype.hasOwnProperty.call(a,'documentation_status')||Object.prototype.hasOwnProperty.call(a,'docs_status')))return ['wait','Admission approved — onboarding required','Your admission is approved. Complete the administrator-provided onboarding and documentation requirements before your Student Portal is unlocked.'];if(a.admission_decision==='approved')return ['ok','Congratulations! You have been admitted.','Your application has been approved. Your admission documents are available here.'];if(a.admission_decision==='rejected')return ['bad','Application decision','Your application was not approved at this time.'+(a.admission_note?' '+a.admission_note:'')];if(a.status==='under_review'||a.admission_decision==='under_review'||a.status==='submitted')return ['wait','Your application is being reviewed','Your application has been submitted successfully. The admissions team will review it and update this page when a decision is made.'];return ['wait','Application in progress','Please complete the remaining steps shown above.'];}
async function statusView(){
 await refreshApp();if(signOutRunning||!S.user)return;
 if(S.app?.status==='paid'){await finalizeAndShowStatus();return;}
 if(S.app?.passport_path&&!S.photoUrl){try{const r=await sb.storage.from('passports').createSignedUrl(S.app.passport_path,1800);if(r.data?.signedUrl)S.photoUrl=r.data.signedUrl}catch(e){console.warn('Could not load passport on status page:',e)}}
 markNav(4);const a=S.app,b=statusMessage(a);let courses=[];
 if(a){const [ac,cs]=await Promise.all([sb.from('application_courses').select('course_code,fee_ngn').eq('application_id',a.id),sb.from('courses').select('code,name,category')]);const cmap=Object.fromEntries((cs.data||[]).map(c=>[c.code,c]));courses=(ac.data||[]).map(x=>({...cmap[x.course_code],fee_ngn:x.fee_ngn})).filter(c=>c.name)}
 const f=a?.form_data||{},full=[f.firstName,f.otherNames,f.surname].filter(Boolean).join(' ')||S.profile?.full_name||S.user.email;
 const docsField=!!a&&(Object.prototype.hasOwnProperty.call(a,'documentation_status')||Object.prototype.hasOwnProperty.call(a,'docs_status'));
 const docsOk=documentationVerified(a)||!docsField;
 const canPortal=!!a&&a.admission_decision==='approved'&&docsOk;S.canOpenPortal=canPortal;$('#nvPortal').hidden=!canPortal;
 const intakeLabel=(S.intakeAll||[]).find(i=>i.id===a?.intake_id)?.label||S.intakes.find(i=>i.id===a?.intake_id)?.label||'—';
 const statusTone=b[0]==='ok'?'success':b[0]==='bad'?'error':b[0]==='none'?'neutral':'pending';
 const courseHtml=courses.length?courses.map(c=>`<div class="status-course"><span>${esc(c.name)} <small>${esc(c.category||'')}</small></span><strong>${a.package_code?'Included':naira(c.fee_ngn||0)}</strong></div>`).join(''):'<p class="field-help">Course selection details will appear here.</p>';
 const ref=a?(a.student_id||('AH-'+String(a.id||'').slice(0,8).toUpperCase())):'—';
 let nextAction='';
 if(!a)nextAction=`<div class="next-action"><div><strong>Ready to apply?</strong><p>Choose an open intake and course to begin.</p></div><button type="button" id="startNow">Start application</button></div>`;
 else if(a.status==='draft')nextAction=`<div class="next-action"><div><strong>Continue your application</strong><p>Your progress is saved. You can pick up where you stopped.</p></div><button type="button" id="continueApplication">Resume application</button></div>`;
 else if(a.status==='pending_payment')nextAction=`<div class="next-action"><div><strong>Finish your application</strong><p>Your details are saved. Complete payment to submit your application.</p></div><button type="button" id="continueApplication">Return to payment</button></div>`;
 else if(a.admission_decision==='approved'&&!docsOk)nextAction=`<div class="next-action onboarding-action"><div><strong>Your next step: onboarding</strong><p>Admission is approved. Your Student Portal will unlock after the training office verifies your required documentation. Any official instructions or document links will appear here when published.</p></div><span class="status-chip pending">Onboarding required</span></div>`;
 else if(canPortal)nextAction=`<div class="next-action"><div><strong>You're ready to begin</strong><p>Your admission and onboarding checks are complete.</p></div><button class="primary-link" type="button" data-portal-transition>Enter Student Portal &#8594;</button></div>`;
 else if(a.admission_decision==='rejected')nextAction=`<div class="next-action"><div><strong>Correct your application details</strong><p>Update your personal details and send them for another admissions review. No second payment is required.</p></div><button type="button" id="correctRejected">Edit my details</button></div>`;
 else nextAction=`<div class="next-action"><div><strong>Nothing else is needed right now</strong><p>Check this page again for updates. Your application status will change when the admissions team records a decision.</p></div><span class="status-chip pending">Awaiting update</span></div>`;
 view=$('#content');view.innerHTML=`<div class="application-flow status-flow"><header class="stage-heading status-heading"><p class="eyebrow">YOUR APPLICATION</p><h1>Application status</h1><p>Keep this page as your reference for admission updates and next steps.</p></header><section class="stage-card status-overview"><div class="status-symbol ${statusTone}">${statusTone==='success'?'&#10003;':statusTone==='error'?'!':statusTone==='pending'?'&#8230;':'i'}</div><div class="status-copy"><span class="status-chip ${statusTone}">${esc(applicationStatusText(a))}</span><h2>${esc(b[1])}</h2><p>${esc(b[2])}</p></div></section>${a?`<section class="stage-card status-details"><div class="section-title-row"><div><h2>Application summary</h2><p class="field-help">Your submitted information</p></div>${S.photoUrl?`<img class="status-passport" src="${esc(S.photoUrl)}" alt="Applicant passport photograph">`:''}</div><div class="status-data-grid"><div><span>Applicant</span><strong>${esc(full)}</strong></div><div><span>Application reference</span><strong>${esc(ref)}</strong></div><div><span>Intake</span><strong>${esc(intakeLabel)}</strong></div><div><span>Payment</span><strong>${a.paid_at||a.status==='paid'||['submitted','under_review','approved'].includes(a.status)?'Verified':a.status==='pending_payment'?'Awaiting payment':'Not completed'}</strong></div><div><span>Submitted</span><strong>${a.submitted_at?new Date(a.submitted_at).toLocaleDateString():'—'}</strong></div></div><div class="status-course-list"><div class="section-title-row"><div><h3>Selected courses</h3></div></div>${courseHtml}</div></section>${nextAction}${a?`<section class="stage-card" style="padding:20px 24px"><h3>Admission documents</h3><p class="field-help">Print issued admission and academic documents here. Payment receipts are available only in the Payment receipts tab.</p><div id="appOfficialDocs" role="region" aria-label="Admission and academic documents" style="margin-top:12px"></div></section>`:''}`:'<section class="stage-card">'+nextAction+'</section>'}<p class="privacy-note">For help, contact <a href="mailto:ahconsultltd02@gmail.com">ahconsultltd02@gmail.com</a>. Never share your password or payment authentication code.</p></div>`;
 if(a&&$('#appOfficialDocs'))AHOfficialDocuments.renderList($('#appOfficialDocs'),sb,C,a.id,{excludeReceipts:true,actions:['print']}).catch(()=>{});
 if($('#correctRejected'))$('#correctRejected').onclick=editRejectedView;if($('#startNow'))$('#startNow').onclick=()=>pickView();if($('#continueApplication'))$('#continueApplication').onclick=()=>{if(S.app?.status==='pending_payment')payView();else pickView()};
}
async function editRejectedView(){
 if(S.app?.admission_decision!=='rejected')return statusView();
 const f=S.app.form_data||{};
 const fields=[['firstName','First name'],['surname','Surname'],['otherNames','Other names'],['phone','Phone'],['dob','Date of birth'],['gender','Gender'],['address','Street address'],['city','City / town'],['lga','Local government'],['state','State']];
 const el=fields.map(([k,l])=>`<label class="field"><span>${esc(l)}</span><input class="in" name="${k}" value="${esc(f[k]||'')}" ${k==='dob'?`type="date" max="${maxEligibleDob()}"`:''} maxlength="250" ${['firstName','surname','phone'].includes(k)?'required':''}></label>`).join('');
 markNav(4);
 view=$('#content');view.innerHTML=`<div class="application-flow"><header class="stage-heading"><p class="eyebrow">APPLICATION CORRECTIONS</p><h1>Review and correct your details</h1><p>Only your personal information can change. Fees, programme, payment and admission decisions remain protected. Your corrected application returns to review.</p></header><section class="stage-card" style="padding:24px"><form id="correctionForm"><div class="grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px">${el}</div><div class="row" style="display:flex;gap:12px;margin-top:20px"><button type="submit" id="sendCorrections">Send corrected details</button><button type="button" class="btn2" id="cancelCorrections">Cancel</button></div></form></section></div>`;
 $('#cancelCorrections').onclick=statusView;
 $('#correctionForm').onsubmit=async e=>{e.preventDefault();const form=new FormData(e.target),updates={};for(const [k,v] of form)updates[k]=String(v).trim();if(!validApplicantAge(updates.dob))return toast('Applicants must be at least 16 years old.',1);const b=$('#sendCorrections');b.disabled=true;b.textContent='Submitting…';const r=await sb.rpc('correct_rejected_application',{p_application:S.app.id,p_details:updates});b.disabled=false;b.textContent='Send corrected details';if(r.error)return toast(r.error.message,1);toast('Corrections sent for another review.');await refreshApp();await statusView();};
}
async function receiptsView(){
 await refreshApp();if(signOutRunning||!S.user)return;
 view=$('#content');markNav(5);const a=S.app;
 view.innerHTML=`<div class="application-flow status-flow receipt-flow"><header class="stage-heading status-heading"><p class="eyebrow">PAYMENT RECORDS</p><h1>Payment receipts</h1><p>Verify a payment and preview, download or print your official receipt. Receipts are issued from verified transactions only.</p></header><section class="stage-card status-overview receipt-overview"><div id="receiptStatusSymbol" class="status-symbol pending" aria-hidden="true">…</div><div class="status-copy"><span id="receiptStatusChip" class="status-chip pending">Checking</span><h2 id="receiptStatusTitle">Checking your payment</h2><p id="receiptStatusDescription">Retrieving verified transaction records and official receipt status.</p></div></section><section class="stage-card status-details receipt-summary"><div class="section-title-row"><div><h2>Payment summary</h2><p class="field-help">Transaction details confirmed by the payment register</p></div></div><div class="status-data-grid" id="receiptSummaryGrid"></div></section><section class="stage-card receipt-verification-card"><div class="section-title-row"><div><h2>Verify your payment</h2><p class="field-help">Refresh the verified transaction and recover any pending receipt. Only verified payments qualify for an official receipt.</p></div></div><div class="receipt-verification-actions"><p id="receiptVerificationStatus" role="status" aria-live="polite">Checking payment records…</p><button type="button" id="receiptPrimaryAction">Verify/Refresh payment</button></div></section></div>`;
 const button=$('#receiptPrimaryAction'),notice=$('#receiptVerificationStatus');
 const symbol=$('#receiptStatusSymbol'),chip=$('#receiptStatusChip'),statusTitle=$('#receiptStatusTitle'),statusDescription=$('#receiptStatusDescription'),summary=$('#receiptSummaryGrid');
 const formatDate=value=>{if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});};
 const pair=(label,value)=>`<div><span>${esc(label)}</span><strong>${esc(value===null||value===undefined||value===''?'—':String(value))}</strong></div>`;
 const fullName=[a?.form_data?.firstName,a?.form_data?.otherNames,a?.form_data?.surname].filter(Boolean).join(' ')||S.profile?.full_name||S.user?.email||'Applicant';
 let latestReceipt=null,verifiedPayments=[];
 const printReceiptLabel=()=> 'Print Receipt';
 const drawState=(tone,label,title,description)=>{
  symbol.className='status-symbol '+tone;symbol.textContent=tone==='success'?'✓':tone==='error'?'!':'…';
  chip.className='status-chip '+tone;chip.textContent=label;statusTitle.textContent=title;statusDescription.textContent=description;
 };
 const drawSummary=()=>{
  const payment=verifiedPayments[0]||null;
  summary.innerHTML=pair('Applicant',fullName)+pair('Application reference',a?.student_id||String(a?.id||'').slice(0,8).toUpperCase())+
   pair('Payment reference',payment?.reference||a?.pay_reference||a?.pay_gateway_ref||'Not assigned')+
   pair('Verified amount',payment?naira(payment.paid_ngn):'Awaiting verified transaction')+
   pair('Payment date',formatDate(payment?.paid_at||payment?.verified_at||a?.paid_at))+
   pair('Payment method',payment?(payment.source?.startsWith('admin_manual')?'Manual bank payment (Finance approved)':'Online payment (provider verified)'):'—')+
   pair('Payment provider',payment?(payment.source?.startsWith('admin_manual')?'AH Consult Finance':payment.provider||'—'):'—')+
   (payment?.source&&!payment.source.startsWith('admin_manual')&&payment.provider_transaction_id?pair('Provider transaction ID',payment.provider_transaction_id):'')+
   pair('Verification status',payment?'Verified':'Not confirmed from transaction register')+
   pair('Receipt status',latestReceipt?(latestReceipt.status==='available'&&latestReceipt.metadata?.pdf_path?'Issued and archived':'Awaiting PDF issuance'):'Not issued')+
   (latestReceipt?pair('Official receipt ID',latestReceipt.id):'');
 };
 if(!a){button.disabled=true;drawState('pending','No application','Application required','Complete your application before verifying a payment.');notice.textContent='No application is available for this account.';drawSummary();return;}
 const refreshReceipts=async()=>{
  const {data:payments,error:payError}=await sb.from('payments')
   .select('id,reference,expected_ngn,paid_ngn,paid_at,verified_at,provider,source,provider_transaction_id')
   .eq('application_id',a.id).not('verified_at','is',null).order('verified_at',{ascending:false});
  // A payment is verified from the ledger, not from an admission decision.
  if(payError)console.warn('Verified payment summary unavailable:',payError.message);
  verifiedPayments=(payments||[]).filter(p=>Number(p.expected_ngn)>0&&Number(p.paid_ngn)>=Number(p.expected_ngn));
  const docs=await AHOfficialDocuments.fetchRecords(sb,a.id,{receiptsOnly:true,skipRepair:true});
  latestReceipt=(docs||[]).find(d=>d.document_type==='payment_receipt'&&d.status==='available'&&d.metadata?.pdf_path&&d.metadata?.sha256)
   ||(docs||[]).find(d=>d.document_type==='payment_receipt'&&['pending','available'].includes(d.status))||null;
  const ready=!!(latestReceipt&&latestReceipt.status==='available'&&latestReceipt.metadata?.pdf_path&&latestReceipt.metadata?.sha256);
  button.textContent=ready?printReceiptLabel():'Verify/Refresh payment';
  if(ready){AHOfficialDocuments.warmOnIntent(button,sb,C,latestReceipt);drawState('success','Receipt issued','Your payment receipt is ready','An official PDF has been archived for your verified payment. Preview, download or print it below.');notice.textContent='Payment verified. Your official receipt is ready.';}
  else if(verifiedPayments.length||latestReceipt){drawState('pending','Payment verified','Your payment is confirmed','The verified transaction is recorded. Its official PDF has not yet been archived. Select Verify/Refresh payment to retry issuance.');notice.textContent='Payment verified. Receipt issuance is pending. Select Verify/Refresh payment to retry.';}
  else if(payError){drawState('pending','Unable to check','Payment register unavailable','Payment data could not be retrieved. Select Verify/Refresh payment again.');notice.textContent='The verified payment register is temporarily unavailable.';}
  else{drawState('pending','Awaiting verification','No verified transaction recorded','After your online provider verifies payment or Finance approves a manual bank payment, your official receipt will appear here.');notice.textContent='No verified payment found. Select Verify/Refresh payment to check your transaction.';}
  drawSummary();return {ready};
 };
 button.onclick=async()=>{
  if(button.disabled)return;
  if(latestReceipt?.status==='available'&&latestReceipt.metadata?.pdf_path&&latestReceipt.metadata?.sha256){
   try{await AHOfficialDocuments.action(sb,C,latestReceipt,'print',button);}catch(e){toast(e.message||'Could not print the receipt. Please try again.',1);}return;
  }
  button.disabled=true;button.textContent='Verifying payment…';notice.textContent='Checking verified transactions and issuing eligible receipts…';
  try{
   const {data:{session}}=await sb.auth.getSession();if(!session)throw new Error('Your session expired. Please sign in again.');
   const response=await fetch(C.SUPABASE_URL.replace(/\/$/,'')+'/functions/v1/verify-payment',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:C.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({applicationId:a.id})});
   const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Payment verification is temporarily unavailable.');
   await refreshApp();const state=await refreshReceipts();
   if(!state.ready){
    if(result.paid){notice.textContent=result.note||'Payment verified. Receipt generation is pending. Please try again or contact Finance.';}
    else notice.textContent=result.note||'Payment not yet verified. Confirm your transaction with the provider.';
   }
  }catch(e){notice.textContent=e.message||'Payment verification failed. Please try again.';toast(notice.textContent,1);}
  finally{button.disabled=false;button.textContent=latestReceipt?.status==='available'&&latestReceipt.metadata?.pdf_path&&latestReceipt.metadata?.sha256?printReceiptLabel():'Verify/Refresh payment';}
 };
 try{
  await refreshReceipts();
  // Passive page entry reads the ledger only. An explicit Verify/Refresh click
  // performs any remote verification or recovery; no automatic provider calls.

 }catch(e){drawState('error','Action required','Receipt service unavailable','The document register could not be loaded. Please refresh or contact Finance with your payment reference.');notice.textContent=e.message||'Receipt recovery failed. Please contact Finance.';drawSummary();}
}
async function defermentView(){await refreshApp();if(signOutRunning||!S.user)return;if(!S.app||S.app.admission_decision!=='approved'){view.innerHTML='<h2>Defer a course</h2><div class="notice i">Deferment is available after admission. Please return here once you have been admitted.</div>';return}const opt=await sb.rpc('student_deferment_options',{p_application:S.app.id});if(opt.error){note(opt.error.message);return}const options=opt.data||{},courses=options.courses||[],ints=options.intakes||[];let D={deferments:[]};try{const pd=await sb.rpc('portal_data');if(!pd.error&&pd.data)D=pd.data}catch(_){}view.innerHTML=`<h2>Request deferment</h2><p class="sub">You can request to postpone one or more active courses. You may cancel a pending request at any time before it is approved.</p><div class="panel"><label>Deferment scope</label><select id="dscope"><option value="courses">Selected courses</option><option value="intake">Whole current intake</option></select><div id="dcourses">${courses.map(c=>`<label class="course"><input type="checkbox" value="${c.code}">${esc(c.name)} <small>(${esc(c.category)})</small></label>`).join('')}</div><label>Reason</label><select id="dtype"><option value="financial">Financial</option><option value="health">Health</option><option value="work">Work</option><option value="relocation">Relocation</option><option value="family">Family</option><option value="academic">Academic</option><option value="other">Other</option></select><label>Explain your reason</label><textarea id="dre" rows="4" placeholder="Please explain why you need to defer..."></textarea><label>Preferred return intake (optional)</label><select id="dreturn"><option value="">No preference</option>${ints.map(i=>`<option value="${i.id}">${esc(i.label)}</option>`).join('')}</select><button id="sendDef">Send deferment request</button></div><h3 style="margin-top:22px">My requests</h3>${(D.deferments||[]).length?D.deferments.map(d=>`<div class="item"><b>${esc((d.course_names||[]).join(', ')||'Whole intake')}</b><p>${esc(d.reason)}</p><span class="pill ${d.status==='approved'?'ok':d.status==='rejected'?'bad':d.status==='cancelled'?'none':'wait'}">${esc(d.status)}</span>${d.status==='pending'?`<button class="btn2" data-cdef="${d.id}">Cancel request</button>`:''}</div>`).join(''):'<p class="sub">No deferment requests yet.</p>'}`;$('#sendDef').onclick=async e=>{const scope=$('#dscope').value,codes=[...document.querySelectorAll('#dcourses input:checked')].map(x=>x.value),reason=$('#dre').value.trim();if(scope==='courses'&&!codes.length)return toast('Select at least one course.',1);if(reason.length<15)return toast('Please explain your reason in at least 15 characters.',1);e.target.disabled=true;const r=await sb.rpc('request_deferment',{p_application:S.app.id,p_scope:scope,p_courses:codes,p_reason_type:$('#dtype').value,p_reason:reason,p_return:$('#dreturn').value||null});e.target.disabled=false;if(r.error)return toast(r.error.message,1);toast('Deferment request sent.');await refreshApp();statusView();};document.querySelectorAll('[data-cdef]').forEach(b=>b.onclick=async()=>{const r=await sb.rpc('cancel_deferment',{p_id:b.dataset.cdef});if(r.error)return toast(r.error.message,1);toast('Deferment request cancelled.');defermentView();});}
async function profileView(){
 try { await refreshApp(); } catch(e) { if(isAuthFailure(e)){redirectToSignIn('Your session has expired. Please sign in again.');return;}console.warn('Could not refresh applicant profile:',e); }
 if(signOutRunning||!S.user)return;
 const a=S.app||{},f=a.form_data||{},p=S.profile||{},full=[f.firstName,f.otherNames,f.surname].filter(Boolean).join(' ').trim()||p.full_name||S.user?.email||'Applicant',amountLabel=(a.paid_at||a.status==='paid')?naira(a.total_ngn||0):'Not confirmed';
 const pair=(label,value)=>`<div class="profile-detail"><span>${label}</span><b>${esc(value||'Not provided')}</b></div>`;
 view=$('#content');$('#navsteps')?.querySelectorAll('.nv').forEach(b=>b.classList.remove('act'));
 view.innerHTML=`<div class="profile-page"><div class="profile-page-head"><div><p class="eyebrow">YOUR ACCOUNT</p><h2>My profile</h2><p class="sub">Review the details associated with your application. To correct application information, return to the relevant application step.</p></div><button type="button" class="btn2" id="profileReturn">Return to application</button></div><section class="profile-card"><div class="profile-card-top"><div class="profile-page-photo" id="profilePhotoBox"><span id="profileInitials"></span><img id="profilePhoto" alt="Your passport photograph" hidden></div><div><h3>${esc(full)}</h3><p>${esc(S.user?.email||p.email||'')}</p><span class="identity-state">${esc(applicationStatusText(a))}</span>${a.student_id?`<small class="profile-ref">Student ID ${esc(a.student_id)}</small>`:a.id?`<small class="profile-ref">Application ${esc(String(a.id).slice(0,8).toUpperCase())}</small>`:''}</div></div><h3 class="profile-section-title">Personal details</h3><div class="profile-detail-grid">${pair('Full name',full)}${pair('Phone number',f.phone||p.phone)}${pair('Date of birth',f.dob)}${pair('Gender',f.gender)}${pair('State',f.state)}${pair('Home address',f.address)}${pair('Education',f.education)}${pair('Occupation',f.occupation)}${pair('Skills',f.skills)}${pair('Laptop access',f.laptop)}${pair('Battery duration',f.battery)}</div><h3 class="profile-section-title">Application summary</h3><div class="profile-detail-grid">${pair('Intake',(S.intakeAll||[]).find(x=>x.id===a.intake_id)?.label)}${pair('Application status',applicationStatusText(a))}${pair('Student ID',a.student_id)}${pair('Payment reference',a.pay_reference)}${pair('Confirmed amount',amountLabel)}</div><div class="notice i">For your privacy, your complete personal information is shown only in this signed-in account area.</div></section></div>`;
 const init=$('#profileInitials');if(init)init.textContent=full.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'AH';
 if(a.passport_path){try{const r=await sb.storage.from('passports').createSignedUrl(a.passport_path,1800);if(r.data?.signedUrl){const img=$('#profilePhoto');img.onload=()=>{img.hidden=false;init.hidden=true};img.onerror=()=>{img.hidden=true;init.hidden=false};img.src=r.data.signedUrl}}catch(e){console.warn('Could not load passport in profile view:',e)}}
 $('#profileReturn').onclick=()=>{const status=S.app?.status;if(status==='pending_payment')payView();else if(status==='paid')finalizeAndShowStatus();else if(status&&['submitted','under_review','approved','rejected'].includes(status))statusView();else if(S.w)continuousWizard();else pickView()};
}
async function resetPw(){if(!S.user?.email)return note('Your account email is unavailable. Please sign out and sign in again.','e');const r=await sb.auth.resetPasswordForEmail(S.user.email,{redirectTo:authBase()+'forgot-password.html?next=apply'});note(r.error?esc(r.error.message):'If this address is registered, a secure password reset link has been sent. Check your inbox and spam folder.',r.error?'e':'i');if(!r.error)toastNotice('Password reset link requested.');}
function toastNotice(message){let el=$('#settingsFeedback');if(!el){el=document.createElement('div');el.id='settingsFeedback';el.className='settings-feedback';el.setAttribute('role','status');document.querySelector('.top')?.insertAdjacentElement('afterend',el)}el.textContent=message;el.hidden=false;clearTimeout(el._hide);el._hide=setTimeout(()=>{el.hidden=true},5000)}
function stage(){if(S.w?.n)return S.w.n;if(S.app?.status==='pending_payment')return 3;if(S.app?.status==='paid')return 3;if(S.app&&['submitted','under_review','approved','rejected'].includes(S.app.status))return 4;return 1}
function canNavigateToStep(n){return n===stage()}
function buildNav(){const holder=$('#navsteps');if(holder)holder.innerHTML='';}
function markNav(i){S.nav=i;buildNav();if(S.user)$('#side')?.classList.remove('open')}
async function go(i){if(i===4)return statusView();if(!S.w)return pickView();if(i>=1&&i<=3){S.w.n=i;saveFlowState();await continuousWizard()}}
function clearLocalAuthToken(){try{const ref=new URL(C.SUPABASE_URL).hostname.split('.')[0],base='sb-'+ref+'-auth-token';[localStorage,sessionStorage].forEach(store=>{for(let i=store.length-1;i>=0;i--){const k=store.key(i);if(k&&(k===base||k.startsWith(base+'.')||k.startsWith(base+'-')||k==='sb-'+ref+'-auth-token-code-verifier'))store.removeItem(k)}})}catch(_){/* Storage may be disabled; continue to the sign-in screen. */}}
function setAuthFlash(message){try{sessionStorage.setItem('ahct_auth_flash',message)}catch(_){}}
function takeAuthFlash(){try{const m=sessionStorage.getItem('ahct_auth_flash')||'';sessionStorage.removeItem('ahct_auth_flash');return m}catch(_){return ''}}
function redirectToSignIn(message){
 if(signOutRunning)return;
 signOutRunning=true;
 try{cleanup()}catch(_){}
 S.user=null;S.profile=null;S.app=null;
 clearLocalAuthToken();
 const target=new URL('apply.html',authBase());target.hash='signin';
 try{history.replaceState(null,'',target.pathname+target.search+target.hash)}catch(_){}
 $('#app').hidden=true;$('#auth').hidden=false;authView('in');
 if(message)note(esc(message),'e');
 try{const pending=sb.auth.signOut({scope:'local'});Promise.resolve(pending).catch(()=>{}).finally(()=>{clearLocalAuthToken();signOutRunning=false})}catch(_){signOutRunning=false}
}
function normalizeLegacySignOutUrl(){const u=new URL(location.href);if(u.searchParams.get('signed_out')!=='1')return false;setAuthFlash('You have signed out securely.');try{const pending=sb.auth.signOut({scope:'local'});if(pending&&typeof pending.catch==='function')pending.catch(()=>{})}catch(_){}clearLocalAuthToken();u.searchParams.delete('signed_out');u.hash='signin';location.replace(u.href);return true}
function closeSettingsMenu(restoreFocus=false){const m=$('#menu'),g=$('#gear');if(m)m.hidden=true;if(g)g.setAttribute('aria-expanded','false');if(restoreFocus&&g)g.focus()}
function signOut(){
 if(signOutRunning)return;
 signOutRunning=true;
 closeSettingsMenu();
 try{cleanup()}catch(_){}
 // End the on-screen session BEFORE network / auth library cleanup.
 // Replacing only a hash does NOT reload the current page, which caused the old delayed sign-out.
 S.user=null;S.profile=null;S.app=null;S.hasAdmitted=false;S.canOpenPortal=false;
 try{sessionStorage.removeItem('ahct_auth_flash')}catch(_){}
 const target=new URL('apply.html',authBase());target.hash='signin';
 try{history.replaceState(null,'',target.pathname+target.search+target.hash)}catch(_){}
 $('#app').hidden=true;$('#auth').hidden=false;
 authView('in');note('You have signed out securely.','i');
 // Disable a new login while the SDK is clearing its in-memory session.
 const submit=$('#go');if(submit){submit.disabled=true;submit.textContent='Finishing sign out…'}
 let pending;
 try{pending=sb.auth.signOut({scope:'local'})}catch(e){pending=Promise.reject(e)}
 clearLocalAuthToken();
 Promise.resolve(pending).catch(e=>{console.warn('Remote sign-out was not completed; local credentials were cleared.',e)})
 .finally(()=>{clearLocalAuthToken();signOutRunning=false;const b=$('#go');if(b){b.disabled=false;b.textContent='Sign in'};$('#email')?.focus()});
}
function showAuth(){S.user=null;$('#app').hidden=true;$('#auth').hidden=false;authView((location.hash==='#signin'||new URLSearchParams(location.search).get('mode')==='in')?'in':'up')}
function showApp(){view=$('#content');$('#auth').hidden=true;$('#app').hidden=false;const n=S.profile?.full_name||S.user.email;$('#uname').textContent=n;$('#av').textContent=(n.trim()[0]||'A').toUpperCase();$('#yr').textContent=new Date().getFullYear();S.canOpenPortal=!!S.app&&S.app.admission_decision==='approved'&&(!Object.prototype.hasOwnProperty.call(S.app,'documentation_status')&&!Object.prototype.hasOwnProperty.call(S.app,'docs_status')||documentationVerified(S.app));$('#nvPortal').hidden=!S.canOpenPortal;buildNav();renderApplicantIdentity()}
function wire(){$('#burger').onclick=()=>$('#side').classList.toggle('open');const wrap=$('#settingsWrap'),gear=$('#gear'),menu=$('#menu');gear.onclick=e=>{e.preventDefault();e.stopPropagation();const open=menu.hidden;menu.hidden=!open;gear.setAttribute('aria-expanded',String(open));if(open)menu.querySelector('button:not(:disabled)')?.focus()};menu.addEventListener('click',async e=>{e.stopPropagation();const b=e.target.closest('button[data-a]');if(!b)return;const key=b.dataset.a;closeSettingsMenu();if(key==='profile'){profileView();return}if(key==='pw'){await resetPw();return}if(key==='out'){await signOut();return}});document.addEventListener('pointerdown',e=>{if(wrap&&!wrap.contains(e.target))closeSettingsMenu()});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden)closeSettingsMenu(true)});$('#nvPay').onclick=statusView;$('#nvReceipts').onclick=receiptsView;$('#nvPortal').onclick=()=>enterStudentPortal();document.addEventListener('click',e=>{const b=e.target.closest?.('[data-portal-transition]');if(b){e.preventDefault();enterStudentPortal()}});$('#nvOut').onclick=signOut;$('#menuEmail').textContent=S.user?.email||'';}
async function boot(){if(normalizeLegacySignOutUrl())return;const flash=takeAuthFlash();const auth=await sb.auth.getSession(),session=auth.data?.session;if(auth.error&&isAuthFailure(auth.error)){redirectToSignIn('Your session has expired. Please sign in again.');return}if(!session){showAuth();if(flash)note(esc(flash),'i');return}S.user=session.user;const [p,apps]=await Promise.all([sb.from('profiles').select('*').eq('id',session.user.id).maybeSingle(),sb.from('applications').select('*').eq('user_id',session.user.id).not('status','eq','expired').order('created_at',{ascending:false})]);if(isAuthFailure(p.error)||isAuthFailure(apps.error)){redirectToSignIn('Your session has expired. Please sign in again.');return}if(apps.error)throw apps.error;S.profile=p.data||{full_name:session.user.user_metadata?.full_name||session.user.email,phone:session.user.user_metadata?.phone||''};S.app=apps.data?.[0]||null;S.hasAdmitted=!!apps.data?.some(a=>a.admission_decision==='approved');const [c,i]=await Promise.all([sb.from('courses').select('code,name,category,fee_ngn'),sb.from('intakes').select('id,label')]);if(isAuthFailure(c.error)||isAuthFailure(i.error)){redirectToSignIn('Your session has expired. Please sign in again.');return}S.catalog=c.data||[];S.intakeAll=i.data||[];showApp();await renderApplicantIdentity();if(flash)toastNotice(flash);if(S.app&&S.app.status==='pending_payment')payView();else if(S.app&&S.app.status==='paid')await finalizeAndShowStatus();else if(S.app&&['submitted','under_review','approved','rejected'].includes(S.app.status))statusView();else pickView();}
initHero();wire();
window.addEventListener('pageshow',async e=>{if(!e.persisted)return;try{const q=await sb.auth.getSession();if(!q.data?.session){clearLocalAuthToken();location.replace(authBase()+'apply.html#signin')}}catch(_){clearLocalAuthToken();location.replace(authBase()+'apply.html#signin')}});
boot().catch(function(e){if(isAuthFailure(e)){redirectToSignIn('Your session has expired. Please sign in again.');return}console.error('Application boot failed:',e);fatal('We could not load your application right now. Check your connection and try again. If the problem continues, contact the training office.')});
}
