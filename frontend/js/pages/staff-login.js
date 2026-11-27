const $=s=>document.querySelector(s),C=window.APPLY_CONFIG,say=(t,k='e')=>{$('#m').innerHTML=t?`<div class="msg ${k}" role="alert">${t}</div>`:''};
function fatal(t){say(t)}
if(!window.supabase||!C||!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(C.SUPABASE_URL||''))fatal('Setup problem: js/config.js did not load or has no valid SUPABASE_URL / SUPABASE_ANON_KEY.');
const sb=(window.supabase&&C)?supabase.createClient(C.SUPABASE_URL,C.SUPABASE_ANON_KEY):null;
function eye(id,btn){const i=$(id);i.type=i.type==='password'?'text':'password';btn.textContent=i.type==='password'?'Show':'Hide'}

let tries=+sessionStorage.getItem('t')||0,until=+sessionStorage.getItem('u')||0,mfaFactor=null,setupFactor=null,staffDestination=null,routing=false;
function showView(id){['loginView','resetView','mfaChoice','mfaSetup','mfaChallenge'].forEach(x=>{$('#'+x).hidden=x!==id});say('')}
function proceed(){location.href=staffDestination}
async function logout(){await sb.auth.signOut();mfaFactor=null;setupFactor=null;staffDestination=null;showView('loginView')}
if(localStorage.getItem('ahct_staff_email')){$('#em').value=localStorage.getItem('ahct_staff_email');$('#rem').checked=true}
$('#pw').addEventListener('keyup',e=>{$('#caps').hidden=!(e.getModifierState&&e.getModifierState('CapsLock'))});
async function route(){if(routing)return;routing=true;try{const {data:{user}}=await sb.auth.getUser();if(!user)return;const {data:st,error:staffError}=await sb.from('staff').select('status,role').eq('id',user.id).maybeSingle();
 if(staffError)return say('We could not verify your staff access. Please try again.');
 if(!st){await sb.auth.signOut();return say('This account is not registered as staff. Students sign in on the application portal.')}
 if(st.status==='pending'){await sb.auth.signOut();return say('Your registration is awaiting approval. You can sign in as soon as an administrator approves it.','i')}
 if(st.status==='rejected'){await sb.auth.signOut();return say('Your registration was not approved. Please contact AH Consult management.')}
 if(st.status==='suspended'){await sb.auth.signOut();return say('This account has been suspended. Please contact an administrator.')}
 staffDestination=st.role==='tutor'?'tutor':st.role==='hr'?'hr-dashboard':'admin-dashboard';
 const assurance=await sb.auth.mfa.getAuthenticatorAssuranceLevel();if(assurance.error)return say('We could not verify your security settings. Please try again.');
 if(assurance.data.nextLevel==='aal2'&&assurance.data.currentLevel!=='aal2'){
  const factors=await sb.auth.mfa.listFactors();if(factors.error)return say('We could not load your authenticator. Please try again.');
  mfaFactor=(factors.data.totp||[]).find(f=>f.status==='verified');if(!mfaFactor)return say('Your authenticator could not be found. Contact your administrator.');
  showView('mfaChallenge');$('#mfaChallengeCode').focus();return;
 }
 if(assurance.data.currentLevel==='aal2')return proceed();
 showView('mfaChoice');
 }finally{routing=false}}
$('#mfaSkip').onclick=proceed;$('#mfaCancel').onclick=logout;$('#mfaChallengeCancel').onclick=logout;
$('#mfaEnroll').onclick=async()=>{const button=$('#mfaEnroll');button.disabled=true;const result=await sb.auth.mfa.enroll({factorType:'totp',friendlyName:'AH Consult authenticator'});button.disabled=false;if(result.error)return say('Authenticator setup could not start. Please contact your administrator or continue for now.');setupFactor=result.data.id;$('#mfaQr').src=result.data.totp.qr_code;$('#mfaSecret').textContent=result.data.totp.secret;showView('mfaSetup');$('#mfaSetupCode').focus()};
$('#mfaSetupCancel').onclick=async()=>{if(setupFactor){const r=await sb.auth.mfa.unenroll({factorId:setupFactor});if(r.error)return say('Could not cancel setup. Please try again.');setupFactor=null}showView('mfaChoice')};
async function verifyFactor(factorId,code,button){if(!/^\d{6}$/.test(code)){say('Enter the six-digit code from your authenticator.');return}button.disabled=true;const challenge=await sb.auth.mfa.challenge({factorId});if(challenge.error){button.disabled=false;say('Verification could not start. Please try again.');return}const verified=await sb.auth.mfa.verify({factorId,challengeId:challenge.data.id,code});button.disabled=false;if(verified.error){say('The code was not accepted. Check the code and try again.');return}setupFactor=null;proceed()}
$('#mfaSetupForm').onsubmit=e=>{e.preventDefault();verifyFactor(setupFactor,$('#mfaSetupCode').value.trim(),e.currentTarget.querySelector('button'))};
$('#mfaChallengeForm').onsubmit=e=>{e.preventDefault();verifyFactor(mfaFactor.id,$('#mfaChallengeCode').value.trim(),e.currentTarget.querySelector('button'))};
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
