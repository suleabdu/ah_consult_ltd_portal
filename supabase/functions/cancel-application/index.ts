/* =============================================================================
   SETUP GUIDE  -  supabase/functions/cancel-application/index.ts
=============================================================================
WHAT IT IS
   Lets an applicant change their courses before paying by cancelling the unpaid application.

WHERE THIS FILE GOES
   supabase/functions/cancel-application/index.ts
   The file MUST be named index.ts. Its folder name (cancel-application) is the function name.
   Run every command below from the PROJECT ROOT (the folder that CONTAINS the "supabase" folder).
   Its helpers live in supabase/functions/_shared/ (lib.ts, crypto.ts, pay.ts). Keep that folder exactly there.

ONE-TIME PREPARATION (skip if already done)
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF      (the part of your project URL before .supabase.co)

DEPLOY
   supabase functions deploy cancel-application
   (Normal deploy. Signed-in users reach it with their login token.)
   "Docker is not running"? Start Docker Desktop, or update the Supabase CLI and add  --use-api  to the command.

SECRETS NEEDED   (supabase secrets set NAME=value   or   Dashboard > Edge Functions > Secrets)
   None.

DATABASE NEEDED
   Migrations 001 to 004.

HOW TO TEST
   On the payment page press "Go back and change my courses" and confirm.

COMMON PROBLEMS
   It refuses if a payment was already claimed or received. That is intended.
   ============================================================================= */

// Lets an applicant change their courses before paying: cancels the unpaid application (and its payment reference).
import { admin, json, safe, userFrom } from "../_shared/lib.ts";
import { kickSheetSync } from "../_shared/sync.ts";
Deno.serve(safe(async (req) => {
  const user = await userFrom(req); if (!user) return json({ error: "Please sign in again." }, 401);
  const { applicationId } = await req.json();
  const db = admin();
  const { data: app } = await db.from("applications").select("*").eq("id", applicationId).eq("user_id", user.id).single();
  if (!app) return json({ error: "Application not found." }, 404);
  if (app.status !== "pending_payment") return json({ error: "Payment has already been confirmed, so your courses can no longer be changed." }, 409);
  const { count } = await db.from("payments").select("id", { count: "exact", head: true }).eq("application_id", app.id);
  if ((count ?? 0) > 0) return json({ error: "A payment has already been received for this application. Please contact the training office." }, 409);
  if (app.payment_claimed_at && app.payment_review === "pending") return json({ error: "You have already told us you have paid. Please contact the training office before changing your courses." }, 409);
  await db.from("applications").update({ status: "expired" }).eq("id", app.id);
  await kickSheetSync();
  return json({ ok: true });
}));
