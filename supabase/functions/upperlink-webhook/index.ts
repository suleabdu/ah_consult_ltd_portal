/* =============================================================================
   SETUP GUIDE  -  supabase/functions/upperlink-webhook/index.ts
=============================================================================
WHAT IT IS
   Receives Upperlink payment notifications. It never trusts the message: it asks Upperlink directly (verify URL) and only then marks the application paid.

WHERE THIS FILE GOES
   supabase/functions/upperlink-webhook/index.ts
   The file MUST be named index.ts. Its folder name (upperlink-webhook) is the function name.
   Run every command below from the PROJECT ROOT (the folder that CONTAINS the "supabase" folder).
   Its helpers live in supabase/functions/_shared/ (lib.ts, crypto.ts, pay.ts). Keep that folder exactly there.

ONE-TIME PREPARATION (skip if already done)
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF      (the part of your project URL before .supabase.co)

DEPLOY
   supabase functions deploy upperlink-webhook --no-verify-jwt
   (--no-verify-jwt lets outside services call it. You can instead set verify_jwt = false for it in supabase/config.toml.)
   "Docker is not running"? Start Docker Desktop, or update the Supabase CLI and add  --use-api  to the command.

SECRETS NEEDED   (supabase secrets set NAME=value   or   Dashboard > Edge Functions > Secrets)
   SETTINGS_ENCRYPTION_KEY.

DATABASE NEEDED
   Migration 010.

HOW TO TEST
   Give Upperlink this address: https://YOUR_PROJECT_REF.supabase.co/functions/v1/upperlink-webhook

COMMON PROBLEMS
   It always answers 200 so the provider does not retry forever. Look in Edge Functions > Logs for lines starting UPPERLINK WEBHOOK.
   ============================================================================= */

// Upperlink calls this when a payment finishes. The notification is only a trigger: the payment is confirmed by asking
// Upperlink's verify endpoint directly, so a forged request cannot mark anything paid. Deploy with --no-verify-jwt.
import { admin } from "../_shared/lib.ts";
import { loadProvider, markPaid, verifyPayment } from "../_shared/pay.ts";
import { kickSheetSync } from "../_shared/sync.ts";
const find = (o: any, out: string[] = []): string[] => { if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (typeof v === "string" && /ref|merchant|meta/i.test(k)) { out.push(v); try { find(JSON.parse(v), out); } catch { /* plain text */ } } else find(v, out); } return out; };
Deno.serve(async (req) => {
  try {
    const q = Object.fromEntries(new URL(req.url).searchParams); let body: any = {}; try { body = await req.json(); } catch { /* GET or form */ }
    const cands = [...new Set([...find(body), ...find(q), ...Object.values(q).filter((v) => typeof v === "string")] as string[])].filter((x) => x && x.length < 80);
    if (!cands.length) return new Response("ignored");
    const db = admin();
    for (const c of cands) {
      const { data: app } = await db.from("applications").select("*").or(`pay_reference.eq.${c.replace(/[^\w.-]/g, "")},pay_gateway_ref.eq.${c.replace(/[^\w.-]/g, "")}`).maybeSingle();
      if (!app || app.status !== "pending_payment") continue;
      const prov = await loadProvider(db, app.pay_provider_id, true); if (!prov) continue;
      const v = await verifyPayment(prov, app);
      if (v.paid) { await markPaid(db, app, v.amount ?? app.total_ngn, app.pay_gateway_ref ? "UL-" + app.pay_gateway_ref : null, { source: "upperlink-webhook", note: v.note }); await kickSheetSync(); return new Response("ok"); }
    }
  } catch (e) { console.error("UPPERLINK WEBHOOK:", e); }
  return new Response("ok");   // always 200 so the provider does not retry forever
});
