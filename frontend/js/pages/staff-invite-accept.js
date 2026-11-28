(function () {
 'use strict';
 const message=document.getElementById('invite-message'),form=document.getElementById('invite-form'),button=document.getElementById('invite-save');
 // Capture the URL before Supabase consumes the one-time invite fragment.
 const fragment=new URLSearchParams(location.hash.slice(1)),inviteToken=fragment.get('access_token'),isInvite=fragment.get('type')==='invite'&&!!inviteToken;
 const config=window.APPLY_CONFIG||{};
 if(!window.supabase||!config.SUPABASE_URL||!config.SUPABASE_ANON_KEY){message.textContent='Staff invitation service is temporarily unavailable.';return;}
 if(!isInvite){message.textContent='This invitation link is missing, expired or already used. Please ask an administrator for help.';return;}
 const sb=window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY);
 let ready=false;
 async function verify(){
  if(ready)return;
  const result=await sb.auth.getUser(inviteToken);
  if(result.error||!result.data.user){message.textContent='This invitation could not be verified. It may have expired; please contact an administrator.';return;}
  const session=await sb.auth.getSession();
  if(session.error||!session.data.session||session.data.session.user.id!==result.data.user.id){message.textContent='This invitation session could not be verified. Please reopen the invitation link.';return;}
  const staff=await sb.from('staff').select('id,status').eq('id',result.data.user.id).maybeSingle();
  if(staff.error||!staff.data){message.textContent='Your staff registration could not be found. Please contact an administrator.';return;}
  if(!['pending','approved'].includes(staff.data.status)){message.textContent='This staff invitation is no longer active. Please contact an administrator.';return;}
  ready=true;message.textContent='Choose a password of at least 10 characters.';form.hidden=false;
 }
 sb.auth.onAuthStateChange((event)=>{if(event==='SIGNED_IN'||event==='INITIAL_SESSION')setTimeout(verify,0)});
 sb.auth.getSession().then(verify).catch(()=>{message.textContent='This invitation could not be verified. Please contact an administrator.'});
 form.onsubmit=async function(e){e.preventDefault();const password=document.getElementById('invite-password').value,confirmPassword=document.getElementById('invite-confirm').value;
  if(password.length<10){message.textContent='Use at least 10 characters.';return;}
  if(password!==confirmPassword){message.textContent='The passwords do not match.';return;}
  button.disabled=true;message.textContent='Saving your password…';const result=await sb.auth.updateUser({password});
  if(result.error){button.disabled=false;message.textContent='Your password could not be saved. Please try again or contact an administrator.';return;}
  await sb.auth.signOut({scope:'local'});form.hidden=true;message.textContent='Your password is set. If your staff access is pending, an authorised team member must approve it before you can sign in.';
 };
})();
