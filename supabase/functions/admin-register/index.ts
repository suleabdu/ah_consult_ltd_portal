/* =============================================================================
   SETUP GUIDE  -  supabase/functions/admin-register/index.ts
=============================================================================
WHAT IT IS
   Staff self-registration. Checks the staff access code, creates the account as pending, and pushes the row to the Google Sheet.

WHERE THIS FILE GOES
   supabase/functions/admin-register/index.ts
   The file MUST be named index.ts. Its folder name (admin-register) is the function name.
   Run every command below from the PROJECT ROOT (the folder that CONTAINS the "supabase" folder).
   Its helpers live in supabase/functions/_shared/ (lib.ts, crypto.ts, pay.ts). Keep that folder exactly there.

ONE-TIME PREPARATION (skip if already done)
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF      (the part of your project URL before .supabase.co)

DEPLOY
   supabase functions deploy admin-register
   (Normal deploy. Signed-in users reach it with their login token.)
   "Docker is not running"? Start Docker Desktop, or update the Supabase CLI and add  --use-api  to the command.

SECRETS NEEDED   (supabase secrets set NAME=value   or   Dashboard > Edge Functions > Secrets)
   Optional ADMIN_INVITE_CODE (the old single code). Codes created in Admin Dashboard > Team & Access need no secret.

DATABASE NEEDED
   Migrations 007, 008 and 010 (access codes).

HOW TO TEST
   Open admin-register.html and register with a valid code. The person appears in Team & Access as pending.

COMMON PROBLEMS
   "Staff registration is not enabled yet" = no active access code exists: create one in the dashboard.
   ============================================================================= */

// Staff self-registration. Needs a valid staff access code (created in Admin Dashboard > Team & Access > Access Codes).
// Every account starts as 'pending' until an Administrator approves it (dashboard or Google Sheet).
import { admin, json, safe } from "../_shared/lib.ts";
import { sha256Hex } from "../_shared/crypto.ts";
import { kickSheetSync } from "../_shared/sync.ts";
const ROLE: Record<string, string> = { "Administrator": "administrator", "Registrar / Admissions": "registrar", "Finance / Accounts": "finance", "Academic Coordinator": "academic", "Operations": "operations", "Tutor / Lecturer": "tutor", "Other": "viewer" };
Deno.serve(safe(async (req) => {
  const { fullName, email, phone, position, password, inviteCode } = await req.json();
  const role = ROLE[String(position ?? "")] ?? "viewer", db = admin(), typed = String(inviteCode ?? "").trim(), hash = await sha256Hex(typed);
  const legacy = Deno.env.get("ADMIN_INVITE_CODE");
  const { data: dbOk } = await db.rpc("redeem_access_code", { p_hash: hash, p_role: role, p_consume: false });
  const { count } = await db.from("access_codes").select("id", { count: "exact", head: true }).eq("active", true);
  if (!legacy && !(count ?? 0)) return json({ error: "Staff registration is not enabled yet. An administrator must create an access code first." }, 503);
  if (dbOk !== true && !(legacy && typed === legacy)) { await new Promise((r) => setTimeout(r, 1000)); return json({ error: "That staff access code is not valid for this position. Please ask an administrator for a current code." }, 403); }
  const name = String(fullName ?? "").trim(), mail = String(email ?? "").trim().toLowerCase();
  if (name.length < 3) return json({ error: "Enter your full name." }, 422);
  if (!/^\S+@\S+\.\S+$/.test(mail)) return json({ error: "Enter a valid email address." }, 422);
  if (String(password ?? "").length < 10) return json({ error: "Use a password of at least 10 characters." }, 422);
  const { data: created, error } = await db.auth.admin.createUser({ email: mail, password, email_confirm: true, user_metadata: { full_name: name, phone } });
  if (error) return json({ error: /already|registered/i.test(error.message) ? "This email is already registered. Use a different email or sign in." : "Could not create the account.", detail: error.message }, 400);
  const { error: e2 } = await db.from("staff").insert({ id: created.user.id, full_name: name, email: mail, phone: phone ?? null, position: position ?? null, role, status: "pending" });
  if (e2) { await db.auth.admin.deleteUser(created.user.id); console.error("staff insert failed", e2); return json({ error: "Could not save your registration. Please try again.", detail: e2.message }, 500); }
  if (dbOk === true) await db.rpc("redeem_access_code", { p_hash: hash, p_role: role, p_consume: true });   // count the use only after success
  await kickSheetSync();
  return json({ ok: true });
}));
