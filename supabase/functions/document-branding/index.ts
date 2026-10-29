/** Native institutional identity profiles, V18.7.1. All actions require a valid staff JWT. */
import {admin, safe, json, corsHeaders, userFrom} from '../_shared/lib.ts';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedFields=['organisation_name','organisation_tagline','postal_address','phone','email','website','header_alignment'] as const;
const textField=(v:unknown,max:number):string=>{
 if(typeof v!=='string') throw Error('Invalid identity field');
 const str=v.trim();
 if(str.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(str))throw Error('Text exceeds limit or contains invalid characters');
 return str;
};
const visible=(p:any)=>({id:p.id,label:p.label,status:p.status,is_default:p.is_default,revision:p.revision,
 organisation_name:p.organisation_name,organisation_tagline:p.organisation_tagline,postal_address:p.postal_address,
 phone:p.phone,email:p.email,website:p.website,header_alignment:p.header_alignment,has_logo:!!p.logo_path,
 updated_at:p.updated_at});
const failure=(message:string,status=422)=>json({error:message},status);
const parseId=(v:unknown)=>typeof v==='string'&&UUID.test(v)?v:null;

Deno.serve(safe(async(req)=>{
 if(!['GET','POST'].includes(req.method))return failure('Unsupported method',405);
 const user=await userFrom(req);if(!user)return failure('Sign in again to manage institutional identities.',401);
 const db=admin();const {data:staff,error:staffErr}=await db.from('staff').select('role,status').eq('id',user.id).maybeSingle();
 if(staffErr||staff?.role!=='administrator'||staff?.status!=='approved')return failure('An approved administrator account is required.',403);
 const profiles=db.from('institution_document_identity_profiles');
 const {data:active,error:activeErr}=await db.from('institution_document_identity').select('*').eq('id',true).maybeSingle();
 if(activeErr||!active)return failure('Institutional identity unavailable. Apply database migration 040.',503);
 const removeOrphanedLogo=async(path:string)=>{
   // Delete storage bytes only when no saved identity uses the asset. Already
   // issued PDFs embed their own logo and remain separate immutable files.
   const [{data:remaining,error:lookupError},{data:live,error:liveError}]=await Promise.all([
     profiles.select('id').eq('logo_path',path).limit(1),
     db.from('institution_document_identity').select('logo_path').eq('id',true).maybeSingle()
   ]);
   if(!lookupError&&!liveError&&!remaining?.length&&live?.logo_path!==path)
     await db.storage.from('institution-document-logos').remove([path]);
 };
 const params=new URL(req.url).searchParams;
 if(req.method==='GET'){
  if(params.has('logo')){
   const profileId=parseId(params.get('profile_id'));
   let logoPath=active.logo_path,logoMime=active.logo_mime;
   if(profileId){const {data:p,error}=await profiles.select('logo_path,logo_mime').eq('id',profileId).maybeSingle();
    if(error||!p)return failure('Identity profile not found.',404);
    logoPath=p.logo_path;logoMime=p.logo_mime;
   }
   if(!logoPath)return failure('No logo exists for this identity.',404);
   const {data,error}=await db.storage.from('institution-document-logos').download(logoPath);
   if(error||!data)return failure('The saved logo file is unavailable.',404);
   return new Response(await data.arrayBuffer(),{headers:{...corsHeaders(req),'Content-Type':logoMime||'image/png',
    'Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff'}});
  }
  const {data:list,error}=await profiles.select('*').order('updated_at',{ascending:false}).limit(100);
  if(error)return failure('Identity profiles unavailable. Apply migration 041 and redeploy document-branding.',503);
  return json({identity:visible({...active,is_default:true}),profiles:(list||[]).map(visible),
    message:'Publishing changes the institutional branding used by new documents. Previously issued PDFs remain archived and unchanged.'});
 }
 let input:any={};const ct=req.headers.get('content-type')||'';
 if(ct.includes('multipart/form-data')){
  const form=await req.formData();const id=parseId(form.get('profile_id'));
  if(!id)return failure('Choose a saved draft before uploading its logo.');
  const file=form.get('logo');if(!(file instanceof File))return failure('Choose a PNG or JPEG logo.');
  if(file.size<100||file.size>1048576)return failure('Logo must be between 100 bytes and 1 MB.');
  const {data:profile,error:lookupError}=await profiles.select('*').eq('id',id).maybeSingle();
  if(lookupError||!profile)return failure('Identity profile not found.',404);
  if(profile.is_default)return failure('Save a draft identity before replacing its live logo.',409);
  const raw=new Uint8Array(await file.arrayBuffer());
  const png=raw.length>8&&[137,80,78,71,13,10,26,10].every((n,i)=>raw[i]===n);
  const jpg=raw.length>4&&raw[0]===255&&raw[1]===216&&raw[2]===255;
  const mime=png?'image/png':jpg?'image/jpeg':null;
  if(!mime||file.type!==mime)return failure('Only genuine PNG/JPEG logo images are accepted.');
  try{const {PDFDocument}=await import('npm:pdf-lib@1.17.1');const pdf=await PDFDocument.create();
   const img=png?await pdf.embedPng(raw):await pdf.embedJpg(raw);
   if(img.width<100||img.height<100||img.width/img.height<0.82||img.width/img.height>5)
    return failure('Use a compact logo rather than a full-page letterhead.');
  }catch{return failure('The image could not be read.');}
  const path=`logos/${crypto.randomUUID()}.${png?'png':'jpg'}`;
  const {error:uploadErr}=await db.storage.from('institution-document-logos').upload(path,raw,{contentType:mime,upsert:false});
  if(uploadErr)return failure('Logo upload failed.',503);
  const {data:savedLogo,error:editErr}=await profiles.update({logo_path:path,logo_mime:mime,status:'draft',revision:profile.revision+1,
    updated_at:new Date().toISOString(),updated_by:user.id}).eq('id',id).eq('is_default',false).eq('revision',profile.revision).select('id').maybeSingle();
  if(editErr||!savedLogo){await db.storage.from('institution-document-logos').remove([path]);return failure('Identity changed before logo upload completed. Refresh and try again.',409);}
  return json({ok:true,profile_id:id,message:'Logo saved to the draft. Publish the identity to use it on new documents.'});
 }
 if(!ct.includes('application/json'))return failure('Send identity settings as JSON or upload a logo.',415);
 try{input=await req.json();}catch{return failure('Malformed JSON.');}
 if(!input||Array.isArray(input)||typeof input!=='object')return failure('Invalid request body.');
 const action=input.action||'save';
 const profileId=parseId(input.profile_id);
 if(action==='save'){
  const raw:any={};
  for(const f of allowedFields)raw[f]=textField(input[f],({organisation_name:130,organisation_tagline:150,
   postal_address:300,phone:80,email:150,website:250,header_alignment:12} as any)[f]);
  raw.label=textField(input.label||'Document identity',100);
  if(raw.label.length<2||raw.organisation_name.length<3)return failure('Enter an identity label and official institution name.');
  if(!['left','center'].includes(raw.header_alignment))return failure('Choose left or center alignment.');
  if(raw.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.email))return failure('Enter a valid email.');
  if(raw.website){let url:URL;try{url=new URL(raw.website)}catch{return failure('Enter an HTTPS website URL.');}
   if(url.protocol!=='https:')return failure('Official website must use HTTPS.');}
  const when=new Date().toISOString();
  if(profileId){
   const {data:old,error:lookupErr}=await profiles.select('*').eq('id',profileId).maybeSingle();
   if(lookupErr||!old)return failure('Identity profile not found.',404);
   if(!old.is_default){
    const {data:saved,error}=await profiles.update({...raw,status:'draft',revision:old.revision+1,updated_at:when,updated_by:user.id})
     .eq('id',profileId).eq('is_default',false).eq('revision',old.revision).select('id').maybeSingle();
    if(error||!saved)return failure('Draft changed or became default. Reload before saving.',409);
    return json({ok:true,profile_id:profileId,message:'Draft saved. Publish or mark as default to activate.'});
   }
   // Published identities are immutable through Save: create an independent draft.
   raw.logo_path=old.logo_path;raw.logo_mime=old.logo_mime;
  }
  const {data:created,error}=await profiles.insert({...raw,is_default:false,status:'draft',updated_by:user.id,updated_at:when})
   .select('id').single();
  if(error||!created)return failure('Could not create identity draft.',503);
  return json({ok:true,profile_id:created.id,message:'New identity draft saved. Publish to make it the default.'});
 }
 if(!profileId)return failure('Select a valid identity profile.');
 const {data:profile,error:lookupErr}=await profiles.select('*').eq('id',profileId).maybeSingle();
 if(lookupErr||!profile)return failure('Identity profile not found.',404);
 if(action==='publish'||action==='set_default'){
  const {data:revision,error}=await db.rpc('ahct_publish_document_identity',{p_profile:profileId,p_actor:user.id});
  if(error)return failure('Unable to publish identity. '+error.message,503);
  return json({ok:true,revision,profile_id:profileId,message:'Identity is now the default for new PDFs across every portal. Existing archived PDFs remain authentic and unchanged.'});
 }
 if(action==='delete'){
  if(profile.is_default)return failure('Cannot delete the active default. Publish another identity first.',409);
  const {data:deleted,error}=await profiles.delete().eq('id',profileId).eq('is_default',false).select('id').maybeSingle();
  if(error||!deleted)return failure('Identity became default or could not be deleted. Refresh the list.',409);
  await db.from('audit_log').insert({actor:user.id,action:'document_identity_draft_deleted',target:profileId,note:'Default identity and issued PDFs preserved'});
  if(profile.logo_path)await removeOrphanedLogo(profile.logo_path);
  return json({ok:true,message:'Non-default identity deleted.'});
 }
 if(action==='remove_logo'||action==='delete_published_logo'){
  if(!profile.logo_path)return json({ok:true,message:'This identity has no logo.'});
  if(profile.is_default){
   const {error}=await db.rpc('ahct_remove_published_document_logo',{p_profile:profileId,p_actor:user.id});
   if(error)return failure('Unable to remove live logo. '+error.message,503);
  }else{
   const {error}=await profiles.update({logo_path:null,logo_mime:null,status:'draft',revision:profile.revision+1,
    updated_by:user.id,updated_at:new Date().toISOString()}).eq('id',profileId).eq('is_default',false);
   if(error)return failure('Unable to remove draft logo.',503);
  }
  await removeOrphanedLogo(profile.logo_path);
  return json({ok:true,message:profile.is_default?'Published logo removed. New PDFs use the AH monogram.':'Draft logo removed.'});
 }
 return failure('Unsupported identity operation.',400);
}));
