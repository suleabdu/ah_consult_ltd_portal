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
  const result = await kickSheetSync();
  if (!result.ok) return json({ ok: false, error: "The sync worker could not complete the request. Check the sync status and Edge Function logs.", detail: result.error ?? result.data?.error ?? "Unknown sync error." }, 502);
  return json({ ok: true, message: `Sync worker completed: ${Number(result.data?.synced ?? 0)} row(s) synced, ${Number(result.data?.failed ?? 0)} failed.`, result: result.data });
}));
