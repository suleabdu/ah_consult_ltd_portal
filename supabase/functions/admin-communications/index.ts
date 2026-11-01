// Administrator-only WhatsApp configuration and campaign queueing.
// Browser code never reads or writes provider secrets or recipient phone values.
import { admin, assertPublicHttps, json, safe, userFrom } from "../_shared/lib.ts";
import { decryptText, encryptText } from "../_shared/crypto.ts";
import { maskPhone, normalizeTemplateLanguage, normalizeTemplateName, normalizeWhatsAppE164 } from "../_shared/whatsapp.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean=(value:unknown,max=500)=>String(value??"").trim().slice(0,max);

async function requireAdministrator(req:Request) {
  const user=await userFrom(req); if(!user) return null;
  const db=admin();
  const {data:staff}=await db.from("staff").select("id,full_name,role,status").eq("id",user.id).maybeSingle();
  if(staff?.status!=="approved"||staff.role!=="administrator") return null;
  return {user,staff,db};
}
function secretHint(value:string){return value?"••••"+value.slice(-4):null;}
function sanitizeProvider(row:any){
  if(!row)return {configured:false,enabled:false};
  return {configured:true,enabled:!!row.enabled,provider_kind:"meta_cloud",graph_version:row.graph_version,
    phone_number_id:row.phone_number_id||"",business_account_id:row.business_account_id||"",
    default_template_name:row.default_template_name||"",default_template_language:row.default_template_language||"en_US",
    chatbot_enabled:row.chatbot_enabled!==false,chatbot_handoff_text:row.chatbot_handoff_text||"",
    secret_hints:row.secret_hints||{},updated_at:row.updated_at||null};
}

async function overview(db:any) {
  const [{data:settings},{data:apps},{data:staffRows},{data:campaigns},{data:handoffRows}]=await Promise.all([
    db.from("whatsapp_provider_settings").select("*").eq("id",true).maybeSingle(),
    db.from("applications").select("user_id,student_id,created_at").order("created_at",{ascending:false}).limit(1000),
    db.from("staff").select("id,full_name,status,whatsapp_e164,whatsapp_opt_in_at").order("full_name").limit(500),
    db.from("whatsapp_campaigns").select("id,subject,template_name,template_language,status,recipient_count,created_at,queued_at,completed_at").order("created_at",{ascending:false}).limit(20),
    db.from("whatsapp_conversations").select("id,user_id,phone_e164,status,last_inbound_at,handoff_requested_at,updated_at").eq("status","handoff").order("handoff_requested_at",{ascending:false}).limit(30)
  ]);
  const ids=[...new Set([...(apps||[]).map((a:any)=>a.user_id),...(handoffRows||[]).map((h:any)=>h.user_id)].filter(Boolean))];
  const [{data:profiles},{data:preferences}]=await Promise.all([
    ids.length?db.from("profiles").select("id,full_name,whatsapp_e164,whatsapp_opt_in_at").in("id",ids):Promise.resolve({data:[]}),
    ids.length?db.from("communication_preferences").select("user_id,whatsapp_enabled").in("user_id",ids):Promise.resolve({data:[]})
  ]);
  const preferenceMap=new Map((preferences||[]).map((p:any)=>[p.user_id,p.whatsapp_enabled===true]));
  const latest=new Map<string,any>(); for(const app of apps||[]){if(!latest.has(app.user_id))latest.set(app.user_id,app);}
  const students=[...(profiles||[])].map((p:any)=>({id:p.id,kind:"student",label:p.full_name||latest.get(p.id)?.student_id||"Student",reference:latest.get(p.id)?.student_id||"",whatsapp_available:!!p.whatsapp_e164&&!!p.whatsapp_opt_in_at&&preferenceMap.get(p.id)===true,phone_hint:maskPhone(p.whatsapp_e164)})).sort((a,b)=>a.label.localeCompare(b.label));
  const staffTargets=(staffRows||[]).filter((s:any)=>s.status==="approved").map((s:any)=>({id:s.id,kind:"staff",label:s.full_name||"Staff member",reference:"Staff",whatsapp_available:!!s.whatsapp_e164&&!!s.whatsapp_opt_in_at,phone_hint:maskPhone(s.whatsapp_e164)}));
  const handoffIds=(handoffRows||[]).map((h:any)=>h.id);
  const {data:messages}=handoffIds.length?await db.from("whatsapp_messages").select("conversation_id,body,created_at").in("conversation_id",handoffIds).eq("direction","inbound").order("created_at",{ascending:false}).limit(100):{data:[]};
  const latestMessage=new Map<string,any>();for(const message of messages||[])if(!latestMessage.has(message.conversation_id))latestMessage.set(message.conversation_id,message);
  const profileName=new Map((profiles||[]).map((p:any)=>[p.id,p.full_name]));
  const handoffs=(handoffRows||[]).map((h:any)=>({id:h.id,user_id:h.user_id,name:profileName.get(h.user_id)||"WhatsApp contact",phone_hint:maskPhone(h.phone_e164),last_inbound_at:h.last_inbound_at,handoff_requested_at:h.handoff_requested_at,last_message:clean(latestMessage.get(h.id)?.body,700)}));
  return {provider:sanitizeProvider(settings),recipients:{students,staff:staffTargets},campaigns:campaigns||[],handoffs};
}

async function saveProvider(db:any, actor:any, body:any) {
  if(body.provider_kind&&body.provider_kind!=="meta_cloud") throw Error("This release supports the Meta WhatsApp Cloud API only.");
  const providerKind="meta_cloud";
  const enabled=body.enabled===true;
  const graphVersion=clean(body.graph_version||"v22.0",20);
  const phoneNumberId=clean(body.phone_number_id,160),businessAccountId=clean(body.business_account_id,160);
  const templateName=normalizeTemplateName(body.default_template_name)||"";
  const templateLanguage=normalizeTemplateLanguage(body.default_template_language||"en_US")||"en_US";
  const handoff=clean(body.chatbot_handoff_text||"Thank you. A member of the AH Consult team will respond during office hours.",500);
  if(!/^v\d+\.\d+$/.test(graphVersion)) throw Error("Use a Graph API version such as v22.0.");
  if(enabled&&(!phoneNumberId||!templateName)) throw Error("An enabled Meta connection needs a phone-number ID and an approved default template.");
  const {data:current}=await db.from("whatsapp_provider_settings").select("*").eq("id",true).maybeSingle();
  const secrets=body.secrets&&typeof body.secrets==="object"?body.secrets:{};
  const next:any={id:true,provider_kind:providerKind,enabled,graph_version:graphVersion,phone_number_id:phoneNumberId||null,business_account_id:businessAccountId||null,endpoint_url:null,default_template_name:templateName||null,default_template_language:templateLanguage,chatbot_enabled:body.chatbot_enabled!==false,chatbot_handoff_text:handoff,updated_at:new Date().toISOString(),updated_by:actor.id,
    access_token_enc:current?.access_token_enc||null,app_secret_enc:current?.app_secret_enc||null,verify_token_enc:current?.verify_token_enc||null};
  for(const [input,column] of [["access_token","access_token_enc"],["app_secret","app_secret_enc"],["verify_token","verify_token_enc"]] as const){
    const value=clean(secrets[input],2000); if(value) next[column]=await encryptText(value);
  }
  if(enabled&&(!next.access_token_enc||!next.app_secret_enc||!next.verify_token_enc)) throw Error("Save the access token, app secret and webhook verify token before enabling WhatsApp.");
  let token="",appSecret="",verify="";
  try { token=next.access_token_enc?await decryptText(next.access_token_enc):""; appSecret=next.app_secret_enc?await decryptText(next.app_secret_enc):""; verify=next.verify_token_enc?await decryptText(next.verify_token_enc):""; }
  catch { throw Error("Stored WhatsApp secrets cannot be read with the current encryption key. Re-enter all three secrets."); }
  next.secret_hints={access_token:secretHint(token),app_secret:secretHint(appSecret),verify_token:secretHint(verify)};
  const {data,error}=await db.from("whatsapp_provider_settings").upsert(next,{onConflict:"id"}).select("*").single();
  if(error) throw Error("Could not save WhatsApp settings.");
  await db.from("audit_log").insert({actor:actor.id,actor_name:actor.full_name,action:"whatsapp.provider_saved",target:providerKind,note:enabled?"Enabled configuration saved":"Draft configuration saved"});
  return sanitizeProvider(data);
}

async function resolveRecipients(db:any, targets:any[]) {
  const cleanTargets=targets.filter(t=>t&&UUID.test(String(t.id||""))&&["student","staff"].includes(t.kind)).slice(0,500);
  if(!cleanTargets.length) throw Error("Select at least one recipient with an opted-in WhatsApp number.");
  const students=[...new Set(cleanTargets.filter(t=>t.kind==="student").map(t=>String(t.id)))],staffIds=[...new Set(cleanTargets.filter(t=>t.kind==="staff").map(t=>String(t.id)))];
  const [profilesResult,staffResult,preferencesResult]=await Promise.all([
    students.length?db.from("profiles").select("id,full_name,whatsapp_e164,whatsapp_opt_in_at").in("id",students):Promise.resolve({data:[]}),
    staffIds.length?db.from("staff").select("id,full_name,whatsapp_e164,whatsapp_opt_in_at,status").in("id",staffIds):Promise.resolve({data:[]}),
    students.length?db.from("communication_preferences").select("user_id,whatsapp_enabled").in("user_id",students):Promise.resolve({data:[]})
  ]);
  const preferences=new Map((preferencesResult.data||[]).map((p:any)=>[p.user_id,p.whatsapp_enabled===true]));
  const out:any[]=[]; const phoneSeen=new Set<string>();
  for(const profile of profilesResult.data||[]){const phone=normalizeWhatsAppE164(profile.whatsapp_e164);if(phone&&profile.whatsapp_opt_in_at&&preferences.get(profile.id)===true&&!phoneSeen.has(phone)){phoneSeen.add(phone);out.push({user_id:profile.id,recipient_kind:"student",recipient_name:clean(profile.full_name||"Student",160),phone_e164:phone});}}
  for(const staff of staffResult.data||[]){const phone=normalizeWhatsAppE164(staff.whatsapp_e164);if(phone&&staff.whatsapp_opt_in_at&&staff.status==="approved"&&!phoneSeen.has(phone)){phoneSeen.add(phone);out.push({user_id:staff.id,recipient_kind:"staff",recipient_name:clean(staff.full_name||"Staff member",160),phone_e164:phone});}}
  if(!out.length) throw Error("None of the selected recipients has an opted-in WhatsApp number.");
  return out;
}

async function queueCampaign(db:any, actor:any, body:any) {
  const provider=await db.from("whatsapp_provider_settings").select("enabled,default_template_name,default_template_language").eq("id",true).maybeSingle();
  if(!provider.data?.enabled) throw Error("Enable and save the WhatsApp provider before creating a campaign.");
  const templateName=normalizeTemplateName(body.template_name||provider.data.default_template_name); const templateLanguage=normalizeTemplateLanguage(body.template_language||provider.data.default_template_language||"en_US");
  if(!templateName||!templateLanguage) throw Error("Choose an approved template name and language.");
  const recipients=await resolveRecipients(db,Array.isArray(body.targets)?body.targets:[]);
  const subject=clean(body.subject,140),preview=clean(body.message_preview,700);
  const {data:campaign,error:campaignError}=await db.from("whatsapp_campaigns").insert({created_by:actor.id,subject:subject||null,template_name:templateName,template_language:templateLanguage,message_preview:preview||null,status:"preparing",recipient_count:recipients.length,metadata:{source:"admin_dashboard",template_only:true}}).select("id").single();
  if(campaignError||!campaign) throw Error("Could not create the campaign record.");
  // Register recipients before the outbox jobs are visible to the worker. This
  // preserves the campaign ledger even when a fast worker claims a new job
  // immediately after insertion.
  const recipientRows=recipients.map(r=>({campaign_id:campaign.id,user_id:r.user_id,recipient_kind:r.recipient_kind,recipient_name:r.recipient_name,phone_e164:r.phone_e164,status:"queued"}));
  const {error:recipientError}=await db.from("whatsapp_campaign_recipients").insert(recipientRows);
  if(recipientError){await db.from("whatsapp_campaigns").update({status:"failed",completed_at:new Date().toISOString()}).eq("id",campaign.id);throw Error("Could not register campaign recipients.");}
  const outboxRows=recipients.map(r=>({user_id:r.user_id,channel:"whatsapp",recipient:r.phone_e164,subject:subject||null,message:preview||("Template: "+templateName),metadata:{message_mode:"template",template_name:templateName,template_language:templateLanguage,campaign_id:campaign.id,recipient_kind:r.recipient_kind,initiated_by:actor.id}}));
  const {data:outbox,error:outboxError}=await db.from("communication_outbox").insert(outboxRows).select("id,user_id,recipient");
  if(outboxError||!outbox?.length){await db.from("whatsapp_campaign_recipients").update({status:"failed",last_error:"Campaign delivery jobs could not be queued",updated_at:new Date().toISOString()}).eq("campaign_id",campaign.id);await db.from("whatsapp_campaigns").update({status:"failed",completed_at:new Date().toISOString()}).eq("id",campaign.id);throw Error("Could not queue WhatsApp delivery jobs.");}
  const links=await Promise.all(outbox.map((row:any)=>db.from("whatsapp_campaign_recipients").update({communication_id:row.id,updated_at:new Date().toISOString()}).eq("campaign_id",campaign.id).eq("phone_e164",row.recipient).select("id")));
  if(links.some((result:any)=>result.error||!(result.data||[]).length)){
    await db.from("communication_outbox").update({status:"cancelled",last_error:"Campaign recipient linkage failed"}).in("id",outbox.map((x:any)=>x.id)).in("status",["queued","failed"]);
    await db.from("whatsapp_campaign_recipients").update({status:"failed",last_error:"Campaign recipient linkage failed",updated_at:new Date().toISOString()}).eq("campaign_id",campaign.id).eq("status","queued");
    await db.from("whatsapp_campaigns").update({status:"failed",completed_at:new Date().toISOString()}).eq("id",campaign.id);
    throw Error("Could not link WhatsApp delivery jobs to the campaign ledger.");
  }
  await db.from("whatsapp_campaigns").update({queued_at:new Date().toISOString()}).eq("id",campaign.id);
  const {error:refreshError}=await db.rpc("ahct_refresh_whatsapp_campaign_status",{p_campaign:campaign.id});
  if(refreshError){
    // The jobs are already durable; do not make the caller retry and create a
    // second campaign solely because the non-critical summary refresh failed.
    console.error("WhatsApp campaign summary refresh failed",refreshError.name||"unknown");
    await db.from("whatsapp_campaigns").update({status:"queued"}).eq("id",campaign.id);
  }
  await db.from("audit_log").insert({actor:actor.id,actor_name:actor.full_name,action:"whatsapp.campaign_queued",target:campaign.id,note:"Template "+templateName+"; "+recipients.length+" opted-in recipient(s)"});
  return {campaign_id:campaign.id,queued:recipients.length,template_name:templateName};
}

Deno.serve(safe(async req=>{
  if(req.method!=="POST") return json({error:"POST required"},405);
  const context=await requireAdministrator(req); if(!context) return json({error:"Administrator access required"},403);
  const body=await req.json().catch(()=>({})); const action=String(body.action||"overview");
  if(action==="overview") return json(await overview(context.db));
  if(action==="save_provider") return json({provider:await saveProvider(context.db,context.staff,body)});
  if(action==="queue_campaign") return json(await queueCampaign(context.db,context.staff,body),201);
  if(action==="cancel_campaign") {
    const id=String(body.campaign_id||"");if(!UUID.test(id))return json({error:"Valid campaign ID required"},400);
    const {data:rows}=await context.db.from("whatsapp_campaign_recipients").select("communication_id").eq("campaign_id",id).in("status",["queued"]);
    const jobIds=(rows||[]).map((r:any)=>r.communication_id).filter(Boolean);
    if(jobIds.length) await context.db.from("communication_outbox").update({status:"cancelled",last_error:"Cancelled by administrator"}).in("id",jobIds).in("status",["queued","failed"]);
    await context.db.from("whatsapp_campaign_recipients").update({status:"cancelled",updated_at:new Date().toISOString()}).eq("campaign_id",id).eq("status","queued");
    await context.db.from("whatsapp_campaigns").update({status:"cancelled",completed_at:new Date().toISOString()}).eq("id",id);
    await context.db.from("audit_log").insert({actor:context.staff.id,actor_name:context.staff.full_name,action:"whatsapp.campaign_cancelled",target:id});
    return json({ok:true});
  }
  if(action==="send_handoff_reply") {
    const id=String(body.conversation_id||"");const message=clean(body.message,1000);
    if(!UUID.test(id)||message.length<2) return json({error:"Select a handoff and enter a concise reply."},400);
    const {data:conversation,error}=await context.db.from("whatsapp_conversations").select("id,user_id,phone_e164,status,last_inbound_at").eq("id",id).maybeSingle();
    if(error||!conversation||conversation.status!=="handoff") return json({error:"This support conversation is no longer awaiting handoff."},409);
    const inbound=conversation.last_inbound_at?new Date(conversation.last_inbound_at).getTime():0;
    if(!Number.isFinite(inbound)||Date.now()-inbound>24*60*60*1000) return json({error:"The 24-hour customer-service window has closed. Send an approved template campaign instead."},409);
    const {error:queueError}=await context.db.from("communication_outbox").insert({user_id:conversation.user_id,channel:"whatsapp",recipient:conversation.phone_e164,subject:"AH Consult Student Hub",message,metadata:{message_mode:"text",conversation_id:conversation.id,recipient_kind:"student",handoff_reply:true,initiated_by:context.staff.id}});
    if(queueError) return json({error:"Could not queue the support reply."},500);
    await context.db.from("whatsapp_conversations").update({updated_at:new Date().toISOString()}).eq("id",id);
    await context.db.from("audit_log").insert({actor:context.staff.id,actor_name:context.staff.full_name,action:"whatsapp.handoff_reply_queued",target:id,note:"Customer-service reply queued"});
    return json({ok:true});
  }
  if(action==="close_handoff") {
    const id=String(body.conversation_id||"");if(!UUID.test(id)) return json({error:"Valid conversation ID required"},400);
    const {error}=await context.db.from("whatsapp_conversations").update({status:"closed",updated_at:new Date().toISOString()}).eq("id",id).eq("status","handoff");
    if(error) return json({error:"Could not close the support handoff."},500);
    await context.db.from("audit_log").insert({actor:context.staff.id,actor_name:context.staff.full_name,action:"whatsapp.handoff_closed",target:id});
    return json({ok:true});
  }
  return json({error:"Unsupported action"},400);
}));
