/* =============================================================================
   SETUP GUIDE  -  supabase/functions/payment-webhook/index.ts
=============================================================================
WHAT IT IS
   Receives Monnify payment notifications, checks the signature with the Monnify secret saved in the dashboard (or the old MONNIFY_SECRET_KEY) and marks the application paid.

WHERE THIS FILE GOES
   supabase/functions/payment-webhook/index.ts
   The file MUST be named index.ts. Its folder name (payment-webhook) is the function name.
   Run every command below from the PROJECT ROOT (the folder that CONTAINS the "supabase" folder).
   Its helpers live in supabase/functions/_shared/ (lib.ts, crypto.ts, pay.ts). Keep that folder exactly there.

ONE-TIME PREPARATION (skip if already done)
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF      (the part of your project URL before .supabase.co)

DEPLOY
   supabase functions deploy payment-webhook --no-verify-jwt
   (--no-verify-jwt lets outside services call it. You can instead set verify_jwt = false for it in supabase/config.toml.)
   "Docker is not running"? Start Docker Desktop, or update the Supabase CLI and add  --use-api  to the command.

SECRETS NEEDED   (supabase secrets set NAME=value   or   Dashboard > Edge Functions > Secrets)
   SETTINGS_ENCRYPTION_KEY. (Old setups: MONNIFY_SECRET_KEY still works.)

DATABASE NEEDED
   Migrations 001 to 010.

HOW TO TEST
   In the Monnify dashboard set the transaction-completion webhook to https://YOUR_PROJECT_REF.supabase.co/functions/v1/payment-webhook and send a test.

COMMON PROBLEMS
   401 "bad signature" = the Monnify secret key saved in the dashboard does not match.
   ============================================================================= */

// Monnify calls this. Verifies signature + amount, then sets application to 'paid'.
import { admin } from "../_shared/lib.ts";
import { loadProvider } from "../_shared/pay.ts";
import { kickSheetSync } from "../_shared/sync.ts";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
Deno.serve(async (req) => {
  const raw = await req.text(), db = admin(), sig = req.headers.get("monnify-signature");
  const hmac = async (secret: string) => { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]); return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw))); };
  const secrets: string[] = []; const { data: provs } = await db.from("payment_providers").select("id").eq("kind", "monnify");
  for (const p of provs ?? []) { const pr = await loadProvider(db, p.id, true); if (pr?.secrets.secret_key) secrets.push(pr.secrets.secret_key); }
  if (Deno.env.get("MONNIFY_SECRET_KEY")) secrets.push(Deno.env.get("MONNIFY_SECRET_KEY")!);
  let valid = false; for (const sec of secrets) { if (await hmac(sec) === sig) { valid = true; break; } }
  if (!valid) return new Response("bad signature", { status: 401 });
  const ev = JSON.parse(raw); if (ev.eventType !== "SUCCESSFUL_TRANSACTION") return new Response("ignored");
  const d = ev.eventData, ref = d.product?.reference, paid = Number(d.amountPaid);
  const { data: app } = await db.from("applications").select("*").eq("pay_reference", ref).maybeSingle();
  if (!app) return new Response("unknown reference", { status: 404 });
  if (!Number.isFinite(paid) || paid !== app.total_ngn) return new Response("amount mismatch", { status: 422 });
  try {
    await db.rpc("record_verified_payment", {
      p_application: app.id,
      p_provider: "monnify",
      p_provider_transaction_id: String(d.transactionReference),
      p_paid_ngn: paid,
      p_raw_event: ev,
      p_source: "monnify_webhook"
    });
  } catch (e) {
    console.error("PAYMENT SETTLEMENT FAILED", e);
    return new Response("payment settlement failed", { status: 500 });
  }
  const kick = kickSheetSync();
  // @ts-ignore EdgeRuntime exists on Supabase Edge Functions
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(kick);
  else void kick;
  return new Response("ok"); // duplicate webhooks are idempotent
});
