/* =============================================================================
   SETUP GUIDE  -  supabase/functions/admin-delete/index.ts
=============================================================================
WHAT IT IS
   Permanently deletes an application or a staff member (Administrator only): the record, passport file, sheet row, with an audit entry.

WHERE THIS FILE GOES
   supabase/functions/admin-delete/index.ts
   The file MUST be named index.ts. Its folder name (admin-delete) is the function name.
   Run every command below from the PROJECT ROOT (the folder that CONTAINS the "supabase" folder).
   Its helpers live in supabase/functions/_shared/ (lib.ts, crypto.ts, pay.ts). Keep that folder exactly there.

ONE-TIME PREPARATION (skip if already done)
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF      (the part of your project URL before .supabase.co)

DEPLOY
   supabase functions deploy admin-delete
   (Normal deploy. Signed-in users reach it with their login token.)
   "Docker is not running"? Start Docker Desktop, or update the Supabase CLI and add  --use-api  to the command.

SECRETS NEEDED   (supabase secrets set NAME=value   or   Dashboard > Edge Functions > Secrets)
   None.

DATABASE NEEDED
   Migrations 007 and 008.

HOW TO TEST
   Dashboard > Data & Deletion > Delete... on a test record.

COMMON PROBLEMS
   "Only administrators can permanently delete records" = the signed-in person is not an approved Administrator.
   ============================================================================= */

// Permanent deletion (Administrator only). Removes the record AND its files, writes an audit entry, and removes the Google Sheet row.
import { admin, json, safe, userFrom } from "../_shared/lib.ts";
import { kickSheetSync } from "../_shared/sync.ts";
Deno.serve(safe(async (req) => {
  const user = await userFrom(req); if (!user) return json({ error: "Please sign in again." }, 401);
  const db = admin();
  const { data: me } = await db.from("staff").select("id,full_name,role,status").eq("id", user.id).maybeSingle();
  if (!me || me.status !== "approved" || me.role !== "administrator") return json({ error: "Only administrators can permanently delete records." }, 403);
  const { kind, id, confirm, reason, deleteAccount } = await req.json();
  const why = String(reason ?? "").trim();
  if (why.length < 5) return json({ error: "Please give a reason (at least 5 characters). It is saved in the audit log." }, 422);
  const kick = () => {
    const p = kickSheetSync();
    // @ts-ignore EdgeRuntime exists on Supabase Edge Functions
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(p);
    else void p;
  };

  if (kind === "application") {
    const { data: a } = await db.from("applications").select("*, profiles(full_name)").eq("id", id).maybeSingle();
    if (!a) return json({ error: "Application not found (it may already be deleted)." }, 404);
    const code = a.student_id || a.pay_reference;
    if (String(confirm ?? "").trim() !== code) return json({ error: `Confirmation does not match. Type exactly: ${code}` }, 422);
    await db.from("audit_log").insert({ actor: me.id, actor_name: me.full_name, action: "application_deleted", target: code, note: `${why} | ${a.profiles?.full_name ?? ""}` });
    if (a.passport_path) await db.storage.from("passports").remove([a.passport_path]);
    await db.from("payments").delete().eq("application_id", id);
    await db.from("sheet_outbox").delete().eq("application_id", id).eq("done", false);
    await db.from("sheet_outbox").insert({ application_id: id, kind: "delete_app" });
    const { error } = await db.from("applications").delete().eq("id", id);
    if (error) return json({ error: "The database refused the deletion." }, 500);
    let accountDeleted = false;
    if (deleteAccount) {
      const { count } = await db.from("applications").select("id", { count: "exact", head: true }).eq("user_id", a.user_id);
      const { data: st } = await db.from("staff").select("id").eq("id", a.user_id).maybeSingle();
      if ((count ?? 0) === 0 && !st) { await db.auth.admin.deleteUser(a.user_id); accountDeleted = true; }
    }
    kick(); return json({ ok: true, accountDeleted });
  }

  if (kind === "staff") {
    const { data: s } = await db.from("staff").select("*").eq("id", id).maybeSingle();
    if (!s) return json({ error: "Staff member not found (they may already be deleted)." }, 404);
    if (s.id === me.id) return json({ error: "You cannot delete your own account." }, 422);
    if (String(confirm ?? "").trim().toLowerCase() !== String(s.email).toLowerCase()) return json({ error: `Confirmation does not match. Type exactly: ${s.email}` }, 422);
    if (s.role === "administrator" && s.status === "approved") {
      const { count } = await db.from("staff").select("id", { count: "exact", head: true }).eq("role", "administrator").eq("status", "approved").neq("id", id);
      if ((count ?? 0) === 0) return json({ error: "You cannot delete the last approved administrator." }, 422);
    }
    await db.from("audit_log").insert({ actor: me.id, actor_name: me.full_name, action: "staff_deleted", target: s.full_name, note: `${why} | ${s.email} | ${s.role}` });
    await db.from("sheet_outbox").delete().eq("application_id", id).eq("kind", "staff").eq("done", false);
    await db.from("sheet_outbox").insert({ application_id: id, kind: "delete_staff" });
    const { error } = await db.auth.admin.deleteUser(id);   // staff row is removed by cascade
    if (error) return json({ error: "Could not delete the account." }, 500);
    kick(); return json({ ok: true });
  }
  return json({ error: "Unknown request." }, 400);
}));
