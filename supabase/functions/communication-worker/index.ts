// Private queue worker. It is invoked by a scheduler with the service-role key,
// never by a browser. WhatsApp provider credentials remain encrypted at rest.
import { admin, json } from "../_shared/lib.ts";
import { decryptText } from "../_shared/crypto.ts";
import { metaRecipient, normalizeTemplateLanguage, normalizeTemplateName, normalizeWhatsAppE164 } from "../_shared/whatsapp.ts";

const db = admin();
const sleep = (ms:number) => new Promise(r=>setTimeout(r,ms));
type WhatsAppProvider = {
  enabled:boolean; graph_version:string; phone_number_id:string; access_token:string;
  default_template_name:string; default_template_language:string;
};

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

async function loadWhatsAppProvider():Promise<WhatsAppProvider|null> {
  // Do not cache this singleton across warm Edge Function invocations: an
  // administrator must be able to disable delivery or rotate credentials now.
  const {data,error}=await db.from("whatsapp_provider_settings").select("*").eq("id",true).maybeSingle();
  if(error) throw new Error("WhatsApp settings could not be loaded.");
  if(!data?.enabled) return null;
  if(data.provider_kind!=="meta_cloud") throw new Error("Unsupported WhatsApp provider configuration. Save the Meta Cloud API settings again.");
  let token="";
  try { token=data.access_token_enc?await decryptText(data.access_token_enc):""; }
  catch { throw new Error("WhatsApp access token cannot be decrypted. Re-save it in Admin settings."); }
  return {
    enabled:true,graph_version:String(data.graph_version||"v22.0"),phone_number_id:String(data.phone_number_id||""),
    access_token:token,
    default_template_name:String(data.default_template_name||""),default_template_language:String(data.default_template_language||"en_US")
  };
}

async function customerWindowOpen(conversationId:string):Promise<boolean> {
  if(!/^[0-9a-f-]{36}$/i.test(conversationId)) return false;
  const {data,error}=await db.from("whatsapp_conversations").select("last_inbound_at,status").eq("id",conversationId).maybeSingle();
  if(error||!data||!["bot","handoff"].includes(data.status)) return false;
  const inbound=data.last_inbound_at?new Date(data.last_inbound_at).getTime():0;
  return Number.isFinite(inbound) && Date.now()-inbound<=24*60*60*1000;
}

async function assertWhatsAppConsent(job:any,phone:string) {
  const metadata=job.metadata||{}, kind=String(metadata.recipient_kind||"student");
  const isOptOutConfirmation=metadata.chatbot===true&&metadata.reply_kind==="optout"&&metadata.allow_after_opt_out===true;
  // A bot response is only created from a verified inbound webhook message and
  // is still constrained to the 24-hour customer-service window in
  // sendWhatsApp. It may therefore respond to a new contact that does not yet
  // have a portal profile or a marketing/notification consent record.
  const isInboundChatbotReply=metadata.chatbot===true
    && typeof metadata.inbound_message_id==="string" && metadata.inbound_message_id.length>0
    && /^[0-9a-f-]{36}$/i.test(String(metadata.conversation_id||""));
  if(isInboundChatbotReply) return;
  if(kind==="staff") {
    const {data:staff}=await db.from("staff").select("whatsapp_e164,whatsapp_opt_in_at,status").eq("id",job.user_id).maybeSingle();
    if(!staff||staff.status!=="approved"||!staff.whatsapp_opt_in_at||normalizeWhatsAppE164(staff.whatsapp_e164)!==phone) throw new Error("The staff recipient has not opted in to WhatsApp delivery.");
    return;
  }
  const {data:profile}=await db.from("profiles").select("whatsapp_e164,whatsapp_opt_in_at").eq("id",job.user_id).maybeSingle();
  if(!profile||!profile.whatsapp_opt_in_at||normalizeWhatsAppE164(profile.whatsapp_e164)!==phone) throw new Error("The recipient has not consented to WhatsApp delivery.");
  const {data:preference}=await db.from("communication_preferences").select("whatsapp_enabled").eq("user_id",job.user_id).maybeSingle();
  if(preference?.whatsapp_enabled===false&&!isOptOutConfirmation) throw new Error("The recipient has opted out of WhatsApp delivery.");
}

async function sendWhatsApp(job:any) {
  const provider=await loadWhatsAppProvider();
  if(!provider) throw new Error("WhatsApp is not enabled in Admin settings.");
  const to=metaRecipient(job.recipient);
  if(!to) throw new Error("The selected recipient does not have a valid WhatsApp number.");
  const metadata=job.metadata||{}, mode=String(metadata.message_mode||"template");
  const phone="+"+to;
  await assertWhatsAppConsent(job,phone);
  let templateName:string|null=null,templateLanguage:string|null=null,body="";
  if(mode==="template") {
    templateName=normalizeTemplateName(metadata.template_name||provider.default_template_name);
    templateLanguage=normalizeTemplateLanguage(metadata.template_language||provider.default_template_language);
    if(!templateName||!templateLanguage) throw new Error("A valid approved WhatsApp template name and language are required for this message.");
  } else {
    if(!await customerWindowOpen(String(metadata.conversation_id||""))) {
      throw new Error("A free-form WhatsApp reply requires an open 24-hour customer-service window. Use an approved template instead.");
    }
    body=String(job.message||"").trim();
    if(!body||body.length>4096) throw new Error("WhatsApp reply text must be between 1 and 4096 characters.");
  }

  if(!provider.phone_number_id || !provider.access_token) throw new Error("Meta WhatsApp Cloud API needs a phone-number ID and access token.");
  if(!/^v\d+\.\d+$/.test(provider.graph_version)) throw new Error("Invalid Meta Graph API version in WhatsApp settings.");
  let payload:any;
  if(mode==="template") {
    payload={messaging_product:"whatsapp",to,type:"template",template:{name:templateName,language:{code:templateLanguage}}};
  } else {
    payload={messaging_product:"whatsapp",to,type:"text",text:{preview_url:false,body}};
  }
  const url="https://graph.facebook.com/"+provider.graph_version+"/"+encodeURIComponent(provider.phone_number_id)+"/messages";
  const r=await fetch(url,{method:"POST",headers:{Authorization:"Bearer "+provider.access_token,"Content-Type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error("Meta WhatsApp "+r.status+": "+String(data?.error?.message||"request failed").slice(0,180));
  return {provider:"meta_cloud",id:String(data?.messages?.[0]?.id||"")||null,mode};
}

async function recordWhatsAppOutbound(job:any,result:{provider:string;id:string|null;mode:string}) {
  const phone=normalizeWhatsAppE164(job.recipient); if(!phone) return;
  try {
    const metadata=job.metadata||{}; let conversationId=String(metadata.conversation_id||"");
    if(!/^[0-9a-f-]{36}$/i.test(conversationId)) {
      const {data:found}=await db.from("whatsapp_conversations").select("id").eq("phone_e164",phone).maybeSingle();
      if(found?.id) conversationId=found.id;
      else {
        const {data:created,error}=await db.from("whatsapp_conversations").insert({phone_e164:phone,user_id:job.user_id||null,status:"bot"}).select("id").single();
        if(error||!created) return; conversationId=created.id;
      }
    }
    await db.from("whatsapp_conversations").update({last_outbound_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",conversationId);
    await db.from("whatsapp_messages").insert({conversation_id:conversationId,communication_id:job.id,provider_message_id:result.id,direction:"outbound",message_type:result.mode==="template"?"template":"text",body:String(job.message||"").slice(0,4096),status:"accepted",payload:{message_mode:result.mode,template_name:metadata.template_name||null,channel:result.provider}});
    const recipientPatch={status:"accepted",provider_message_id:result.id,updated_at:new Date().toISOString()};
    const linked=await db.from("whatsapp_campaign_recipients").update(recipientPatch).eq("communication_id",job.id).select("id");
    // A worker can claim an outbox row between campaign-job insertion and the
    // linkage update. The campaign ID plus canonical phone remains an
    // unambiguous fallback because queueCampaign de-duplicates recipients.
    if(!linked.error&&!(linked.data||[]).length&&/^[0-9a-f-]{36}$/i.test(String(metadata.campaign_id||""))){
      await db.from("whatsapp_campaign_recipients").update(recipientPatch).eq("campaign_id",metadata.campaign_id).eq("phone_e164",phone);
    }
  } catch (e) {
    // Delivery is already accepted by the provider. Do not retry and risk a
    // duplicate just because the optional conversation ledger is unavailable.
    console.error("WhatsApp ledger write failed",job.id,e instanceof Error?e.name:"unknown");
  }
}
async function refreshWhatsAppCampaign(job:any) {
  const campaignId=String(job?.metadata?.campaign_id||"");
  if(!/^[0-9a-f-]{36}$/i.test(campaignId)) return;
  const {error}=await db.rpc("ahct_refresh_whatsapp_campaign_status",{p_campaign:campaignId});
  if(error) console.error("WhatsApp campaign refresh failed",job.id,error.name||"unknown");
}

async function sendWebhook(job:any, channel:"sms") {
  const url = Deno.env.get("SMS_PROVIDER_URL"), token = Deno.env.get("SMS_PROVIDER_TOKEN");
  if (!url) throw new Error("SMS provider is not configured.");
  const r = await fetch(url,{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({to:job.recipient,message:job.message,subject:job.subject,metadata:job.metadata})});
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
      let result:any;
      if(job.channel==="email") result=await sendEmail(job);
      else if(job.channel==="whatsapp") result=await sendWhatsApp(job);
      else result=await sendWebhook(job,"sms");
      if(job.channel==="whatsapp") await recordWhatsAppOutbound(job,{...result,mode:result.mode||"text"});
      const done=await db.rpc("complete_communication_job",{p_id:job.id,p_provider:result.provider,p_provider_message_id:result.id});
      if(done.error) throw new Error(done.error.message);
      if(job.channel==="whatsapp") await refreshWhatsAppCampaign(job);
      sent++;
    }catch(e){
      failed++;
      const failedJob=await db.rpc("fail_communication_job",{p_id:job.id,p_error:e instanceof Error?e.message:String(e),p_provider:job.channel});
      if(job.channel==="whatsapp"&&failedJob.data?.status==="failed"){
        await db.from("whatsapp_campaign_recipients").update({status:"failed",last_error:e instanceof Error?e.message.slice(0,500):String(e).slice(0,500),updated_at:new Date().toISOString()}).eq("communication_id",job.id);
        await refreshWhatsAppCampaign(job);
      }
    }
    await sleep(25);
  }
  return json({ok:true,claimed:(jobs??[]).length,sent,failed});
});
