// Staff invitations are created only for new accounts and start pending approval.
// No password, provider secret, or invitation token is returned to the browser.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { admin, json, safe, userFrom } from "../_shared/lib.ts";
import { normalizeNigerianWhatsApp } from "../_shared/whatsapp.ts";

Deno.serve(safe(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required." }, 405);
  const actor = await userFrom(req);
  if (!actor) return json({ error: "Please sign in again." }, 401);
  const authHeader = req.headers.get("Authorization") || "";
  const actorDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const body = await req.json().catch(() => ({}));
  const name = String(body.fullName ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = String(body.role ?? "").trim();
  const phone = normalizeNigerianWhatsApp(body.phone);
  if (name.length < 3 || name.length > 160) return json({ error: "Enter a full name of 3–160 characters." }, 422);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 422);
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(role)) return json({ error: "Select a valid role." }, 422);
  if (!phone) return json({ error: "Enter a valid Nigerian WhatsApp number." }, 422);

  const [permission, scope, staffRecord] = await Promise.all([
    actorDb.rpc("can_write", { m: "governance_user_invite" }),
    actorDb.rpc("governance_can_assign_role", { p_role: role }),
    actorDb.from("staff").select("role,status").eq("id", actor.id).maybeSingle(),
  ]);
  if (permission.error || scope.error || staffRecord.error) return json({ error: "Invitation permissions could not be verified." }, 503);
  if (staffRecord.data?.status !== "approved" || !["administrator", "hr"].includes(staffRecord.data?.role || "") || permission.data !== true || scope.data !== true)
    return json({ error: "Only an authorised administrator or HR officer can invite staff into this role." }, 403);

  // A redirect derived from an arbitrary Origin could leak the invitation session.
  // Require an explicit HTTPS origin in the server's trusted list.
  const origin = String(req.headers.get("origin") || "").replace(/\/$/, "");
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") || Deno.env.get("ALLOWED_ORIGIN") || "")
    .split(",").map((v) => v.trim().replace(/\/$/, "")).filter((v) => v && v !== "*");
  let parsedOrigin: URL;
  try { parsedOrigin = new URL(origin); } catch { return json({ error: "An approved website origin is required for invitations." }, 400); }
  if (parsedOrigin.origin !== origin || parsedOrigin.protocol !== "https:" || !allowed.includes(origin))
    return json({ error: "This website origin is not configured for staff invitations." }, 403);

  const db = admin();
  // Fail closed if the rate limiter is unavailable; account creation is sensitive.
  const limits = await Promise.all([
    db.rpc("check_rate_limit", { p_key: "staff-invite:actor:" + actor.id, p_max: 20, p_window_seconds: 3600 }),
    db.rpc("check_rate_limit", { p_key: "staff-invite:all", p_max: 100, p_window_seconds: 3600 }),
  ]);
  if (limits.some((r) => r.error)) return json({ error: "Invitation service is temporarily unavailable." }, 503);
  if (limits.some((r) => r.data !== true)) return json({ error: "Invitation limit reached. Please try again later." }, 429);

  // createUser enforces Auth's email uniqueness. Unlike an invite call on an
  // existing unconfirmed account, this cannot silently attach a staff role to
  // an existing user's account. The password is random and never disclosed.
  const created = await db.auth.admin.createUser({
    email, password: crypto.randomUUID() + crypto.randomUUID(), email_confirm: false,
    user_metadata: { full_name: name, phone },
  });
  if (created.error || !created.data.user) return json({ error: "Could not create a new account. The email may already be registered; contact an administrator." }, 409);
  const invitedUser = created.data.user;
  const [inviteAgain, permissionAgain] = await Promise.all([
    actorDb.rpc("can_write", { m: "governance_user_invite" }),
    actorDb.rpc("governance_can_assign_role", { p_role: role }),
  ]);
  if (inviteAgain.error || inviteAgain.data !== true || permissionAgain.error || permissionAgain.data !== true) {
    console.error("staff invitation stopped after account creation", invitedUser.id, "permission changed");
    return json({ error: "Your permission changed before the invitation was prepared. Contact an administrator before retrying." }, 409);
  }
  const roleRow = await db.from("staff_roles").select("name").eq("code", role).maybeSingle();
  if (roleRow.error || !roleRow.data) return json({ error: "Role is unavailable. Contact an administrator before retrying." }, 409);
  const inserted = await db.from("staff").insert({
    id: invitedUser.id, full_name: name, email, phone, whatsapp_e164: phone,
    // Merely providing a number does not prove the recipient consented to WhatsApp.
    whatsapp_opt_in_at: null, whatsapp_opt_in_source: null,
    position: roleRow.data.name, role, status: "pending",
  });
  if (inserted.error) {
    // Do not delete a newly created account after a partial failure. Preserve it
    // for an authorised recovery rather than risking loss of user data.
    console.error("staff invitation record creation failed", invitedUser.id, inserted.error.code || "unknown");
    return json({ error: "The account was created but its staff record was not saved. Contact an administrator before retrying." }, 500);
  }
  await db.from("audit_log").insert({ actor: actor.id, actor_name: "Staff", action: "staff_invitation_created", target: invitedUser.id, note: "Pending approval; requested role: " + role });

  // Supabase sends the configured Invite email to the unconfirmed new account.
  // The redirect must also be present in the Supabase Auth redirect allowlist.
  const invitation = await db.auth.admin.inviteUserByEmail(email, {
    redirectTo: origin + "/staff-invite-accept.html",
  });
  if (invitation.error) {
    console.error("staff invitation delivery failed", invitedUser.id, invitation.error.code || "unknown");
    return json({ error: "The staff record is pending, but the invitation email could not be sent. Contact an administrator before retrying." }, 502);
  }
  return json({ ok: true, status: "pending", message: "Invitation sent. Staff access remains pending approval." }, 201);
}));
