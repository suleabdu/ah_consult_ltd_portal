// Upperlink calls this when a payment finishes. The notification is only a trigger: the payment is confirmed by asking
// Upperlink's verify endpoint directly, so a forged request cannot mark anything paid. Deploy with --no-verify-jwt.
import { admin, clientIp, withinRateLimit } from "../_shared/lib.ts";
import { loadProvider, markPaid, verifyPayment } from "../_shared/pay.ts";
import { kickSheetSync } from "../_shared/sync.ts";
const find = (o: any, out: string[] = []): string[] => { if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (typeof v === "string" && /ref|merchant|meta/i.test(k)) { out.push(v); try { find(JSON.parse(v), out); } catch { /* plain text */ } } else find(v, out); } return out; };
Deno.serve(async (req) => {
  try {
    const q = Object.fromEntries(new URL(req.url).searchParams); let body: any = {}; try { body = await req.json(); } catch { /* GET or form */ }
    if (!(await withinRateLimit(admin(), "ulhook:" + clientIp(req), 60, 60))) return new Response("slow down", { status: 429 });
    const cands = [...new Set([...find(body), ...find(q), ...Object.values(q).filter((v) => typeof v === "string")] as string[])].filter((x) => x && x.length < 80);
    if (!cands.length) return new Response("ignored");
    const db = admin();
    for (const c of cands) {
      const { data: app } = await db.from("applications").select("*").or(`pay_reference.eq.${c.replace(/[^\w.-]/g, "")},pay_gateway_ref.eq.${c.replace(/[^\w.-]/g, "")}`).maybeSingle();
      if (!app || app.status !== "pending_payment") continue;
      const prov = await loadProvider(db, app.pay_provider_id, true); if (!prov) continue;
      const v = await verifyPayment(prov, app);
      if (v.paid) { await markPaid(db, app, v.amount ?? app.total_ngn, app.pay_gateway_ref ? "UL-" + app.pay_gateway_ref : null, { source: "upperlink-webhook", note: v.note, provider_evidence: v.evidence || {} }); await kickSheetSync(); return new Response("ok"); }
    }
  } catch (e) { console.error("UPPERLINK WEBHOOK:", e); }
  return new Response("ok");   // always 200 so the provider does not retry forever
});
