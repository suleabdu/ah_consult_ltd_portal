/* =============================================================================
   SETUP GUIDE  -  supabase/functions/verify-payment/index.ts
=============================================================================
WHAT IT IS
   When an applicant returns from an online checkout (Upperlink), asks the payment provider directly whether the payment succeeded and unlocks the form if it did.

WHERE THIS FILE GOES
   supabase/functions/verify-payment/index.ts
   The file MUST be named index.ts. Its folder name (verify-payment) is the function name.
   Run every command below from the PROJECT ROOT (the folder that CONTAINS the "supabase" folder).
   Its helpers live in supabase/functions/_shared/ (lib.ts, crypto.ts, pay.ts). Keep that folder exactly there.

ONE-TIME PREPARATION (skip if already done)
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF      (the part of your project URL before .supabase.co)

DEPLOY
   supabase functions deploy verify-payment
   (Normal deploy. Signed-in users reach it with their login token.)
   "Docker is not running"? Start Docker Desktop, or update the Supabase CLI and add  --use-api  to the command.

SECRETS NEEDED   (supabase secrets set NAME=value   or   Dashboard > Edge Functions > Secrets)
   SETTINGS_ENCRYPTION_KEY (to read the saved key).

DATABASE NEEDED
   Migration 010.

HOW TO TEST
   Make an Upperlink method active, pay in test mode, press "I have completed payment, check now".

COMMON PROBLEMS
   "verify payment URL is not set" = fill in the Verify-payment URL in the Upperlink method.
   ============================================================================= */

// Applicant taps "I have paid" on a hosted-checkout payment: ask the payment provider directly (never trust the browser).
import { admin, json, safe, userFrom } from "../_shared/lib.ts";
import { envProvider, loadProvider, markPaid, verifyPayment } from "../_shared/pay.ts";
import { kickSheetSync } from "../_shared/sync.ts";
Deno.serve(safe(async (req) => {
  const user = await userFrom(req); if (!user) return json({ error: "Please sign in again." }, 401);
  const { applicationId } = await req.json(), db = admin();
  const { data: app } = await db.from("applications").select("*").eq("id", applicationId).eq("user_id", user.id).maybeSingle();
  if (!app) return json({ error: "Application not found." }, 404);
  if (app.status !== "pending_payment") return json({ paid: ["paid", "submitted", "under_review", "approved"].includes(app.status), status: app.status });
  const prov = app.pay_provider_id ? await loadProvider(db, app.pay_provider_id, true) : envProvider();
  if (!prov) return json({ paid: false, note: "The payment method for this application no longer exists." });
  const v = await verifyPayment(prov, app);
  if (v.paid) { await markPaid(db, app, v.amount ?? app.total_ngn, app.pay_gateway_ref ? "UL-" + app.pay_gateway_ref : null, { source: "verify", note: v.note }); await kickSheetSync(); return json({ paid: true, status: "paid" }); }
  return json({ paid: false, note: v.note });
}));
