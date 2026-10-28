const $=s=>document.querySelector(s),C=window.APPLY_CONFIG,say=(t,k='e')=>{$('#m').innerHTML=t?`<div class="msg ${k}" role="alert">${t}</div>`:''};
function fatal(t){say(t)}
if(!window.supabase||!C||!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(C.SUPABASE_URL||''))fatal('Setup problem: js/config.js did not load or has no valid SUPABASE_URL / SUPABASE_ANON_KEY.');
const sb=(window.supabase&&C)?supabase.createClient(C.SUPABASE_URL,C.SUPABASE_ANON_KEY):null;
function eye(id,btn){const i=$(id);i.type=i.type==='password'?'text':'password';btn.textContent=i.type==='password'?'Show':'Hide'}

const E=(k,t)=>{const el=$('#e_'+k);if(el)el.textContent=t||''};
$('#pw').oninput=()=>{const p=$('#pw').value;let s=0;if(p.length>=10)s++;if(/[A-Z]/.test(p)&&/[a-z]/.test(p))s++;if(/\d/.test(p))s++;if(/[^A-Za-z0-9]/.test(p))s++;
 $('#mt').style.width=(s*25)+'%';$('#mt').style.background=['#dc2626','#dc2626','#f59e0b','#84cc16','#16a34a'][s]};
$('#f').onsubmit=async e=>{e.preventDefault();say('');['fn','em','ph','po','pw','pw2','ic','ag'].forEach(k=>E(k));
 const v=id=>$('#'+id).value.trim(),er={};
 if(v('fn').length<3)er.fn='Enter your full name.';if(!/^\S+@\S+\.\S+$/.test(v('em')))er.em='Enter a valid email address.';
 if(!/^(\+234|0)[789][01]\d{8}$/.test(v('ph').replace(/\s/g,'')))er.ph='Enter a valid Nigerian phone number.';if(!v('po'))er.po='Select your position.';
 if($('#pw').value.length<10)er.pw='Use at least 10 characters.';if($('#pw').value!==$('#pw2').value)er.pw2='Passwords do not match.';
 if(!v('ic'))er.ic='Enter the staff access code.';if(!$('#ag').checked)er.ag='Please tick to continue.';
 for(const k in er)E(k,er[k]);if(Object.keys(er).length)return;
 const b=$('#go');b.disabled=true;b.textContent='Submitting...';
 try{const r=await fetch(C.SUPABASE_URL+'/functions/v1/admin-register',{method:'POST',headers:{'Content-Type':'application/json',apikey:C.SUPABASE_ANON_KEY,Authorization:'Bearer '+C.SUPABASE_ANON_KEY},
  body:JSON.stringify({fullName:v('fn'),email:v('em'),phone:v('ph'),position:v('po'),password:$('#pw').value,inviteCode:$('#ic').value})});const j=await r.json().catch(()=>({}));
  if(!r.ok){b.disabled=false;b.textContent='Submit registration';return say(j.error||'Registration failed. Please try again.')}
  $('#regView').hidden=true;$('#doneView').hidden=false}catch(x){b.disabled=false;b.textContent='Submit registration';say('We could not reach the server. Check your connection and try again.')}};
