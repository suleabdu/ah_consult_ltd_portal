/** AHCT manual applications: validate -> stage -> explicitly confirm -> resumable draft import.
 * Runs with service-role key only server-side. Uploaded file stays in the browser.
 */
import { admin, json, safe, userFrom } from '../_shared/lib.ts';

const FIELDS = ['Source Reference','First Name','Surname','Email','Phone','Intake','Course Codes','Date of Birth','Gender','Registration Note'];
const clean = (x: unknown, cap = 160) => String(x ?? '').trim().slice(0, cap);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (message: string, code = 400) => json({ error: message }, code);
const hexDigest = async (v: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(v));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map(x => x.toString(16).padStart(2,'0')).join('');
};

Deno.serve(safe(async (req) => {
  if (req.method !== 'POST') return fail('POST required',405);
  const auth = await userFrom(req);
  if (!auth) return fail('Sign in again',401);
  const db = admin();
  const { data: officer, error: officerError } = await db.from('staff').select('role,status').eq('id',auth.id).maybeSingle();
  if (officerError || !officer || officer.status !== 'approved' || !['registrar','administrator'].includes(officer.role))
    return fail('Only approved admissions officers can import applications',403);
  let input: Record<string, any>;
  try { input = await req.json(); } catch { return fail('Malformed request'); }
  if (!input || typeof input !== 'object') return fail('Invalid request');

  if (input.action === 'history') {
    const {data,error}=await db.from('manual_import_batches').select('id,file_name,status,row_count,created_at')
      .eq('created_by',auth.id).order('created_at',{ascending:false}).limit(12);
    if(error)return fail('Could not retrieve previous imports',503);
    return json({batches:data||[]});
  }
  if(input.action==='recover'){
    const batchId=clean(input.batchId,40);
    if(!UUID.test(batchId))return fail('Invalid import batch');
    const stale=new Date(Date.now()-10*60*1000).toISOString();
    const {data,error}=await db.from('manual_import_batches').update({status:'partial',updated_at:new Date().toISOString()})
      .eq('id',batchId).eq('created_by',auth.id).eq('status','processing').lt('updated_at',stale).select('id').maybeSingle();
    if(error||!data)return fail('Import is still processing or is not eligible for recovery. Check again after ten minutes.',409);
    return json({recovered:true});
  }
  if (input.action === 'cancel') {
    const batchId=clean(input.batchId,40);
    if(!UUID.test(batchId))return fail('Invalid import batch');
    const {data:batch}=await db.from('manual_import_batches').select('status').eq('id',batchId).eq('created_by',auth.id).maybeSingle();
    if(!batch||batch.status!=='validated')return fail('Only an uncommitted preview may be discarded',409);
    const {error}=await db.from('manual_import_batches').delete().eq('id',batchId).eq('created_by',auth.id).eq('status','validated');
    if(error)return fail('Could not discard preview',503);
    return json({discarded:true});
  }
  if (input.action === 'preview') {
    if (!Array.isArray(input.rows) || input.rows.length === 0 || input.rows.length > 100)
      return fail('Upload between 1 and 100 application rows per file');
    if (JSON.stringify(input).length > 250000) return fail('Import is too large');
    if (input.columns?.length !== FIELDS.length || FIELDS.some((f,i)=>input.columns[i]!==f))
      return fail('Columns do not match the AHCT template. Download a fresh template and keep the headings unchanged.');
    const { data: intakes, error: intakeErr } = await db.from('intakes').select('id,label');
    const { data: courses, error: courseErr } = await db.from('courses').select('code,fee_ngn,workflow_status,is_active');
    if (intakeErr || courseErr) return fail('Could not verify the current intake and course catalogue',503);
    const byIntake = new Map<string, any[]>();
    (intakes||[]).forEach(x=>{for(const key of [String(x.id).toLowerCase(),String(x.label).trim().toLowerCase()])byIntake.set(key,[...(byIntake.get(key)||[]),x]);});
    const byCode = new Map((courses||[]).map(x=>[x.code.toUpperCase(),x]));
    const rows: any[] = [], errors: {row:number;reason:string}[]=[];
    const seenMail = new Set<string>(), seenRef = new Set<string>();
    for (const [index, raw] of input.rows.entries()) {
      const line=index+2;const problems:string[]=[];
      if (!raw || typeof raw!=='object' || Array.isArray(raw)) {errors.push({row:line,reason:'Invalid row format'});continue;}
      const get=(f:string,n=160)=>clean(raw[f],n);
      const ref=get('Source Reference',64).toUpperCase(),first=get('First Name',90),last=get('Surname',90),
        mail=get('Email',254).toLowerCase(),phone=get('Phone',40),intakeName=get('Intake',130).toLowerCase(),note=get('Registration Note',350),
        dob=get('Date of Birth',20),gender=get('Gender',32);
      const codes=get('Course Codes',300).toUpperCase().split(/[,;|\s]+/).filter(Boolean);
      if(!/^[A-Z0-9][A-Z0-9/_-]{2,63}$/.test(ref))problems.push('Source Reference must contain 3–64 letters/numbers/-/_');
      if(!first||!last)problems.push('First Name and Surname required');
      if(!emailPattern.test(mail)||mail.length>254)problems.push('Valid Email required for a student portal invitation');
      if(!/^[+0-9() .-]{7,25}$/.test(phone))problems.push('Valid Phone required');
      if(seenMail.has(mail))problems.push('Duplicate email in this spreadsheet');seenMail.add(mail);
      if(seenRef.has(ref))problems.push('Duplicate paper Source Reference in this spreadsheet');seenRef.add(ref);
      const matching=byIntake.get(intakeName)||[];
      if(matching.length!==1)problems.push('Intake must match exactly one existing intake label or ID');
      if(!codes.length||codes.length>10||new Set(codes).size!==codes.length)problems.push('Choose 1–10 unique Course Codes');
      for(const code of codes){const c=byCode.get(code);if(!c||c.workflow_status!=='published'||!c.is_active)problems.push(`Course ${code} is not published`);}
      if(dob&&!/^\d{4}-\d{2}-\d{2}$/.test(dob))problems.push('Date of Birth must be YYYY-MM-DD');
      if(gender&&!['Male','Female','Other','Prefer not to say'].includes(gender))problems.push('Unrecognized Gender; use the template dropdown');
      if(Object.values(raw).some(v=>typeof v==='string'&&/^\s*=/.test(v)))problems.push('Spreadsheet formulas are not permitted');
      if(problems.length){errors.push({row:line,reason:problems.join('; ')});continue;}
      rows.push({row_number:line,source_reference:ref,email:mail,data:{
        first_name:first,surname:last,email:mail,phone,intake_id:matching[0].id,course_codes:codes,
        ...(dob?{date_of_birth:dob}:{}),...(gender?{gender}:{}),note
      }});
    }
    const warnings: {row:number;reason:string}[]=[];
    if(rows.length){
      const emails=rows.map(r=>r.email),refs=rows.map(r=>r.source_reference);
      const [p,s,st,phoneMatches]=await Promise.all([
        db.from('profiles').select('email').in('email',emails),
        db.from('manual_registration_sources').select('source_reference').in('source_reference',refs),
        db.from('manual_import_rows').select('email,source_reference,status').in('email',emails).in('status',['validated','invited','imported','failed']),
        db.from('profiles').select('phone').in('phone',rows.map(r=>r.data.phone))
      ]);
      if(p.error||s.error||st.error||phoneMatches.error)return fail('Could not check existing student identities and paper references',503);
      const existingEmails=new Set((p.data||[]).map(x=>String(x.email).toLowerCase()));
      const priorRefs=new Set((s.data||[]).map(x=>x.source_reference));
      const pendingEmails=new Set((st.data||[]).map(x=>x.email));
      const priorPhones=new Set((phoneMatches.data||[]).map(x=>String(x.phone||'').replace(/\D/g,'')));
      for(const r of rows){
        if(existingEmails.has(r.email))errors.push({row:r.row_number,reason:'Email already belongs to an account; reconcile manually'});
        if(priorRefs.has(r.source_reference))errors.push({row:r.row_number,reason:'Paper registration reference already imported'});
        if(pendingEmails.has(r.email))errors.push({row:r.row_number,reason:'Email is already staged in another upload'});
        if(priorPhones.has(r.data.phone.replace(/\D/g,'')))warnings.push({row:r.row_number,reason:'Phone matches an existing profile. Confirm this is not a duplicate applicant.'});
      }
    }
    if(errors.length)return json({ready:false,total:input.rows.length,valid:input.rows.length-errors.length,errors:errors.slice(0,100)});
    const checksum=await hexDigest(rows.map(r=>[r.source_reference,r.email,r.data]));
    const {data:recent,error:quotaErr}=await db.from('manual_import_batches').select('row_count').eq('created_by',auth.id).gte('created_at',new Date(Date.now()-24*3600*1000).toISOString());
    if(quotaErr)return fail('Import quota verification is unavailable',503);
    if((recent||[]).reduce((sum,b)=>sum+Number(b.row_count||0),0)+rows.length>500)return fail('Daily import limit reached (500 rows per officer). Try again tomorrow.',429);
    const {data:prior}=await db.from('manual_import_batches').select('id,status').eq('created_by',auth.id).eq('checksum',checksum).maybeSingle();
    if(prior)return json({ready:prior.status==='validated',batchId:prior.id,total:rows.length,valid:rows.length,status:prior.status,duplicateUpload:true});
    const {data:batch,error:batchErr}=await db.from('manual_import_batches').insert({created_by:auth.id,file_name:clean(input.fileName,140)||'manual-registrations.xlsx',checksum,row_count:rows.length}).select('id').single();
    if(batchErr||!batch)return fail('Unable to stage import for review',500);
    const {error:rowErr}=await db.from('manual_import_rows').insert(rows.map(r=>({...r,batch_id:batch.id})));
    if(rowErr){await db.from('manual_import_batches').delete().eq('id',batch.id);return fail('Unable to stage application rows',500);}
    return json({ready:true,batchId:batch.id,total:rows.length,valid:rows.length,errors:[],warnings,preview:rows.slice(0,10).map(r=>({row:r.row_number,source:r.source_reference,name:r.data.first_name+' '+r.data.surname,courses:r.data.course_codes.join(', ')}))});
  }

  if(input.action==='commit'){
    const batchId=clean(input.batchId,40);
    if(!UUID.test(batchId)||input.confirm!==true)return fail('You must confirm the validated import');
    const {data:batch,error:batchErr}=await db.from('manual_import_batches').select('*').eq('id',batchId).eq('created_by',auth.id).maybeSingle();
    if(batchErr||!batch)return fail('Import batch not found',404);
    if(batch.status==='completed')return json({status:'completed',message:'This batch was already imported.',imported:batch.row_count,failed:0});
    if(!['validated','partial'].includes(batch.status))return fail('This batch is already processing. Please retry after a failed or completed attempt.',409);
    const {data:locked,error:lockErr}=await db.from('manual_import_batches').update({status:'processing',updated_at:new Date().toISOString()}).eq('id',batch.id).eq('status',batch.status).select('id').maybeSingle();
    if(lockErr||!locked)return fail('Another import is already processing',409);
    const {data:entries,error:rowsErr}=await db.from('manual_import_rows').select('*').eq('batch_id',batchId).order('row_number');
    if(rowsErr||!entries)return fail('Unable to retrieve staged application rows',503);
    const failures: {row:number;reason:string}[]=[];
    const unfinished=entries.filter(x=>x.status==='validated'||x.status==='invited');
    const selected=(unfinished.length?unfinished:entries.filter(x=>x.status==='failed')).slice(0,15);
    for(const row of selected){
      let uid=row.invited_user_id;
      try{
        if(!uid){
          // Supabase sends its configured invite email; do NOT generate shared passwords.
          const {data:invite,error:inviteErr}=await db.auth.admin.inviteUserByEmail(row.email,{
            data:{full_name:row.data.first_name+' '+row.data.surname,phone:row.data.phone,manual_import:true}
          });
          if(inviteErr||!invite.user)throw new Error('Could not invite applicant. Check whether this email already exists and whether Auth email delivery is configured.');
          uid=invite.user.id;
          const {error:saveErr}=await db.from('manual_import_rows').update({invited_user_id:uid,status:'invited',updated_at:new Date().toISOString()}).eq('id',row.id);
          if(saveErr)throw new Error('Account invitation was sent but staging could not be updated. Contact support before retrying.');
        }
        const {error:writeErr}=await db.rpc('ahct_import_application_row',{p_batch:batchId,p_row:row.row_number,p_user:uid,p_actor:auth.id});
        if(writeErr)throw new Error(writeErr.message);
      }catch(err){
        const message=(err instanceof Error?err.message:'Import failed').slice(0,280);
        await db.from('manual_import_rows').update({status:'failed',error_message:message,updated_at:new Date().toISOString()}).eq('id',row.id);
        failures.push({row:row.row_number,reason:message});
      }
      await db.from('manual_import_batches').update({updated_at:new Date().toISOString()}).eq('id',batchId).eq('status','processing');
    }
    const {data:summary}=await db.from('manual_import_rows').select('row_number,status,error_message').eq('batch_id',batchId);
    const imported=(summary||[]).filter(x=>x.status==='imported').length;
    const failed=(summary||[]).filter(x=>x.status==='failed').length;
    const pending=(summary||[]).filter(x=>['validated','invited'].includes(x.status)).length;
    await db.from('manual_import_batches').update({status:(failed||pending)?'partial':'completed',updated_at:new Date().toISOString()}).eq('id',batchId);
    return json({status:(failed||pending)?'partial':'completed',imported,failed,pending,errors:(summary||[]).filter(x=>x.status==='failed').map(x=>({row:x.row_number,reason:x.error_message||'Failed'}))});
  }
  return fail('Choose preview or commit');
}));
