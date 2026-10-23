/* =============================================================================
   SETUP GUIDE  -  supabase/functions/create-application/index.ts
=============================================================================
WHAT IT IS
   Called when an applicant presses "Proceed to payment". Locks the price on the server, then creates the payment with the active payment method (bank account, Monnify account or Upperlink checkout link).

WHERE THIS FILE GOES
   supabase/functions/create-application/index.ts
   The file MUST be named index.ts. Its folder name (create-application) is the function name.
   Run every command below from the PROJECT ROOT (the folder that CONTAINS the "supabase" folder).
   Its helpers live in supabase/functions/_shared/ (lib.ts, crypto.ts, pay.ts). Keep that folder exactly there.

ONE-TIME PREPARATION (skip if already done)
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF      (the part of your project URL before .supabase.co)

DEPLOY
   supabase functions deploy create-application
   (Normal deploy. Signed-in users reach it with their login token.)
   "Docker is not running"? Start Docker Desktop, or update the Supabase CLI and add  --use-api  to the command.

SECRETS NEEDED   (supabase secrets set NAME=value   or   Dashboard > Edge Functions > Secrets)
   None required once a payment method exists in the dashboard (SETTINGS_ENCRYPTION_KEY is needed for encrypted keys). Before any method exists it falls back to the old PAY_MODE / MONNIFY_* / BANK_* secrets.

DATABASE NEEDED
   Migrations 001 to 010 (010 adds the payment method columns).

HOW TO TEST
   Sign in on apply.html, choose a course, press Proceed to payment. You should reach the payment page. Add ?debug=1 to the page address to see technical detail if it fails.

COMMON PROBLEMS
   "Payment could not be set up" = the active method is incomplete: open Payment Methods and press Test.  "Could not reach the server" = this function is not deployed, or old copies are running: redeploy all functions.
   ============================================================================= */

// "Proceed to payment": locks the price server-side (per-course or Full Package), creates the application and a payment account.
import { admin, json, safe, userFrom } from "../_shared/lib.ts";
import { createPayment, envProvider, loadProvider } from "../_shared/pay.ts";
import { kickSheetSync } from "../_shared/sync.ts";
Deno.serve(safe(async (req) => {
  const user = await userFrom(req); if (!user) return json({ error: "Please sign in again." }, 401);
  const body = await req.json();
  const { intakeId, courseCodes, packageCode, returnUrl, key, applicationId } = body;
  const idempotencyKey = String(key ?? req.headers.get("idempotency-key") ?? "").trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) return json({ error: "Invalid request key. Please reload the application and try again." }, 400);
  const db = admin();

  // Phase 3: the application is already a draft. Payment setup must never create a second application.
  let draft: any = null;
  if (applicationId) {
    const { data, error } = await db.from("applications").select("*").eq("id", applicationId).eq("user_id", user.id).maybeSingle();
    if (error || !data) return json({ error: "Application draft not found. Please restart the application." }, 404);
    draft = data;
    if (draft.status === "pending_payment" && draft.pay_reference) return json({ application: draft, idempotent: true });
    if (draft.status !== "draft" && draft.status !== "pending_payment") return json({ application: draft, idempotent: true });
  }

  const effectiveIntakeId = draft?.intake_id ?? intakeId;
  if (!effectiveIntakeId || !Array.isArray(courseCodes) || !courseCodes.length) return json({ error: "Choose an intake and at least one course." }, 400);
  if (draft && draft.intake_id !== effectiveIntakeId) return json({ error: "The intake cannot be changed after the application has started." }, 400);

  const { data: intake } = await db.from("intakes").select("*").eq("id", effectiveIntakeId).single();
  const now = Date.now();
  if (!intake?.is_active || (intake.opens_at && now < +new Date(intake.opens_at)) || (intake.closes_at && now > +new Date(intake.closes_at))) return json({ error: "This intake is closed." }, 400);
  const uniqueCodes = [...new Set(courseCodes.map((x: any) => String(x).trim()).filter(Boolean))];
  const { data: courses } = await db.from("courses").select("*").in("code", uniqueCodes).eq("is_active", true);
  if (!courses || courses.length !== uniqueCodes.length) return json({ error: "A selected course is unavailable." }, 400);

  let total = courses.reduce((s: number, c: any) => s + Number(c.fee_ngn || 0), 0), pkg: any = null;
  if (packageCode) {
    const { data: p } = await db.from("packages").select("*").eq("code", packageCode).eq("is_active", true).maybeSingle();
    if (!p) return json({ error: "This package is unavailable." }, 400);
    if (p.max_courses && uniqueCodes.length > p.max_courses) return json({ error: `The package allows up to ${p.max_courses} courses.` }, 400);
    if (new Set(courses.map((c: any) => c.category)).size !== courses.length) return json({ error: "With the Full Package you can choose only one course from each level." }, 400);
    pkg = p; total = p.fee_ngn;
  }

  const { data: byKey } = await db.from("applications").select("*").eq("idempotency_key", idempotencyKey).eq("user_id", user.id).maybeSingle();
  if (byKey && byKey.id !== applicationId) return json({ application: byKey, idempotent: true });

  const { data: priorAttempt } = await db.from("payment_attempts").select("*").eq("user_id", user.id).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (priorAttempt?.status === "provider_created" && priorAttempt.application_id) {
    const { data: priorApp } = await db.from("applications").select("*").eq("id", priorAttempt.application_id).maybeSingle();
    if (priorApp) return json({ application: priorApp, idempotent: true });
  }
  if (priorAttempt?.status === "reserved") return json({ error: "Your payment setup is already being prepared. Please wait a moment and try again." }, 409);
  if (priorAttempt?.status === "failed") await db.from("payment_attempts").update({ status: "reserved", last_error: null }).eq("id", priorAttempt.id);
  else if (!priorAttempt) {
    const { error: reserveError } = await db.from("payment_attempts").insert({ user_id: user.id, intake_id: effectiveIntakeId, idempotency_key: idempotencyKey, amount_ngn: total, course_codes: uniqueCodes, package_code: pkg?.code ?? null, status: "reserved" });
    if (reserveError) return json({ error: "Another payment setup is already in progress for this intake. Please wait and try again." }, 409);
  }

  const ref = draft?.pay_reference ?? ("AHCT-" + crypto.randomUUID().slice(0, 12).toUpperCase());
  const prov = (await loadProvider(db)) ?? envProvider();
  await db.from("payment_attempts").update({ provider: prov.kind }).eq("user_id", user.id).eq("idempotency_key", idempotencyKey);
  const { data: prof } = await db.from("profiles").select("full_name").eq("id", user.id).single();
  const origin = (req.headers.get("origin") ?? "").replace(/\/$/, "");
  const back = /^https?:\/\//.test(String(returnUrl ?? "")) ? String(returnUrl) : `${origin}/payment-success.html`;
  let out;
  try { out = await createPayment(prov, { ref, amount: total, name: prof?.full_name ?? user.email!, email: user.email!, appId: applicationId ?? idempotencyKey, returnUrl: back }); }
  catch (e) {
    await db.from("payment_attempts").update({ status: "failed", last_error: e instanceof Error ? e.message.slice(0,1000) : String(e).slice(0,1000) }).eq("user_id", user.id).eq("idempotency_key", idempotencyKey);
    return json({ error: "Payment could not be set up right now. Please try again shortly." }, 502);
  }

  let app: any = draft;
  if (draft) {
    const { data: updated, error } = await db.from("applications").update({ total_ngn: total, package_code: pkg?.code ?? null, idempotency_key: idempotencyKey, pay_reference: ref, pay_bank: out.bank, pay_account: out.account, pay_provider: prov.kind, pay_provider_id: prov.id, pay_mode: prov.mode, pay_url: out.url, pay_gateway_ref: out.gatewayRef, status: "pending_payment" }).eq("id", draft.id).select().single();
    if (error) return json({ error: "Could not prepare your payment. Please try again." }, 500); app = updated;
    await db.from("application_courses").delete().eq("application_id", app.id);
  } else {
    const { data: existing } = await db.from("applications").select("*").eq("user_id", user.id).eq("intake_id", effectiveIntakeId).not("status","in","(expired,rejected)").maybeSingle();
    if (existing) return json({ application: existing, idempotent: true });
    const { data: inserted, error } = await db.from("applications").insert({ user_id:user.id,intake_id:effectiveIntakeId,total_ngn:total,package_code:pkg?.code??null,idempotency_key:idempotencyKey,pay_reference:ref,pay_bank:out.bank,pay_account:out.account,pay_provider:prov.kind,pay_provider_id:prov.id,pay_mode:prov.mode,pay_url:out.url,pay_gateway_ref:out.gatewayRef }).select().single();
    if (error) return json({ error:"Could not start your application. Please try again." },500); app=inserted;
  }
  const { error: courseError } = await db.from("application_courses").insert(courses.map((c:any)=>({application_id:app.id,course_code:c.code,fee_ngn:pkg?0:c.fee_ngn})));
  if (courseError) return json({ error:"Could not save your selected courses. Please try again." },500);
  await db.from("payment_attempts").update({status:"completed",application_id:app.id,provider_reference:app.pay_reference,provider_transaction_id:app.pay_gateway_ref,completed_at:new Date().toISOString()}).eq("user_id",user.id).eq("idempotency_key",idempotencyKey);
  await kickSheetSync();
  return json({ application: app });
}));
