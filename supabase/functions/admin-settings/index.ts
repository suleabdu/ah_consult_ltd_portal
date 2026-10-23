/* =============================================================================
   SETUP GUIDE  -  supabase/functions/admin-settings/index.ts
=============================================================================
WHAT IT IS
   Administrator-only server function behind Payment Methods and staff access codes: saves payment methods (keys encrypted), tests connections, creates and revokes access codes.

WHERE THIS FILE GOES
   supabase/functions/admin-settings/index.ts
   The file MUST be named index.ts. Its folder name (admin-settings) is the function name.
   Run every command below from the PROJECT ROOT (the folder that CONTAINS the "supabase" folder).
   Its helpers live in supabase/functions/_shared/ (lib.ts, crypto.ts, pay.ts). Keep that folder exactly there.

ONE-TIME PREPARATION (skip if already done)
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF      (the part of your project URL before .supabase.co)

DEPLOY
   supabase functions deploy admin-settings
   (Normal deploy. Signed-in users reach it with their login token.)
   "Docker is not running"? Start Docker Desktop, or update the Supabase CLI and add  --use-api  to the command.

SECRETS NEEDED   (supabase secrets set NAME=value   or   Dashboard > Edge Functions > Secrets)
   SETTINGS_ENCRYPTION_KEY (REQUIRED; see supabase/functions/_shared/crypto.ts for how to create it).

DATABASE NEEDED
   Migrations 008 and 010.

HOW TO TEST
   Dashboard > Payment Methods > Add payment method > Save, then Test. Also Team & Access > Create code.

COMMON PROBLEMS
   "SETTINGS_ENCRYPTION_KEY secret is not set" = set that secret and try again (no redeploy needed).  "Only administrators..." = sign in as an Administrator.
   ============================================================================= */

// Administrator-only: payment methods (secrets encrypted), staff access codes.
import { admin, json, safe, userFrom } from "../_shared/lib.ts";
import { encryptText, sha256Hex } from "../_shared/crypto.ts";
import { loadProvider, testProvider } from "../_shared/pay.ts";
const CONFIG_KEYS: Record<string, string[]> = { manual: ["bank_name", "account_name", "account_number"], monnify: ["contract_code", "base_url"], upperlink: ["merchant_id", "init_url", "verify_url", "verify_method", "auth_style", "auth_header", "redirect_url"] };
const SECRET_KEYS: Record<string, string[]> = { manual: [], monnify: ["api_key", "secret_key"], upperlink: ["secret_key"] };
const ROLES = ["administrator", "registrar", "finance", "academic", "operations", "tutor", "viewer"];
Deno.serve(safe(async (req) => {
  const user = await userFrom(req); if (!user) return json({ error: "Please sign in again." }, 401);
  const db = admin();
  const { data: me } = await db.from("staff").select("id,full_name,role,status").eq("id", user.id).maybeSingle();
  if (!me || me.status !== "approved" || me.role !== "administrator") return json({ error: "Only administrators can change these settings." }, 403);
  const b = await req.json(), audit = (action: string, target: string, note = "") => db.from("audit_log").insert({ actor: me.id, actor_name: me.full_name, action, target, note });
  const url = (v: unknown) => { const t = String(v ?? "").trim(); if (t && !/^https:\/\/[^\s]+$/.test(t)) throw new Error("Web addresses must start with https://"); return t; };

  if (b.action === "provider_save") {
    const kind = String(b.kind); if (!CONFIG_KEYS[kind]) return json({ error: "Unknown payment method type." }, 422);
    if (!["test", "live"].includes(b.mode)) return json({ error: "Choose Test or Live mode." }, 422);
    const label = String(b.label ?? "").trim().slice(0, 80); if (!label) return json({ error: "Give this method a name." }, 422);
    const config: Record<string, string> = {}; for (const k of CONFIG_KEYS[kind]) { const v = String((b.config ?? {})[k] ?? "").trim().slice(0, 300); config[k] = /url$/.test(k) ? url(v) : v; }
    let existing: any = null; if (b.id) { const r = await db.from("payment_providers").select("*").eq("id", b.id).maybeSingle(); existing = r.data; if (!existing) return json({ error: "Payment method not found." }, 404); }
    const secrets_enc = { ...(existing?.secrets_enc ?? {}) }, secret_hints = { ...(existing?.secret_hints ?? {}) };
    for (const k of SECRET_KEYS[kind]) { const v = String((b.secrets ?? {})[k] ?? "").trim(); if (v) { secrets_enc[k] = await encryptText(v); secret_hints[k] = "\u2022\u2022\u2022\u2022" + v.slice(-4); } }
    const row = { kind, label, mode: b.mode, enabled: b.enabled !== false, config, secrets_enc, secret_hints, updated_at: new Date().toISOString(), updated_by: me.id };
    let id = b.id;
    if (existing) { const { error } = await db.from("payment_providers").update(row).eq("id", id); if (error) return json({ error: error.message }, 500); }
    else { const { data, error } = await db.from("payment_providers").insert(row).select("id").single(); if (error) return json({ error: error.message }, 500); id = data.id; }
    if (b.makeDefault) { await db.from("payment_providers").update({ is_default: false }).neq("id", id); await db.from("payment_providers").update({ is_default: true, enabled: true }).eq("id", id); }
    await audit("payment_method_saved", `${label} (${b.mode})`, b.makeDefault ? "set as default" : ""); return json({ ok: true, id });
  }
  if (b.action === "provider_default") {
    const { data: p } = await db.from("payment_providers").select("id,label,mode").eq("id", b.id).maybeSingle(); if (!p) return json({ error: "Not found." }, 404);
    await db.from("payment_providers").update({ is_default: false }).neq("id", b.id); await db.from("payment_providers").update({ is_default: true, enabled: true }).eq("id", b.id);
    await audit("payment_method_default", `${p.label} (${p.mode})`); return json({ ok: true });
  }
  if (b.action === "provider_toggle") { await db.from("payment_providers").update({ enabled: !!b.enabled }).eq("id", b.id).eq("is_default", false); await audit("payment_method_toggle", String(b.id), b.enabled ? "enabled" : "disabled"); return json({ ok: true }); }
  if (b.action === "provider_delete") {
    const { data: p } = await db.from("payment_providers").select("label,mode,is_default").eq("id", b.id).maybeSingle(); if (!p) return json({ error: "Not found." }, 404);
    if (p.is_default) return json({ error: "This is the active method. Make another method the default first." }, 422);
    await db.from("payment_providers").delete().eq("id", b.id); await audit("payment_method_deleted", `${p.label} (${p.mode})`); return json({ ok: true });
  }
  if (b.action === "provider_test") { const p = await loadProvider(db, b.id, true); if (!p) return json({ error: "Not found." }, 404); return json(await testProvider(p)); }

  if (b.action === "code_create") {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (x) => alphabet[x % alphabet.length]).join("");
    const code = String(b.custom ?? "").trim() || `AHC-${rnd()}-${rnd()}-${rnd()}`; if (code.length < 8) return json({ error: "A code must be at least 8 characters." }, 422);
    const roles = Array.isArray(b.allowedRoles) && b.allowedRoles.length ? b.allowedRoles.filter((r: string) => ROLES.includes(r)) : null;
    const exp = Number(b.expiresDays) > 0 ? new Date(Date.now() + Number(b.expiresDays) * 864e5).toISOString() : null, max = Number(b.maxUses) > 0 ? Number(b.maxUses) : null;
    const { error } = await db.from("access_codes").insert({ label: String(b.label ?? "Staff code").slice(0, 80), code_hash: await sha256Hex(code), hint: "\u2022\u2022\u2022\u2022" + code.slice(-4), allowed_roles: roles, max_uses: max, expires_at: exp, created_by: me.id });
    if (error) return json({ error: /duplicate/.test(error.message) ? "That code already exists." : error.message }, 422);
    await audit("access_code_created", String(b.label ?? "Staff code")); return json({ ok: true, code });   // shown once, never stored in readable form
  }
  if (b.action === "code_toggle") { await db.from("access_codes").update({ active: !!b.active }).eq("id", b.id); await audit("access_code_toggle", String(b.id), b.active ? "enabled" : "disabled"); return json({ ok: true }); }
  if (b.action === "code_delete") { await db.from("access_codes").delete().eq("id", b.id); await audit("access_code_deleted", String(b.id)); return json({ ok: true }); }
  return json({ error: "Unknown request." }, 400);
}));
