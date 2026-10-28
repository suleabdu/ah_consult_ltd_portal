import { createClient } from "npm:@supabase/supabase-js@2.45.4";
// Default CORS (used by webhook-style functions that are never called from a browser page).
export const cors = { "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey" };   // origin is added per-request by safe()/corsHeaders()
export const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
export const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
export async function userFrom(req: Request) {
  const c = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data } = await c.auth.getUser(); return data.user;
}
// Request-aware CORS. Works the same on a developer machine and on the live site, with no code change:
//  - ALLOWED_ORIGINS (comma list) or ALLOWED_ORIGIN is REQUIRED in production. Unset = only localhost/private-network origins are allowed (secure default). "*" must be set explicitly.
//  - localhost / 127.0.0.1 / private-network origins are always accepted unless ALLOW_LOCALHOST=false.
export function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const list = (Deno.env.get("ALLOWED_ORIGINS") ?? Deno.env.get("ALLOWED_ORIGIN") ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  const local = Deno.env.get("ALLOW_LOCALHOST") !== "false" && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin);
  const any = list.includes("*");
  const allow = any ? "*" : (local || list.includes(origin)) ? origin : (list[0] ?? "");
  return { ...(allow ? { "Access-Control-Allow-Origin": allow } : {}), "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
}
// Wrap every browser-facing function: CORS preflight, request-aware CORS on every response, and crashes become JSON errors.
export const safe = (fn: (req: Request) => Promise<Response>) => async (req: Request) => {
  const requestId = crypto.randomUUID();
  const h = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  let res: Response;
  try { res = await fn(req); }
  catch (e) { const ref = requestId.slice(0, 8); console.error(JSON.stringify({ level: "error", event: "function_failed", request_id: requestId, method: req.method, path: new URL(req.url).pathname, error_type: e instanceof Error ? e.name : "UnknownError" })); res = json({ error: "Something went wrong on our side. Please try again.", ref }, 500); }
  const out = new Headers(res.headers); out.set("X-Request-ID", requestId); for (const [k, v] of Object.entries(h)) out.set(k, v);
  return new Response(res.body, { status: res.status, headers: out });
};

export { timingSafeEqual, clientIp, safeReturnUrl, assertPublicHttps, isPaidStatus, amountCovers } from "./guards.ts";
/** Fixed-window rate limit backed by Postgres (see migration 024). Returns true when the caller is within the limit. Fails OPEN on DB error so an outage never locks out real users. */
export async function withinRateLimit(db: any, key: string, max: number, windowSeconds: number): Promise<boolean> {
  try { const { data, error } = await db.rpc("check_rate_limit", { p_key: key, p_max: max, p_window_seconds: windowSeconds }); if (error) { console.error("rate limit rpc", error.message); return true; } return data === true; }
  catch (e) { console.error("rate limit", e); return true; }
}
