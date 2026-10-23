/* =============================================================================
   SETUP GUIDE  -  supabase/functions/sheet-sync/index.ts
=============================================================================
WHAT IT IS
   Copies applications and staff registrations to the Google Sheet and removes deleted rows. Includes a protected diagnostic mode.

WHERE THIS FILE GOES
   supabase/functions/sheet-sync/index.ts
   The file MUST be named index.ts. Its folder name (sheet-sync) is the function name.
   Run every command below from the PROJECT ROOT (the folder that CONTAINS the "supabase" folder).
   Its helpers live in supabase/functions/_shared/ (lib.ts, crypto.ts, pay.ts). Keep that folder exactly there.

ONE-TIME PREPARATION (skip if already done)
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF      (the part of your project URL before .supabase.co)

DEPLOY
   supabase functions deploy sheet-sync
   (JWT verification is enabled. Only an approved administrator or trusted server-side call may run it.)
   "Docker is not running"? Start Docker Desktop, or update the Supabase CLI and add  --use-api  to the command.

SECRETS NEEDED   (supabase secrets set NAME=value   or   Dashboard > Edge Functions > Secrets)
   SHEET_ID (the long code in the sheet address); GOOGLE_SERVICE_ACCOUNT_B64 (base64 of the new service-account key). Optional SHEET_TAB and ADMIN_TAB.

DATABASE NEEDED
   Migrations 003, 005, 007 and 008.

HOW TO TEST
   Use the signed-in Admin Dashboard sync control for a protected run. Do not put secrets in query strings or browser URLs.

COMMON PROBLEMS
   The checklist says what to fix (share the sheet with the service account email, enable the Sheets API, wrong SHEET_ID, damaged key).
   ============================================================================= */

// Outbox -> Google Sheets (one-way mirror).
// Normal run:  POST /functions/v1/sheet-sync (JWT + handler authorization required)
// Self-test:   GET       /functions/v1/sheet-sync?check=1   (authorized administrator/service role only)
import { admin, cors, json, userFrom } from "../_shared/lib.ts";
const T = (ms = 15000) => AbortSignal.timeout(ms);
const APP_HEAD = ["ApplicationID","StudentID","Name","Phone","Intake","Courses","Total","Status","Created","Paid","Submitted","PaymentClaimed","Payment Review","Occupation","EducationLevel","LaptopAvailable","LaptopBattery","Skills"];
const ADM_HEAD = ["StaffID","Name","Email","Phone","Position","Registered","Approval","Role"];
const colName = (n: number) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const b64u = (s: ArrayBuffer | string) => btoa(typeof s === "string" ? s : String.fromCharCode(...new Uint8Array(s))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const API = "https://sheets.googleapis.com/v4/spreadsheets";
// Accepts GOOGLE_SERVICE_ACCOUNT_B64 (base64 of the key file: cannot be mangled) or GOOGLE_SERVICE_ACCOUNT_JSON (also repairs common paste damage).
const hasSA = () => !!(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_B64") || Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON"));
function validateSA(v: any) { // must be a Google SERVICE ACCOUNT key file; say precisely what was found otherwise
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { /* handled below */ } }
  if (v && typeof v === "object" && v.client_email && v.private_key) return v;
  const keys = v && typeof v === "object" ? Object.keys(v).slice(0, 8).join(", ") : typeof v;
  const hint = v && (v.web || v.installed) ? "This is an OAuth CLIENT file (client_secret_...json), not a service account key."
    : "A service account key file starts with {\"type\": \"service_account\" and contains client_email and private_key.";
  throw new Error(`The Google key secret decoded, but it is not a service account key (found: ${keys}). ${hint} In Google Cloud Console go to IAM & Admin > Service Accounts > your account > Keys > Add key > Create new key > JSON, then use THAT file.`);
}
function parseSA() {
  const b64 = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_B64");
  if (b64) { let txt: string; try { txt = new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0))); } catch { throw new Error("GOOGLE_SERVICE_ACCOUNT_B64 is not valid base64. Re-create it from the original .json file."); }
    let v: any; try { v = JSON.parse(txt); } catch { throw new Error(`GOOGLE_SERVICE_ACCOUNT_B64 decoded to text that is not JSON (starts with ${JSON.stringify(txt.slice(0, 12))}). Base64-encode the original .json file itself.`); }
    return validateSA(v); }
  let raw = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") ?? "").trim();
  if (raw.length > 1 && raw.startsWith("'") && raw.endsWith("'")) raw = raw.slice(1, -1);
  try { return validateSA(JSON.parse(raw)); } catch (e) { if (e instanceof Error && e.message.startsWith("The Google key")) throw e; }
  const email = raw.match(/"client_email"\s*:\s*"([^"]+)"/)?.[1], key = raw.match(/"private_key"\s*:\s*"([\s\S]*?-----END PRIVATE KEY-----)/)?.[1];
  if (email && key) return { client_email: email, private_key: key }; // token() strips \n and whitespace itself
  throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is damaged (received ${raw.length} characters, starting with ${JSON.stringify(raw.slice(0, 12))}). Use GOOGLE_SERVICE_ACCOUNT_B64 instead.`);
}
async function token() {
  const sa = parseSA(), now = Math.floor(Date.now() / 1000), head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64u(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const pem = String(sa.private_key).replace(/\\n/g, "").replace(/-----[^-]+-----|\s/g, "");
  const k = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", k, new TextEncoder().encode(`${head}.${body}`)));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", signal: T(), headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${head}.${body}.${sig}` });
  const j = await r.json(); if (!j.access_token) throw new Error("Google rejected the service account key: " + (j.error_description ?? j.error ?? r.status));
  return j.access_token as string;
}
async function meta(H: any, SID: string) {
  const r = await fetch(`${API}/${SID}?fields=properties.title,sheets.properties(sheetId,title)`, { headers: H, signal: T() }); const j = await r.json();
  if (!r.ok) { const sa = parseSA(); const m = j.error?.message ?? ""; throw new Error(r.status === 404 ? "SHEET_ID is wrong: Google cannot find that spreadsheet. Use the long id from the sheet's address (between /d/ and /edit)."
    : /not been used|disabled/i.test(m) ? "The Google Sheets API is not enabled. In Google Cloud Console enable 'Google Sheets API' for the service account's project."
    : `Google refused access (${r.status}). Share the Google Sheet with ${sa.client_email} as Editor. ${m}`); }
  return j;
}
const delRow = async (H: any, SID: string, TAB: string, rowIndex0: number) => { // remove one sheet row by 0-based index
  const m = await meta(H, SID), sh = (m.sheets ?? []).find((x: any) => x.properties.title === TAB); if (!sh) return;
  const r = await fetch(`${API}/${SID}:batchUpdate`, { method: "POST", headers: H, signal: T(), body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: sh.properties.sheetId, dimension: "ROWS", startIndex: rowIndex0, endIndex: rowIndex0 + 1 } } }] }) });
  if (!r.ok) throw new Error("Could not delete the sheet row: " + (await r.text()).slice(0, 200));
};
async function ensureTab(H: any, SID: string, TAB: string, HEAD: string[]) { // create the tab + headers if missing; top up headers if columns were added
  const m = await meta(H, SID), last = colName(HEAD.length), rng = `${API}/${SID}/values/${encodeURIComponent(TAB)}!A1:${last}1`;
  if (!(m.sheets ?? []).some((s: any) => s.properties.title === TAB)) {
    const r = await fetch(`${API}/${SID}:batchUpdate`, { method: "POST", headers: H, signal: T(), body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB } } }] }) });
    if (!r.ok) throw new Error("Could not create the '" + TAB + "' tab: " + (await r.text()).slice(0, 200));
  }
  const cur = await (await fetch(rng, { headers: H, signal: T() })).json();
  if ((cur.values?.[0]?.length ?? 0) < HEAD.length) await fetch(`${rng}?valueInputOption=RAW`, { method: "PUT", headers: H, signal: T(), body: JSON.stringify({ values: [HEAD] }) });
}
const readIds = async (H: any, base: string) => { const res = await fetch(`${base}!A:A`, { headers: H, signal: T() }); const j = await res.json();
  if (!res.ok) throw new Error(`Sheets read failed (${res.status}): ${j.error?.message ?? ""}`); return (j.values ?? []).map((v: string[]) => v[0]); };
async function diagnose(db: any) {
  const steps: any[] = [], add = (step: string, ok: boolean, detail = "") => steps.push({ step, ok, detail });
  const SID = Deno.env.get("SHEET_ID"), TAB = Deno.env.get("SHEET_TAB") ?? "Online Applications";
  add("Secret SHEET_ID is set", !!SID); add("Google service account secret is set (_B64 or _JSON)", hasSA());
  if (SID && hasSA()) {
    try { const sa = parseSA(); add("Service account key parses", true, "client_email: " + sa.client_email + "  <- the Google Sheet must be shared with this address as Editor");
      const H = { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }; add("Google accepts the key", true);
      const m = await meta(H, SID); add("Spreadsheet reachable", true, "title: " + m.properties?.title);
      add(`Tab '${TAB}' exists`, (m.sheets ?? []).some((s: any) => s.properties.title === TAB), (m.sheets ?? []).map((s: any) => s.properties.title).join(", ") + " (it is created automatically on the next sync if missing)");
    } catch (e) { add("Google step failed", false, e instanceof Error ? e.message : String(e)); }
  }
  const p = await db.from("sheet_outbox").select("id,application_id,attempts,last_error,created_at").eq("done", false).order("id", { ascending: false }).limit(5);
  add("Jobs waiting in sheet_outbox", true, String(p.data?.length ?? 0) + " (latest 5 shown below)");
  return { all_ok: steps.every((s) => s.ok), steps, pending_jobs: p.data };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin(), url = new URL(req.url);
  // Defence in depth: the gateway verifies JWTs, and this handler only permits
  // the service role or an approved administrator to run/diagnose the worker.
  const authorization = req.headers.get("authorization") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  let authorized = !!serviceRole && authorization === `Bearer ${serviceRole}`;
  if (!authorized) {
    const user = await userFrom(req);
    if (user) {
      const { data: staff } = await db.from("staff").select("role,status").eq("id", user.id).maybeSingle();
      authorized = staff?.status === "approved" && staff?.role === "administrator";
    }
  }
  if (!authorized) return json({ error: "Unauthorized. Use an approved administrator account." }, 401);
  if (url.searchParams.get("check") === "1") return json(await diagnose(db));
  let jobs: any[] = [];
  try {
    const worker = `sheet-sync-${crypto.randomUUID()}`;
    const r = await db.rpc("claim_sheet_jobs", { p_worker: worker, p_limit: 25 });
    if (r.error) throw new Error(`Could not claim synchronization jobs: ${r.error.message}`);
    jobs = r.data ?? [];
    if (!jobs.length) return json({ synced: 0, failed: 0, note: "nothing pending" });
    const SID = Deno.env.get("SHEET_ID"), APP_TAB = Deno.env.get("SHEET_TAB") ?? "Online Applications", ADM_TAB = Deno.env.get("ADMIN_TAB") ?? "Admin Registrations";
    if (!SID) throw new Error("Missing secret SHEET_ID"); if (!hasSA()) throw new Error("Missing secret GOOGLE_SERVICE_ACCOUNT_B64");
    const H = { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" };
    const tabs: Record<string, { base: string; ids: string[] }> = {};
    const open = async (name: string, head: string[]) => { if (!tabs[name]) { await ensureTab(H, SID, name, head); const base = `${API}/${SID}/values/${encodeURIComponent(name)}`; tabs[name] = { base, ids: await readIds(H, base) }; } return tabs[name]; };
    let ok = 0, failed = 0;
    const done = async (id: number, note?: string) => {
      const r = await db.rpc("complete_sheet_job", { p_id: id, p_note: note ?? null });
      if (r.error) throw new Error(`Could not complete sync job ${id}: ${r.error.message}`);
    };
    const failedJob = async (id: number, message: string) => {
      const r = await db.rpc("fail_sheet_job", { p_id: id, p_error: message.slice(0, 1000), p_max_attempts: 8 });
      if (r.error) console.error(`Could not mark sync job ${id} failed`, r.error.message);
    };
    for (const j of jobs) {
      try {
        let name: string, head: string[], row: any[], id: string;
        if (j.kind === "delete_app" || j.kind === "delete_staff") { // permanent deletions: remove the row from the sheet
          const isS = j.kind === "delete_staff", t = await open(isS ? ADM_TAB : APP_TAB, isS ? ADM_HEAD : APP_HEAD);
          t.ids = await readIds(H, t.base); const i = t.ids.indexOf(j.application_id);
          if (i > 0) { await delRow(H, SID, isS ? ADM_TAB : APP_TAB, i); t.ids.splice(i, 1); }
          await done(j.id); ok++; continue;
        }
        if (j.kind === "staff") {
          const { data: s } = await db.from("staff").select("*").eq("id", j.application_id).maybeSingle();
          if (!s) { await done(j.id, "skipped: staff record no longer exists"); continue; }
          name = ADM_TAB; head = ADM_HEAD; id = s.id; row = [s.id, s.full_name, s.email, s.phone ?? "", s.position ?? "", s.created_at, cap(s.status), s.role];
        } else {
          const { data: a } = await db.from("applications").select("*, intakes(label), application_courses(course_code), profiles(full_name,phone)").eq("id", j.application_id).single();
          if (!a) { await done(j.id, "skipped: application no longer exists"); continue; }
          const f = a.form_data ?? {};
          name = APP_TAB; head = APP_HEAD; id = a.id;
          row = [a.id, a.student_id ?? "", f.surname ? `${f.surname} ${f.firstName}`.trim() : a.profiles?.full_name ?? "", f.phone ?? a.profiles?.phone ?? "", a.intakes?.label,
            (a.package_code ? "[FULL PACKAGE] " : "") + a.application_courses.map((c: any) => c.course_code).join(", "), a.total_ngn, a.status, a.created_at, a.paid_at ?? "", a.submitted_at ?? "",
            a.payment_claimed_at ?? "", cap(a.payment_review), f.occupation ?? "", f.education ?? "", f.laptop ?? "", f.battery ?? "", f.skills ?? ""];
        }
        const t = await open(name, head);
        let i = t.ids.indexOf(id); if (i < 0) { t.ids = await readIds(H, t.base); i = t.ids.indexOf(id); } // re-read just before appending: no duplicate rows
        const u = i >= 0 ? `${t.base}!A${i + 1}?valueInputOption=RAW` : `${t.base}!A:A:append?valueInputOption=RAW&insertDataOption=OVERWRITE`;
        const res = await fetch(u, { method: i >= 0 ? "PUT" : "POST", headers: H, signal: T(), body: JSON.stringify({ values: [row] }) });
        if (!res.ok) throw new Error(`Sheets write failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
        if (i < 0) t.ids.push(id);
        await done(j.id); ok++;
      } catch (err) { failed++; await failedJob(j.id, String(err)); }
    }
    return json({ synced: ok, failed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e); console.error("SHEET-SYNC ERROR:", msg);
    if (jobs.length) for (const j of jobs) await failedJob(j.id, msg);
    return json({ error: msg }, 500);
  }
});
