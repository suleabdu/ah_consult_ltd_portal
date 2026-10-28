/** Public authenticity check against archived SHA-256 bytes (no student PII is exposed). */
import { admin, safe, json, withinRateLimit } from "../_shared/lib.ts";
Deno.serve(safe(async(req)=>{
 if(req.method!=='POST')return json({error:'POST required'},405);
 const body=await req.json().catch(()=>({}));
 const id=String(body.document_id||''),hash=String(body.sha256||'').toLowerCase();
 if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[0-9a-f]{64}$/.test(hash))return json({error:'Provide a valid document ID and SHA-256 fingerprint'},422);
 const db=admin();
 const ip=(req.headers.get('x-forwarded-for')||'unidentified').split(',')[0].trim().slice(0,64);
 if(!await withinRateLimit(db,`public-document-verify:${ip}`,20,60))return json({error:'Too many checks. Try again later.'},429);
 const {data,error}=await db.from('student_documents').select('status,metadata').eq('id',id).maybeSingle();
 if(error)return json({error:'Verification service is temporarily unavailable'},503);
 // Only the hash of the first archived official PDF is authoritative.
 const authentic=Boolean(data?.status==='available' && data?.metadata?.pdf_path && data?.metadata?.sha256===hash);
 return json({authentic,explanation: authentic?'This file matches the institution\'s archived official document and has not been revoked.':'This file does not match an active, archived official document. Contact the records office.'});
}));
