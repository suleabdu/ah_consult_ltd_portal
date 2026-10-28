/* =============================================================================
   guards.ts : small, dependency-free security helpers shared by Edge Functions.
   Pure functions only (no Deno APIs) so they are unit-tested in CI (guards_test.ts).
   ============================================================================= */

/** Constant-time string comparison (does not leak how many leading characters matched). */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const PAID_WORDS = new Set(["success", "successful", "successfully", "paid", "complete", "completed", "approved", "settled"]);
const NOT_PAID_WORDS = new Set([
  "fail", "failed", "failure", "unsuccessful", "unpaid", "incomplete", "decline", "declined", "pending", "abandoned",
  "cancel", "cancelled", "canceled", "reverse", "reversed", "refund", "refunded", "expired", "error", "not", "no",
  "processing", "initiated", "initialized", "initialised", "awaiting", "partial", "partially",
]);

/**
 * Whole-word status classification. The previous substring regex treated "unpaid", "incomplete" and
 * "unsuccessful" as PAID. Here a status counts as paid only if it contains an affirmative word AND no
 * negative word, matched as complete words.
 */
export function isPaidStatus(raw: unknown): boolean {
  const words = String(raw ?? "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (!words.length) return false;
  if (words.some((w) => NOT_PAID_WORDS.has(w))) return false;
  return words.some((w) => PAID_WORDS.has(w));
}

/** Money check: the provider MUST report an amount, and it must cover the total (no tolerance, no null pass-through). */
export function amountCovers(paid: number | null, total: number): boolean {
  return paid !== null && Number.isFinite(paid) && Number.isFinite(total) && total > 0 && Math.round(paid) >= Math.round(total);
}

/** Admin-configured provider URLs must be public https endpoints (blocks localhost, private/link-local IPs and internal names). */
export function assertPublicHttps(url: string, label = "URL"): URL {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error(`${label} is not a valid URL.`); }
  if (u.protocol !== "https:") throw new Error(`${label} must start with https://`);
  const h = u.hostname.toLowerCase();
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
  const bad = h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") ||
    h.includes(":") || ipv4 || !h.includes(".");
  if (bad) throw new Error(`${label} must use a public domain name, not an IP address or internal host.`);
  if (u.username || u.password) throw new Error(`${label} must not contain credentials.`);
  return u;
}

/** Only return to this site (or a listed origin) after payment. Anything else falls back to the default. */
export function safeReturnUrl(candidate: unknown, fallback: string, allowedOrigins: string[]): string {
  try {
    const u = new URL(String(candidate ?? ""));
    const origin = u.origin;
    const allowed = allowedOrigins.map((o) => o.replace(/\/$/, ""));
    if ((u.protocol === "https:" || u.protocol === "http:") && allowed.includes(origin)) return u.toString();
  } catch { /* fall through */ }
  return fallback;
}

/** Best-effort client IP for rate limiting (behind Supabase's proxy). */
export function clientIp(req: Request): string {
  const h = req.headers;
  return (h.get("cf-connecting-ip") ?? h.get("x-real-ip") ?? (h.get("x-forwarded-for") ?? "").split(",")[0] ?? "").trim() || "unknown";
}
