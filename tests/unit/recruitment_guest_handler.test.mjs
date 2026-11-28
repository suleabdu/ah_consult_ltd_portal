import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';

const source = readFileSync(new URL('../../supabase/functions/recruitment-apply/index.ts', import.meta.url), 'utf8');
const compiled = await transform(source, { loader:'ts', format:'esm', target:'es2022' });
const code = compiled.code.replace(/^import .*?;\s*/m, '');
const vacancy = '00000000-0000-4000-8000-000000000001';
const submission = '00000000-0000-4000-8000-000000000002';
let handler, state;
const reset = () => state={uploads:[],removed:[],calls:[],rate:true,replay:false,previous:false,ambiguous:false};
const db={
  rpc: async (name,args) => {
    state.calls.push({name,args});
    if(name==='check_rate_limit') return state.rate===null ? {error:{message:'unavailable'}} : {data:state.rate};
    if(name==='recruitment_guest_submission_status') return {data:state.previous ? {id:'submitted',replayed:true} : null};
    if(name==='recruitment_public_vacancy') return {data:{id:vacancy,requires_cv:true,requires_passport:false,questions:[]}};
    if(name==='recruitment_submit_guest_application') return state.ambiguous ? {error:{code:'NETWORK'}} : {data:{id:'submitted',replayed:state.replay}};
    throw new Error('Unexpected RPC '+name);
  },
  storage:{from:()=>({upload:async(path)=>{state.uploads.push(path);return {data:{path}}},remove:async(paths)=>{state.removed.push(...paths);return {data:[]}}})}
};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
new Function('admin','clientIp','json','safe','Deno',code)(()=>db,()=> '203.0.113.1',json,fn=>fn,{serve:fn=>handler=fn});

function request(overrides={},file=new File(['%PDF-1.7 example'],'cv.pdf',{type:'application/pdf'})) {
  const form=new FormData();
  form.set('payload',JSON.stringify({vacancy_id:vacancy,submission_id:submission,full_name:'Example Applicant',email:'applicant@example.org',phone:'08012345678',answers:{},consent:true,...overrides}));
  if(file)form.set('cv',file);
  return new Request('https://example.org',{method:'POST',body:form});
}
reset();
let response=await handler(request());
assert.equal(response.status,200);
assert.equal(state.uploads.length,1);
assert.match(state.uploads[0],new RegExp('^guest/[0-9a-f-]+/'+vacancy+'/'));
const saved=state.calls.find(x=>x.name==='recruitment_submit_guest_application');
assert.equal(saved.args.p_submission_id,submission);
assert.equal(saved.args.p_application.cv_path,state.uploads[0]);
assert.equal(state.removed.length,0);

reset(); response=await handler(request({consent:false}));
assert.equal(response.status,400); assert.equal(state.uploads.length,0);
reset(); response=await handler(request({},new File(['not a pdf'],'cv.pdf')));
assert.equal(response.status,400); assert.equal(state.uploads.length,0);
reset(); state.rate=null; response=await handler(request());
assert.equal(response.status,503); assert.equal(state.uploads.length,0);
reset(); state.rate=false; response=await handler(request());
assert.equal(response.status,429); assert.equal(state.uploads.length,0);
reset(); state.replay=true; response=await handler(request());
assert.equal(response.status,200); assert.deepEqual(state.removed,state.uploads);
reset(); state.previous=true; response=await handler(request());
assert.equal(response.status,200); assert.equal(state.uploads.length,0);
assert.equal(state.calls.some(x=>x.name==='recruitment_public_vacancy'),false);
reset(); state.ambiguous=true; response=await handler(request());
assert.equal(response.status,503); assert.equal(state.uploads.length,1); assert.equal(state.removed.length,0);
reset();
response=await handler(new Request('https://example.org',{method:'POST',headers:{'content-type':'multipart/form-data; boundary=test','content-length':String(26*1024*1024)},body:'x'}));
assert.equal(response.status,400); assert.equal(state.uploads.length,0);
reset();
const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(26*1024*1024));controller.close()}});
response=await handler(new Request('https://example.org',{method:'POST',headers:{'content-type':'multipart/form-data; boundary=test'},body:stream,duplex:'half'}));
assert.equal(response.status,400); assert.equal(state.uploads.length,0);
console.log('PASS guest recruitment handler: anonymous submission, validation, limits, idempotency and safe cleanup');
