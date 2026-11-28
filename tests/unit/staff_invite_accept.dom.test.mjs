import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const html=readFileSync('frontend/staff-invite-accept.html','utf8');
const script=readFileSync('frontend/js/pages/staff-invite-accept.js','utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
function boot(hash,staffStatus='pending',tokenValid=true,sessionUser='user-1'){
 const dom=new JSDOM(html,{url:'https://portal.example/staff-invite-accept.html'+hash,runScripts:'outside-only'}),w=dom.window;
 const calls={create:0,update:[],signOut:0,tokens:[]};
 const sb={auth:{onAuthStateChange(){},getSession:async()=>({data:{session:{user:{id:sessionUser}}}}),getUser:async token=>{calls.tokens.push(token);return tokenValid?{data:{user:{id:'user-1'}}}:{data:{user:null},error:{message:'Invalid token'}}},updateUser:async value=>{calls.update.push(value);return {error:null}},signOut:async()=>{calls.signOut++;return {error:null}}},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:'user-1',status:staffStatus}})})})})};
 w.APPLY_CONFIG={SUPABASE_URL:'https://project.supabase.co',SUPABASE_ANON_KEY:'public-key'};w.supabase={createClient:()=>{calls.create++;return sb}};
 w.eval(script);return {dom,w,calls};
}
const valid=boot('#access_token=invite-token&type=invite');await tick();
assert.equal(valid.w.document.getElementById('invite-form').hidden,false,'a verified invite opens password setup');
assert.ok(valid.calls.tokens.includes('invite-token'),'the link token itself must be verified');
valid.w.document.getElementById('invite-password').value='a sufficiently long password';
valid.w.document.getElementById('invite-confirm').value='different password';
valid.w.document.getElementById('invite-form').dispatchEvent(new valid.w.Event('submit',{bubbles:true,cancelable:true}));
await tick();assert.equal(valid.calls.update.length,0,'mismatched passwords are never submitted');
valid.w.document.getElementById('invite-confirm').value='a sufficiently long password';
valid.w.document.getElementById('invite-form').dispatchEvent(new valid.w.Event('submit',{bubbles:true,cancelable:true}));await tick();
assert.equal(valid.calls.update.length,1);assert.equal(valid.calls.signOut,1);assert.equal(valid.w.document.getElementById('invite-form').hidden,true);
assert.match(valid.w.document.getElementById('invite-message').textContent,/pending/i,'password setup does not promise approval');valid.dom.window.close();
const noInvite=boot('');await tick();assert.equal(noInvite.calls.create,0,'ordinary visits cannot initialize the invite setup flow');assert.equal(noInvite.w.document.getElementById('invite-form').hidden,true);noInvite.dom.window.close();
const rejected=boot('#access_token=invite-token&type=invite','rejected');await tick();assert.equal(rejected.w.document.getElementById('invite-form').hidden,true,'rejected staff cannot use the invitation page');rejected.dom.window.close();
const invalid=boot('#access_token=invalid&type=invite','pending',false);await tick();assert.equal(invalid.w.document.getElementById('invite-form').hidden,true,'an invalid link cannot rely on an existing session');invalid.dom.window.close();
const mismatched=boot('#access_token=invite-token&type=invite','pending',true,'another-user');await tick();assert.equal(mismatched.w.document.getElementById('invite-form').hidden,true,'the session must belong to the invited user');mismatched.dom.window.close();
console.log('PASS staff invitation password setup requires invite context and preserves approval');
