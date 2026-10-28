// Permanent deletion (Administrator only). Removes the record AND its files, writes an audit entry, and removes the Google Sheet row.
import { admin, json, safe, userFrom } from "../_shared/lib.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { kickSheetSync } from "../_shared/sync.ts";
Deno.serve(safe(async (req) => {
  const user = await userFrom(req); if (!user) return json({ error: "Please sign in again." }, 401);
  const db = admin();
  const { data: me } = await db.from("staff").select("id,full_name,role,status").eq("id", user.id).maybeSingle();
  if (!me || me.status !== "approved" || me.role !== "administrator") return json({ error: "Only administrators can permanently delete records." }, 403);
  const { kind, id, confirm, reason, deleteAccount } = await req.json();
  const why = String(reason ?? "").trim();
  if (why.length < (kind === "application" ? 10 : 5)) return json({ error: "Please provide a detailed reason; application deletion requires at least 10 characters." }, 422);
  const kick = () => {
    const p = kickSheetSync();
    // @ts-ignore EdgeRuntime exists on Supabase Edge Functions
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(p);
    else void p;
  };

  if (kind === "application") {
    // The database RPC implements transaction-scoped verification, dependent row deletion,
    // Sheet tombstone queueing and audit. This function only cleans up the passport after commit.
    // Admitted or formally issued academic records are protected. Non-admitted records can be removed with retained financial evidence.
    const scoped = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: result, error } = await scoped.rpc("admin_delete_nonadmitted", {
      p_application: id, p_confirm: String(confirm ?? ""), p_reason: why,
    });
    if (error) {
      console.warn("Non-admitted deletion rejected", error.code, error.message);
      if (error.code === "23514") return json({ error: error.message?.includes("PORTAL_TRANSITION_RETAINED")
        ? "This person permanently entered the student portal. Keep the institutional enrolment record and use a formal revocation/retention workflow."
        : "This application is currently admitted. Change the admission decision through an authorized review before attempting deletion." }, 409);
      if (error.code === "23503") return json({ error: "A retained dependent record still references this application. Deletion was rolled back; review the constraint name in Edge Function logs." }, 409);
      if (["22023", "42501"].includes(error.code))
        return json({ error: error.message }, 422);
      if (error.code === "PGRST202")
        return json({ error: "Database update 031 is missing. Apply the migration before deleting non-admitted applications." }, 503);
      return json({ error: "The database could not safely remove this application. No changes were committed. Review the database logs before retrying." }, 409);
    }
    let passportCleanupPending = false;
    if (result?.passport_path) {
      const { error: fileError } = await db.storage.from("passports").remove([result.passport_path]);
      if (fileError) { passportCleanupPending = true; console.error("Post-delete passport cleanup is pending", fileError.message); }
    }
    // Never automatically delete the authentication account: it may own other records.
    // Dispatch the queued Sheet tombstone after database commit, without blocking the browser.
    kick();
    return json({ ok: true, reference: result?.reference, passportCleanupPending,
      message: passportCleanupPending ? "The application was deleted. Its passport file still needs administrator cleanup." : "The non-admitted application was deleted." });
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
