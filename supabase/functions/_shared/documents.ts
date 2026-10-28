/** Internal-only receipt queue kick. Public callers must never see service-role credentials. */
export async function kickReceiptIssuance(documentId?: string): Promise<{ok:boolean; error?:string; issued?:number}> {
  const base = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !key) return {ok:false,error:'Service configuration missing'};
  try {
    const r = await fetch(`${base.replace(/\/$/,'')}/functions/v1/document-issue`, {
      method:'POST', headers:{Authorization:`Bearer ${key}`,apikey:key,'Content-Type':'application/json'},
      body:JSON.stringify(documentId?{document_id:documentId}:{limit:12}), signal:AbortSignal.timeout(55000)
    });
    const result = await r.json().catch(()=>({}));
    if (!r.ok || result.failed) console.error('Receipt issuance not fully completed',r.status, result.failed || result.error);
    return {ok:r.ok&&!result.failed,issued:Number(result.issued||0),error:String(result.failures?.[0]?.reason||result.error||(!r.ok?`HTTP ${r.status}`:result.failed?"Receipt PDF generation failed":""))||undefined};
  } catch (e) {
    const message=e instanceof Error?e.message:String(e);
    console.error('Receipt issuance worker unavailable:',message);
    return {ok:false,error:message};
  }
}
/** Run work after responding to the provider; database pending records remain retryable. */
export function scheduleReceiptIssuance() {
  const task=kickReceiptIssuance();
  // @ts-ignore EdgeRuntime is supplied by Supabase's deployed runtime
  if(typeof EdgeRuntime!=='undefined') EdgeRuntime.waitUntil(task);
  else return task;
}
