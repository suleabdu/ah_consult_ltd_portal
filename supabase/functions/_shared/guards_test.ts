import { amountCovers, assertPublicHttps, isPaidStatus, safeReturnUrl, timingSafeEqual } from "./guards.ts";
const eq = (a: unknown, b: unknown, m = "") => { if (a !== b) throw new Error(`${m} expected ${b}, got ${a}`); };
const throws = (f: () => unknown, m = "") => { try { f(); } catch { return; } throw new Error("expected throw " + m); };

Deno.test("isPaidStatus: affirmative statuses", () => {
  for (const s of ["success", "SUCCESSFUL", "Paid", "payment completed", "approved", "Transaction Successful"]) eq(isPaidStatus(s), true, s);
});
Deno.test("isPaidStatus: the old regex bugs stay fixed", () => {
  for (const s of ["unpaid", "incomplete", "unsuccessful", "not paid", "payment not successful", "partially paid", "pending", "failed", "reversed", "refunded", "", null, undefined]) eq(isPaidStatus(s), false, String(s));
});
Deno.test("amountCovers: null, short and exact", () => {
  eq(amountCovers(null, 5000), false); eq(amountCovers(4999, 5000), false); eq(amountCovers(5000, 5000), true);
  eq(amountCovers(5001, 5000), true); eq(amountCovers(NaN, 5000), false); eq(amountCovers(5000, 0), false);
});
Deno.test("timingSafeEqual", () => { eq(timingSafeEqual("abc", "abc"), true); eq(timingSafeEqual("abc", "abd"), false); eq(timingSafeEqual("abc", "abcd"), false); eq(timingSafeEqual("", ""), true); });
Deno.test("assertPublicHttps blocks SSRF targets", () => {
  assertPublicHttps("https://api.example.com/v1/pay");
  for (const u of ["http://api.example.com", "https://localhost/x", "https://127.0.0.1/x", "https://169.254.169.254/latest", "https://[::1]/x", "https://db.internal/x", "https://intranet/x", "https://user:pw@api.example.com/", "not a url"]) throws(() => assertPublicHttps(u), u);
});
Deno.test("safeReturnUrl only returns to allowed origins", () => {
  const fb = "https://hub.example.com/payment-success.html", ok = ["https://hub.example.com"];
  eq(safeReturnUrl("https://hub.example.com/payment-success.html?a=1", fb, ok), "https://hub.example.com/payment-success.html?a=1");
  eq(safeReturnUrl("https://evil.example.net/phish", fb, ok), fb); eq(safeReturnUrl("javascript:alert(1)", fb, ok), fb); eq(safeReturnUrl(undefined, fb, ok), fb);
});
