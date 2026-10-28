-- AH CONSULT V18.2 | APPLY ON BACKED-UP STAGING AFTER 029.
-- All administrative operations below check claims server side.

-- Public aggregate endpoints: no anonymous EXECUTE on SECURITY DEFINER functions.
-- Expose one trusted, aggregate-only VIEW; callers receive no underlying rows.
create or replace view public.public_website_aggregates as
select
 (select nullif(count(distinct a.user_id)::integer,0) from public.applications a
  where a.admission_decision='approved' and a.paid_at is not null and a.status in ('paid','submitted','under_review','approved')) as learners_enrolled,
 (select nullif(count(distinct j.user_id)::integer,0) from public.document_jobs j where j.document_key='certificate' and j.status='issued') as graduates,
 (select nullif(count(distinct c.name)::integer,0) from public.courses c where c.is_active) as programmes,
 (select nullif(count(*)::integer,0) from public.courses c where c.is_active) as active_course_options,
 (select nullif(count(*)::integer,0) from public.intakes i where i.is_active and (i.closes_at is null or i.closes_at>=now())) as active_intakes;
revoke all on public.public_website_aggregates from public;
grant select on public.public_website_aggregates to anon,authenticated;
create or replace function public.public_impact_stats() returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('learners_enrolled',learners_enrolled,'graduates',graduates,'programmes',programmes,
 'active_intakes',active_intakes,'as_of',now()) from public.public_website_aggregates;
$$;
create or replace function public.public_homepage_metrics() returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('admitted_learners',learners_enrolled,'active_programmes',programmes,
 'active_course_options',active_course_options,'active_intakes',active_intakes) from public.public_website_aggregates;
$$;
revoke all on function public.public_impact_stats() from public;
revoke all on function public.public_homepage_metrics() from public;
grant execute on function public.public_impact_stats() to anon,authenticated;
grant execute on function public.public_homepage_metrics() to anon,authenticated;

-- A publication boundary must be enforced by SQL, not only hidden in HTML.
-- The updated portal_data(), student_academic_record() and published_student_results()
-- definitions below are refreshed from migration 021 with added suppression of
-- unpublished assignment marks and unreviewed assessment scores.

-- Maintain institutional templates and named authorized signatories.
alter table public.document_templates add column if not exists letterhead text;
alter table public.document_templates add column if not exists body_text text;
alter table public.document_templates add column if not exists signatory_name text;
alter table public.document_templates add column if not exists signatory_title text;
alter table public.document_templates add column if not exists footer_text text;
create or replace function public.admin_update_document_template(p_key text,p_letterhead text,p_body text,p_signatory text,p_title text,p_footer text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not public.has_role('administrator') then raise exception 'Administrator required'; end if;
 if p_key not in ('admission_letter','payment_receipt','academic_transcript','certificate','deferment_letter','result_statement') then raise exception 'Unsupported template'; end if;
 if length(coalesce(p_body,''))>6000 or length(coalesce(p_letterhead,''))>250 or length(coalesce(p_footer,''))>500 then raise exception 'Template text too long'; end if;
 update public.document_templates set letterhead=left(trim(p_letterhead),250),body_text=left(trim(p_body),6000),
 signatory_name=left(trim(p_signatory),150),signatory_title=left(trim(p_title),150),footer_text=left(trim(p_footer),500),
 version=version+1,updated_at=now() where key=p_key;
 if not found then raise exception 'Template not found'; end if;
 insert into public.audit_log(actor,action,target,note) values(auth.uid(),'document_template_updated',p_key,'New version saved');
end $$;
revoke all on function public.admin_update_document_template(text,text,text,text,text,text) from public,anon;
grant execute on function public.admin_update_document_template(text,text,text,text,text,text) to authenticated;
insert into public.document_templates(key,title,document_type,template_html)
values ('deferment_letter','Deferment Letter','deferment_letter','AH CONSULT LTD|DEFERMENT LETTER') on conflict(key) do nothing;

-- Rejected applicants may correct identity and contact fields, not amounts, grades, status or payments.
create or replace function public.correct_rejected_application(p_application uuid,p_details jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.applications%rowtype; cleaned jsonb; k text; val text;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select * into a from public.applications where id=p_application and user_id=auth.uid() for update;
 if not found or a.admission_decision <> 'rejected' then raise exception 'Only your rejected application may be corrected'; end if;
 if jsonb_typeof(p_details)<>'object' then raise exception 'Invalid correction form'; end if;
 cleaned:=coalesce(a.form_data,'{}'::jsonb);
 foreach k in array array['firstName','surname','otherNames','phone','address','state','lga','city','dob','gender'] loop
   if p_details ? k then
     val:=trim(p_details->>k);
     if length(val)>250 then raise exception 'Field too long: %',k; end if;
     cleaned:=jsonb_set(cleaned,array[k],to_jsonb(val),true);
   end if;
 end loop;
 if length(trim(coalesce(cleaned->>'firstName','')))<2 or length(trim(coalesce(cleaned->>'surname','')))<2 then raise exception 'First name and surname are required'; end if;
 update public.applications set form_data=cleaned,status='under_review',admission_decision='under_review',
 admission_note='Applicant submitted corrected details for reconsideration.',reviewed_at=null,reviewed_by=null
 where id=p_application;
 insert into public.audit_log(actor,action,target,note) values(auth.uid(),'rejected_application_corrected',coalesce(a.student_id,a.pay_reference,a.id::text),'Applicant correction submitted for renewed review');
 return jsonb_build_object('ok',true,'status','under_review');
end $$;
revoke all on function public.correct_rejected_application(uuid,jsonb) from public,anon;
grant execute on function public.correct_rejected_application(uuid,jsonb) to authenticated;

-- An honest, non-destructive financial ledger is retained for removed non-admitted applications.
create table if not exists public.application_erasure_register(
 application_id uuid primary key, reference text, previous_decision text, actor uuid,
 reason text not null, detached_payments integer not null, amount_paid_ngn numeric not null,
 erased_at timestamptz not null default now());
revoke all on public.application_erasure_register from public,anon,authenticated;
alter table public.application_erasure_register enable row level security;

create or replace function public.admin_delete_nonadmitted(p_application uuid,p_confirm text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.applications%rowtype; code text; n integer; total numeric; who text;
begin
 if auth.uid() is null or not public.has_role('administrator') then raise exception using errcode='42501',message='Administrator access required'; end if;
 if length(trim(coalesce(p_reason,'')))<10 then raise exception using errcode='22023',message='Enter a reason of at least 10 characters'; end if;
 select * into a from public.applications where id=p_application for update;
 if not found then raise exception using errcode='P0002',message='Application not found'; end if;
 if a.admission_decision='approved' then raise exception using errcode='23514',message='Admitted students cannot be permanently deleted'; end if;
 code:=coalesce(nullif(a.student_id,''),nullif(a.pay_reference,''),upper(left(a.id::text,8)));
 if upper(trim(coalesce(p_confirm,'')))<>upper(code) then raise exception using errcode='22023',message='Reference confirmation does not match'; end if;
 -- Issued institutional records cannot be destroyed accidentally by reversing a decision.
 if exists(select 1 from public.student_documents where application_id=a.id and status='available' and document_key in ('admission_letter','academic_transcript','result_statement','deferment_letter','certificate'))
    or exists(select 1 from public.document_jobs where application_id=a.id and status='issued' and document_key<>'payment_receipt') then
   raise exception using errcode='23514',message='An issued institutional document must be revoked and retained under a separate authorized record-retention procedure';
 end if;
 select count(*),coalesce(sum(paid_ngn),0) into n,total from public.payments where application_id=a.id;
 insert into public.application_erasure_register(application_id,reference,previous_decision,actor,reason,detached_payments,amount_paid_ngn)
 values(a.id,code,a.admission_decision,auth.uid(),left(trim(p_reason),800),n,total);
 -- Preserve issued financial receipts independently of the application, for retention.
 update public.student_documents set application_id=null where application_id=a.id and document_key='payment_receipt';
 -- Payments are not deleted; their unique transaction references, provider data and amounts survive.
 update public.payments set application_id=null where application_id=a.id;
 delete from public.sheet_outbox where application_id=a.id and done=false;
 delete from public.applications where id=a.id;
 insert into public.sheet_outbox(application_id,kind) values(a.id,'delete_app');
 select full_name into who from public.staff where id=auth.uid();
 insert into public.audit_log(actor,actor_name,action,target,note)
 values(auth.uid(),coalesce(who,'Administrator'),'application_deleted',code,
 left(trim(p_reason),800)||' | detached payment records: '||n::text);
 return jsonb_build_object('ok',true,'reference',code,'passport_path',a.passport_path,'detached_payments',n);
end $$;
revoke all on function public.admin_delete_nonadmitted(uuid,text,text) from public,anon,authenticated;
grant execute on function public.admin_delete_nonadmitted(uuid,text,text) to authenticated;

-- New applications with approved admissions get an issued admission record automatically.
-- An authorised PDF can be fetched through student-document using its record ID.
create or replace function public.auto_student_documents() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.admission_decision='approved' and (tg_op='INSERT' or old.admission_decision is distinct from 'approved') then
   insert into public.student_documents(user_id,application_id,title,document_type,status,document_key,issued_at,metadata)
   values(new.user_id,new.id,'Admission Letter','admission_letter','available','admission_letter',now(),
    jsonb_build_object('student_id',new.student_id,'admission_date',now(),'source','automatic_approval'))
   on conflict(user_id,document_key) where document_key is not null
   do update set application_id=excluded.application_id,status='available',issued_at=excluded.issued_at,metadata=excluded.metadata;
 end if;
 return new;
end $$;
drop trigger if exists v18_auto_admission_documents on public.applications;
create trigger v18_auto_admission_documents after insert or update of admission_decision on public.applications
 for each row execute function public.auto_student_documents();
-- Backfill approved students missing admission letters.
insert into public.student_documents(user_id,application_id,title,document_type,status,document_key,issued_at,metadata)
select a.user_id,a.id,'Admission Letter','admission_letter','available','admission_letter',coalesce(a.reviewed_at,now()),
 jsonb_build_object('student_id',a.student_id,'source','backfill') from public.applications a
 where a.admission_decision='approved'
on conflict(user_id,document_key) where document_key is not null do nothing;

create or replace function public.auto_verified_receipts() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.applications%rowtype;
begin
 if new.verified_at is null or coalesce(new.expected_ngn,0)<=0 or coalesce(new.paid_ngn,0)<new.expected_ngn or new.application_id is null then return new; end if;
 select * into a from public.applications where id=new.application_id;
 if not found then return new; end if;
 insert into public.student_documents(user_id,application_id,title,document_type,status,document_key,issued_at,metadata)
 values(a.user_id,a.id,'Payment Receipt','payment_receipt','available','payment_receipt',new.verified_at,
 jsonb_build_object('payment_reference',new.reference,'payment_id',new.id))
 on conflict(user_id,document_key) where document_key is not null
 do update set application_id=excluded.application_id,status='available',issued_at=excluded.issued_at,metadata=excluded.metadata;
 return new;
end $$;
drop trigger if exists v18_auto_verified_receipts on public.payments;
create trigger v18_auto_verified_receipts after insert or update of verified_at on public.payments
 for each row execute function public.auto_verified_receipts();
insert into public.student_documents(user_id,application_id,title,document_type,status,document_key,issued_at,metadata)
select a.user_id,a.id,'Payment Receipt','payment_receipt','available','payment_receipt',p.verified_at,
 jsonb_build_object('payment_reference',p.reference,'payment_id',p.id)
from public.payments p join public.applications a on a.id=p.application_id
where p.verified_at is not null and p.expected_ngn>0 and p.paid_ngn>=p.expected_ngn
on conflict(user_id,document_key) where document_key is not null do nothing;

-- Student PDF downloads require an issued/available institutional record.
-- Academic issuance must never infer completion from mere course registration.
create or replace function public.admin_issue_academic_records(p_applications uuid[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare aid uuid; a public.applications%rowtype; ok jsonb:='[]'::jsonb; failures jsonb:='[]'::jsonb; n int;
begin
 if auth.uid() is null or not public.has_role('administrator','academic','registrar') then raise exception 'Academic/registrar access required'; end if;
 if cardinality(p_applications)>50 then raise exception 'Batch limit is 50'; end if;
 foreach aid in array p_applications loop
  select * into a from public.applications where id=aid;
  select count(*) into n from public.exam_results r where r.application_id=aid and r.published_at is not null and r.grading_model<>'needs_review';
  if a.id is null or a.admission_decision<>'approved' or n=0 then
   failures:=failures||jsonb_build_object('id',aid,'reason','No completed and published exams, or admission not approved');
  else
   insert into public.student_documents(user_id,application_id,title,document_type,status,document_key,issued_at,metadata)
    values(a.user_id,a.id,'Academic Transcript','transcript','available','academic_transcript',now(),jsonb_build_object('published_results',n))
    on conflict(user_id,document_key) where document_key is not null
    do update set application_id=excluded.application_id,status='available',issued_at=excluded.issued_at,metadata=excluded.metadata;
   insert into public.audit_log(actor,action,target,note) values(auth.uid(),'transcript_issued',coalesce(a.student_id,aid::text),n||' published result(s)');
   ok:=ok||to_jsonb(aid);
  end if;
 end loop;
 return jsonb_build_object('issued',ok,'skipped',failures);
end $$;
revoke all on function public.admin_issue_academic_records(uuid[]) from public,anon;
grant execute on function public.admin_issue_academic_records(uuid[]) to authenticated;

-- Staff can edit templates; students see only an authorised, PII-scoped snapshot.
create or replace function public.student_document_snapshot(p_application uuid,p_key text)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare a public.applications%rowtype; t public.document_templates%rowtype; d public.student_documents%rowtype;
  grades jsonb; pay jsonb; def jsonb; fullname text; intake_name text; course_names text;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select * into a from public.applications where id=p_application and user_id=auth.uid();
 if not found then raise exception 'Application is not linked to this account'; end if;
 select * into t from public.document_templates where key=case when p_key='result' then 'result_statement' else p_key end;
 if p_key not in('result','admission_letter','deferment_letter','payment_receipt','academic_transcript') then raise exception 'Unknown document type'; end if;
 select * into d from public.student_documents where application_id=a.id and user_id=auth.uid() and document_key=case when p_key='result' then 'result_statement' else p_key end and status='available' limit 1;
 if p_key not in('result','deferment_letter') and not found then raise exception 'Document has not been issued yet'; end if;
 if p_key in('result','academic_transcript') and a.admission_decision<>'approved' then raise exception 'Admission required to view academic records'; end if;
 if p_key='admission_letter' and a.admission_decision<>'approved' then raise exception 'Admission is not approved'; end if;
 if p_key='deferment_letter' and not exists(select 1 from public.deferments where application_id=a.id and status='approved') then raise exception 'No approved deferment is recorded'; end if;
 select p.full_name into fullname from public.profiles p where p.id=a.user_id;
 select i.label into intake_name from public.intakes i where i.id=a.intake_id;
 select string_agg(c.name,', ' order by c.name) into course_names from public.application_courses ac join public.courses c on c.code=ac.course_code where ac.application_id=a.id;
 select coalesce(jsonb_agg(jsonb_build_object('course',c.name,'code',r.course_code,'total',r.total,'grade',r.band)
 order by c.name),'[]'::jsonb) into grades
 from public.exam_results r join public.courses c on c.code=r.course_code
 where r.application_id=a.id and r.published_at is not null and r.grading_model<>'needs_review';
 select to_jsonb(z) into pay from (select reference,paid_ngn,verified_at from public.payments
  where application_id=a.id and verified_at is not null and paid_ngn>0 order by verified_at desc limit 1) z;
 select to_jsonb(z) into def from (select scope,reason,decided_at from public.deferments
  where application_id=a.id and status='approved' order by decided_at desc limit 1) z;
 return jsonb_build_object('document_id',d.id,'key',p_key,'reference',coalesce(a.student_id,a.pay_reference,a.id::text),
 'name',fullname,'intake',intake_name,'courses',course_names,'decision',a.admission_decision,
 'admission_date',a.reviewed_at,'grades',grades,'payment',pay,'deferment',def,
 'letterhead',coalesce(t.letterhead,'AH CONSULT LTD'),'body_text',coalesce(t.body_text,''),
 'signatory_name',coalesce(t.signatory_name,''),'signatory_title',coalesce(t.signatory_title,''),'footer',coalesce(t.footer_text,''));
end $$;
revoke all on function public.student_document_snapshot(uuid,text) from public,anon;
grant execute on function public.student_document_snapshot(uuid,text) to authenticated;


-- Refresh publication-safe student RPC portal_data
create or replace function public.portal_data()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  perf jsonb;
  applications_payload jsonb;
  assignments_payload jsonb;
  lectures_payload jsonb;
  exams_payload jsonb;
  additions_payload jsonb;
  deferments_payload jsonb;
  catalog_payload jsonb;
  open_intakes_payload jsonb;
  result_payload jsonb;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  select to_jsonb(z)
    into perf
  from (
    with avgs as (
      select
        a.id as aid,
        a.intake_id,
        a.user_id,
        avg(e.total) as av,
        count(e.total) as n
      from public.applications a
      join public.exam_results e on e.application_id = a.id
      where a.admission_decision = 'approved'
        and e.published_at is not null
        and e.grading_model <> 'needs_review'
      group by a.id, a.intake_id, a.user_id
    ), ranked as (
      select *, rank() over (partition by intake_id order by av desc) as rk
      from avgs
    )
    select
      aid as application_id,
      round(av, 1) as average,
      rk as rank,
      n as graded,
      (
        select count(*)
        from public.applications x
        where x.intake_id = ranked.intake_id
          and x.admission_decision = 'approved'
      ) as class_size
    from ranked
    where user_id = uid
    order by aid desc
    limit 1
  ) z;

  select coalesce(jsonb_agg(a order by a.created_at desc), '[]'::jsonb)
    into applications_payload
  from (
    select
      ap.id,
      ap.student_id,
      ap.status,
      ap.admission_decision,
      ap.admission_note,
      ap.intake_id,
      i.label as intake_label,
      ap.total_ngn,
      ap.package_code,
      ap.pay_bank,
      ap.pay_account,
      ap.pay_reference,
      ap.passport_path,
      ap.form_data,
      ap.created_at,
      ap.paid_at,
      ap.submitted_at,
      ap.reviewed_at,
      ap.welcomed_at,
      (ap.admission_decision = 'approved') as admitted,
      coalesce((
        select jsonb_agg(course_row order by course_row.category, course_row.name)
        from (
          select
            c.code,
            c.name,
            c.category,
            ac.fee_ngn as fee,
            ac.deferred,
            coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', l.id,
                'name', l.full_name,
                'email', l.email,
                'phone', l.phone
              ))
              from public.lecturer_courses lc
              join public.lecturers l on l.id = lc.lecturer_id
              where lc.course_code = c.code
                and l.is_active
            ), '[]'::jsonb) as tutors,
            case
              when er.id is null
                or er.published_at is null
                or er.grading_model = 'needs_review'
              then null
              else jsonb_build_object(
                'attendance', er.attendance,
                'ca', er.ca,
                'exams', er.exams,
                'legacy_exam_obj', er.exam_obj,
                'legacy_exam_prac', er.exam_prac,
                'grading_model', er.grading_model,
                'total', er.total,
                'band', er.band,
                'published', true,
                'locked', er.locked_at is not null,
                'revision', er.revision_no
              )
            end as result
          from public.application_courses ac
          join public.courses c on c.code = ac.course_code
          left join public.exam_results er
            on er.application_id = ac.application_id
           and er.course_code = ac.course_code
          where ac.application_id = ap.id
        ) course_row
      ), '[]'::jsonb) as courses
    from public.applications ap
    join public.intakes i on i.id = ap.intake_id
    where ap.user_id = uid
      and ap.status <> 'expired'
  ) a;

  select coalesce(jsonb_agg(x order by x.due_at nulls last), '[]'::jsonb)
    into assignments_payload
  from (
    select
      s.id,
      s.title,
      s.description,
      s.due_at,
      s.max_score,
      s.closed,
      s.course_code,
      c.name as course_name,
      c.category as course_category,
      s.submission_type,
      s.file_required,
      s.external_url,
      s.question_set,
      ap.id as application_id,
      (
        select to_jsonb(q)
        from (
          select id, body, file_path, submitted_at,
             case when exists(select 1 from public.exam_results erpub where erpub.application_id=ap.id and erpub.course_code=s.course_code and erpub.published_at is not null and erpub.grading_model <> 'needs_review') then marks else null end as marks,
             case when exists(select 1 from public.exam_results erpub where erpub.application_id=ap.id and erpub.course_code=s.course_code and erpub.published_at is not null and erpub.grading_model <> 'needs_review') then feedback else null end as feedback,
             case when exists(select 1 from public.exam_results erpub where erpub.application_id=ap.id and erpub.course_code=s.course_code and erpub.published_at is not null and erpub.grading_model <> 'needs_review') then graded_at else null end as graded_at
          from public.submissions sub
          where sub.assignment_id = s.id
            and sub.application_id = ap.id
        ) q
      ) as submission
    from public.assignments s
    join public.application_courses ac
      on ac.course_code = s.course_code
     and not ac.deferred
    join public.applications ap
      on ap.id = ac.application_id
     and ap.user_id = uid
     and ap.admission_decision = 'approved'
     and (s.intake_id is null or s.intake_id = ap.intake_id)
    join public.courses c on c.code = s.course_code
  ) x;

  select coalesce(jsonb_agg(x order by x.held_at desc), '[]'::jsonb)
    into lectures_payload
  from (
    select
      lt.id,
      lt.title,
      lt.description,
      lt.held_at,
      lt.course_code,
      c.name as course_name,
      c.category as course_category,
      lt.material_path,
      l.full_name as tutor
    from public.lectures lt
    join public.application_courses ac
      on ac.course_code = lt.course_code
     and not ac.deferred
    join public.applications ap
      on ap.id = ac.application_id
     and ap.user_id = uid
     and ap.admission_decision = 'approved'
     and (lt.intake_id is null or lt.intake_id = ap.intake_id)
    join public.courses c on c.code = lt.course_code
    left join public.lecturers l on l.id = lt.lecturer_id
  ) x;

  select coalesce(jsonb_agg(x order by x.due_at nulls last), '[]'::jsonb)
    into exams_payload
  from (
    select
      e.id,
      e.title,
      e.instructions,
      e.due_at,
      e.course_code,
      c.name as course_name,
      c.category as course_category,
      e.submission_type,
      e.file_required,
      e.external_url,
      e.time_limit_minutes,
      e.question_set,
      ap.id as application_id,
      (
        select (to_jsonb(attempt_row) - 'score' - 'percentage' - 'total' - 'marks' - 'correct_count' - 'points' - 'graded_at' - 'feedback' - 'result' - 'auto_score' - 'manual_score')
        from public.assessment_attempts attempt_row
        where attempt_row.assessment_type = 'exam'
          and attempt_row.assessment_id = e.id
          and attempt_row.application_id = ap.id
      ) as attempt
    from public.exams e
    join public.application_courses ac
      on ac.course_code = e.course_code
     and not ac.deferred
    join public.applications ap
      on ap.id = ac.application_id
     and ap.user_id = uid
     and ap.admission_decision = 'approved'
     and (e.intake_id is null or e.intake_id = ap.intake_id)
    join public.courses c on c.code = e.course_code
  ) x;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb)
    into additions_payload
  from (
    select
      ca.id,
      ca.application_id,
      ca.course_code,
      c.name as course_name,
      c.category as course_category,
      ca.fee_ngn,
      ca.status,
      ca.note,
      ca.created_at
    from public.course_additions ca
    join public.applications ap on ap.id = ca.application_id
    join public.courses c on c.code = ca.course_code
    where ap.user_id = uid
  ) q;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb)
    into deferments_payload
  from (
    select
      d.id,
      d.application_id,
      d.scope,
      d.course_codes,
      d.reason_type,
      d.reason,
      d.status,
      d.admin_note,
      d.created_at,
      d.decided_at,
      ri.label as return_label,
      (
        select coalesce(jsonb_agg(c.name || ' (' || c.category || ')'), '[]'::jsonb)
        from public.courses c
        where c.code = any(d.course_codes)
      ) as course_names
    from public.deferments d
    join public.applications ap on ap.id = d.application_id
    left join public.intakes ri on ri.id = d.return_intake_id
    where ap.user_id = uid
  ) q;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'code', code,
      'name', name,
      'category', category,
      'fee', fee_ngn
    ) order by category, name),
    '[]'::jsonb
  )
  into catalog_payload
  from public.courses
  where is_active;

  select coalesce(
    jsonb_agg(jsonb_build_object('id', id, 'label', label) order by label),
    '[]'::jsonb
  )
  into open_intakes_payload
  from public.intakes
  where is_active
    and (opens_at is null or opens_at <= now())
    and (closes_at is null or closes_at >= now());

  select jsonb_build_object(
    'profile', (
      select to_jsonb(p)
      from (
        select full_name, phone, email
        from public.profiles
        where id = uid
      ) p
    ),
    'applications', applications_payload,
    'assignments', assignments_payload,
    'lectures', lectures_payload,
    'exams', exams_payload,
    'performance', perf,
    'additions', additions_payload,
    'deferments', deferments_payload,
    'catalog', catalog_payload,
    'open_intakes', open_intakes_payload
  )
  into result_payload;

  return result_payload;
end;
$$;


-- Refresh publication-safe student RPC student_academic_record
create or replace function public.student_academic_record(p_application uuid default null)
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare uid uuid:=auth.uid(); aid uuid; result_payload jsonb;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  select id into aid from public.applications
  where user_id=uid and admission_decision='approved' and (p_application is null or id=p_application)
  order by created_at desc limit 1;
  if aid is null then return jsonb_build_object('student',null,'courses','[]'::jsonb,'summary',null,'timeline','[]'::jsonb); end if;

  select jsonb_build_object(
    'student',(select jsonb_build_object('application_id',a.id,'student_id',a.student_id,
      'name',coalesce(nullif(trim(coalesce(a.form_data->>'surname','')||' '||coalesce(a.form_data->>'firstName','')),''),p.full_name),
      'email',p.email,'intake',i.label,'admission_decision',a.admission_decision)
      from public.applications a join public.profiles p on p.id=a.user_id join public.intakes i on i.id=a.intake_id where a.id=aid),
    'courses',coalesce((select jsonb_agg(jsonb_build_object(
      'code',c.code,'name',c.name,'category',c.category,'deferred',ac.deferred,
      'result',case
        when er.id is null then null
        when er.published_at is null then jsonb_build_object('published',false,'locked',er.locked_at is not null,'review_required',er.grading_model='needs_review')
        when er.grading_model='needs_review' then jsonb_build_object('published',true,'locked',er.locked_at is not null,'review_required',true,'grading_model','needs_review')
        else jsonb_build_object(
          'attendance',er.attendance,'ca',er.ca,'exams',er.exams,
          'legacy_exam_obj',er.exam_obj,'legacy_exam_prac',er.exam_prac,
          'grading_model',er.grading_model,'total',er.total,'band',er.band,
          'published',true,'locked',er.locked_at is not null,'revision',er.revision_no)
      end
    ) order by c.category,c.name) from public.application_courses ac join public.courses c on c.code=ac.course_code
       left join public.exam_results er on er.application_id=ac.application_id and er.course_code=ac.course_code
       where ac.application_id=aid),'[]'::jsonb),
    'summary',(select jsonb_build_object('graded',count(er.total) filter(where er.published_at is not null and er.grading_model <> 'needs_review'),
      'courses',count(ac.course_code),'average',round(avg(er.total) filter(where er.published_at is not null and er.grading_model <> 'needs_review'),1),
      'published',count(*) filter(where er.published_at is not null and er.grading_model <> 'needs_review'),'locked',count(*) filter(where er.locked_at is not null and er.grading_model <> 'needs_review'))
      from public.application_courses ac left join public.exam_results er on er.application_id=ac.application_id and er.course_code=ac.course_code
      where ac.application_id=aid and not ac.deferred),
    'timeline',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc) from public.application_state_history h where h.application_id=aid),'[]'::jsonb)
  ) into result_payload;
  return result_payload;
end $$;


-- Refresh publication-safe student RPC published_student_results
create or replace function public.published_student_results(p_application uuid)
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare uid uuid:=auth.uid(); result_payload jsonb;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not exists(select 1 from public.applications where id=p_application and user_id=uid and admission_decision='approved') then
    raise exception 'Application not found';
  end if;
  select coalesce(jsonb_agg(
    case when er.grading_model='needs_review' then
      jsonb_build_object('code',er.course_code,'published',true,'review_required',true,'published_at',er.published_at)
    else jsonb_build_object(
      'code',er.course_code,'attendance',er.attendance,'ca',er.ca,'exams',er.exams,
      'legacy_exam_obj',er.exam_obj,'legacy_exam_prac',er.exam_prac,
      'grading_model',er.grading_model,'total',er.total,'band',er.band,'published',true,'published_at',er.published_at)
    end order by er.course_code),'[]'::jsonb) into result_payload
  from public.exam_results er where er.application_id=p_application and er.published_at is not null;
  return result_payload;
end $$;

create or replace function public.admin_read_document_template(p_key text)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare t public.document_templates%rowtype;
begin
 if auth.uid() is null or not public.has_role('administrator') then raise exception 'Administrator required'; end if;
 select * into t from public.document_templates where key=p_key;
 if not found then raise exception 'Document template not found'; end if;
 return jsonb_build_object('letterhead',t.letterhead,'body_text',t.body_text,'signatory_name',t.signatory_name,
 'signatory_title',t.signatory_title,'footer_text',t.footer_text,'version',t.version);
end $$;
revoke all on function public.admin_read_document_template(text) from public,anon;
grant execute on function public.admin_read_document_template(text) to authenticated;

create or replace function public.admin_ensure_admission_document(p_application uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.applications%rowtype; doc uuid;
begin
 if auth.uid() is null or not public.has_role('administrator','registrar') then raise exception 'Admissions staff access required'; end if;
 select * into a from public.applications where id=p_application;
 if not found or a.admission_decision<>'approved' then raise exception 'Admission not approved'; end if;
 insert into public.student_documents(user_id,application_id,title,document_type,status,document_key,issued_at,metadata)
 values(a.user_id,a.id,'Admission Letter','admission_letter','available','admission_letter',coalesce(a.reviewed_at,now()),jsonb_build_object('source','staff-issued'))
 on conflict(user_id,document_key) where document_key is not null
 do update set application_id=excluded.application_id,status='available'
 returning id into doc;
 insert into public.audit_log(actor,action,target,note) values(auth.uid(),'admission_letter_available',coalesce(a.student_id,a.id::text),'Student document available in applicant portal');
 return doc;
end $$;
revoke all on function public.admin_ensure_admission_document(uuid) from public,anon;
grant execute on function public.admin_ensure_admission_document(uuid) to authenticated;

-- Deferment decisions create their own private document record on approval.
create or replace function public.auto_deferment_document() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.applications%rowtype;
begin
 if new.status='approved' and (tg_op='INSERT' or old.status is distinct from 'approved') then
  select * into a from public.applications where id=new.application_id;
  if found then
   insert into public.student_documents(user_id,application_id,title,document_type,status,document_key,issued_at,metadata)
   values(a.user_id,a.id,'Deferment Letter','deferment_letter','available','deferment_letter',coalesce(new.decided_at,now()),jsonb_build_object('deferment_id',new.id))
   on conflict(user_id,document_key) where document_key is not null
   do update set application_id=excluded.application_id,status='available',issued_at=excluded.issued_at,metadata=excluded.metadata;
  end if;
 end if;
 return new;
end $$;
drop trigger if exists v18_auto_deferment_documents on public.deferments;
create trigger v18_auto_deferment_documents after insert or update of status on public.deferments
 for each row execute function public.auto_deferment_document();

-- Academic result statements are separately issuable from transcripts, using exactly
-- the same published-grade eligibility. They are never created for draft/no-exam records.
insert into public.document_templates(key,title,document_type,template_html)
values ('result_statement','Academic Result Statement','result','AH CONSULT LTD|ACADEMIC RESULT STATEMENT') on conflict(key) do nothing;
create or replace function public.admin_issue_result_statements(p_applications uuid[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare aid uuid; a public.applications%rowtype; n int; ok jsonb:='[]'::jsonb; skipped jsonb:='[]'::jsonb;
begin
 if auth.uid() is null or not public.has_role('administrator','academic','registrar') then raise exception 'Academic staff access required'; end if;
 if cardinality(p_applications)>50 then raise exception 'Batch limit is 50'; end if;
 foreach aid in array p_applications loop
   a:=null;
   select * into a from public.applications where id=aid;
   select count(*) into n from public.exam_results r where r.application_id=aid and r.published_at is not null and r.grading_model<>'needs_review';
   if a.id is null or a.admission_decision<>'approved' or n=0 then
      skipped:=skipped||jsonb_build_object('id',aid,'reason','No completed and published exams, or admission not approved');
   else
      insert into public.student_documents(user_id,application_id,title,document_type,status,document_key,issued_at,metadata)
      values(a.user_id,a.id,'Academic Result Statement','result','available','result_statement',now(),jsonb_build_object('published_results',n))
      on conflict(user_id,document_key) where document_key is not null
      do update set application_id=excluded.application_id,status='available',issued_at=excluded.issued_at,metadata=excluded.metadata;
      insert into public.audit_log(actor,action,target,note) values(auth.uid(),'result_statement_issued',coalesce(a.student_id,aid::text),n||' published results');
      ok:=ok||to_jsonb(aid);
   end if;
 end loop;
 return jsonb_build_object('issued',ok,'skipped',skipped);
end $$;
revoke all on function public.admin_issue_result_statements(uuid[]) from public,anon;
grant execute on function public.admin_issue_result_statements(uuid[]) to authenticated;

-- Students get submission-status information only via publication-filtered RPCs;
-- direct table reads of attempt rows may expose auto-scores before publication.
drop policy if exists assessment_attempts_own on public.assessment_attempts;
