-- AHCT V18.7: native institutional identity and governance; apply after 039.
-- No changes to previously issued PDF files, document histories or applied migrations.
-- The old full-page letterhead is deliberately NOT used by the new renderer.
create table if not exists public.institution_document_identity (
 id boolean primary key default true check (id),
 organisation_name text not null default 'AH Consult Ltd' check (length(organisation_name) between 3 and 130),
 organisation_tagline text not null default 'Academic & Professional Development' check(length(organisation_tagline)<=150),
 postal_address text not null default '' check(length(postal_address)<=300),
 phone text not null default '' check(length(phone)<=80),
 email text not null default '' check(length(email)<=150),
 website text not null default '' check(length(website)<=250),
 header_alignment text not null default 'left' check(header_alignment in('left','center')),
 logo_path text,
 logo_mime text check(logo_mime in ('image/png','image/jpeg')),
 revision bigint not null default 1 check(revision>0),
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now()
);
insert into public.institution_document_identity(id) values(true) on conflict(id) do nothing;
alter table public.institution_document_identity enable row level security;
revoke all on public.institution_document_identity from public,anon,authenticated;

-- Only service-role Edge Functions may read/write logo bytes. No public logos or reusable signature files.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('institution-document-logos','institution-document-logos',false,1048576,array['image/png','image/jpeg'])
 on conflict(id) do update set public=false,file_size_limit=1048576,allowed_mime_types=excluded.allowed_mime_types;

-- Registrar + academic staff are distinct controls for FINAL transcripts. Mere publication of one grade is insufficient.
create table if not exists public.document_issuance_reviews(
 application_id uuid not null references public.applications(id) on delete restrict,
 document_key text not null check(document_key in('academic_transcript','result_statement')),
 academic_review_by uuid references auth.users(id),
 academic_review_at timestamptz,
 registrar_approval_by uuid references auth.users(id),
 registrar_approval_at timestamptz,
 review_note text not null default '',
 approved_snapshot jsonb not null default '{}'::jsonb,
 primary key(application_id,document_key),
 check((academic_review_by is null)=(academic_review_at is null)),
 check((registrar_approval_by is null)=(registrar_approval_at is null)),
 check(registrar_approval_by is null or (academic_review_by is not null and registrar_approval_by <> academic_review_by))
);
alter table public.document_issuance_reviews enable row level security;
revoke all on public.document_issuance_reviews from public,anon,authenticated;

-- Revalidate eligibility at the moment of approval AND at the moment of first PDF rendering.
create or replace function public.ahct_academic_document_eligibility(p_application uuid,p_key text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare a public.applications%rowtype; total_courses int; published_courses int; reviewed_courses int;
begin
 if auth.uid() is null or not public.has_role('administrator','academic','registrar') then
   raise exception 'Academic or registrar staff account required';
 end if;
 if p_key not in ('academic_transcript','result_statement','certificate') then
   return jsonb_build_object('eligible',false,'reason','Unsupported academic document');
 end if;
 select * into a from public.applications where id=p_application;
 if a.id is null or a.admission_decision is distinct from 'approved' then
   return jsonb_build_object('eligible',false,'reason','Approved admission required');
 end if;
 if p_key='certificate' then
   return jsonb_build_object('eligible',false,'reason','Certificate awards remain on hold until AHCT approves a versioned programme-completion and award policy');
 end if;
 select count(distinct ac.course_code) into total_courses from public.application_courses ac
 where ac.application_id=p_application and coalesce(ac.deferred,false)=false;
 select count(distinct r.course_code) into published_courses from public.exam_results r
 where r.application_id=p_application and r.published_at is not null and r.grading_model is not null and r.grading_model <> 'needs_review';
 select count(distinct ac.course_code) into reviewed_courses from public.application_courses ac
 where ac.application_id=p_application and coalesce(ac.deferred,false)=false
 and exists(select 1 from public.exam_results r where r.application_id=ac.application_id
   and r.course_code=ac.course_code and r.published_at is not null
   and r.grading_model is not null and r.grading_model <> 'needs_review');
 if reviewed_courses=0 then return jsonb_build_object('eligible',false,'reason','No reviewed and published course results'); end if;
 if p_key='academic_transcript' and (total_courses=0 or reviewed_courses<total_courses) then
   return jsonb_build_object('eligible',false,'reason','Final transcript requires published, reviewed results for every non-deferred enrolled course',
     'required_courses',total_courses,'published_courses',reviewed_courses);
 end if;
 return jsonb_build_object('eligible',true,'required_courses',total_courses,'published_courses',reviewed_courses,
    'scope',case when p_key='result_statement' and reviewed_courses<total_courses then 'partial_published_results' else 'complete_published_results' end);
end $$;
revoke all on function public.ahct_academic_document_eligibility(uuid,text) from public,anon;
grant execute on function public.ahct_academic_document_eligibility(uuid,text) to authenticated,service_role;

-- Academic review followed by a DIFFERENT registrar's approval; audit both decisions.
create or replace function public.ahct_review_document_issuance(p_application uuid,p_key text,p_note text default '')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare who uuid:=auth.uid(); verdict jsonb; r public.document_issuance_reviews%rowtype;
begin
 if who is null then raise exception 'Sign-in required'; end if;
 if p_key not in ('academic_transcript','result_statement') then raise exception 'Only governed academic documents may be reviewed'; end if;
 if length(trim(coalesce(p_note,'')))<10 or length(p_note)>600 then raise exception 'Provide an evidence/review note (10–600 characters)'; end if;
 verdict:=public.ahct_academic_document_eligibility(p_application,p_key);
 if (verdict->>'eligible')::boolean is distinct from true then raise exception '%',verdict->>'reason'; end if;
 if public.has_role('academic') then
   insert into public.document_issuance_reviews(application_id,document_key,academic_review_by,academic_review_at,review_note,approved_snapshot)
   values(p_application,p_key,who,now(),trim(p_note),verdict)
   on conflict(application_id,document_key) do update
   set academic_review_by=excluded.academic_review_by,academic_review_at=now(),
       registrar_approval_by=null,registrar_approval_at=null,review_note=excluded.review_note,approved_snapshot=verdict;
   insert into public.audit_log(actor,action,target,note) values(who,'academic_document_review',p_application::text,p_key||' | '||left(p_note,300));
 elsif public.has_role('registrar') then
   select * into r from public.document_issuance_reviews where application_id=p_application and document_key=p_key for update;
   if r.academic_review_by is null then raise exception 'An academic officer must review the record before the registrar'; end if;
   if r.academic_review_by=who then raise exception 'Academic review and registrar approval require different staff accounts'; end if;
   update public.document_issuance_reviews set registrar_approval_by=who,registrar_approval_at=now(),
     approved_snapshot=verdict,review_note=left(trim(p_note),600)
    where application_id=p_application and document_key=p_key;
   insert into public.audit_log(actor,action,target,note) values(who,'registrar_document_approval',p_application::text,p_key||' | '||left(p_note,300));
 else
   raise exception 'Only academic officers and registrars can approve academic documents. Admin rights alone do not authorize academic awards';
 end if;
 return jsonb_build_object('ok',true,'document_key',p_key,'eligibility',verdict,
 'stage',case when public.has_role('registrar') then 'registrar_approved' else 'academic_reviewed' end);
end $$;
revoke all on function public.ahct_review_document_issuance(uuid,text,text) from public,anon;
grant execute on function public.ahct_review_document_issuance(uuid,text,text) to authenticated;

-- Replace previously permissive bulk FINAL transcript issuance. Historic issued PDF bytes are never rewritten.
create or replace function public.admin_issue_academic_records(p_applications uuid[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare aid uuid; a public.applications%rowtype; review public.document_issuance_reviews%rowtype;
 v jsonb; ok jsonb:='[]'::jsonb; skipped jsonb:='[]'::jsonb;
begin
 if auth.uid() is null or not public.has_role('registrar') then raise exception 'Registrar approval required to issue final transcripts'; end if;
 if cardinality(p_applications)>50 then raise exception 'Batch limit is 50'; end if;
 foreach aid in array p_applications loop
  select * into a from public.applications where id=aid;
  select * into review from public.document_issuance_reviews where application_id=aid and document_key='academic_transcript';
  v:=public.ahct_academic_document_eligibility(aid,'academic_transcript');
  if a.id is null or review.registrar_approval_at is null or (v->>'eligible')::boolean is distinct from true then
    skipped:=skipped||jsonb_build_object('id',aid,'reason',coalesce(v->>'reason','Missing two-stage academic and registrar approval'));
  else
    insert into public.student_documents(user_id,application_id,title,document_type,status,document_key,issued_at,metadata)
    values(a.user_id,a.id,'Academic Transcript','transcript','available','academic_transcript',now(),
    jsonb_build_object('issuance_review',true,'published_courses',v->'published_courses'))
    on conflict(user_id,document_key) where document_key is not null
    do update set status='available',issued_at=excluded.issued_at,metadata=excluded.metadata
    where not (public.student_documents.metadata ? 'pdf_path');
    insert into public.audit_log(actor,action,target,note) values(auth.uid(),'transcript_issued',coalesce(a.student_id,aid::text),'approved complete transcript');
    ok:=ok||to_jsonb(aid);
  end if;
 end loop;
 return jsonb_build_object('issued',ok,'skipped',skipped);
end $$;
revoke all on function public.admin_issue_academic_records(uuid[]) from public,anon;
grant execute on function public.admin_issue_academic_records(uuid[]) to authenticated;

-- Result statements remain scoped to PUBLISHED, REVIEWED results; require the same two-stage approval for new issuance.
create or replace function public.admin_issue_result_statements(p_applications uuid[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare aid uuid; a public.applications%rowtype; review public.document_issuance_reviews%rowtype;
 v jsonb; ok jsonb:='[]'::jsonb; skipped jsonb:='[]'::jsonb;
begin
 if auth.uid() is null or not public.has_role('registrar') then raise exception 'Registrar approval required to issue official statements'; end if;
 if cardinality(p_applications)>50 then raise exception 'Batch limit is 50'; end if;
 foreach aid in array p_applications loop
  select * into a from public.applications where id=aid;
  select * into review from public.document_issuance_reviews where application_id=aid and document_key='result_statement';
  v:=public.ahct_academic_document_eligibility(aid,'result_statement');
  if a.id is null or review.registrar_approval_at is null or (v->>'eligible')::boolean is distinct from true then
    skipped:=skipped||jsonb_build_object('id',aid,'reason',coalesce(v->>'reason','Missing two-stage academic and registrar approval'));
  else
    insert into public.student_documents(user_id,application_id,title,document_type,status,document_key,issued_at,metadata)
    values(a.user_id,a.id,'Academic Result Statement','result','available','result_statement',now(),
      jsonb_build_object('issuance_review',true,'scope',v->>'scope'))
    on conflict(user_id,document_key) where document_key is not null
    do update set status='available',issued_at=excluded.issued_at,metadata=excluded.metadata
    where not (public.student_documents.metadata ? 'pdf_path');
    insert into public.audit_log(actor,action,target,note) values(auth.uid(),'result_statement_issued',coalesce(a.student_id,aid::text),'approved results statement');
    ok:=ok||to_jsonb(aid);
  end if;
 end loop;
 return jsonb_build_object('issued',ok,'skipped',skipped);
end $$;
revoke all on function public.admin_issue_result_statements(uuid[]) from public,anon;
grant execute on function public.admin_issue_result_statements(uuid[]) to authenticated;

-- Any academic source-record change revokes the approval snapshot; review must be repeated.
create or replace function public.ahct_invalidate_academic_issuance_review()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare affected uuid; n integer;
begin
 if tg_op='DELETE' then affected:=old.application_id; else affected:=new.application_id; end if;
 update public.document_issuance_reviews set academic_review_by=null,academic_review_at=null,
  registrar_approval_by=null,registrar_approval_at=null,approved_snapshot='{}'::jsonb,
  review_note='Previous approvals invalidated by updated academic source records'
 where application_id=affected and academic_review_by is not null;
 get diagnostics n=row_count;
 if n>0 then insert into public.audit_log(actor,action,target,note)
  values(auth.uid(),'academic_document_approvals_invalidated',affected::text,coalesce(tg_table_name,'academic record')||' changed');
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
drop trigger if exists ahct_invalidate_reviews_on_results on public.exam_results;
create trigger ahct_invalidate_reviews_on_results after insert or update or delete on public.exam_results
for each row execute function public.ahct_invalidate_academic_issuance_review();
drop trigger if exists ahct_invalidate_reviews_on_enrolment on public.application_courses;
create trigger ahct_invalidate_reviews_on_enrolment after insert or update or delete on public.application_courses
for each row execute function public.ahct_invalidate_academic_issuance_review();

-- Prevent old unarchived academic rows (created under permissive V18.6 rules)
-- from masquerading as already issued. Never touch archived, fingerprinted PDFs.
update public.student_documents
set status='pending',issued_at=null,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('requires_issuance_review',true)
where document_key in ('academic_transcript','result_statement')
  and status='available' and not (coalesce(metadata,'{}'::jsonb) ? 'pdf_path');
