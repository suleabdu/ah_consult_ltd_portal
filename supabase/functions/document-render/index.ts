import { admin, corsHeaders, json, safe, userFrom } from "../_shared/lib.ts";

const esc=(v:any)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]!));
const money=(v:any)=>`₦${Number(v||0).toLocaleString()}`;
const date=(v:any)=>v?new Date(v).toLocaleString("en-NG"):"";

Deno.serve(safe(async(req)=>{
  if(req.method!=="POST") return json({error:"POST required"},405);
  const user=await userFrom(req); if(!user) return json({error:"Please sign in again."},401);
  const db=admin();
  const {data:staff}=await db.from("staff").select("role,status,full_name").eq("id",user.id).maybeSingle();
  if(!staff || staff.status!=="approved" || !["administrator","registrar","finance","academic"].includes(staff.role)) return json({error:"Document access denied."},403);
  const body=await req.json().catch(()=>({}));
  const jobId=body?.job_id;
  if(!jobId) return json({error:"job_id is required."},400);
  const {data:job,error:jerr}=await db.from("document_jobs").select("*").eq("id",jobId).maybeSingle();
  if(jerr||!job) return json({error:"Document job not found."},404);
  if(!["requested","generated","issued"].includes(job.status)) return json({error:`Document job cannot be rendered in status ${job.status}.`},409);

  const {data:a,error:aerr}=await db.from("applications").select("*,intakes(label),application_courses(course_code,fee_ngn,deferred),profiles(full_name,email,phone)").eq("id",job.application_id).single();
  if(aerr||!a) return json({error:"Application record not found."},404);
  const {data:courseRows}=await db.from("application_courses").select("course_code,fee_ngn,deferred").eq("application_id",a.id);
  const codes=(courseRows??[]).map((x:any)=>x.course_code);
  const {data:courses}=codes.length?await db.from("courses").select("code,name,category").in("code",codes):{data:[]};
  const {data:results}=await db.from("exam_results").select("course_code,attendance,ca,exams,total,band,published_at").eq("application_id",a.id).order("course_code");
  const {data:payments}=await db.from("payments").select("reference,expected_ngn,paid_ngn,paid_at,verified_at,provider,source").eq("application_id",a.id).order("paid_at",{ascending:false});
  const f=a.form_data??{};
  const name=esc(a.profiles?.full_name || `${f.firstName??""} ${f.surname??""}`.trim() || "Student");
  const studentId=esc(a.student_id||"");
  const intake=esc(a.intakes?.label||"");
  const courseText=(courses??[]).map((c:any)=>`${esc(c.name)} (${esc(c.category)})`).join(", ");
  const rows=(results??[]).map((r:any)=>`<tr><td>${esc(r.course_code)}</td><td>${r.attendance??""}</td><td>${r.ca??""}</td><td>${r.exams??""}</td><td>${r.total??""}</td><td>${esc(r.band||"")}</td></tr>`).join("");
  const paymentRows=(payments??[]).map((p:any)=>`<tr><th>Reference</th><td>${esc(p.reference)}</td></tr><tr><th>Amount paid</th><td>${money(p.paid_ngn)}</td></tr><tr><th>Paid date</th><td>${esc(date(p.paid_at))}</td></tr>`).join("");
  let content="";
  if(job.document_key==="admission_letter") content=`<p>Dear <b>${name}</b>,</p><p>We are pleased to confirm your admission to <b>AH Consult Ltd</b>.</p><table><tr><th>Student ID</th><td>${studentId}</td></tr><tr><th>Intake</th><td>${intake}</td></tr><tr><th>Programme</th><td>${courseText}</td></tr></table><p>Please retain this letter for your academic records.</p>`;
  else if(job.document_key==="payment_receipt") content=`<h2>OFFICIAL PAYMENT RECEIPT</h2><table>${paymentRows}<tr><th>Student</th><td>${name}</td></tr><tr><th>Student ID</th><td>${studentId}</td></tr></table>`;
  else if(job.document_key==="academic_transcript") content=`<h2>ACADEMIC TRANSCRIPT</h2><p><b>${name}</b> · ${studentId} · ${intake}</p><table><tr><th>Course</th><th>Attendance</th><th>CA</th><th>Exams</th><th>Total</th><th>Band</th></tr>${rows||`<tr><td colspan="6">No published results are available.</td></tr>`}</table>`;
  else if(job.document_key==="certificate") content=`<div class="certificate"><p>This is to certify that</p><h1>${name}</h1><p>has successfully completed the registered programme at <b>AH Consult Ltd</b>.</p><p><b>Student ID:</b> ${studentId}</p><p><b>Intake:</b> ${intake}</p></div>`;
  else return json({error:"Unsupported document type."},400);

  await db.from("document_jobs").update({status:"generated",generated_at:new Date().toISOString(),generated_by:user.id,error_message:null}).eq("id",jobId).in("status",["requested","generated","issued"]);
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>${esc(job.document_key)}</title><style>body{font-family:Arial,sans-serif;margin:48px;color:#111}header{border-bottom:3px solid #ea580c;padding-bottom:12px;margin-bottom:28px}h1,h2{margin:8px 0}p{line-height:1.7}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{border:1px solid #ddd;padding:9px;text-align:left}th{background:#f3f4f6;width:32%}.certificate{text-align:center;border:8px double #111;padding:60px 30px;margin-top:50px}.certificate h1{font-size:36px;margin:24px 0}@media print{body{margin:25mm}}</style></head><body><header><b>AH CONSULT LTD</b><div>Official Institutional Document</div></header>${content}<footer style="margin-top:40px;font-size:12px;color:#666">Generated ${esc(date(new Date().toISOString()))}</footer></body></html>`;
  return new Response(html,{status:200,headers:{...corsHeaders(req),"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
}));
