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
