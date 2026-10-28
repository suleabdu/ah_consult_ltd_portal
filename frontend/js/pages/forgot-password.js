const $=s=>document.querySelector(s),C=window.APPLY_CONFIG,say=(t,k='e')=>{$('#m').innerHTML=t?`<div class="msg ${k}" role="alert">${t}</div>`:''};
function eye(id,btn){const i=$(id);i.type=i.type==='password'?'text':'password';btn.textContent=i.type==='password'?'Show':'Hide'}
if(!window.supabase||!C||!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(C.SUPABASE_URL||''))say('Setup problem: js/config.js did not load.');
else{
 const sb=supabase.createClient(C.SUPABASE_URL,C.SUPABASE_ANON_KEY),q=new URLSearchParams(location.search);
 const next=(q.get('next')||'apply').replace(/[^a-zA-Z0-9_.\-]/g,''),isStaff=/staff/.test(next),minLen=isStaff?10:8,base=location.origin+location.pathname.replace(/[^/]*$/,'');
 $('#back').href=next;$('#goLogin').onclick=()=>location.href=next;$('#pwHint').textContent='Use at least '+minLen+' characters.';
 const showNew=()=>{$('#reqView').hidden=true;$('#newView').hidden=false;say('')};
 if(/error_code=otp_expired|error=access_denied/.test(location.hash))say('That reset link has expired or was already used. Request a new one below.');
 sb.auth.onAuthStateChange(ev=>{if(ev==='PASSWORD_RECOVERY')showNew()});if(/type=recovery/.test(location.hash))showNew();
 $('#rf').onsubmit=async e=>{e.preventDefault();say('');const em=$('#em').value.trim();if(!/^\S+@\S+\.\S+$/.test(em))return say('Enter a valid email address.');
  const b=$('#rb');b.disabled=true;b.textContent='Sending...';const {error}=await sb.auth.resetPasswordForEmail(em,{redirectTo:base+'forgot-password.html?next='+next});b.disabled=false;b.textContent='Send reset link';
  say(error?(/rate limit|too many/i.test(error.message)?'Too many requests. Please wait a few minutes and try again.':error.message):'If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.',error?'e':'s')};
 $('#np').oninput=()=>{const p=$('#np').value;let s=0;if(p.length>=minLen)s++;if(/[A-Z]/.test(p)&&/[a-z]/.test(p))s++;if(/\d/.test(p))s++;if(/[^A-Za-z0-9]/.test(p)||p.length>=12)s++;$('#mt').style.width=(s*25)+'%';$('#mt').style.background=['#dc2626','#dc2626','#f59e0b','#84cc16','#16a34a'][s]};
 $('#nf').onsubmit=async e=>{e.preventDefault();say('');const p=$('#np').value;if(p.length<minLen)return say('Use at least '+minLen+' characters.');if(p!==$('#np2').value)return say('The two passwords do not match.');
  const b=$('#nb');b.disabled=true;b.textContent='Saving...';const {error}=await sb.auth.updateUser({password:p});b.disabled=false;b.textContent='Save password';
  if(error)return say(/same|different/i.test(error.message)?'Choose a password you have not used before.':error.message);
  await sb.auth.signOut();$('#newView').hidden=true;$('#doneView').hidden=false;say('')};
}
