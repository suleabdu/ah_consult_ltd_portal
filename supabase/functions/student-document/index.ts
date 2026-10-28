import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { admin, corsHeaders, json, safe, userFrom } from "../_shared/lib.ts";

const ORANGE = rgb(0.78, 0.24, 0.05);
const INK = rgb(0.10, 0.12, 0.16);
const MUTED = rgb(0.39, 0.42, 0.47);
const LINE = rgb(0.88, 0.89, 0.91);
const PAPER = rgb(0.98, 0.98, 0.98);
const escFile = (v: unknown) => String(v ?? "document").normalize("NFKD").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "document";
// pdf-lib's standard fonts support WinAnsi. Convert unsupported glyphs rather than failing a document request.
const textSafe = (v: unknown) => String(v ?? "-").normalize("NFKD").replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim() || "-";
const money = (v: unknown) => `NGN ${Number(v || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (v: unknown) => v ? new Date(String(v)).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }) : "-";

type Draw = {
  pdf: PDFDocument; page: any; regular: any; bold: any; y: number; width: number; height: number;
  newPage: () => void; ensure: (height: number) => void; wrap: (text: string, size: number, font?: any, maxWidth?: number) => string[];
  write: (text: string, size?: number, opts?: { bold?: boolean; color?: any; x?: number; maxWidth?: number; leading?: number }) => void;
  heading: (text: string) => void; rule: () => void; row: (label: string, value: unknown) => void; paragraph: (text: string, size?: number) => void;
};

function makeDraw(pdf: PDFDocument, regular: any, bold: any, letterhead: any = null, topSafeMm = 85, bottomSafeMm = 20): Draw {
  const width = 595.28, height = 841.89, margin = 52;
  let page = pdf.addPage([width, height]);
  const topSafe = Math.max(25,Math.min(120,topSafeMm))*72/25.4;
  const bottomSafe = Math.max(12,Math.min(60,bottomSafeMm))*72/25.4;
  let y = height - (letterhead ? topSafe : 52);
  const drawLetterhead = (target: any) => { if (letterhead) target.drawImage(letterhead,{x:0,y:0,width,height}); }; 
  drawLetterhead(page);
  const draw: Draw = {
    pdf, page, regular, bold, get y() { return y; }, set y(value: number) { y = value; }, width, height,
    newPage() {
      page = pdf.addPage([width, height]); drawLetterhead(page);y = height - (letterhead ? topSafe : 54);
      if(!letterhead){page.drawText("AH CONSULT LTD", { x: margin, y, size: 10, font: bold, color: ORANGE }); y -= 18;
      page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: LINE }); y -= 24;}
      draw.page = page; draw.y = y;
    },
    ensure(h) { if (y - h < Math.max(58,bottomSafe)) draw.newPage(); },
    wrap(value, size, font = regular, maxWidth = width - margin * 2) {
      const words = textSafe(value).split(" "); const lines: string[] = []; let line = "";
      for (const word of words) { const next = line ? line + " " + word : word; if (font.widthOfTextAtSize(next, size) > maxWidth && line) { lines.push(line); line = word; } else line = next; }
      if (line) lines.push(line); return lines;
    },
    write(value, size = 11, opts = {}) {
      const font = opts.bold ? bold : regular, x = opts.x ?? margin, maxWidth = opts.maxWidth ?? width - margin * 2, leading = opts.leading ?? size * 1.45;
      const lines = draw.wrap(value, size, font, maxWidth); draw.ensure(lines.length * leading + 3);
      for (const line of lines) { page.drawText(line, { x, y, size, font, color: opts.color ?? INK, maxWidth }); y -= leading; }
      draw.y = y;
    },
    heading(value) { draw.ensure(35); page.drawText(textSafe(value).toUpperCase(), { x: margin, y, size: 19, font: bold, color: INK }); y -= 30; draw.y = y; },
    rule() { page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 2.4, color: ORANGE }); y -= 22; draw.y = y; },
    row(label, value) {
      const left = margin + 12, totalW = width - margin * 2 - 24, rightX = left + 142, rightW = totalW - 142;
      const valLines = draw.wrap(textSafe(value), 10.5, regular, rightW); const rh = Math.max(30, valLines.length * 14 + 14); draw.ensure(rh + 2);
      page.drawRectangle({ x: margin, y: y - rh + 6, width: width - margin * 2, height: rh, color: PAPER });
      page.drawText(textSafe(label), { x: left, y: y - 12, size: 9, font: bold, color: MUTED });
      valLines.forEach((line, i) => page.drawText(line, { x: rightX, y: y - 12 - i * 14, size: 10.5, font: regular, color: INK }));
      y -= rh; page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: LINE }); y -= 2; draw.y = y;
    },
    paragraph(value, size = 11) { draw.write(value, size, { leading: size * 1.55 }); y -= 7; draw.y = y; }
  };
  if(!letterhead){page.drawText("AH CONSULT LTD", { x: margin, y, size: 18, font: bold, color: ORANGE });
  y -= 17; page.drawText("ACADEMIC & PROFESSIONAL DEVELOPMENT", { x: margin, y, size: 8, font: bold, color: MUTED });
  y -= 15; draw.rule();}
  return draw;
}

Deno.serve(safe(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  const internal=!!serviceKey && token===serviceKey;
  const user=internal?null:await userFrom(req);
  if (!user && !internal) return json({ error: "Please sign in again." }, 401);
  const body = await req.json().catch(() => ({}));
  const preview=body?.preview===true;
  const realPreview=preview&&typeof body?.application_id==='string'&&/^[0-9a-f-]{36}$/i.test(body.application_id);
  const db=admin();
  if(preview){
    if(!user || internal) return json({error:'Administrator sign-in required for previews.'},403);
    const {data:staff}=await db.from('staff').select('role,status').eq('id',user.id).maybeSingle();
    if(staff?.status!=='approved'||staff?.role!=='administrator') return json({error:'Document preview is administrator-only.'},403);
  }
  const documentId = String(body?.document_id ?? "");
  const requestedKey = String(body?.document_key ?? "");
  if (!preview && (!documentId || !/^[0-9a-f-]{36}$/i.test(documentId))) return json({ error: "A valid document ID is required." }, 400);

  // A document must already have been formally issued by an authorised staff workflow.
  const {data:staffAccess}=!internal&&user?await db.from('staff').select('role,status').eq('id',user.id).maybeSingle():{data:null};
  const staffCanView=staffAccess?.status==='approved'&&['administrator','finance'].includes(staffAccess.role);
  let docQuery=db.from("student_documents").select("id,user_id,application_id,title,document_type,status,document_key,issued_at,metadata,file_url").eq("id", documentId);
  if (!internal&&!staffCanView) docQuery=docQuery.eq("user_id",user!.id);
  const { data: doc, error: docError } = preview
    ? {data:{id:'00000000-0000-4000-8000-000000000000',user_id:user!.id,application_id:realPreview?body.application_id:'00000000-0000-4000-8000-000000000001',title:'SAMPLE DOCUMENT',document_type:requestedKey,status:'available',document_key:requestedKey,issued_at:null,metadata:{},file_url:null},error:null}
    : await docQuery.maybeSingle();
  if (docError || !doc) return json({ error: "Document not found for this account." }, 404);
  // Financial staff can retrieve receipts, not unrelated academic or personal files.
  if(!preview&&!internal&&doc.user_id!==user!.id&&(!staffCanView||
    (staffAccess?.role==='finance'&&doc.document_type!=='payment_receipt')))
    return json({error:'Document access denied'},403);
  const isQueuedReceipt=doc.document_type==="payment_receipt" && /^payment_receipt:[0-9a-f-]{36}$/i.test(String(doc.document_key||""));
  if (doc.status !== "available" && !(isQueuedReceipt&&doc.status==="pending")) return json({ error: "This document has not been issued for download yet." }, 409);
  // The authoritative type must come from the server-issued record, never from the request body.
  const key = isQueuedReceipt ? "payment_receipt" : String(doc.document_key || "");
  if (!key) return json({ error: "This issued document has no document type. Please contact the office to correct the record." }, 409);
  if (requestedKey && requestedKey !== key) return json({ error: "The requested document does not match the issued document." }, 400);
  if (!doc.application_id && !doc.metadata?.pdf_path) return json({ error: "This document is not linked to an application record." }, 409);

  const allowed = new Set(["admission_letter", "payment_receipt", "academic_transcript", "result_statement", "deferment_letter", "certificate"]);
  if (!allowed.has(key)) return json({ error: "This document type cannot be downloaded here." }, 400);

  // Previously issued bytes are the legal record, even when application data is
  // later detached under the institution's retention/erasure policy.
  const savedPath=doc.metadata?.pdf_path;
  const savedFilename=`AHCT-${escFile(key)}-${escFile(doc.metadata?.payment_reference||doc.id)}.pdf`;
  const readArchived=async ():Promise<Response|null>=>{
   if(!savedPath)return null;
   {
    const {data:saved,error:savedError}=await db.storage.from('issued-documents').download(savedPath);
    if(savedError||!saved)return json({error:'Archived official PDF unavailable. Contact the records office.'},503);
    const bin=await saved.arrayBuffer();
    const hashBytes=new Uint8Array(await crypto.subtle.digest('SHA-256',bin));
    const actual=[...hashBytes].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(!doc.metadata?.sha256 || doc.metadata.sha256!==actual)return json({error:'The archived document integrity check failed. Contact the records office.'},409);
    return new Response(bin,{headers:{...corsHeaders(req),'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${savedFilename}"`,'Cache-Control':'private, no-store','X-Document-SHA256':actual,'X-Content-Type-Options':'nosniff'}});
  }
  };
  if(!doc.application_id){
    if(key!=="payment_receipt")return json({error:'Only archived financial documents may be retained without an application.'},409);
    return (await readArchived())||json({error:'This historic receipt has no archived PDF; contact the records office.'},409);
  }
  const { data: app, error: appError } = preview&&!realPreview
    ? {data:{id:doc.application_id,user_id:doc.user_id,status:'approved',admission_decision:'approved',admission_note:'',student_id:'SAMPLE-001',total_ngn:150000,package_code:'',form_data:{firstName:'Amina',surname:'Example'},passport_path:null,intake_id:null,paid_at:new Date().toISOString(),submitted_at:new Date().toISOString(),created_at:new Date().toISOString()},error:null}
    : await (realPreview ? db.from("applications").select("id,user_id,status,admission_decision,admission_note,student_id,total_ngn,package_code,form_data,passport_path,intake_id,paid_at,submitted_at,created_at").eq("id",doc.application_id) : db.from("applications").select("id,user_id,status,admission_decision,admission_note,student_id,total_ngn,package_code,form_data,passport_path,intake_id,paid_at,submitted_at,created_at").eq("id", doc.application_id).eq("user_id", doc.user_id)).maybeSingle();
  if (appError || !app) return json({ error: "Application not found for this account." }, 404);
  if (key === "admission_letter" && app.admission_decision !== "approved") return json({ error: "An admission letter is available only after admission has been approved." }, 403);

  // Academic records are accessible only after the recorded, irreversible transition.
  if (!preview && ["academic_transcript","result_statement","deferment_letter","certificate"].includes(key)) {
    const {data:entered,error:enteredError}=await db.from('student_portal_transitions').select('application_id').eq('user_id',doc.user_id).eq('application_id',app.id).maybeSingle();
    if(enteredError||!entered)return json({error:'This document is accessible only after entering the Student Portal'},403);
  }
  if(savedPath)return (await readArchived())!;
  const [{ data: profile }, { data: intake }, { data: appCourses }] = preview&&!realPreview
    ? [{data:{full_name:'Amina Example',email:'sample@example.invalid',phone:''}},{data:{label:'2026 Professional Development Intake'}},{data:[{course_code:'SAMPLE101',deferred:false}]}]
    : await Promise.all([
      db.from("profiles").select("full_name,email,phone").eq("id", app.user_id).maybeSingle(),
      db.from("intakes").select("label").eq("id", app.intake_id).maybeSingle(),
      db.from("application_courses").select("course_code,fee_ngn,deferred").eq("application_id", app.id)
    ]);
  const codes = (appCourses || []).map((c: any) => c.course_code).filter(Boolean);
  const { data: courses } = preview&&!realPreview ? {data:[{code:'SAMPLE101',name:'Sample Professional Course',category:'Professional'}]} : codes.length ? await db.from("courses").select("code,name,category").in("code", codes) : { data: [] };
  const courseByCode = new Map<string, any>((courses || []).map((c: any) => [String(c.code), c] as [string, any]));
  const selectedCourses = (appCourses || []).map((c: any) => ({ ...c, ...(courseByCode.get(String(c.course_code)) || {}) }));
  const { data: storedTemplate } = await db.from("document_templates").select("version,letterhead,body_text,signatory_name,signatory_title,footer_text").eq("key",key).maybeSingle();
  const drafts=preview&&body.template&&typeof body.template==='object'?body.template:{};
  const template=preview?{
    ...storedTemplate,
    body_text:String(drafts.body_text??storedTemplate?.body_text??'').slice(0,6000),
    signatory_name:String(drafts.signatory_name??storedTemplate?.signatory_name??'').slice(0,150),
    signatory_title:String(drafts.signatory_title??storedTemplate?.signatory_title??'').slice(0,150),
    footer_text:String(drafts.footer_text??storedTemplate?.footer_text??'').slice(0,500)
  }:storedTemplate;
  const form = app.form_data || {};
  const name = textSafe(profile?.full_name || [form.firstName, form.otherNames, form.surname].filter(Boolean).join(" ") || user?.email || "Student");
  const studentId = textSafe(app.student_id || (key==='payment_receipt'?'Application '+String(app.id).slice(0,8).toUpperCase():'Pending assignment'));
  const intakeLabel = textSafe(intake?.label || "Training intake");
  const program = textSafe(selectedCourses.filter((c: any) => !c.deferred).map((c: any) => c.name).filter(Boolean).join(", ") || (app.package_code ? "Full Package" : "Training programme"));

  let payments: any[] = [];
  let results: any[] = [];
  if (key === "payment_receipt") {
    let receiptPayments=db.from("payments").select("id,reference,expected_ngn,paid_ngn,paid_at,verified_at,provider,source").eq("application_id", app.id).not("verified_at", "is", null);
    if(isQueuedReceipt)receiptPayments=receiptPayments.eq("id",doc.metadata?.payment_id||"");
    const { data, error } = preview&&!realPreview ? {data:[{id:'sample-payment',reference:'SAMPLE-PAYMENT-NOT-VALID',expected_ngn:150000,paid_ngn:150000,paid_at:new Date().toISOString(),verified_at:new Date().toISOString(),provider:'Sample provider'}],error:null} : await receiptPayments.order("verified_at", { ascending: false });
    if (error) return json({ error: "Payment verification could not be checked. Please try again." }, 503);
    payments = (data || []).filter((p: any) => Number(p.expected_ngn) > 0 && Number(p.paid_ngn) >= Number(p.expected_ngn));
    if (!payments.length) return json({ error: "A receipt is available only after a payment has been verified for the full amount." }, 403);
  }
  if (key === "academic_transcript" || key === "result_statement") {
    const { data, error } = preview&&!realPreview ? {data:[{course_code:'SAMPLE101',attendance:30,ca:25,exams:35,total:90,band:'A',published_at:new Date().toISOString()}],error:null} : await db.from("exam_results").select("course_code,attendance,ca,exams,total,band,published_at").eq("application_id", app.id).not("published_at", "is", null).neq("grading_model", "needs_review").order("course_code");
    if (error) return json({ error: "Published results could not be checked. Please try again." }, 503);
    results = data || [];
    if (!results.length) return json({ error: "A transcript is available only after results have been published." }, 403);
  }
  if ((!preview||realPreview) && key === "deferment_letter") { const { data: approved } = await db.from("deferments").select("reason,status").eq("application_id",app.id).eq("status","approved").limit(1); if (!approved?.length) return json({error:"No approved deferment exists."},403); }
  if (realPreview && key === "certificate") return json({error:"Certificate previews require a verified completion record."},409);
  if (!preview && key === "certificate" && !(doc.document_key === "certificate" && doc.status === "available")) return json({ error: "A certificate must be formally issued before download." }, 403);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${doc.title || key} - AH Consult Ltd`);
  pdf.setAuthor("AH Consult Ltd");
  pdf.setSubject(`Official student document for ${studentId}`);
  pdf.setCreator("AH Student Hub");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let image = null;
  const {data:branding}=await db.from('institution_document_branding').select('file_path,image_mime,revision,top_safe_mm,bottom_safe_mm').eq('id',true).maybeSingle();
  if(key==='payment_receipt' && !branding?.file_path) return json({error:'Official receipt is awaiting an approved company letterhead. Ask the administrator to publish one.'},503);
  if(branding?.file_path){
    const {data:asset,error:assetError}=await db.storage.from('institution-letterheads').download(branding.file_path);
    if(assetError||!asset)return json({error:'Official letterhead image could not be read; please contact the administrator'},503);
    const raw=await asset.arrayBuffer();
    try{image=branding.image_mime==='image/png'?await pdf.embedPng(raw):await pdf.embedJpg(raw)}catch(e){return json({error:'The uploaded letterhead cannot be processed; please replace it in Document designer'},503)}
  }
  const d = makeDraw(pdf, regular, bold, image, Number(branding?.top_safe_mm||85),Number(branding?.bottom_safe_mm||20));
  const reference = `AHCT-${key.toUpperCase().replace(/[^A-Z0-9]/g, "-")}-${String(doc.id).slice(0, 8).toUpperCase()}`;
  const issuedDate = date(doc.issued_at || new Date().toISOString());
  // Only these documented, server-owned data fields may be interpolated in the
  // published wording. No evaluated JavaScript/HTML/user-supplied expressions.
  const templateFields:Record<string,string>={
    student_name:name,student_id:studentId,intake:intakeLabel,programme:program,
    payment_reference:payments[0]?.reference?textSafe(payments[0].reference):'Not applicable',
    payment_amount:payments[0]?money(payments[0].paid_ngn):'Not applicable',
    issue_date:issuedDate,document_reference:reference
  };
  const interpolate=(value:unknown)=>String(value||'').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi,(_match,field:string)=>templateFields[field.toLowerCase()]??'[Unknown data field]');
  // Printed UUID allows independent verification of downloaded bytes without revealing student PII.
  d.write(`Document ID: ${doc.id}`, 8, { color: MUTED });

  if (key === "admission_letter") {
    d.heading("Admission Letter");
    d.write(`Document reference: ${reference}`, 9, { color: MUTED });
    d.write(`Date: ${issuedDate}`, 9, { color: MUTED });
    d.y -= 12;
    d.paragraph(`Dear ${name},`);
    d.paragraph("We are pleased to confirm that your application for admission to AH Consult Ltd has been approved. Please retain this letter as part of your official training records.");
    d.write("ADMISSION DETAILS", 10, { bold: true, color: ORANGE }); d.y -= 7;
    d.row("Student name", name); d.row("Student ID", studentId); d.row("Training intake", intakeLabel); d.row("Programme / courses", program); d.row("Admission status", "Approved");
    d.y -= 16; d.paragraph("Please follow the instructions provided by the training office regarding orientation, class schedules and any outstanding enrolment requirements.");
    d.y -= 14; d.write(textSafe(template?.signatory_name || "Admissions Office"), 11, { bold: true }); d.write(textSafe(template?.signatory_title || "AH Consult Ltd"), 10, { color: MUTED });
  } else if (key === "deferment_letter") {
    d.heading("Deferment Letter");
    d.write(`Reference: ${reference}`, 9, { color: MUTED }); d.write(`Issued: ${issuedDate}`, 9, { color: MUTED });
    d.row("Applicant", name); d.row("Reference", studentId); d.row("Training intake", intakeLabel);
    d.paragraph(interpolate(template?.body_text) || "The training office confirms approval of the student's deferment request.");
    d.y -= 12;d.write(textSafe(template?.signatory_name || "Training Office"), 11, { bold:true });
  } else if (key === "payment_receipt") {
    const payment = payments[0];
    d.heading("Official Payment Receipt");
    d.write(`Receipt reference: ${reference}`, 9, { color: MUTED }); d.write(`Issued: ${issuedDate}`, 9, { color: MUTED }); d.y -= 12;
    d.paragraph("This receipt confirms a payment recorded and verified by AH Consult Ltd.");
    d.write("PAYMENT DETAILS", 10, { bold: true, color: ORANGE }); d.y -= 7;
    d.row("Payer / applicant", name); d.row("Student / application ID", studentId); d.row("Payment reference", payment.reference || app.pay_reference || reference); d.row("Amount received", money(payment.paid_ngn)); d.row("Expected amount", money(payment.expected_ngn)); d.row("Payment date", date(payment.paid_at || payment.verified_at)); d.row("Provider", payment.provider || payment.source || "Verified payment"); d.row("Intake", intakeLabel); d.row("Purpose", program);
    d.y -= 14; d.paragraph("Keep this receipt for your records. If you believe any detail is incorrect, contact the AH Consult finance office and quote the receipt reference shown above.");
  } else if (key === "academic_transcript" || key === "result_statement") {
    d.heading(key === "result_statement" ? "Academic Result Statement" : "Academic Transcript"); d.write(`Document reference: ${reference}`, 9, { color: MUTED }); d.write(`Issued: ${issuedDate}`, 9, { color: MUTED }); d.y -= 12;
    d.row("Student name", name); d.row("Student ID", studentId); d.row("Training intake", intakeLabel); d.row("Programme", program);
    d.y -= 14; d.write("PUBLISHED COURSE RESULTS", 10, { bold: true, color: ORANGE }); d.y -= 10;
    for (const r of results) {
      const course: any = courseByCode.get(r.course_code);
      d.row(`${textSafe(course?.name || r.course_code)} (${textSafe(course?.category || "Course")})`, `Attendance ${r.attendance ?? "-"} | CA ${r.ca ?? "-"} | Exam ${r.exams ?? "-"} | Total ${r.total ?? "-"} | Grade ${textSafe(r.band || "-")}`);
    }
    d.y -= 10; d.paragraph("This transcript includes results published in the student system at the time of issue.");
  } else if (key === "certificate") {
    d.y = 640; d.page.drawRectangle({ x: 36, y: 120, width: d.width - 72, height: 560, borderColor: ORANGE, borderWidth: 2, color: rgb(1, 1, 1) });
    d.page.drawText("AH CONSULT LTD", { x: 90, y: 625, size: 20, font: bold, color: ORANGE });
    d.page.drawText("CERTIFICATE OF COMPLETION", { x: 90, y: 574, size: 19, font: bold, color: INK });
    d.page.drawLine({ start: { x: 90, y: 552 }, end: { x: d.width - 90, y: 552 }, thickness: 2, color: ORANGE });
    d.page.drawText("This is to certify that", { x: 90, y: 507, size: 12, font: regular, color: MUTED });
    d.page.drawText(textSafe(name).slice(0, 55), { x: 90, y: 460, size: 22, font: bold, color: INK });
    d.page.drawText("has completed the approved training programme at AH Consult Ltd.", { x: 90, y: 425, size: 10.5, font: regular, color: INK, maxWidth: d.width - 180 });
    d.page.drawText(`Student ID: ${studentId}`, { x: 90, y: 385, size: 11, font: bold, color: INK });
    d.page.drawText(`Intake: ${intakeLabel}`, { x: 90, y: 362, size: 11, font: regular, color: INK });
    d.page.drawText(`Reference: ${reference}`, { x: 90, y: 325, size: 9, font: regular, color: MUTED });
    d.page.drawText(`Issued ${issuedDate}`, { x: 90, y: 285, size: 9, font: regular, color: MUTED });
    d.page.drawText("Authorised by AH Consult Ltd", { x: 90, y: 230, size: 10, font: bold, color: INK });
  }

  if (template?.body_text && key !== "deferment_letter") { d.y -= 12; d.paragraph(interpolate(template.body_text)); }
  if (template?.signatory_name && key !== "admission_letter" && key !== "deferment_letter") { d.y -= 12; d.write(textSafe(template.signatory_name + " | " + (template.signatory_title||"")), 10, { bold:true }); }
  if (template?.footer_text) { d.y -= 13; d.write(interpolate(template.footer_text), 9, { color:MUTED }); }
  if(preview){
    for(const page of pdf.getPages()){
      const {width}=page.getSize();
      page.drawText('SAMPLE PREVIEW - NOT VALID FOR OFFICIAL USE', {x:50,y:38,size:10,font:bold,color:ORANGE,maxWidth:width-100});
    }
    const bytes=await pdf.save();
    return new Response(bytes,{headers:{...corsHeaders(req),'Content-Type':'application/pdf','Content-Disposition':'inline; filename="AHCT-sample-preview.pdf"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  // Audit only after the official PDF is stored and its registry is reconciled.
  // Sample preview never writes a document issuance event.
  const auditOfficial=async (kind:'receipt_pdf_issued'|'document_pdf_issued')=>{
    try {await db.from('audit_log').insert({actor:internal?null:user!.id,actor_name:internal?'Receipt issue worker':profile?.full_name||user?.email||'Student',action:kind,target:studentId,note:`${key} | ${reference} | ${doc.id}`});}
    catch(e){console.warn('Official issuance audit could not be written:',e);}
  };
  const bytes = await pdf.save();
  // Cache the exact issued bytes in PRIVATE storage; do not regenerate on every download.
  const h=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const fingerprint=[...h].map(x=>x.toString(16).padStart(2,'0')).join('');
  const storagePath=`${doc.user_id}/${doc.id}.pdf`;
  const {error:storeError}=await db.storage.from('issued-documents').upload(storagePath,bytes,{contentType:'application/pdf',upsert:false});
  if(storeError){
    // Concurrent first downloads may both produce bytes; use the winner's archived file.
    const {data:winner,error:winnerError}=await db.storage.from('issued-documents').download(storagePath);
    if(winnerError||!winner)return json({error:'Official document archiving failed. Please retry later.'},503);
    const archived=await winner.arrayBuffer();const hashBytes=new Uint8Array(await crypto.subtle.digest('SHA-256',archived));
    const hash=[...hashBytes].map(x=>x.toString(16).padStart(2,'0')).join('');
    const metadata={...(doc.metadata||{}),pdf_path:storagePath,sha256:hash,archived_at:new Date().toISOString(),template_version:template?.version||null,branding_revision:branding?.revision||null};
    const {error:registryError}=await db.from('student_documents').update({metadata,status:'available',issued_at:doc.issued_at||new Date().toISOString()}).eq('id',doc.id).eq('user_id',doc.user_id);
    if(registryError)return json({error:'Archived PDF found but registry reconciliation failed. Contact records office.'},503);
    await auditOfficial(internal?'receipt_pdf_issued':'document_pdf_issued');
    return new Response(archived,{headers:{...corsHeaders(req),'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="AHCT-${escFile(key)}-${escFile(app.student_id||app.id)}.pdf"`,'Cache-Control':'private, no-store','X-Document-SHA256':hash}});
  }
  const metadata={...(doc.metadata||{}),pdf_path:storagePath,sha256:fingerprint,archived_at:new Date().toISOString(),template_version:template?.version||null,template_snapshot:{body_text:template?.body_text||'',signatory_name:template?.signatory_name||'',signatory_title:template?.signatory_title||'',footer_text:template?.footer_text||''},branding_revision:branding?.revision||null,branding_path:branding?.file_path||null};
  const {error:markError}=await db.from('student_documents').update({metadata,status:'available',issued_at:doc.issued_at||new Date().toISOString()}).eq('id',doc.id).eq('user_id',doc.user_id).in('status',['pending','available']);
  if(markError){console.error('PDF stored but metadata update failed',doc.id,markError.message);return json({error:'Official PDF saved but issuance registry update failed; contact administrator before retrying'},503)}
  await auditOfficial(internal?'receipt_pdf_issued':'document_pdf_issued');
  const filename = `AHCT-${escFile(key)}-${escFile(app.student_id || String(app.id).slice(0, 8))}.pdf`;
  return new Response(bytes, { status: 200, headers: { ...corsHeaders(req), "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "X-Document-SHA256": fingerprint } });
}));
