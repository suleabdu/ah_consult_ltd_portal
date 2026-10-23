/* =============================================================================
   SETUP GUIDE  -  supabase/functions/_shared/crypto.ts
=============================================================================
WHAT IT IS
   Encrypts and decrypts payment secret keys (AES-256) and fingerprints staff access codes (SHA-256).

THIS IS NOT A FUNCTION
   Do NOT run "supabase functions deploy" on it. It has no deploy step of its own.
   It is bundled automatically into every function that imports it.

WHERE THIS FILE GOES
   supabase/functions/_shared/crypto.ts
   Exactly this folder: supabase/functions/_shared/   (the underscore is part of the name).
   lib.ts, crypto.ts and pay.ts must all sit side by side, because they import each other with ./ paths.

AFTER YOU COPY OR CHANGE IT
   Redeploy the functions that use it (each keeps the copy it had when it was deployed):
   PowerShell:  'create-application','cancel-application','submit-application','admin-register','admin-delete','admin-settings','verify-payment','payment-webhook','upperlink-webhook','sheet-sync','sheet-review' | ForEach-Object { supabase functions deploy $_ }
   Or run:      scripts/deploy-functions.ps1  (Windows)   or   bash scripts/deploy-functions.sh  (Mac/Linux)

SECRET REQUIRED:  SETTINGS_ENCRYPTION_KEY
   Create it once and keep a safe copy. If you lose it, saved payment keys cannot be decrypted and must be typed in again.
   Windows PowerShell:
      $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
   Mac/Linux:   openssl rand -base64 32
   Then:        supabase secrets set SETTINGS_ENCRYPTION_KEY=THE_VALUE_YOU_GENERATED
   Never put this value in GitHub or in chat. Setting or changing a secret needs no redeploy.

HOW TO CHECK THE FOLDER IS RIGHT
   Run scripts/check-setup.ps1 (Windows) or bash scripts/check-setup.sh (Mac/Linux) from the project root. Every line must say OK.
   ============================================================================= */

// Encrypts payment secrets before they are stored. The key lives ONLY in the SETTINGS_ENCRYPTION_KEY function secret (never in the database or the browser).
const enc = new TextEncoder();
async function key() {
  const raw = Deno.env.get("SETTINGS_ENCRYPTION_KEY");
  if (!raw || raw.length < 16) throw new Error("The SETTINGS_ENCRYPTION_KEY secret is not set. Set it to a random value of 32+ characters (see the setup guide).");
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode(raw)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function encryptText(t: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); return b64(iv) + "." + b64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), enc.encode(t)))); }
export async function decryptText(s: string) { const [i, c] = s.split("."); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(i) }, await key(), unb64(c))); }
export async function sha256Hex(t: string) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(t)))].map((x) => x.toString(16).padStart(2, "0")).join(""); }
