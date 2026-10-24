/* =============================================================================
   SETUP GUIDE  -  supabase/functions/_shared/lib.ts
=============================================================================
WHAT IT IS
   Helper code used by every function: browser access rules (CORS; works for localhost and your live site), friendly error handling, and the database connection.

THIS IS NOT A FUNCTION
   Do NOT run "supabase functions deploy" on it. It has no deploy step of its own.
   It is bundled automatically into every function that imports it.

WHERE THIS FILE GOES
   supabase/functions/_shared/lib.ts
   Exactly this folder: supabase/functions/_shared/   (the underscore is part of the name).
   lib.ts, crypto.ts and pay.ts must all sit side by side, because they import each other with ./ paths.

AFTER YOU COPY OR CHANGE IT
   Redeploy the functions that use it (each keeps the copy it had when it was deployed):
   PowerShell:  'create-application','cancel-application','submit-application','admin-register','admin-delete','admin-settings','verify-payment','payment-webhook','upperlink-webhook','sheet-sync','sheet-review' | ForEach-Object { supabase functions deploy $_ }
   Or run:      scripts/deploy-functions.ps1  (Windows)   or   bash scripts/deploy-functions.sh  (Mac/Linux)

SECRETS: none required. Optional: ALLOWED_ORIGINS (comma-separated website addresses) to lock functions to your live site; ALLOW_LOCALHOST=false to refuse localhost.

HOW TO CHECK THE FOLDER IS RIGHT
   Run scripts/check-setup.ps1 (Windows) or bash scripts/check-setup.sh (Mac/Linux) from the project root. Every line must say OK.
   ============================================================================= */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Default CORS (used by webhook-style functions that are never called from a browser page).
export const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey" };
export const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
export const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
export async function userFrom(req: Request) {
  const c = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data } = await c.auth.getUser(); return data.user;
}
// Request-aware CORS. Works the same on a developer machine and on the live site, with no code change:
//  - ALLOWED_ORIGINS (comma list) or ALLOWED_ORIGIN restricts live callers. Unset = any site (safe: calls are token-protected, never cookie-based).
//  - localhost / 127.0.0.1 / private-network origins are always accepted unless ALLOW_LOCALHOST=false.
export function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const list = (Deno.env.get("ALLOWED_ORIGINS") ?? Deno.env.get("ALLOWED_ORIGIN") ?? "*").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  const local = Deno.env.get("ALLOW_LOCALHOST") !== "false" && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin);
  const any = list.includes("*");
  const allow = any ? "*" : (local || list.includes(origin)) ? origin : list[0];
  return { "Access-Control-Allow-Origin": allow, "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
}
// Wrap every browser-facing function: CORS preflight, request-aware CORS on every response, and crashes become JSON errors.
export const safe = (fn: (req: Request) => Promise<Response>) => async (req: Request) => {
  const h = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  let res: Response;
  try { res = await fn(req); }
  catch (e) { const requestId = crypto.randomUUID(); console.error("FUNCTION ERROR", requestId, e); res = json({ error: "Something went wrong on our side. Please try again.", request_id: requestId }, 500); }
  const out = new Headers(res.headers); for (const [k, v] of Object.entries(h)) out.set(k, v);
  return new Response(res.body, { status: res.status, headers: out });
};
