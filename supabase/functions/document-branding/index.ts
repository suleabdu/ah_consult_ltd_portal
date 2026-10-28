/** Administrator-only letterhead upload and preview. Stored outside public web root. */
import { admin, safe, json, corsHeaders, userFrom } from "../_shared/lib.ts";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
Deno.serve(safe(async (req) => {
  if (!['GET','POST'].includes(req.method)) return json({error:'Method not supported'},405);
  const user = await userFrom(req); if(!user) return json({error:'Sign in required'},401);
  const db=admin();const {data:staff}=await db.from('staff').select('role,status').eq('id',user.id).maybeSingle();
  if(!staff||staff.status!=='approved'||staff.role!=='administrator') return json({error:'Administrator access required'},403);
  const {data:brand}=await db.from('institution_document_branding').select('file_path,image_mime,revision,top_safe_mm,bottom_safe_mm').eq('id',true).single();
  if(req.method==='GET'&&new URL(req.url).searchParams.has('versions')){
    const {data,error}=await db.from('institution_letterhead_versions').select('id,revision,created_at,retired_at,file_path').order('revision',{ascending:false});
    if(error)return json({error:'Could not read the published letterhead library. Apply migration 034.'},503);
    return json({versions:(data||[]).map(v=>({id:v.id,revision:v.revision,created_at:v.created_at,retired:!!v.retired_at,default:v.file_path===brand?.file_path}))});
  }
  if(req.method==='GET'&&new URL(req.url).searchParams.has('settings'))return json({revision:brand?.revision||0,letterhead_uploaded:!!brand?.file_path,top_safe_mm:Number(brand?.top_safe_mm||85),bottom_safe_mm:Number(brand?.bottom_safe_mm||20)});
  if(req.method==='GET'){
    if(!brand?.file_path) return json({error:'No letterhead uploaded'},404);
    const {data,error}=await db.storage.from('institution-letterheads').download(brand.file_path);
    if(error||!data) return json({error:'Letterhead file not available'},404);
    return new Response(await data.arrayBuffer(),{headers:{...corsHeaders(req),'Content-Type':brand.image_mime||'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
  if((req.headers.get('content-type')||'').includes('application/json')){
    const data=await req.json().catch(()=>({}));
    if(['set_default','archive'].includes(String(data.action||''))){
      if(!/^[0-9a-f-]{36}$/i.test(String(data.version_id||'')))return json({error:'Invalid letterhead version ID'},422);
      const {data:v}=await db.from('institution_letterhead_versions').select('id,revision,file_path,image_mime,retired_at').eq('id',data.version_id).maybeSingle();
      if(!v)return json({error:'Letterhead version not found'},404);
      if(v.retired_at)return json({error:'Archived letterheads cannot be selected or archived again'},409);
      if(data.action==='archive'){
        if(v.file_path===brand?.file_path)return json({error:'Choose a different default before archiving this letterhead'},409);
        const {error}=await db.from('institution_letterhead_versions').update({retired_at:new Date().toISOString(),retired_by:user.id}).eq('id',v.id).is('retired_at',null);
        if(error)return json({error:'Could not archive old letterhead'},503);
      }else{
        // A previously published revision may become the default again. No historical PDF is rewritten.
        const {error}=await db.from('institution_document_branding').update({file_path:v.file_path,image_mime:v.image_mime,revision:v.revision,updated_at:new Date().toISOString(),updated_by:user.id}).eq('id',true);
        if(error)return json({error:'Could not switch default letterhead'},503);
      }
      await db.from('audit_log').insert({actor:user.id,action:data.action==='archive'?'letterhead_archived':'letterhead_default_changed',target:v.id,note:`Revision ${v.revision}`});
      return json({ok:true,message:data.action==='archive'?'Old letterhead archived':'Default letterhead updated'});
    }
    const top=Number(data.top_safe_mm), bottom=Number(data.bottom_safe_mm);
    if(!Number.isFinite(top)||!Number.isFinite(bottom)||top<25||top>120||bottom<12||bottom>60||top+bottom>=240)return json({error:'Invalid letterhead margins. Use top 25–120 mm, bottom 12–60 mm.'},422);
    const {error}=await db.from('institution_document_branding').update({top_safe_mm:top,bottom_safe_mm:bottom,updated_at:new Date().toISOString(),updated_by:user.id}).eq('id',true);
    if(error)return json({error:'Could not save letterhead safe areas.'},503);
    await db.from('audit_log').insert({actor:user.id,action:'institution_letterhead_margins',target:'document_branding',note:`Top ${top} mm; bottom ${bottom} mm`});
    return json({ok:true,top_safe_mm:top,bottom_safe_mm:bottom});
  }
  const form=await req.formData();const file=form.get('letterhead');
  if(!(file instanceof File))return json({error:'Select a PNG or JPEG letterhead image'},422);
  if(file.size<100||file.size>8*1024*1024)return json({error:'Letterhead size must be between 100 bytes and 8 MB'},422);
  const bytes=new Uint8Array(await file.arrayBuffer());
  const png=bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47&&bytes[4]===0x0d&&bytes[5]===0x0a&&bytes[6]===0x1a&&bytes[7]===0x0a;
  const jpg=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
  const mime=png?'image/png':jpg?'image/jpeg':null;
  if(!mime || (file.type!==mime))return json({error:'Only actual PNG/JPEG images are accepted, not SVG or PDFs'},422);
  try {
    const pdf=await PDFDocument.create();const image=png?await pdf.embedPng(bytes):await pdf.embedJpg(bytes);
    const aspect=image.width/image.height;
    if(image.width<1200||image.height<1600||Math.abs(aspect-210/297)>0.075)
      return json({error:'For full-page stationery, upload an A4 portrait letterhead at least 1200 × 1600 pixels (recommended 2480 × 3508).'},422);
  } catch {return json({error:'The image could not be decoded as a valid PNG/JPEG.'},422);}
  // Name is generated by the server. No direct public read or client uploads.
  const path=`institutional/${crypto.randomUUID()}.${png?'png':'jpg'}`;
  const {error:uploaded}=await db.storage.from('institution-letterheads').upload(path,bytes,{contentType:mime,upsert:false});
  if(uploaded)return json({error:'Letterhead upload failed; check private Storage bucket and logs'},503);
  // The revision counter must never decrease when an administrator selects an older default.
  const {data:latest,error:latestError}=await db.from('institution_letterhead_versions').select('revision').order('revision',{ascending:false}).limit(1);
  if(latestError){await db.storage.from('institution-letterheads').remove([path]);return json({error:'Letterhead version registry unavailable. Apply migration 034.'},503)}
  const revision=Math.max(Number(latest?.[0]?.revision||0),Number(brand?.revision||0))+1;
  const {error:registered}=await db.from('institution_letterhead_versions').insert({revision,file_path:path,image_mime:mime,uploaded_by:user.id});
  if(registered){await db.storage.from('institution-letterheads').remove([path]);return json({error:'Unable to record the letterhead revision; retry upload.'},503)}
  const {error:changed}=await db.from('institution_document_branding').update({file_path:path,image_mime:mime,revision,updated_at:new Date().toISOString(),updated_by:user.id}).eq('id',true);
  if(changed){await db.from('institution_letterhead_versions').delete().eq('file_path',path);await db.storage.from('institution-letterheads').remove([path]);return json({error:'Could not publish the letterhead'},503)}
  await db.from('audit_log').insert({actor:user.id,action:'institution_letterhead_uploaded',target:'document_branding',note:`Revision ${revision}`});
  return json({ok:true,revision,message:'Letterhead published as the new default. Previously archived PDFs remain unchanged.'});
}));
