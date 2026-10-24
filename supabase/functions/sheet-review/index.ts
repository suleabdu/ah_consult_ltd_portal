import { admin, json, safe } from "../_shared/lib.ts";
import { hmacSha256Hex } from "../_shared/crypto.ts";
import { kickSheetSync } from "../_shared/sync.ts";
const MAX_CLOCK_SKEW_SECONDS = 300;
Deno.serve(safe(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const secret = Deno.env.get("SHEET_WEBHOOK_SECRET") ?? "";
  const timestamp = req.headers.get("x-sheet-timestamp") ?? "";
  const requestId = req.headers.get("x-sheet-request-id") ?? "";
  const signature = req.headers.get("x-sheet-signature") ?? "";
  if (!secret || !timestamp || !requestId || !signature) return json({ error: "Unauthorized." }, 401);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > MAX_CLOCK_SKEW_SECONDS) return json({ error: "Request expired." }, 401);
  if (!/^[A-Za-z0-9_-]{12,120}$/.test(requestId)) return json({ error: "Invalid request id." }, 400);
  const raw = await req.text();
  const expected = await hmacSha256Hex(secret, `${timestamp}.${requestId}.${raw}`);
  if (signature.length !== expected.length || !timingSafeEqual(signature.toLowerCase(), expected)) return json({ error: "Unauthorized." }, 401);
  const db = admin();
  const { error: replay } = await db.from("sheet_webhook_events").insert({ request_id: requestId, payload_sha256: await hmacSha256Hex("payload", raw) });
  if (replay) { if (replay.code === "23505") return json({ error: "Duplicate request." }, 409); throw replay; }
  let body: any; try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON." }, 400); }
  const { applicationId, staffId, kind, decision, by } = body ?? {};
  if (applicationId === "TEST") return json({ message: "Connection and signature are OK." });
  if (!['pending', 'approved', 'rejected'].includes(decision)) return json({ error: "Use Pending, Approved or Rejected." }, 400);
  if (kind === "admin") {
    const { data: st } = await db.from("staff").select("id,full_name").eq("id", staffId).maybeSingle();
    if (!st) return json({ error: "Staff record not found." }, 404);
    const { error } = await db.from("staff").update({ status: decision }).eq("id", staffId); if (error) throw error;
    await db.from("audit_log").insert({ actor_name: by ?? "sheet", action: "staff_" + decision, target: st.full_name });
    await kickSheetSync();
    return json({ message: `${st.full_name} is now ${decision}.` + (decision === "approved" ? " They can sign in to the dashboard." : "") });
  }
  const { data: app } = await db.from("applications").select("*").eq("id", applicationId).maybeSingle();
  if (!app) return json({ error: "Application not found." }, 404);
  if (app.status !== "pending_payment") return json({ error: `This application is already '${app.status}'. Payment review is closed.` }, 409);
  if (decision === "approved") {
    const { error: paymentError } = await db.from("payments").upsert({ application_id: app.id, reference: "MANUAL-" + app.pay_reference, expected_ngn: app.total_ngn, paid_ngn: app.total_ngn, raw_event: { source: "sheet", by } }, { onConflict: "reference" }); if (paymentError) throw paymentError;
    const { error } = await db.from("applications").update({ status: "paid", paid_at: new Date().toISOString(), payment_review: "approved" }).eq("id", app.id); if (error) throw error;
    await kickSheetSync(); return json({ message: "Approved. The applicant's form is now unlocked." });
  }
  const { error } = await db.from("applications").update({ payment_review: decision }).eq("id", app.id); if (error) throw error;
  await kickSheetSync(); return json({ message: decision === "rejected" ? "Rejected. The applicant will be asked to check and resubmit." : "Set back to pending." });
}));
function timingSafeEqual(a: string, b: string) { if (a.length !== b.length) return false; let out = 0; for (let i=0;i<a.length;i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i); return out === 0; }
