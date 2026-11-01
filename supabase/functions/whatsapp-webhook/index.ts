// Meta WhatsApp Cloud API webhook. It verifies the challenge and HMAC before
// accepting events, deduplicates provider message IDs, and queues only safe
// guidance replies inside the customer-service window.
import { admin, timingSafeEqual } from "../_shared/lib.ts";
import { decryptText } from "../_shared/crypto.ts";
import { normalizeWhatsAppE164 } from "../_shared/whatsapp.ts";

const db=admin();
const enc=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("");
const clean=(value:unknown,max=4096)=>String(value??"").trim().slice(0,max);
const publicBase=()=>String(Deno.env.get("PUBLIC_APP_URL")||Deno.env.get("SITE_URL")||"").replace(/\/$/,"");

async function settings(){
  const {data,error}=await db.from("whatsapp_provider_settings").select("provider_kind,enabled,phone_number_id,app_secret_enc,verify_token_enc,chatbot_enabled,chatbot_handoff_text").eq("id",true).maybeSingle();
  if(error||!data) return null;
  let appSecret="",verifyToken="";
  try { appSecret=data.app_secret_enc?await decryptText(data.app_secret_enc):""; verifyToken=data.verify_token_enc?await decryptText(data.verify_token_enc):""; }
  catch { return null; }
  return {...data,appSecret,verifyToken};
}
async function signed(secret:string,raw:string){
  const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return "sha256="+hex(await crypto.subtle.sign("HMAC",key,enc.encode(raw)));
}
async function eventAlreadyHandled(id:string) {
  const {data,error}=await db.from("whatsapp_webhook_events").select("provider_event_id").eq("provider_event_id",id).maybeSingle();
  if(error) throw new Error("Event register unavailable");
  return !!data;
}
async function markEventHandled(id:string,kind:string,payload:Record<string,unknown>){
  const {error}=await db.from("whatsapp_webhook_events").insert({provider_event_id:id,event_kind:kind,payload});
  if(!error) return true;
  if(error.code==="23505") return false;
  throw new Error("Event register unavailable");
}
async function findConversation(phone:string,userId:string|null){
  const {data:found,error}=await db.from("whatsapp_conversations").select("id,status").eq("phone_e164",phone).maybeSingle();
  if(error) throw new Error("Conversation lookup failed");
  if(found?.id){
    const status=found.status==="closed"?"bot":found.status;
    await db.from("whatsapp_conversations").update({user_id:userId||undefined,status,last_inbound_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",found.id);
    return {id:found.id,status};
  }
  const {data:created,error:createdError}=await db.from("whatsapp_conversations").insert({phone_e164:phone,user_id:userId,last_inbound_at:new Date().toISOString(),status:"bot"}).select("id,status").single();
  if(createdError||!created) throw new Error("Conversation could not be created");
  return created;
}
function botReply(body:string,handoff:string){
  const text=body.toLowerCase().replace(/\s+/g," ").trim();const base=publicBase();
  const portal=base?`${base}/portal.html`:"the AH Student Portal";
  const apply=base?`${base}/apply.html`:"the AH Student Hub application page";
  if(/^(stop|opt ?out|unsubscribe|cancel)$/i.test(text)) return {kind:"optout",message:"Your WhatsApp preference has been updated. We will stop automated WhatsApp updates; you can still contact the training office for support."};
  if(/^(4|support|help|agent|human|person|representative)$/i.test(text)) return {kind:"handoff",message:handoff};
  if(/^(1|course|courses|training|class|programme|program)$/i.test(text)) return {kind:"courses",message:`For courses and current-intake additions, sign in to ${portal}. Reply 2 for applications, 3 for payment guidance, or 4 for support.`};
  if(/^(2|application|apply|admission|intake)$/i.test(text)) return {kind:"application",message:`For open intakes and your application progress, visit ${apply}. Reply 1 for courses, 3 for payment guidance, or 4 for support.`};
  if(/^(3|payment|pay|receipt|invoice)$/i.test(text)) return {kind:"payment",message:`For payment status and official receipts, sign in to ${portal} or use the secure application page. Never send card details or bank PINs in this chat. Reply 4 for support.`};
  return {kind:"menu",message:"Welcome to AH Consult Student Hub. Reply 1 for courses, 2 for applications, 3 for payment guidance, or 4 to speak with support. Do not send passwords, bank PINs or identity documents here."};
}
async function inbound(value:any,message:any,config:any){
  const messageId=clean(message?.id,180);const from=clean(message?.from,30);const phone=normalizeWhatsAppE164(from?"+"+from:"");
  if(!messageId||!phone) return;
  const eventId="message:"+messageId;
  if(await eventAlreadyHandled(eventId)) return;
  const {data:profile}=await db.from("profiles").select("id").eq("whatsapp_e164",phone).maybeSingle();
  const conversation=await findConversation(phone,profile?.id||null);
  const body=clean(message?.text?.body||"",4096);
  const inboundWrite=await db.from("whatsapp_messages").upsert({conversation_id:conversation.id,provider_message_id:messageId,direction:"inbound",message_type:clean(message?.type,40)||"unknown",body:body||null,status:"received",payload:{contact_name:clean(value?.contacts?.[0]?.profile?.name,160)||null}},{onConflict:"provider_message_id",ignoreDuplicates:true});
  if(inboundWrite.error) throw new Error("Inbound message could not be recorded");
  if(config.chatbot_enabled&&conversation.status!=="handoff"&&message?.type==="text"&&body){
    const reply=botReply(body,clean(config.chatbot_handoff_text,500)||"Thank you. A member of the AH Consult team will respond during office hours.");
    if(reply.kind==="optout"&&profile?.id){
      await db.from("communication_preferences").upsert({user_id:profile.id,whatsapp_enabled:false,updated_at:new Date().toISOString()},{onConflict:"user_id"});
      const {data:activeApps}=await db.from("applications").select("id,form_data").eq("user_id",profile.id).in("status",["draft","pending_payment","paid"]);
      for(const app of activeApps||[]){
        const update=await db.from("applications").update({form_data:{...(app.form_data||{}),whatsapp_consent:false}}).eq("id",app.id);
        if(update.error) throw new Error("Application consent state could not be updated");
      }
    }
    if(reply.kind==="handoff") await db.from("whatsapp_conversations").update({status:"handoff",handoff_requested_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",conversation.id);
    const outbox=await db.from("communication_outbox").insert({user_id:profile?.id||null,channel:"whatsapp",recipient:phone,subject:"AH Consult Student Hub",message:reply.message,metadata:{message_mode:"text",conversation_id:conversation.id,chatbot:true,inbound_message_id:messageId,reply_kind:reply.kind,allow_after_opt_out:reply.kind==="optout"}});
    if(outbox.error&&outbox.error.code!=="23505") throw new Error("Chatbot reply could not be queued");
  }
  await markEventHandled(eventId,"inbound_message",{message_id:messageId,phone_e164:phone,type:clean(message?.type,40)});
}
async function statusEvent(status:any){
  const id=clean(status?.id,180),state=clean(status?.status,30),at=status?.timestamp?new Date(Number(status.timestamp)*1000).toISOString():new Date().toISOString();
  if(!id||!state) return;
  const eventId="status:"+id+":"+state+":"+String(status?.timestamp||"");
  if(await eventAlreadyHandled(eventId)) return;
  const known=["sent","delivered","read","failed"].includes(state)?state:"accepted";
  // The campaign register starts at provider acceptance; its narrower status
  // enum intentionally folds Meta's intermediate sent state into accepted.
  const recipientStatus=known==="sent"?"accepted":known;
  await db.from("whatsapp_messages").update({status:known,status_at:at}).eq("provider_message_id",id);
  const recipients=await db.from("whatsapp_campaign_recipients")
    .update({status:recipientStatus,last_error:state==="failed"?clean(status?.errors?.[0]?.title||"Provider delivery failed",500):null,updated_at:new Date().toISOString()})
    .eq("provider_message_id",id).select("campaign_id");
  if(recipients.error) throw new Error("Campaign delivery status could not be recorded");
  for(const recipient of recipients.data||[]){
    const refreshed=await db.rpc("ahct_refresh_whatsapp_campaign_status",{p_campaign:recipient.campaign_id});
    if(refreshed.error) throw new Error("Campaign dispatch status could not be refreshed");
  }
  const patch:any={provider_status:known};if(state==="delivered"||state==="read")patch.delivered_at=at;if(state==="failed")patch.last_error=clean(status?.errors?.[0]?.title||"WhatsApp provider delivery failed",1000);
  await db.from("communication_outbox").update(patch).eq("provider_message_id",id);
  await markEventHandled(eventId,"delivery_status",{provider_message_id:id,status:state});
}

Deno.serve(async req=>{
  const config=await settings();
  if(req.method==="GET"){
    const u=new URL(req.url),mode=u.searchParams.get("hub.mode")||"",token=u.searchParams.get("hub.verify_token")||"",challenge=u.searchParams.get("hub.challenge")||"";
    if(!config?.verifyToken||mode!=="subscribe"||!token||!timingSafeEqual(config.verifyToken,token)) return new Response("forbidden",{status:403});
    return new Response(challenge,{status:200,headers:{"Content-Type":"text/plain","Cache-Control":"no-store"}});
  }
  if(req.method!=="POST") return new Response("method not allowed",{status:405});
  if(!config?.appSecret||config.provider_kind!=="meta_cloud") return new Response("not configured",{status:503});
  if(!config.enabled) return new Response("EVENT_RECEIVED",{status:200});
  const raw=await req.text();if(raw.length>1_000_000)return new Response("payload too large",{status:413});
  const signature=req.headers.get("x-hub-signature-256")||"";
  if(!signature||!timingSafeEqual(await signed(config.appSecret,raw),signature)) return new Response("bad signature",{status:401});
  let event:any;try{event=JSON.parse(raw);}catch{return new Response("bad json",{status:400});}
  if(event?.object!=="whatsapp_business_account")return new Response("ignored",{status:200});
  try {
    for(const entry of event.entry||[])for(const change of entry?.changes||[]){
      const value=change?.value||{};
      const eventPhoneNumberId=clean(value?.metadata?.phone_number_id,160);
      if(config.phone_number_id&&eventPhoneNumberId!==config.phone_number_id) continue;
      for(const status of value.statuses||[])await statusEvent(status);
      for(const message of value.messages||[])await inbound(value,message,config);
    }
    return new Response("EVENT_RECEIVED",{status:200});
  } catch (e) {
    console.error("WhatsApp webhook processing failed",e instanceof Error?e.name:"unknown");
    return new Response("processing failed",{status:500});
  }
});
