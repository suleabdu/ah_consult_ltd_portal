/* =============================================================================
   SETUP GUIDE  -  supabase/functions/sheet-review/index.ts
=============================================================================
WHAT IT IS
   Called by the Google Sheet (Apps Script) when someone changes the Approved / Rejected / Pending dropdown, for payments and for staff approvals.

WHERE THIS FILE GOES
   supabase/functions/sheet-review/index.ts
   The file MUST be named index.ts. Its folder name (sheet-review) is the function name.
   Run every command below from the PROJECT ROOT (the folder that CONTAINS the "supabase" folder).
   Its helpers live in supabase/functions/_shared/ (lib.ts, crypto.ts, pay.ts). Keep that folder exactly there.

ONE-TIME PREPARATION (skip if already done)
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF      (the part of your project URL before .supabase.co)

DEPLOY
   supabase functions deploy sheet-review --no-verify-jwt
   (--no-verify-jwt lets outside services call it. You can instead set verify_jwt = false for it in supabase/config.toml.)
   "Docker is not running"? Start Docker Desktop, or update the Supabase CLI and add  --use-api  to the command.

SECRETS NEEDED   (supabase secrets set NAME=value   or   Dashboard > Edge Functions > Secrets)
   SHEET_WEBHOOK_SECRET (the same value stored as SHEET_WEBHOOK_SECRET in Apps Script Script Properties).

DATABASE NEEDED
   Migrations 003 to 008.

HOW TO TEST
   In Apps Script run ahctDiagnose: the server line must say OK.

COMMON PROBLEMS
   401 Unauthorized = the Apps Script SHEET_WEBHOOK_SECRET property does not match Supabase Secrets.
   ============================================================================= */

// Called by the Google Sheet (Apps Script) when staff change the "Payment Review" dropdown.
import { admin, json, safe } from "../_shared/lib.ts";
import { kickSheetSync } from "../_shared/sync.ts";
Deno.serve(safe(async (req) => {
  if (req.headers.get("x-sheet-secret") !== Deno.env.get("SHEET_WEBHOOK_SECRET")) return json({ error: "Unauthorized" }, 401);
  const { applicationId, staffId, kind, decision, by } = await req.json();
  console.log("sheet-review called:", applicationId, decision, by);
  if (applicationId === "TEST") return json({ message: "Connection and secret are OK." });
  if (!["pending", "approved", "rejected"].includes(decision)) return json({ error: "Use Pending, Approved or Rejected." }, 400);
  const db = admin();
  if (kind === "admin") { // staff approval from the "Admin Registrations" tab
    if (!["pending", "approved", "rejected"].includes(decision)) return json({ error: "Use Pending, Approved or Rejected." }, 400);
    const { data: st } = await db.from("staff").select("id,full_name").eq("id", staffId).maybeSingle();
    if (!st) return json({ error: "Staff record not found." }, 404);
    await db.from("staff").update({ status: decision }).eq("id", staffId);
    await db.from("audit_log").insert({ actor_name: by ?? "sheet", action: "staff_" + decision, target: st.full_name });
    await kickSheetSync();
    return json({ message: `${st.full_name} is now ${decision}.` + (decision === "approved" ? " They can sign in to the dashboard." : "") });
  }
  const { data: app } = await db.from("applications").select("*").eq("id", applicationId).maybeSingle();
  if (!app) return json({ error: "Application not found." }, 404);
  if (app.status !== "pending_payment") return json({ error: `This application is already '${app.status}'. Payment review is closed.` }, 409);
  if (decision === "approved") {
    await db.from("payments").upsert({ application_id: app.id, reference: "MANUAL-" + app.pay_reference, expected_ngn: app.total_ngn, paid_ngn: app.total_ngn, raw_event: { source: "sheet", by } }, { onConflict: "reference" });
    await db.from("applications").update({ status: "paid", paid_at: new Date().toISOString(), payment_review: "approved" }).eq("id", app.id);
    await kickSheetSync();
    return json({ message: "Approved. The applicant's form is now unlocked." });
  }
  await db.from("applications").update({ payment_review: decision }).eq("id", app.id);
  await kickSheetSync();
  return json({ message: decision === "rejected" ? "Rejected. The applicant will be asked to check and resubmit." : "Set back to pending." });
}));
