import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { admin, json, safe, userFrom } from "../_shared/lib.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The approval RPC checks the caller's live staff role. Only after approval do
// we use the service account to remove private objects via the Storage API.
// The application remains available and the approved request retryable if the
// API fails; no auth account is deleted.
Deno.serve(safe(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const actor = await userFrom(req);
  if (!actor) return json({ error: "Sign in as a super administrator." }, 401);
  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const requestId = typeof body === "object" && body !== null && "request_id" in body ? String(body.request_id) : "";
  if (!UUID.test(requestId)) return json({ error: "Select a valid deletion request." }, 400);
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const approval = await client.rpc("recruitment_approve_deletion", { p_request: requestId });
  if (approval.error) {
    const message = String(approval.error.message || "");
    if (message.includes("documents shared with another application")) return json({ error: "This application has documents shared with another application. Contact an administrator before proceeding." }, 409);
    if (message.includes("Super administrator access required")) return json({ error: "Only a super administrator can approve deletion." }, 403);
    return json({ error: "The deletion request could not be approved. Please refresh and try again." }, 400);
  }
  if (approval.data?.status === "completed") return json({ ok: true, status: "completed" });
  const paths = approval.data?.paths;
  if (approval.data?.status !== "approved" || !Array.isArray(paths) || paths.some((path: unknown) => typeof path !== "string" || !path)) {
    return json({ error: "The approved deletion needs administrator review before it can continue." }, 503);
  }
  const db = admin();
  if (paths.length) {
    const removal = await db.storage.from("recruitment-applications").remove(paths);
    if (removal.error) {
      console.error(JSON.stringify({ event: "recruitment_deletion_storage_failed", request_id: requestId }));
      return json({ error: "The deletion was approved, but document removal is incomplete. A super administrator can retry this request." }, 503);
    }
  }
  const finished = await db.rpc("recruitment_finalize_deletion", { p_request: requestId });
  if (finished.error) {
    console.error(JSON.stringify({ event: "recruitment_deletion_finalize_failed", request_id: requestId }));
    return json({ error: "The deletion was approved, but completion could not be confirmed. A super administrator can retry this request." }, 503);
  }
  return json({ ok: true, status: "completed" });
}));
