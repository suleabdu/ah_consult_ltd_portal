// Server-side helper for triggering the private Google Sheets sync worker.
// Never call sheet-sync directly from an unauthenticated browser request.
export async function kickSheetSync(): Promise<{ ok: boolean; status?: number; data?: any; error?: string }> {
  const base = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) return { ok: false, error: "Supabase server configuration is incomplete." };
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/functions/v1/sheet-sync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Protected sheet-sync request failed", response.status, body?.error ?? "");
      return { ok: false, status: response.status, data: body, error: body?.error ?? "Sheet sync request failed." };
    }
    return { ok: true, status: response.status, data: body };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Protected sheet-sync request failed", message);
    return { ok: false, error: message };
  }
}
