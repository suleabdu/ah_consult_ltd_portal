/** Private batch document issuer. Requires service role or approved administrator/finance officer. */
import {admin,corsHeaders,json,safe,userFrom} from '../_shared/lib.ts';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
Deno.serve(safe(async req=>{
  if(req.method!=='POST')return json({error:'POST required'},405);
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const bearer=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  const trusted=!!key && bearer===key;
  const db=admin();
  if(!trusted){
    const who=await userFrom(req);
    if(!who)return json({error:'Authentication required'},401);
    const {data:staff}=await db.from('staff').select('role,status').eq('id',who.id).maybeSingle();
    if(staff?.status!=='approved'||!['administrator','finance'].includes(staff?.role)) return json({error:'Finance or administrator access required'},403);
  }
  const input=await req.json().catch(()=>({}));
  const id=input.document_id?String(input.document_id):null;
  if(id&&!UUID.test(id))return json({error:'Invalid document identifier'},400);
  const limit=Math.min(30,Math.max(1,Math.floor(Number(input.limit)||12)));
  let q=db.from('student_documents').select('id,document_key,status,metadata')
    .eq('document_type','payment_receipt').eq('status','pending').order('created_at',{ascending:true}).limit(limit);
  if(id)q=q.eq('id',id);
  const {data:jobs,error}=await q;
  if(error)return json({error:'Could not load pending receipts'},503);
  const failed:{id:string;reason:string}[]=[];let issued=0;
  for(const doc of jobs||[]){
    if(!/^payment_receipt:[0-9a-f-]{36}$/i.test(doc.document_key||'')||!doc.metadata?.payment_id){
      failed.push({id:doc.id,reason:'Missing verified payment reference'});continue;
    }
    try{
      const r=await fetch(`${Deno.env.get('SUPABASE_URL')!.replace(/\/$/,'')}/functions/v1/student-document`,{
        method:'POST',headers:{Authorization:`Bearer ${key}`,apikey:key,'Content-Type':'application/json'},
        body:JSON.stringify({document_id:doc.id,document_key:'payment_receipt'}),signal:AbortSignal.timeout(40000)
      });
      if(!r.ok){const msg=await r.json().catch(()=>({}));throw new Error(String(msg.error||`PDF renderer HTTP ${r.status}`).slice(0,180));}
      if(!(r.headers.get('content-type')||'').startsWith('application/pdf'))throw Error('Unexpected renderer response');
      await r.arrayBuffer();issued++;
    }catch(e){const reason=e instanceof Error?e.message:'Unknown render failure';failed.push({id:doc.id,reason});console.error('receipt issue failure',doc.id,reason);}
  }
  return new Response(JSON.stringify({ok:!failed.length,issued,failed:failed.length,failures:failed}),{
    headers:{...corsHeaders(req),'Content-Type':'application/json','Cache-Control':'no-store'}
  });
}));
