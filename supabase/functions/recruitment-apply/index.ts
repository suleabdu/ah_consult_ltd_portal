import { admin, clientIp, json, safe } from "../_shared/lib.ts";

const MAX_BODY = 25 * 1024 * 1024;
const MAX_FILE = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES: Record<string, string> = {
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
};

// A fixed upper bound is enforced while reading, even for chunked requests.
async function boundedBody(req: Request): Promise<Uint8Array> {
  const size = Number(req.headers.get("content-length") || "0");
  if (size > MAX_BODY) throw new Error("Application files must total no more than 25 MB.");
  if (!req.body) throw new Error("No application was provided.");
  const reader = req.body.getReader(); const parts: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.length;
    if (total > MAX_BODY) { await reader.cancel(); throw new Error("Application files must total no more than 25 MB."); }
    parts.push(value);
  }
  const all = new Uint8Array(total); let offset = 0;
  for (const part of parts) { all.set(part, offset); offset += part.length; }
  return all;
}

function fileMatches(ext: string, bytes: Uint8Array): boolean {
  if (ext === "pdf") return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  if (ext === "docx") return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (ext === "jpg" || ext === "jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return ext === "png" && bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n);
}

Deno.serve(safe(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("multipart/form-data;"))
    return json({ error: "Send the application and files as a form." }, 400);
  const db = admin();
  const ip = clientIp(req);
  const ipHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip)))).map(b=>b.toString(16).padStart(2,"0")).join("");
  const limits = await Promise.all([
    ...(ip === "unknown" ? [] : [db.rpc("check_rate_limit", { p_key:"recruitment-apply:ip:"+ipHash, p_max:12, p_window_seconds:3600 })]),
    db.rpc("check_rate_limit", { p_key:"recruitment-apply:all", p_max:200, p_window_seconds:3600 }),
  ]);
  if (limits.some(r=>r.error)) return json({ error:"Applications are temporarily unavailable. Please try again later." }, 503);
  if (limits.some(r=>r.data !== true)) return json({ error:"Too many application attempts. Please try again later." }, 429);

  let data: FormData;
  try {
    const bytes = await boundedBody(req);
    data = await new Request("https://local.invalid", { method:"POST", headers:{"content-type":req.headers.get("content-type")!}, body:bytes }).formData();
  } catch (e) { return json({ error:e instanceof Error && e.message.includes("25 MB") ? e.message : "The application form could not be read." }, 400); }
  let input: Record<string, unknown>;
  try {
    const payload = data.get("payload"); if (typeof payload !== "string" || payload.length > 100000 || data.getAll("payload").length !== 1) throw new Error();
    input = JSON.parse(payload); if (!input || Array.isArray(input) || typeof input !== "object") throw new Error();
  } catch { return json({ error:"Invalid application details." }, 400); }
  const vacancyId = String(input.vacancy_id || "");
  const submissionId = String(input.submission_id || "");
  if (!UUID.test(vacancyId) || !UUID.test(submissionId)) return json({ error:"Select an available position and reload the form." }, 400);
  const previous = await db.rpc("recruitment_guest_submission_status", { p_vacancy:vacancyId, p_submission_id:submissionId });
  if (previous.error) return json({ error:"Applications are temporarily unavailable." }, 503);
  if (previous.data) return json(previous.data, 200);
  const vacancyResult = await db.rpc("recruitment_public_vacancy", { p_vacancy:vacancyId });
  if (vacancyResult.error) return json({ error:"Applications are temporarily unavailable." }, 503);
  const vacancy = vacancyResult.data;
  if (!vacancy) return json({ error:"This vacancy is no longer open." }, 400);
  if (input.consent !== true) return json({ error:"Please agree to the privacy notice." }, 400);
  if (typeof input.full_name !== "string" || input.full_name.trim().length < 2 || input.full_name.trim().length > 160 ||
      typeof input.email !== "string" || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) ||
      typeof input.phone !== "string" || input.phone.trim().length < 7 || input.phone.trim().length > 40)
    return json({ error:"Enter your name, valid email address and phone number." }, 400);
  if (!input.answers || typeof input.answers !== "object" || Array.isArray(input.answers)) return json({ error:"Invalid answers." }, 400);
  const answers = { ...(input.answers as Record<string, unknown>) };
  const questions = Array.isArray(vacancy.questions) ? vacancy.questions : [];
  const questionMap = new Map(questions.map((q: { id:string; kind:string; required:boolean; options?:string[] })=>[q.id,q]));
  if (Object.keys(answers).some(key=>!questionMap.has(key) || questionMap.get(key).kind === "file" || typeof answers[key] !== "string"))
    return json({ error:"The questions changed. Please reload and try again." }, 400);

  const files: Array<{ key:string; file:File; ext:string; bytes:Uint8Array }> = [];
  for (const [key,value] of data.entries()) {
    if (key === "payload") continue;
    if (!(value instanceof File) || (key !== "cv" && key !== "passport" && !/^question:[0-9a-f-]{36}$/i.test(key)) || data.getAll(key).length !== 1)
      return json({ error:"Invalid attachment." }, 400);
    const qid = key.startsWith("question:") ? key.slice(9) : "";
    if (qid && (!questionMap.has(qid) || questionMap.get(qid).kind !== "file")) return json({ error:"The questions changed. Please reload and try again." }, 400);
    const ext = value.name.split(".").pop()?.toLowerCase() || "";
    if (!TYPES[ext] || (key === "cv" && !["pdf","docx"].includes(ext)) || (key === "passport" && !["jpg","jpeg","png"].includes(ext)))
      return json({ error:"Use a supported PDF, DOCX, JPG or PNG file." }, 400);
    if (!value.size || value.size > MAX_FILE) return json({ error:"Each file must be no larger than 10 MB." }, 400);
    const bytes = new Uint8Array(await value.arrayBuffer());
    if (!fileMatches(ext,bytes)) return json({ error:"An attachment does not match its file type." }, 400);
    files.push({key,file:value,ext,bytes});
  }
  if (files.length > 22) return json({ error:"Too many attachments." }, 400);
  if (vacancy.requires_cv && !files.some(f=>f.key === "cv")) return json({ error:"A CV is required." }, 400);
  if (vacancy.requires_passport && !files.some(f=>f.key === "passport")) return json({ error:"A passport photograph is required." }, 400);
  for (const q of questions) {
    const value = q.kind === "file" ? files.some(f=>f.key === "question:"+q.id) : String(answers[q.id] || "").trim();
    if (q.required && !value) return json({ error:"Please answer all required questions." }, 400);
    if (typeof value === "string" && value.length > 5000) return json({ error:"An answer is too long." }, 400);
    if (q.kind === "select" && value && (!Array.isArray(q.options) || !q.options.includes(value))) return json({ error:"Select an available answer." }, 400);
  }

  const uploadId = crypto.randomUUID(); const uploaded: string[] = [];
  let cleanup = true;
  try {
    let cv: string | null = null, passport: string | null = null;
    for (const item of files) {
      const path = `guest/${uploadId}/${vacancyId}/${crypto.randomUUID()}.${item.ext}`;
      const result = await db.storage.from("recruitment-applications").upload(path,item.bytes,{contentType:TYPES[item.ext],upsert:false});
      if (result.error) throw new Error("An attachment could not be uploaded. Please try again.");
      uploaded.push(path);
      if (item.key === "cv") cv=path; else if (item.key === "passport") passport=path; else answers[item.key.slice(9)]=path;
    }
    // An interrupted response can hide a successful database commit. In that
    // ambiguous case preserve the files; an operator can reconcile them later.
    cleanup = false;
    const result = await db.rpc("recruitment_submit_guest_application", { p_vacancy:vacancyId, p_upload_id:uploadId, p_submission_id:submissionId, p_application:{full_name:input.full_name,email:input.email,phone:input.phone,consent:true,answers,cv_path:cv,passport_path:passport} });
    if (result.error) {
      if (result.error.code === "P0001" || result.error.code === "23505") {
        cleanup=true;
        return json({ error:"Your application could not be accepted. Please check the position and try again." }, 400);
      }
      return json({ error:"The submission status could not be confirmed. Please contact recruitment before trying again." }, 503);
    }
    if (result.data?.replayed === true) cleanup = true;
    return json(result.data, 200);
  } catch { return json({ error:"An attachment could not be uploaded. Please try again." }, 503); }
  finally { if (cleanup && uploaded.length) { const removed = await db.storage.from("recruitment-applications").remove(uploaded); if (removed.error) console.error("recruitment upload cleanup failed"); } }
}));
