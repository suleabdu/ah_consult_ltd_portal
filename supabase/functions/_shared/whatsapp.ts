/* WhatsApp-specific helpers. Keep provider credentials and policy decisions in
   Edge Functions; this module only normalizes public contact values/payloads. */
export function normalizeNigerianWhatsApp(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (/^0[789][01]\d{8}$/.test(digits)) return "+234" + digits.slice(1);
  if (/^234[789][01]\d{8}$/.test(digits)) return "+" + digits;
  return null;
}

// Staff/applicant forms currently collect Nigerian numbers, but delivery and
// webhook processing also accept an already-canonical international E.164
// value. This avoids silently corrupting a valid stored number in a campaign.
export function normalizeWhatsAppE164(raw: unknown): string | null {
  const value = String(raw ?? "").trim().replace(/[\s().-]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(value)) return value;
  return normalizeNigerianWhatsApp(value);
}

export function metaRecipient(raw: unknown): string | null {
  const normalized = normalizeWhatsAppE164(raw);
  return normalized ? normalized.slice(1) : null;
}

export function maskPhone(raw: unknown): string {
  const normalized = normalizeWhatsAppE164(raw);
  return normalized ? `${normalized.slice(0, 5)}••••${normalized.slice(-3)}` : "Unavailable";
}

export function normalizeTemplateName(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  return /^[a-z0-9_]{1,512}$/.test(value) ? value : null;
}

export function normalizeTemplateLanguage(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  return /^[a-z]{2,3}_[A-Z]{2}$/.test(value) ? value : null;
}
