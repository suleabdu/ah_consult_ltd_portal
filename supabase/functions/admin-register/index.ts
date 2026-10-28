// Staff self-registration. Needs a valid staff access code (created in Admin Dashboard > Team & Access > Access Codes).
// Every account starts as 'pending' until an Administrator approves it (Admin Dashboard).
import { admin, clientIp, json, safe, withinRateLimit } from "../_shared/lib.ts";
import { sha256Hex } from "../_shared/crypto.ts";
import { kickSheetSync } from "../_shared/sync.ts";
const ROLE: Record<string, string> = { "Administrator": "administrator", "Registrar / Admissions": "registrar", "Finance / Accounts": "finance", "Academic Coordinator": "academic", "Operations": "operations", "Tutor / Lecturer": "tutor", "Other": "viewer" };
Deno.serve(safe(async (req) => {
  const { fullName, email, phone, position, password, inviteCode } = await req.json();
  const role = ROLE[String(position ?? "")] ?? "viewer", db = admin(), typed = String(inviteCode ?? "").trim(), hash = await sha256Hex(typed);
  // A personal invitation/access code is required. Legacy shared fallback is disabled.
  const legacy = null;
  // Throttle guessing of access codes: 10 attempts per IP per hour, 200 per hour across the whole site.
  if (!(await withinRateLimit(db, "adminreg:ip:" + clientIp(req), 10, 3600)) || !(await withinRateLimit(db, "adminreg:all", 200, 3600)))
    return json({ error: "Too many attempts. Please wait an hour and try again, or ask an administrator for help." }, 429);
  const { data: dbOk } = await db.rpc("redeem_access_code", { p_hash: hash, p_role: role, p_consume: false });
  const { count } = await db.from("access_codes").select("id", { count: "exact", head: true }).eq("active", true);
  if (!legacy && !(count ?? 0)) return json({ error: "Staff registration is not enabled yet. An administrator must create an access code first." }, 503);
  if (dbOk !== true) { await new Promise((r) => setTimeout(r, 1000)); return json({ error: "That staff access code is not valid for this position. Please ask an administrator for a current code." }, 403); }
  const name = String(fullName ?? "").trim(), mail = String(email ?? "").trim().toLowerCase();
  if (name.length < 3) return json({ error: "Enter your full name." }, 422);
  if (!/^\S+@\S+\.\S+$/.test(mail)) return json({ error: "Enter a valid email address." }, 422);
  if (String(password ?? "").length < 10) return json({ error: "Use a password of at least 10 characters." }, 422);
  const { data: created, error } = await db.auth.admin.createUser({ email: mail, password, email_confirm: true, user_metadata: { full_name: name, phone } });
  if (error) return json({ error: /already|registered/i.test(error.message) ? "This email is already registered. Use a different email or sign in." : "Could not create the account." }, 400);
  const { error: e2 } = await db.from("staff").insert({ id: created.user.id, full_name: name, email: mail, phone: phone ?? null, position: position ?? null, role, status: "pending" });
  if (e2) { await db.auth.admin.deleteUser(created.user.id); console.error("staff insert failed", e2); return json({ error: "Could not save your registration. Please try again." }, 500); }
  if (dbOk === true) await db.rpc("redeem_access_code", { p_hash: hash, p_role: role, p_consume: true });   // count the use only after success
  await kickSheetSync();
  return json({ ok: true });
}));
