import { admin, json, safe, userFrom } from "../_shared/lib.ts";
import { kickSheetSync } from "../_shared/sync.ts";

Deno.serve(safe(async (req) => {
  const user = await userFrom(req);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const db = admin();
  const { data: staff } = await db.from("staff").select("role,status").eq("id", user.id).maybeSingle();
  if (!staff || staff.status !== "approved" || staff.role !== "administrator") {
    return json({ error: "Only an approved administrator can run the Sheet sync." }, 403);
  }
  const payload = await req.json().catch(() => ({}));
  if (payload.action === "diagnose") {
    const base = Deno.env.get("SUPABASE_URL"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!base || !service) return json({error:"Required Supabase server secrets are missing."},503);
    try {
      const r = await fetch(base.replace(/\/$/, "")+"/functions/v1/sheet-sync?check=1", {
        headers: { Authorization: "Bearer " + service, apikey: service },
        signal: AbortSignal.timeout(20000)
      });
      const result = await r.json().catch(() => ({}));
      if (!r.ok) return json({error:result.error||"Worker connection failed (HTTP "+r.status+"). Review sheet-sync Edge Function logs."},502);
      return json({all_ok:result.all_ok,steps:result.steps,pending_jobs:result.pending_jobs});
    } catch (e) { console.error("sheet-sync diagnostics failed",e);return json({error:"Sheet-sync diagnostics could not reach the worker. Check function deployment, secrets and execution logs."},502); }
  }
  const work = kickSheetSync().then(result => {
    if (!result.ok) console.error("Manual sheet-sync worker request failed", result.status, result.error);
  }).catch(e => console.error("Manual sheet-sync dispatch failed", e));
  // @ts-ignore EdgeRuntime is provided by the Supabase Edge runtime.
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
  else await work;
  return json({ ok: true, queued: true, message: "Synchronization requested. Refresh the status to see completed and failed jobs." }, 202);
}));
