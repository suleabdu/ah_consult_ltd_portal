// Signed-in applicant payment verification and receipt recovery.
// A paid application status is NOT proof that an archived receipt exists.
import { admin, json, safe, userFrom } from "../_shared/lib.ts";
import { envProvider, loadProvider, markPaid, verifyPayment } from "../_shared/pay.ts";
import { kickSheetSync } from "../_shared/sync.ts";
import { kickReceiptIssuance } from "../_shared/documents.ts";

type ReceiptState = "ready" | "pending" | "missing_verified_payment" | "issuance_error";

async function reconcileVerifiedReceipts(db: any, app: any): Promise<{paid:boolean;receipt_status:ReceiptState;receipt_count:number;note:string}> {
  const {data:payments,error:paymentsError}=await db.from("payments")
    .select("id,reference,expected_ngn,paid_ngn,verified_at")
    .eq("application_id",app.id).not("verified_at","is",null)
    .order("verified_at",{ascending:false}).limit(30);
  if(paymentsError) {
    console.error("Receipt ledger lookup failed",app.id,paymentsError.message);
    return {paid:false,receipt_status:"issuance_error",receipt_count:0,note:"The verified payment register is temporarily unavailable. Finance can investigate."};
  }
  const verified=(payments||[]).filter((p:any)=>Number(p.expected_ngn)>0&&Number(p.paid_ngn)>=Number(p.expected_ngn));
  if(!verified.length) return {paid:false,receipt_status:"missing_verified_payment",receipt_count:0,note:"No fully verified payment transaction was found. Contact Finance if your provider confirmed a charge."};

  let pendingId:string|null=null;
  let readyCount=0;
  let issueError=false;
  for(const payment of verified){
    const key=`payment_receipt:${payment.id}`;
    const query=()=>db.from("student_documents")
      .select("id,status,metadata").eq("user_id",app.user_id).eq("document_key",key).maybeSingle();
    let {data:document,error:lookupError}=await query();
    if(lookupError){console.error("Receipt lookup failed",payment.id,lookupError.message);issueError=true;continue;}
    if(!document){
      const {data:inserted,error:insertError}=await db.from("student_documents").insert({
        user_id:app.user_id,application_id:app.id,title:"Payment Receipt",document_type:"payment_receipt",
        status:"pending",document_key:key,issued_at:null,
        metadata:{payment_id:payment.id,payment_reference:payment.reference,verified_at:payment.verified_at,source:"applicant_server_reconciliation"}
      }).select("id,status,metadata").single();
      if(insertError){
        // Another webhook / applicant request may have inserted the same record.
        if(insertError.code==="23505") ({data:document,error:lookupError}=await query());
        else {console.error("Receipt creation failed",payment.id,insertError.message);issueError=true;continue;}
      }else document=inserted;
      if(lookupError||!document){issueError=true;continue;}
    }
    if(document.status==="available"&&document.metadata?.pdf_path&&document.metadata?.sha256)readyCount++;
    else if(document.status==="pending"&&!pendingId)pendingId=document.id;
  }

  // A user-initiated refresh also repairs payments settled before this function
  // version was deployed. The provider webhook still schedules issuance automatically.
  let generationNote="";
  if(pendingId){
    const attempt=await kickReceiptIssuance(pendingId);
    if(!attempt.ok){
      issueError=true;
      console.error("Receipt PDF generation failed",pendingId,attempt.error);
      generationNote=/letterhead/i.test(attempt.error||"")
        ? "The official company letterhead must be published or repaired by the administrator."
        : "The official PDF could not be archived yet. Finance can retry issuance.";
    }
    const {data:updated}=await db.from("student_documents").select("status,metadata").eq("id",pendingId).maybeSingle();
    if(updated?.status==="available"&&updated.metadata?.pdf_path&&updated.metadata?.sha256)readyCount++;
  }
  const receipt_status:ReceiptState=readyCount>0?"ready":issueError?"issuance_error":"pending";
  return {paid:true,receipt_status,receipt_count:readyCount,
    note:readyCount>0?"Your official payment receipt is ready to preview, download or print.":generationNote||"Your verified payment is recorded; official receipt issuance is in progress."};
}

Deno.serve(safe(async (req) => {
  if(req.method!=="POST")return json({error:"POST required"},405);
  const user=await userFrom(req); if(!user)return json({error:"Please sign in again."},401);
  const body=await req.json().catch(()=>({}));
  const applicationId=String(body.applicationId||"");
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId))return json({error:"Valid application ID required"},400);
  const db=admin();
  const {data:app,error:appError}=await db.from("applications").select("*").eq("id",applicationId).eq("user_id",user.id).maybeSingle();
  if(appError)return json({error:"Application could not be checked"},503);
  if(!app)return json({error:"Application not found"},404);
  const alreadyPaid=["paid","submitted","under_review","approved"].includes(app.status);
  if(app.status==="pending_payment"){
    const prov=app.pay_provider_id?await loadProvider(db,app.pay_provider_id,true):envProvider();
    if(!prov)return json({paid:false,receipt_status:"missing_verified_payment",note:"The configured payment provider is unavailable."});
    const result=await verifyPayment(prov,app);
    if(!result.paid)return json({paid:false,receipt_status:"missing_verified_payment",note:result.note||"Payment not yet verified."});
    await markPaid(db,app,result.amount??app.total_ngn,app.pay_gateway_ref?"UL-"+app.pay_gateway_ref:null,{source:"verify",note:result.note,provider_evidence:result.evidence||{}});
    await kickSheetSync();
  }else if(!alreadyPaid){
    return json({paid:false,receipt_status:"missing_verified_payment",note:"This application is not awaiting payment verification."});
  }
  // Never claim a usable receipt merely because the application status is paid.
  const receipt=await reconcileVerifiedReceipts(db,app);
  return json({...receipt,status:app.status==="pending_payment"?"paid":app.status});
}));
