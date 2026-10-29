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
const stripDocumentSubject = (value: unknown): string => String(value ?? "")
  .split(/\r?\n/)
  .filter(line => !/^\s*subject\s*[:：-]\s*\S/i.test(line))
  .join("\n").replace(/^\s*\n+/, "").trim();

type Draw = {
  pdf: PDFDocument; page: any; regular: any; bold: any; y: number; width: number; height: number;
  newPage: () => void; ensure: (height: number) => void; wrap: (text: string, size: number, font?: any, maxWidth?: number) => string[];
  write: (text: string, size?: number, opts?: { bold?: boolean; color?: any; x?: number; maxWidth?: number; leading?: number; align?: "left" | "center" | "right" }) => void;
  heading: (text: string) => void; rule: () => void;
  row: (label: string, value: unknown, compact?: boolean) => void; paragraph: (text: string, size?: number) => void;
  footer: (name: string, id: string, website: string, custom?: string) => void;
};

type InstitutionIdentity = {
  organisation_name: string; organisation_tagline: string; postal_address: string;
  phone: string; email: string; website: string; header_alignment: "left" | "center";
  revision: number; logo_path?: string | null; logo_mime?: string | null;
};
function makeDraw(pdf: PDFDocument, regular: any, bold: any, identity: InstitutionIdentity, logo: any = null): Draw {
  const width = 595.28, height = 841.89, margin = 52;
  const contentWidth = width - margin * 2;
  const bottomSafe = 3 * 72 / 25.4; // physical edge only; footer remains above the print-safe zone
  const footerBaseline = Math.max(20, bottomSafe + 12);
  const contentFloor = footerBaseline + 69;
  let page = pdf.addPage([width, height]);
  let y = height - 150;

  // The masthead is vector text, a small optional logo, and a rule — never an A4 background image.
  // It is drawn on EVERY page. No user-set letterhead margin is required.
  const drawMasthead = (target: any): number => {
    const centered = identity.header_alignment === "center";
    const top = height - 42;
    const company = textSafe(identity.organisation_name).slice(0, 105);
    const tagline = textSafe(identity.organisation_tagline || "Academic & Professional Development").slice(0, 130);
    const address = textSafe(identity.postal_address || "").replace(/^-$ /,'').slice(0, 170);
    const contact = [identity.phone,identity.email].filter((v)=>String(v||'').trim()).map(textSafe).join('  |  ').slice(0, 140);
    const logoSize = 42;
    const drawLogo = (x: number, y0: number) => {
      if (logo) {
        const ratio = Math.min(logoSize / logo.width, logoSize / logo.height);
        const w=logo.width*ratio,h=logo.height*ratio;
        target.drawImage(logo,{x:x+(logoSize-w)/2,y:y0+(logoSize-h)/2,width:w,height:h});
      } else {
        target.drawRectangle({x,y:y0,width:logoSize,height:logoSize,color:ORANGE});
        target.drawText("AH",{x:x+10,y:y0+12,size:16,font:bold,color:rgb(1,1,1)});
      }
    };
    // Wrap official addresses instead of silently cropping them. The native header
    // grows to fit; content starts below the resulting rule on each page.
    const intoLines = (value:string,size:number,font:any,maxWidth:number): string[] => {
      if(!value||value==='-')return [];
      const lines:string[]=[];let line='';
      for(const raw of value.split(/\s+/).filter(Boolean)){
        let rest=raw;
        while(rest){
          let word=rest,cut=word.length;
          while(cut>1&&font.widthOfTextAtSize(word.slice(0,cut),size)>maxWidth)cut--;
          word=rest.slice(0,cut);rest=rest.slice(cut);
          const candidate=line?`${line} ${word}`:word;
          if(line&&font.widthOfTextAtSize(candidate,size)>maxWidth){lines.push(line);line=word;}
          else line=candidate;
          if(rest&&line){lines.push(line);line='';}
        }
      }
      if(line)lines.push(line);
      return lines;
    };
    const drawGroup = (value:string,baseline:number,size:number,font:any,color:any,x:number,available:number,center:boolean,leading:number):number => {
      const lines=intoLines(value,size,font,available);
      for(const line of lines){
        const xx=center?x+(available-font.widthOfTextAtSize(line,size))/2:x;
        target.drawText(line,{x:xx,y:baseline,size,font,color});baseline-=leading;
      }
      return baseline;
    };
    if(centered){
      drawLogo((width-logoSize)/2,top-42);
      let cursor=top-62;
      cursor=drawGroup(company,cursor,15,bold,INK,margin,contentWidth,true,18);
      cursor=drawGroup(tagline,cursor,8,regular,ORANGE,margin,contentWidth,true,12);
      cursor=drawGroup(address,cursor,8,regular,MUTED,margin,contentWidth,true,11);
      cursor=drawGroup(contact,cursor,7.5,regular,MUTED,margin,contentWidth,true,11);
      const ruleY=Math.min(top-113,cursor-6);
      target.drawLine({start:{x:margin,y:ruleY},end:{x:width-margin,y:ruleY},thickness:1.7,color:ORANGE});
      return ruleY-20;
    }
    drawLogo(margin,top-42);
    const x=margin+56,available=contentWidth-56;
    let cursor=top-8;
    cursor=drawGroup(company,cursor,16,bold,INK,x,available,false,18);
    cursor=drawGroup(tagline,cursor,8.5,regular,ORANGE,x,available,false,12);
    cursor=drawGroup(address,cursor,8,regular,MUTED,x,available,false,11);
    cursor=drawGroup(contact,cursor,7.5,regular,MUTED,x,available,false,10);
    const ruleY=Math.min(top-68,cursor-7);
    target.drawLine({start:{x:margin,y:ruleY},end:{x:width-margin,y:ruleY},thickness:1.7,color:ORANGE});
    return ruleY-23;
  };
  y = drawMasthead(page);

  // Standard PDF fonts do not wrap by themselves. Split long tokens so applicant
  // names / references cannot escape the printable column.
  const wrap = (value: string, size: number, font: any = regular, maxWidth = contentWidth): string[] => {
    const lines: string[] = [];
    let line = "";
    for (const original of textSafe(value).split(/\s+/)) {
      let pending = original;
      while (pending) {
        let word = pending;
        if (font.widthOfTextAtSize(word, size) > maxWidth) {
          let cut = 1;
          while (cut < pending.length && font.widthOfTextAtSize(pending.slice(0, cut + 1), size) <= maxWidth) cut++;
          word = pending.slice(0, cut);
        }
        const candidate = line ? `${line} ${word}` : word;
        if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          lines.push(line);
          line = word;
        } else line = candidate;
        pending = pending.slice(word.length);
        if (pending && line) { lines.push(line); line = ""; }
      }
    }
    if (line) lines.push(line);
    return lines;
  };
  const rightText = (target: any, value: string, baseline: number, size: number, font: any = regular, color: any = MUTED) => {
    const safe = wrap(textSafe(value), size, font, contentWidth)[0] || "-";
    const x = width - margin - font.widthOfTextAtSize(safe, size);
    target.drawText(safe, { x, y: baseline, size, font, color });
  };
  const draw: Draw = {
    pdf, page, regular, bold, get y() { return y; }, set y(value: number) { y = value; }, width, height,
    newPage() {
      page = pdf.addPage([width, height]);
      y = drawMasthead(page);
      draw.page = page; draw.y = y;
    },
    ensure(h) { if (y - h < contentFloor) draw.newPage(); },
    wrap,
    write(value, size = 11, opts = {}) {
      const font = opts.bold ? bold : regular;
      const x = opts.x ?? margin, maxWidth = opts.maxWidth ?? contentWidth;
      const leading = opts.leading ?? size * 1.45;
      const lines = draw.wrap(value, size, font, maxWidth);
      for (const line of lines) {
        draw.ensure(leading + 2);
        const lineWidth = font.widthOfTextAtSize(line, size);
        const lineX = opts.align === "center" ? (width - lineWidth) / 2
          : opts.align === "right" ? width - margin - lineWidth : x;
        page.drawText(line, { x: lineX, y, size, font, color: opts.color ?? INK });
        y -= leading;
      }
      draw.y = y;
    },
    heading(value) {
      y -= 2;
      draw.write(textSafe(value).toUpperCase(), 18, { bold: true, align: "center", leading: 24 });
      y -= 9; draw.y = y;
    },
    rule() { draw.ensure(24); page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 2.4, color: ORANGE }); y -= 22; draw.y = y; },
    row(label, value, compact = false) {
      // Receipts have a one-page A4 requirement. Their verified payment rows
      // use reduced vertical padding to fit beneath a tall company masthead;
      // academic transcripts retain the more spacious table style.
      const left = margin + 12, totalW = contentWidth - 24, rightX = left + 142, rightW = totalW - 142;
      const labelSize = compact ? 8.25 : 9, valueSize = compact ? 9.25 : 10.5;
      const lineHeight = compact ? 10 : 14, inset = compact ? 8 : 12;
      const labelLines = draw.wrap(textSafe(label), labelSize, bold, 130);
      const valLines = draw.wrap(textSafe(value), valueSize, regular, rightW);
      const rh = compact ? Math.max(20, Math.max(labelLines.length, valLines.length) * lineHeight + 8)
        : Math.max(30, Math.max(labelLines.length, valLines.length) * 14 + 14);
      draw.ensure(rh + 2);
      page.drawRectangle({ x: margin, y: y - rh + 6, width: contentWidth, height: rh, color: PAPER });
      labelLines.forEach((line, i) => page.drawText(line, { x: left, y: y - inset - i * lineHeight, size: labelSize, font: bold, color: MUTED }));
      valLines.forEach((line, i) => page.drawText(line, { x: rightX, y: y - inset - i * lineHeight, size: valueSize, font: regular, color: INK }));
      y -= rh; page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: LINE }); y -= 2; draw.y = y;
    },
    paragraph(value, size = 11) {
      const leading = size * 1.55;
      // Preserve editor-authored paragraph boundaries, rather than flattening
      // line breaks into one block. Only intermediate lines are justified.
      const paragraphs = String(value ?? "").split(/\r?\n+/).filter(s => s.trim());
      for (const part of paragraphs) {
        const lines = draw.wrap(part, size, regular, contentWidth);
        for (let i = 0; i < lines.length; i++) {
          draw.ensure(leading + 2);
          const line = lines[i], words = line.split(" ");
          const natural = regular.widthOfTextAtSize(line, size);
          const gap = words.length > 1 ? (contentWidth - natural) / (words.length - 1) : 0;
          // Avoid very wide rivers on short/near-final lines.
          const justify = i < lines.length - 1 && words.length >= 4 && gap >= 0 && gap <= size * 0.85;
          if (justify) {
            let wordX = margin;
            for (const word of words) {
              page.drawText(word, { x: wordX, y, size, font: regular, color: INK });
              wordX += regular.widthOfTextAtSize(word, size) + regular.widthOfTextAtSize(" ", size) + gap;
            }
          } else page.drawText(line, { x: margin, y, size, font: regular, color: INK });
          y -= leading;
        }
        y -= 7;
      }
      draw.y = y;
    },
    footer(name, id, website, custom = "") {
      // Native footer is drawn on every page; no uploaded stationery or background overlays.
      const footId = textSafe(id);
      const docName = textSafe(name);
      const web = textSafe(website);
      for (const target of pdf.getPages()) {
        const ruleY = footerBaseline + 55;
        target.drawLine({ start: { x: margin, y: ruleY }, end: { x: width - margin, y: ruleY }, thickness: 0.5, color: LINE });
        if (custom.trim()) {
          const lines = draw.wrap(custom, 7.5, regular, contentWidth);
          // Two restrained lines for the administrator-authored contact text.
          for (const [i, line] of lines.slice(0, 2).entries()) {
            const last = i === 1 && lines.length > 2;
            const fitted = last ? `${line.slice(0, Math.max(0, line.length - 4))} ...` : line;
            rightText(target, fitted, footerBaseline + 43 - i * 10, 7.5);
          }
        }
        rightText(target, web, footerBaseline + 20, 8);
        rightText(target, `${docName}  |  Document ID: ${footId}`, footerBaseline + 9, 7.5);
      }
    }
  };
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
  const currentStyle=body?.current_style===true && !preview && !!savedPath;
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
  if(savedPath && !currentStyle)return (await readArchived())!;
  let restyleIdentityRevision=0;
  if(currentStyle){
    // First authenticate the immutable ORIGINAL; never restyle a corrupt or missing archive.
    const original=await readArchived();if(!original||original.status!==200)return original!;
    const {data:published,error:publishedError}=await db.from('institution_document_identity')
      .select('revision').eq('id',true).maybeSingle();
    if(publishedError||!published)return json({error:'Published identity unavailable.'},503);
    restyleIdentityRevision=Number(published.revision);
    if(restyleIdentityRevision===Number(doc.metadata?.identity_revision))return original;
    // A style-only copy must retain the approved template wording, not silently
    // substitute a later document template revision on a historic document.
    if(!doc.metadata?.template_snapshot)
      return json({error:'Historic document has no frozen template snapshot. Print the archived original or request a formally authorized reissue.'},409);
    // Certificates require formal registrar-approved reissuance, not an automatic new award.
    if(key==='certificate')return original;
    const {data:copy,error:copyError}=await db.from('document_style_reprints')
      .select('pdf_path,sha256,original_sha256').eq('document_id',doc.id)
      .eq('identity_revision',restyleIdentityRevision).maybeSingle();
    if(copyError)return json({error:'Updated-style PDF registry unavailable. Apply migration 041.'},503);
    if(copy){
      if(copy.original_sha256!==doc.metadata?.sha256)return json({error:'Original document fingerprint changed; contact records office.'},409);
      const {data:blob,error:blobError}=await db.storage.from('issued-documents').download(copy.pdf_path);
      if(blobError||!blob)return json({error:'Updated-style archived copy is unavailable.'},503);
      const bytes=await blob.arrayBuffer();
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
      if(hash!==copy.sha256)return json({error:'Updated-style copy failed its integrity check.'},409);
      return new Response(bytes,{headers:{...corsHeaders(req),'Content-Type':'application/pdf',
        'Content-Disposition':`attachment; filename="AHCT-updated-style-${escFile(key)}.pdf"`,
        'Cache-Control':'private,no-store','X-Document-SHA256':hash,'X-Identity-Revision':String(restyleIdentityRevision)}});
    }
  }
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
  // All portals use the same approved template at first issuance. Never silently
  // fall back to hard-coded wording if a published template is unavailable.
  const { data: storedTemplate, error: publishedTemplateError } = await db.from("document_templates")
    .select("version,letterhead,body_text,signatory_name,signatory_title,footer_text")
    .eq("key",key).eq("active",true).maybeSingle();
  if (publishedTemplateError || !storedTemplate) return json({error:"No active published template is available for this document type. Contact the administrator."},503);
  const drafts=preview&&body.template&&typeof body.template==='object'?body.template:{};
  const template=preview?{
    ...storedTemplate,
    body_text:String(drafts.body_text??storedTemplate?.body_text??'').slice(0,6000),
    signatory_name:String(drafts.signatory_name??storedTemplate?.signatory_name??'').slice(0,150),
    signatory_title:String(drafts.signatory_title??storedTemplate?.signatory_title??'').slice(0,150),
    footer_text:String(drafts.footer_text??storedTemplate?.footer_text??'').slice(0,500)
  }:(currentStyle&&doc.metadata?.template_snapshot ? {
      ...storedTemplate,...doc.metadata.template_snapshot
    }:storedTemplate);
  const form = app.form_data || {};
  const name = textSafe(profile?.full_name || [form.firstName, form.otherNames, form.surname].filter(Boolean).join(" ") || user?.email || "Student");
  const studentId = textSafe(app.student_id || (key==='payment_receipt'?'Application '+String(app.id).slice(0,8).toUpperCase():'Pending assignment'));
  const intakeLabel = textSafe(intake?.label || "Training intake");
  const program = textSafe(selectedCourses.filter((c: any) => !c.deferred).map((c: any) => c.name).filter(Boolean).join(", ") || (app.package_code ? "Full Package" : "Training programme"));

  let payments: any[] = [];
  let results: any[] = [];
  if (key === "payment_receipt") {
    let receiptPayments=db.from("payments").select("id,reference,expected_ngn,paid_ngn,paid_at,verified_at,provider,source,provider_transaction_id,raw_event").eq("application_id", app.id).not("verified_at", "is", null);
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
  if(!preview && (key==='academic_transcript'||key==='result_statement')){
    const {data:review,error:reviewError}=await db.from('document_issuance_reviews')
      .select('academic_review_by,registrar_approval_by,registrar_approval_at')
      .eq('application_id',app.id).eq('document_key',key).maybeSingle();
    if(reviewError||!review?.academic_review_by||!review?.registrar_approval_at||!review?.registrar_approval_by)
      return json({error:'Academic review and independent registrar approval are required before first issuance.'},403);
    const required=new Set((appCourses||[]).filter((c:any)=>!c.deferred).map((c:any)=>String(c.course_code)));
    const published=new Set(results.map((r:any)=>String(r.course_code)));
    if(key==='academic_transcript' && (!required.size||[...required].some(code=>!published.has(code))))
      return json({error:'Final transcript requires published reviewed results for every non-deferred enrolled course.'},403);
  }
  if(!preview && key==='certificate')return json({error:'Certificate issuance remains blocked pending the approved programme-completion and award policy.'},403);
  if ((!preview||realPreview) && key === "deferment_letter") { const { data: approved } = await db.from("deferments").select("reason,status").eq("application_id",app.id).eq("status","approved").limit(1); if (!approved?.length) return json({error:"No approved deferment exists."},403); }
  if (realPreview && key === "certificate") return json({error:"Certificate previews require a verified completion record."},409);
  if (!preview && key === "certificate" && !(doc.document_key === "certificate" && doc.status === "available")) return json({ error: "A certificate must be formally issued before download." }, 403);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${doc.title || key} - AH Consult Ltd`);
  pdf.setAuthor("AH Consult Ltd");
  pdf.setCreator("AH Student Hub");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  // Institution identity is authoritative, not derived from an uploaded full-page letterhead.
  const {data:identity,error:identityError}=await db.from('institution_document_identity').select('*').eq('id',true).maybeSingle();
  if(identityError||!identity)return json({error:'Institutional document identity has not been configured. Apply migration 040.'},503);
  if(!preview&&(!identity.updated_by||!String(identity.postal_address||'').trim()||!(String(identity.phone||'').trim()||String(identity.email||'').trim())))
    return json({error:'Official document issuance is temporarily unavailable until the institution publishes its official address and contact details in Document Designer.'},503);
  pdf.setAuthor(String(identity.organisation_name||'AH Consult Ltd'));
  let logo: any=null;
  if(identity.logo_path){
    const {data:asset,error:assetError}=await db.storage.from('institution-document-logos').download(identity.logo_path);
    if(assetError||!asset)return json({error:'The official institutional logo is unavailable; contact the administrator.'},503);
    try{
      const raw=await asset.arrayBuffer();logo=identity.logo_mime==='image/png'?await pdf.embedPng(raw):await pdf.embedJpg(raw);
    }catch{return json({error:'The institutional logo is unreadable. Contact the administrator.'},503)}
  }
  const d=makeDraw(pdf,regular,bold,identity as InstitutionIdentity,logo);
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
  // Keep document identifiers off the page body; the full ID is printed in
  // the right-aligned footer on every page for verification and traceability.
  const receiptPayment = key==='payment_receipt' ? payments[0] : null;
  // Only staff-authorized manual settlements carry admin_manual provenance.
  // All other receipts are derived from the provider-confirmed payment ledger.
  const manualReceipt = !!receiptPayment && String(receiptPayment.source||'').startsWith('admin_manual');
  const verifiedProviderData = receiptPayment?.raw_event && typeof receiptPayment.raw_event==='object'
    ? (receiptPayment.raw_event.eventData || receiptPayment.raw_event.provider_evidence || {}) : {};
  const safeProviderField = (value:unknown) => typeof value==='string' || typeof value==='number'
    ? textSafe(String(value).slice(0,120)) : '';
  const providerChannel = safeProviderField(verifiedProviderData.paymentMethod
    || verifiedProviderData.paymentChannel || verifiedProviderData.channel);
  const providerReference = safeProviderField(verifiedProviderData.transactionReference
    || verifiedProviderData.transaction_reference || verifiedProviderData.paymentReference);
  const providerPaymentDate = safeProviderField(verifiedProviderData.payment_date
    || verifiedProviderData.paidOn || verifiedProviderData.paidAt);
  const providerCurrency = safeProviderField(verifiedProviderData.currency);
  const presentation: Record<string, string> = {
    admission_letter: "Admission Letter",
    deferment_letter: "Deferment Approval Letter",
    payment_receipt: manualReceipt ? "Manual Payment Receipt" : "Electronic Payment Receipt",
    academic_transcript: "Academic Transcript",
    result_statement: "Statement of Results",
    certificate: "Certificate of Completion"
  };
  const documentName = presentation[key];
  // Date is the first line below the native institutional masthead, right-aligned above
  // the centered title for all six document families (including receipts).
  d.write(`Date: ${issuedDate}`, 9, { align: "right", color: MUTED });
  d.y -= 11;
  d.heading(documentName);
  d.y -= 12;

  if (key === "admission_letter") {
    d.write(`Dear ${name},`, 11);
    d.y -= 7;
    d.paragraph(stripDocumentSubject(interpolate(template?.body_text)) || "We are pleased to confirm that your application for admission to AH Consult Ltd has been approved. Please retain this letter as part of your official training records.");
    d.write("ADMISSION DETAILS", 10, { bold: true, color: ORANGE }); d.y -= 7;
    d.row("Student name", name); d.row("Student ID", studentId); d.row("Training intake", intakeLabel); d.row("Programme / courses", program); d.row("Admission status", "Approved");
    d.y -= 16;
    if(!template?.body_text)d.paragraph("Please follow the instructions provided by the training office regarding orientation, class schedules and any outstanding enrolment requirements.");
    d.y -= 14;
    d.write(textSafe(template?.signatory_name || "Admissions Office"), 11, { bold: true });
    d.write(textSafe(template?.signatory_title || "AH Consult Ltd"), 10, { color: MUTED });
  } else if (key === "deferment_letter") {
    d.row("Applicant", name); d.row("Student ID", studentId); d.row("Training intake", intakeLabel);
    d.y -= 14;
    d.paragraph(stripDocumentSubject(interpolate(template?.body_text)) || "The training office confirms approval of the student's deferment request.");
    d.y -= 12;
    d.write(textSafe(template?.signatory_name || "Training Office"), 11, { bold: true });
    if (template?.signatory_title) d.write(textSafe(template.signatory_title), 10, { color: MUTED });
  } else if (key === "payment_receipt") {
    const payment = payments[0];
    const receiptRow = (label: string, value: unknown) => d.row(label, value, true);
    d.paragraph(stripDocumentSubject(interpolate(template?.body_text)) || (manualReceipt
      ? "AH Consult Ltd acknowledges a bank payment manually checked and approved by its authorized finance team. This is an institutional receipt, not a bank-generated receipt."
      : "AH Consult Ltd acknowledges the successful electronic payment reported and verified through the named payment provider. The fields below reflect the verified transaction record."));
    d.write("PAYMENT DETAILS", 10, { bold: true, color: ORANGE }); d.y -= 7;
    receiptRow("Receipt type", manualReceipt ? "Manual bank payment - Finance approved" : "Online payment - Provider verified");
    receiptRow("Payer / applicant", name); receiptRow("Student / application ID", studentId);
    receiptRow("Payment reference", payment.reference || app.pay_reference || reference);
    receiptRow("Amount received", money(payment.paid_ngn)); receiptRow("Expected amount", money(payment.expected_ngn));
    receiptRow("Payment date", date(payment.paid_at || payment.verified_at));
    receiptRow("Verified date", date(payment.verified_at));
    if(manualReceipt){
      receiptRow("Authorized by", "AH Consult Finance");
    }else{
      receiptRow("Payment provider", payment.provider || "Verified provider");
      if(payment.provider_transaction_id) receiptRow("Provider reference / transaction ID", safeProviderField(payment.provider_transaction_id));
      if(providerReference && providerReference!==payment.provider_transaction_id) receiptRow("Provider-issued reference", providerReference);
      if(providerChannel) receiptRow("Payment channel", providerChannel);
      if(providerPaymentDate) receiptRow("Provider-reported date", providerPaymentDate);
      if(providerCurrency) receiptRow("Provider currency", providerCurrency);
    }
    receiptRow("Intake", intakeLabel); receiptRow("Purpose", program);
    d.y -= 14;
    d.paragraph(manualReceipt
      ? "Institutional manual-payment acknowledgement only; this is not a bank-issued receipt. Quote the verified payment reference for enquiries."
      : "Institutional acknowledgement of the provider-verified transaction, not an independent provider-issued PDF. Quote the payment reference for enquiries.",9.5);
  } else if (key === "academic_transcript" || key === "result_statement") {
    d.row("Student name", name); d.row("Student ID", studentId); d.row("Training intake", intakeLabel); d.row("Programme", program);
    d.y -= 14; d.write("PUBLISHED COURSE RESULTS", 10, { bold: true, color: ORANGE }); d.y -= 10;
    for (const r of results) {
      const course: any = courseByCode.get(r.course_code);
      d.row(`${textSafe(course?.name || r.course_code)} (${textSafe(course?.category || "Course")})`, `Attendance ${r.attendance ?? "-"} | CA ${r.ca ?? "-"} | Exam ${r.exams ?? "-"} | Total ${r.total ?? "-"} | Grade ${textSafe(r.band || "-")}`);
    }
    d.y -= 10;
    const requiredCodes=new Set((appCourses||[]).filter((c:any)=>!c.deferred).map((c:any)=>String(c.course_code)));
    const publishedCodes=new Set(results.map((r:any)=>String(r.course_code)));
    if(key==='result_statement')d.write([...requiredCodes].every(c=>publishedCodes.has(c))?'COMPLETE PUBLISHED RESULTS':'PARTIAL PUBLISHED RESULTS',9,{bold:true,color:ORANGE});
    d.paragraph(stripDocumentSubject(interpolate(template?.body_text)) || (key === "result_statement"
      ? "This statement reflects only results officially published in the student system as of the issue date."
      : "This final transcript contains the reviewed published results for all non-deferred enrolled courses."));
  } else if (key === "certificate") {
    // Certificate body stays within the calculated native content area.
    d.paragraph(stripDocumentSubject(interpolate(template?.body_text)) || "This is to certify that the learner named below has successfully completed the approved training programme at AH Consult Ltd.");
    d.y -= 14;
    d.write(name, 20, { bold: true, align: "center", leading: 27 });
    d.write(program, 11, { align: "center", leading: 17, color: MUTED });
    d.y -= 22;
    d.row("Student ID", studentId); d.row("Training intake", intakeLabel);
    d.y -= 18;
    d.paragraph("This certificate has been issued by the authorized training office as confirmation of the learner's completion record.");
    d.y -= 18;
    d.write(textSafe(template?.signatory_name || "Authorized by AH Consult Ltd"), 10.5, { bold: true });
    if (template?.signatory_title) d.write(textSafe(template.signatory_title), 10, { color: MUTED });
  }

  // Published template body appears in its intended narrative position above, not as a duplicated appendix.
  if (template?.signatory_name && !["admission_letter", "deferment_letter", "certificate"].includes(key)) {
    d.y -= 12; d.write(textSafe(template.signatory_name + " | " + (template.signatory_title || "")), 10, { bold: true });
  }

  // Only use an institution-controlled setting or an explicitly configured
  // deployment URL; never trust the HTTP Origin header as an official website.
  const { data: websiteSetting } = await db.from("site_settings")
    .select("value").eq("key", "official_website").maybeSingle();
  const siteValue: unknown = websiteSetting?.value;
  const configuredSite = String(identity.website||'') || Deno.env.get("AHCT_PUBLIC_WEBSITE_URL")
    || (typeof siteValue === "string" ? siteValue
      : siteValue && typeof siteValue === "object" && "url" in siteValue ? String(siteValue.url) : "");
  const officialWebsite = (() => {
    try {
      const url = new URL(configuredSite.trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") return "Website: Not configured";
      return `Website: ${url.origin}`;
    } catch { return "Website: Not configured"; }
  })();
  const copyNotice=currentStyle?'UPDATED-STYLE REPRINT - archived original retained':'';
  d.footer(documentName, preview ? "SAMPLE - NOT ISSUED" : String(doc.id), officialWebsite,
    [copyNotice,interpolate(template?.footer_text)].filter(Boolean).join(' | '));
  if(key === "payment_receipt" && pdf.getPageCount() !== 1)
    return json({error:"Receipt exceeds one A4 page. Shorten the additional receipt template wording."},422);
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
  if(currentStyle){
    // Never mutate metadata.pdf_path, metadata.sha256, issue date or the original PDF.
    const copyPath=`${doc.user_id}/style-copies/${doc.id}/${restyleIdentityRevision}.pdf`;
    const {error:storeError}=await db.storage.from('issued-documents')
      .upload(copyPath,bytes,{contentType:'application/pdf',upsert:false});
    if(storeError){
      // Another request may have created this revision concurrently; retry on next click.
      return json({error:'A refreshed document is being prepared. Please retry shortly.'},409);
    }
    const {error:registryError}=await db.from('document_style_reprints').insert({
      document_id:doc.id,identity_revision:restyleIdentityRevision,pdf_path:copyPath,
      sha256:fingerprint,original_sha256:String(doc.metadata.sha256)
    });
    if(registryError)return json({error:'Updated-style PDF saved but registration failed; contact the records office.'},503);
    await db.from('audit_log').insert({actor:internal?null:user?.id,action:'official_document_style_copy_issued',
      target:String(doc.id),note:`Identity revision ${restyleIdentityRevision}; original hash ${String(doc.metadata.sha256).slice(0,16)}`});
    return new Response(bytes,{headers:{...corsHeaders(req),'Content-Type':'application/pdf',
      'Content-Disposition':`attachment; filename="AHCT-updated-style-${escFile(key)}.pdf"`,
      'Cache-Control':'private,no-store','X-Document-SHA256':fingerprint,
      'X-Identity-Revision':String(restyleIdentityRevision)}});
  }
  const storagePath=`${doc.user_id}/${doc.id}.pdf`;
  const {error:storeError}=await db.storage.from('issued-documents').upload(storagePath,bytes,{contentType:'application/pdf',upsert:false});
  if(storeError){
    // Concurrent first downloads may both produce bytes; use the winner's archived file.
    const {data:winner,error:winnerError}=await db.storage.from('issued-documents').download(storagePath);
    if(winnerError||!winner)return json({error:'Official document archiving failed. Please retry later.'},503);
    const archived=await winner.arrayBuffer();const hashBytes=new Uint8Array(await crypto.subtle.digest('SHA-256',archived));
    const hash=[...hashBytes].map(x=>x.toString(16).padStart(2,'0')).join('');
    const metadata={...(doc.metadata||{}),pdf_path:storagePath,sha256:hash,archived_at:new Date().toISOString(),template_version:template?.version||null,identity_revision:identity.revision||null};
    const {error:registryError}=await db.from('student_documents').update({metadata,status:'available',issued_at:doc.issued_at||new Date().toISOString()}).eq('id',doc.id).eq('user_id',doc.user_id);
    if(registryError)return json({error:'Archived PDF found but registry reconciliation failed. Contact records office.'},503);
    await auditOfficial(internal?'receipt_pdf_issued':'document_pdf_issued');
    return new Response(archived,{headers:{...corsHeaders(req),'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="AHCT-${escFile(key)}-${escFile(app.student_id||app.id)}.pdf"`,'Cache-Control':'private, no-store','X-Document-SHA256':hash}});
  }
  const metadata={...(doc.metadata||{}),pdf_path:storagePath,sha256:fingerprint,archived_at:new Date().toISOString(),template_version:template?.version||null,template_snapshot:{body_text:template?.body_text||'',signatory_name:template?.signatory_name||'',signatory_title:template?.signatory_title||'',footer_text:template?.footer_text||''},identity_revision:identity.revision||null,identity_logo_path:identity.logo_path||null};
  const {error:markError}=await db.from('student_documents').update({metadata,status:'available',issued_at:doc.issued_at||new Date().toISOString()}).eq('id',doc.id).eq('user_id',doc.user_id).in('status',['pending','available']);
  if(markError){console.error('PDF stored but metadata update failed',doc.id,markError.message);return json({error:'Official PDF saved but issuance registry update failed; contact administrator before retrying'},503)}
  await auditOfficial(internal?'receipt_pdf_issued':'document_pdf_issued');
  const filename = `AHCT-${escFile(key)}-${escFile(app.student_id || String(app.id).slice(0, 8))}.pdf`;
  return new Response(bytes, { status: 200, headers: { ...corsHeaders(req), "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "X-Document-SHA256": fingerprint } });
}));
