import { admin, json } from "../_shared/lib.ts";

const db = admin();
const sleep = (ms:number) => new Promise(r=>setTimeout(r,ms));

async function sendEmail(job:any) {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  if (!key || !from) throw new Error("Email provider is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.");
  const action = job.metadata?.action_url ? `<p><a href="${escapeHtml(job.metadata.action_url)}">Open AH Student Hub</a></p>` : "";
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>${escapeHtml(job.subject ?? "AH Student Hub")}</h2><p>${escapeHtml(job.message).replace(/\n/g,"<br>")}</p>${action}<hr><small>AH Consult Ltd · AH Student Hub</small></div>`;
  const r = await fetch("https://api.resend.com/emails", { method:"POST", headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"}, body:JSON.stringify({from,to:[job.recipient],subject:job.subject ?? "AH Student Hub",html}) });
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(`Email provider ${r.status}: ${data?.message ?? "request failed"}`);
  return {provider:"resend",id:data?.id ?? null};
}

async function sendWebhook(job:any, channel:"sms"|"whatsapp") {
  const url = Deno.env.get(channel === "sms" ? "SMS_PROVIDER_URL" : "WHATSAPP_PROVIDER_URL");
  const token = Deno.env.get(channel === "sms" ? "SMS_PROVIDER_TOKEN" : "WHATSAPP_PROVIDER_TOKEN");
  if (!url) throw new Error(`${channel.toUpperCase()} provider is not configured.`);
  const r = await fetch(url, {method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({to:job.recipient,message:job.message,subject:job.subject,metadata:job.metadata})});
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(`${channel} provider ${r.status}: ${data?.message ?? "request failed"}`);
  return {provider:data?.provider ?? channel,id:data?.id ?? data?.message_id ?? null};
}

function escapeHtml(v:any){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]!));}

Deno.serve(async (req)=>{
  if(req.method!=="POST") return json({error:"POST required"},405);
  const auth=req.headers.get("authorization")??"";
  const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
  if(!service || auth!==`Bearer ${service}`) return json({error:"Unauthorized."},401);
  const worker=`communication-${crypto.randomUUID()}`;
  const {data:jobs,error}=await db.rpc("claim_communication_jobs",{p_worker:worker,p_limit:25});
  if(error) return json({error:error.message},500);
  let sent=0,failed=0;
  for(const job of jobs??[]){
    try{
      const result=job.channel==="email"?await sendEmail(job):await sendWebhook(job,job.channel);
      const done=await db.rpc("complete_communication_job",{p_id:job.id,p_provider:result.provider,p_provider_message_id:result.id});
      if(done.error) throw new Error(done.error.message);
      sent++;
    }catch(e){
      failed++;
      await db.rpc("fail_communication_job",{p_id:job.id,p_error:e instanceof Error?e.message:String(e),p_provider:job.channel});
    }
    await sleep(25);
  }
  return json({ok:true,claimed:(jobs??[]).length,sent,failed});
});
