/* =============================================================================
   SETUP GUIDE  -  supabase/functions/_shared/pay.ts
=============================================================================
WHAT IT IS
   The payment adapters: Manual bank transfer, Monnify and Upperlink. It reads the ACTIVE payment method chosen in Admin Dashboard > Payment Methods, decrypts its keys on the server, creates the payment and verifies it.

THIS IS NOT A FUNCTION
   Do NOT run "supabase functions deploy" on it. It has no deploy step of its own.
   It is bundled automatically into every function that imports it.

WHERE THIS FILE GOES
   supabase/functions/_shared/pay.ts
   Exactly this folder: supabase/functions/_shared/   (the underscore is part of the name).
   lib.ts, crypto.ts and pay.ts must all sit side by side, because they import each other with ./ paths.

AFTER YOU COPY OR CHANGE IT
   Redeploy the functions that use it (each keeps the copy it had when it was deployed):
   PowerShell:  'create-application','cancel-application','submit-application','admin-register','admin-delete','admin-settings','verify-payment','payment-webhook','upperlink-webhook','sheet-sync','sheet-review' | ForEach-Object { supabase functions deploy $_ }
   Or run:      scripts/deploy-functions.ps1  (Windows)   or   bash scripts/deploy-functions.sh  (Mac/Linux)

IMPORTS: ./crypto.ts  (crypto.ts must be in the same folder).
SECRETS: needs SETTINGS_ENCRYPTION_KEY (see crypto.ts). Payment keys themselves are NOT Supabase secrets: you type them into the dashboard and they are stored encrypted.
DATABASE: migration 010_settings.sql (table payment_providers).
UPPERLINK: its web addresses are set per method in the dashboard (initialise URL, verify URL, merchant ID, how the key is sent) because Upperlink's public API documentation was not available when this was written.

HOW TO CHECK THE FOLDER IS RIGHT
   Run scripts/check-setup.ps1 (Windows) or bash scripts/check-setup.sh (Mac/Linux) from the project root. Every line must say OK.
   ============================================================================= */

// Payment method adapters: manual bank transfer, Monnify reserved accounts, Upperlink hosted checkout.
// The active method is chosen in Admin Dashboard > Payment Methods. Secrets are decrypted only here, inside the function.
import { decryptText } from "./crypto.ts";
export type Provider = { id: string | null; kind: "manual" | "monnify" | "upperlink"; label: string; mode: "test" | "live"; config: Record<string, any>; secrets: Record<string, string> };
export type Created = { bank: string; account: string; url: string | null; gatewayRef: string | null };
const s = (v: unknown) => String(v ?? "").trim();
const redact = (t: string, p: Provider) => Object.values(p.secrets).filter((x) => x && x.length > 5).reduce((a, x) => a.split(x).join("[hidden]"), t);

export async function loadProvider(db: any, id?: string | null, anyState = false): Promise<Provider | null> {
  let q = db.from("payment_providers").select("*"); if (!anyState) q = q.eq("enabled", true);
  q = id ? q.eq("id", id) : q.eq("is_default", true);
  const { data } = await q.maybeSingle(); if (!data) return null;
  const secrets: Record<string, string> = {};
  for (const [k, v] of Object.entries(data.secrets_enc ?? {})) { try { secrets[k] = await decryptText(String(v)); } catch { /* unreadable with the current key */ } }
  return { id: data.id, kind: data.kind, label: data.label, mode: data.mode, config: data.config ?? {}, secrets };
}
// Before any method is configured in the dashboard, the old environment-variable setup keeps working.
export function envProvider(): Provider {
  if ((Deno.env.get("PAY_MODE") ?? "monnify") === "manual") return { id: null, kind: "manual", label: "Manual (env)", mode: "live", config: { bank_name: Deno.env.get("BANK_NAME"), account_name: Deno.env.get("BANK_ACCOUNT_NAME"), account_number: Deno.env.get("BANK_ACCOUNT_NUMBER") }, secrets: {} };
  return { id: null, kind: "monnify", label: "Monnify (env)", mode: (Deno.env.get("MONNIFY_BASE_URL") ?? "").includes("sandbox") || !Deno.env.get("MONNIFY_BASE_URL") ? "test" : "live",
    config: { contract_code: Deno.env.get("MONNIFY_CONTRACT_CODE"), base_url: Deno.env.get("MONNIFY_BASE_URL") }, secrets: { api_key: Deno.env.get("MONNIFY_API_KEY") ?? "", secret_key: Deno.env.get("MONNIFY_SECRET_KEY") ?? "" } };
}
const monnifyBase = (p: Provider) => s(p.config.base_url) || (p.mode === "live" ? "https://api.monnify.com" : "https://sandbox.monnify.com");
async function monnifyToken(p: Provider) {
  const r = await fetch(`${monnifyBase(p)}/api/v1/auth/login`, { method: "POST", signal: AbortSignal.timeout(15000), headers: { Authorization: "Basic " + btoa(`${p.secrets.api_key}:${p.secrets.secret_key}`) } });
  const j = await r.json();
  if (!j.requestSuccessful || !j.responseBody?.accessToken) throw new Error("Monnify login failed: " + (j.responseMessage ?? r.status) + " (check the API key, secret key and test/live mode)");
  return j.responseBody.accessToken as string;
}
function upperlinkHeaders(p: Provider) {
  const sk = p.secrets.secret_key; if (!sk) throw new Error("No Upperlink secret key is saved for this method.");
  const style = s(p.config.auth_style) || "bearer", h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (style === "bearer") h.Authorization = "Bearer " + sk; else if (style === "x-api-key") h["x-api-key"] = sk; else if (style === "basic") h.Authorization = "Basic " + btoa(sk + ":");
  else h[s(p.config.auth_header) || "Authorization"] = sk;
  return h;
}
const pick = (j: any, ...paths: string[]) => { for (const path of paths) { const v = path.split(".").reduce((o: any, k) => o?.[k], j); if (v !== undefined && v !== null && v !== "") return v; } return null; };

export async function createPayment(p: Provider, c: { ref: string; amount: number; name: string; email: string; appId: string; returnUrl: string }): Promise<Created> {
  if (p.kind === "manual") {
    if (!s(p.config.account_number)) throw new Error("This manual payment method has no account number. Edit it in Admin Dashboard > Payment Methods.");
    return { bank: `${s(p.config.bank_name)} - ${s(p.config.account_name)}`, account: s(p.config.account_number), url: null, gatewayRef: null };
  }
  if (p.kind === "monnify") {
    const r = await fetch(`${monnifyBase(p)}/api/v2/bank-transfer/reserved-accounts`, { method: "POST", signal: AbortSignal.timeout(20000), headers: { Authorization: "Bearer " + await monnifyToken(p), "Content-Type": "application/json" },
      body: JSON.stringify({ accountReference: c.ref, accountName: "AH Consult - " + c.name, currencyCode: "NGN", contractCode: s(p.config.contract_code), customerEmail: c.email, customerName: c.name, getAllAvailableBanks: false, preferredBanks: ["035"] }) });
    const j = await r.json(), acct = j.responseBody?.accounts?.[0];
    if (!acct) throw new Error("Monnify could not create the payment account: " + (j.responseMessage ?? r.status));
    return { bank: acct.bankName, account: acct.accountNumber, url: null, gatewayRef: null };
  }
  // upperlink: hosted checkout. The exact endpoint addresses come from the Upperlink developer documentation and are set per method.
  const init = s(p.config.init_url); if (!/^https:\/\//.test(init)) throw new Error("The Upperlink 'initialise payment URL' is not set. Add it in Payment Methods (copy it from the Upperlink documentation).");
  const r = await fetch(init, { method: "POST", signal: AbortSignal.timeout(20000), headers: upperlinkHeaders(p),
    body: JSON.stringify({ amount: c.amount, merchantId: s(p.config.merchant_id), meta: JSON.stringify({ reference: c.ref, application_id: c.appId }), redirectUrl: s(p.config.redirect_url) || `${c.returnUrl}?reference=${encodeURIComponent(c.ref)}` }) });
  const txt = await r.text(); let j: any = {}; try { j = JSON.parse(txt); } catch { /* not json */ }
  const url = pick(j, "data.checkOutUrl", "data.checkoutUrl", "data.authorization_url", "data.url", "data.link", "checkOutUrl", "checkoutUrl", "url");
  if (!r.ok || !url) throw new Error(`Upperlink did not return a payment link (HTTP ${r.status}): ${redact(txt, p).slice(0, 300)}`);
  return { bank: "Online payment (Upperlink)", account: "", url: String(url), gatewayRef: pick(j, "data.reference", "data.transactionReference", "data.transactionRef", "reference") };
}

export async function verifyPayment(p: Provider, app: { pay_reference: string; pay_gateway_ref?: string | null; total_ngn: number }): Promise<{ paid: boolean; amount: number | null; note: string }> {
  if (p.kind !== "upperlink") return { paid: false, amount: null, note: "This method is confirmed by bank transfer or webhook." };
  const tpl = s(p.config.verify_url); if (!/^https:\/\//.test(tpl)) throw new Error("The Upperlink 'verify payment URL' is not set.");
  const ref = app.pay_gateway_ref || app.pay_reference, url = tpl.replace("{reference}", encodeURIComponent(ref)).replace("{merchantId}", encodeURIComponent(s(p.config.merchant_id)));
  const post = s(p.config.verify_method).toUpperCase() === "POST";
  const r = await fetch(url, { method: post ? "POST" : "GET", signal: AbortSignal.timeout(20000), headers: upperlinkHeaders(p), body: post ? JSON.stringify({ reference: ref, merchantId: s(p.config.merchant_id) }) : undefined });
  const txt = await r.text(); let j: any = {}; try { j = JSON.parse(txt); } catch { /* not json */ }
  if (!r.ok) return { paid: false, amount: null, note: `Upperlink answered HTTP ${r.status}` };
  const status = s(pick(j, "data.status", "data.paymentStatus", "data.transactionStatus", "data.responseMessage", "status", "message")).toLowerCase();
  const amount = Number(pick(j, "data.amount", "data.amountPaid", "data.paidAmount", "amount")); const amt = Number.isFinite(amount) ? amount : null;
  const paid = /(success|paid|complete|approved|settled)/.test(status) && !/(fail|declin|pending|abandon|cancel|reverse|not)/.test(status) && (amt === null || amt + 1 >= app.total_ngn);
  return { paid, amount: amt, note: redact(status, p).slice(0, 80) };
}

export async function markPaid(db: any, app: any, paidNgn: number, ref: string | null, raw: unknown) {
  const providerRef = ref || "GW-" + app.pay_reference;
  const r = await db.rpc("record_verified_payment", {
    p_application: app.id,
    p_provider: app.pay_provider || "upperlink",
    p_provider_transaction_id: providerRef,
    p_paid_ngn: Math.round(paidNgn),
    p_raw_event: raw ?? {},
    p_source: "provider_verification"
  });
  if (r.error) throw new Error(`Could not settle payment: ${r.error.message}`);
  return r.data;
}

// "Test connection" in the dashboard. Never returns secrets.
export async function testProvider(p: Provider): Promise<{ ok: boolean; message: string; detail?: string }> {
  if (p.kind === "manual") return s(p.config.account_number) ? { ok: true, message: "Bank details are saved. Applicants will see " + s(p.config.account_number) + "." } : { ok: false, message: "No account number saved yet." };
  if (p.kind === "monnify") { try { await monnifyToken(p); return { ok: true, message: `Monnify accepted these ${p.mode} keys.` }; } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; } }
  try {
    const init = s(p.config.init_url); if (!/^https:\/\//.test(init)) return { ok: false, message: "Add the Upperlink 'initialise payment URL' first." };
    const r = await fetch(init, { method: "POST", signal: AbortSignal.timeout(20000), headers: upperlinkHeaders(p), body: JSON.stringify({ amount: 100, merchantId: s(p.config.merchant_id), meta: JSON.stringify({ reference: "TEST-" + Date.now() }), redirectUrl: s(p.config.redirect_url) || "https://example.com/" }) });
    const txt = await r.text(); let j: any = {}; try { j = JSON.parse(txt); } catch { /* not json */ }
    const url = pick(j, "data.checkOutUrl", "data.checkoutUrl", "data.authorization_url", "data.url", "data.link", "checkOutUrl", "checkoutUrl", "url");
    return { ok: r.ok && !!url, message: r.ok && url ? "Upperlink returned a checkout link. The connection works." : `Upperlink answered HTTP ${r.status} but no checkout link was found. Check the URL, merchant ID and key.`, detail: redact(txt, p).slice(0, 700) };
  } catch (e) { return { ok: false, message: "Could not reach Upperlink: " + (e instanceof Error ? e.message : String(e)) }; }
}
