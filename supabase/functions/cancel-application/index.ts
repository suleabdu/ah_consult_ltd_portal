// Lets an applicant change their courses before paying: cancels the unpaid application (and its payment reference).
import { admin, json, safe, userFrom } from "../_shared/lib.ts";
import { kickSheetSync } from "../_shared/sync.ts";
import { z } from "npm:zod@3.23.8";
const CancelInput = z.object({ applicationId: z.string().uuid() }).strict();
Deno.serve(safe(async (req) => {
  const user = await userFrom(req); if (!user) return json({ error: "Please sign in again." }, 401);
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const reportedLength = Number(req.headers.get("Content-Length") || 0);
  if (reportedLength > 4096) return json({ error: "Request is too large." }, 413);
  const raw = await req.text();
  if (raw.length > 4096) return json({ error: "Request is too large." }, 413);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return json({ error: "Enter a valid application reference." }, 400); }
  const result = CancelInput.safeParse(parsed);
  if (!result.success) return json({ error: "Enter a valid application reference." }, 400);
  const { applicationId } = result.data;
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
