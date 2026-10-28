const $=s=>document.querySelector(s),C=window.APPLY_CONFIG,say=(t,k='e')=>{$('#m').innerHTML=t?`<div class="msg ${k}" role="alert">${t}</div>`:''};
function fatal(t){say(t)}
if(!window.supabase||!C||!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(C.SUPABASE_URL||''))fatal('Setup problem: js/config.js did not load or has no valid SUPABASE_URL / SUPABASE_ANON_KEY.');
const sb=(window.supabase&&C)?supabase.createClient(C.SUPABASE_URL,C.SUPABASE_ANON_KEY):null;
function eye(id,btn){const i=$(id);i.type=i.type==='password'?'text':'password';btn.textContent=i.type==='password'?'Show':'Hide'}

let tries=+sessionStorage.getItem('t')||0,until=+sessionStorage.getItem('u')||0;
if(localStorage.getItem('ahct_staff_email')){$('#em').value=localStorage.getItem('ahct_staff_email');$('#rem').checked=true}
$('#pw').addEventListener('keyup',e=>{$('#caps').hidden=!(e.getModifierState&&e.getModifierState('CapsLock'))});
async function route(){const {data:{user}}=await sb.auth.getUser();if(!user)return;const {data:st}=await sb.from('staff').select('status,role').eq('id',user.id).maybeSingle();
 if(!st){await sb.auth.signOut();return say('This account is not registered as staff. Students sign in on the application portal.')}
 if(st.status==='pending'){await sb.auth.signOut();return say('Your registration is awaiting approval. You can sign in as soon as an administrator approves it.','i')}
 if(st.status==='rejected'){await sb.auth.signOut();return say('Your registration was not approved. Please contact AH Consult management.')}
 if(st.status==='suspended'){await sb.auth.signOut();return say('This account has been suspended. Please contact an administrator.')}
 location.href=st.role==='tutor'?'tutor':'admin-dashboard'}
$('#f').onsubmit=async e=>{e.preventDefault();say('');
 if(Date.now()<until)return say('Too many attempts. Please wait '+Math.ceil((until-Date.now())/1000)+' seconds and try again.');
 const em=$('#em').value.trim(),pw=$('#pw').value;if(!/^\S+@\S+\.\S+$/.test(em)||!pw)return say('Enter your email and password.');
 const b=$('#go');b.disabled=true;b.textContent='Signing in...';
 const {error}=await sb.auth.signInWithPassword({email:em,password:pw});b.disabled=false;b.textContent='Sign in';
 if(error){tries++;sessionStorage.setItem('t',tries);if(tries>=5){until=Date.now()+30000;sessionStorage.setItem('u',until);tries=0;sessionStorage.setItem('t',0)}return say(error.message==='Invalid login credentials'?'Email or password is incorrect.':error.message)}
 sessionStorage.removeItem('t');if($('#rem').checked)localStorage.setItem('ahct_staff_email',em);else localStorage.removeItem('ahct_staff_email');route()};
$('#fp').onclick=async()=>{const em=$('#em').value.trim();if(!em)return say('Enter your email above first, then tap "Forgot password?".','i');
 const {error}=await sb.auth.resetPasswordForEmail(em,{redirectTo:location.origin+location.pathname.replace(/[^/]*$/,'')+'forgot-password.html?next=staff-login'});say(error?error.message:'If that email belongs to a staff account, a reset link has been sent. Check your inbox and spam folder.',error?'e':'s')};
sb.auth.onAuthStateChange(ev=>{if(ev==='PASSWORD_RECOVERY'){$('#loginView').hidden=true;$('#resetView').hidden=false}});
$('#sp').onclick=async()=>{const p=$('#np').value;if(p.length<10)return say('Use at least 10 characters.');const {error}=await sb.auth.updateUser({password:p});
 if(error)return say(error.message);await sb.auth.signOut();$('#resetView').hidden=true;$('#loginView').hidden=false;say('Password updated. Please sign in.','s')};
sb.auth.getSession().then(({data:{session}})=>{if(session&&!location.hash.includes('type=recovery'))route()});
if(new URLSearchParams(location.search).get('expired'))say('You were signed out after a period of inactivity.','i');
