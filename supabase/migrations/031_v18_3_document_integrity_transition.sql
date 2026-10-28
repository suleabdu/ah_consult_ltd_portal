-- AH STUDENT HUB V18.3 — apply AFTER 030 on backed-up staging.
-- Private institutional branding and canonical, cached student documents.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('institution-letterheads','institution-letterheads',false,8388608,array['image/png','image/jpeg']),
       ('issued-documents','issued-documents',false,10485760,array['application/pdf'])
on conflict(id) do update set public=false;
-- Neither bucket has a browser storage policy: service-role Edge Functions enforce access.

create table if not exists public.institution_document_branding (
 id boolean primary key default true check(id),
 file_path text,
 image_mime text check(image_mime in ('image/png','image/jpeg')),
 revision integer not null default 0,
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id)
);
insert into public.institution_document_branding(id) values(true) on conflict do nothing;
alter table public.institution_document_branding enable row level security;
revoke all on public.institution_document_branding from public,anon,authenticated;

-- Acknowledgement is durable and immutable. Exiting the portal does not reset it.
create table if not exists public.student_portal_transitions (
 user_id uuid primary key references auth.users(id) on delete cascade,
 application_id uuid not null references public.applications(id) on delete restrict,
 accepted_at timestamptz not null default now(),
 acceptance_version text not null default '2026-10-v1'
);
alter table public.student_portal_transitions enable row level security;
revoke all on public.student_portal_transitions from public,anon,authenticated;
create or replace function public.student_portal_access() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.student_portal_transitions t
 join public.applications a on a.id=t.application_id
 where t.user_id=auth.uid() and a.admission_decision='approved');
$$;
revoke all on function public.student_portal_access() from public,anon;
grant execute on function public.student_portal_access() to authenticated;

create or replace function public.accept_student_portal_transition(p_application uuid,p_accepted boolean)
returns timestamptz language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.applications%rowtype; done_at timestamptz;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if p_accepted is distinct from true then raise exception 'Explicit acceptance is required'; end if;
 select * into a from public.applications where id=p_application and user_id=auth.uid() for update;
 if not found or a.admission_decision is distinct from 'approved' then raise exception 'Admission approval required'; end if;
 -- Newer installations may include documentation_status in applications.
 if to_jsonb(a) ? 'documentation_status' and lower(coalesce(to_jsonb(a)->>'documentation_status','pending')) not in ('approved','verified','successful','complete','completed') then
  raise exception 'Onboarding documentation must be verified first';
 end if;
 if to_jsonb(a) ? 'docs_status' and lower(coalesce(to_jsonb(a)->>'docs_status','pending')) not in ('approved','verified','successful','complete','completed') then
  raise exception 'Onboarding documentation must be verified first';
 end if;
 if exists(select 1 from public.student_portal_transitions where user_id=auth.uid() and application_id<>p_application) then
  raise exception 'The permanent transition is already bound to a different admission';
 end if;
 insert into public.student_portal_transitions(user_id,application_id) values(auth.uid(),p_application)
 on conflict(user_id) do nothing;
 select accepted_at into done_at from public.student_portal_transitions where user_id=auth.uid();
 insert into public.audit_log(actor,action,target,note) values(auth.uid(),'student_portal_transition',coalesce(a.student_id,a.id::text),'Student accepted permanent transition to learning portal') on conflict do nothing;
 return done_at;
end $$;
revoke all on function public.accept_student_portal_transition(uuid,boolean) from public,anon;
grant execute on function public.accept_student_portal_transition(uuid,boolean) to authenticated;

-- When an earlier admission is reversed, previously issued letters are retained as historical
-- records but are no longer available as proof of a current admission.
create or replace function public.reconcile_admission_letter_status() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.admission_decision is distinct from old.admission_decision and new.admission_decision is distinct from 'approved' then
  update public.student_documents set status='replaced',
   metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('revoked_at',now(),'revocation_reason','Admission decision changed')
   where application_id=new.id and document_key='admission_letter' and status='available';
 end if;
 return new;
end $$;
drop trigger if exists v183_reconcile_admission_letter on public.applications;
create trigger v183_reconcile_admission_letter after update of admission_decision on public.applications
for each row execute function public.reconcile_admission_letter_status();

-- Delete based on current admission, not stale issued letters. Historical documents and
-- financial transactions are DETACHED AND RETAINED, never erased with the application.
create or replace function public.admin_delete_nonadmitted(p_application uuid,p_confirm text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.applications%rowtype; code text; n integer; total numeric; who text; docs integer;
begin
 if auth.uid() is null or not public.has_role('administrator') then raise exception using errcode='42501',message='Administrator access required'; end if;
 if length(trim(coalesce(p_reason,'')))<10 then raise exception using errcode='22023',message='Provide a deletion reason of at least 10 characters'; end if;
 select * into a from public.applications where id=p_application for update;
 if not found then raise exception using errcode='P0002',message='Application not found'; end if;
 if a.admission_decision='approved' then raise exception using errcode='23514',message='CURRENTLY_ADMITTED'; end if;
 if exists(select 1 from public.student_portal_transitions where application_id=a.id) then
  raise exception using errcode='23514',message='PORTAL_TRANSITION_RETAINED';
 end if;
 code:=coalesce(nullif(a.student_id,''),nullif(a.pay_reference,''),upper(left(a.id::text,8)));
 if upper(trim(coalesce(p_confirm,'')))<>upper(code) then raise exception using errcode='22023',message='Reference confirmation does not match'; end if;
 select count(*),coalesce(sum(paid_ngn),0) into n,total from public.payments where application_id=a.id;
 select count(*) into docs from public.student_documents where application_id=a.id;
 insert into public.application_erasure_register(application_id,reference,previous_decision,actor,reason,detached_payments,amount_paid_ngn)
 values(a.id,code,a.admission_decision,auth.uid(),left(trim(p_reason),800),n,total);
 update public.student_documents set application_id=null,
    status=case when document_key='payment_receipt' then status else 'replaced' end,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('erased_application_id',a.id,'detached_at',now(),'erasure_reference',code)
    where application_id=a.id;
 update public.document_jobs set application_id=null,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('erased_application_id',a.id,'retained_for_audit',true)
    where application_id=a.id;
 update public.payments set application_id=null where application_id=a.id;
 delete from public.sheet_outbox where application_id=a.id and done=false;
 delete from public.applications where id=a.id;
 insert into public.sheet_outbox(application_id,kind) values(a.id,'delete_app');
 select full_name into who from public.staff where id=auth.uid();
 insert into public.audit_log(actor,actor_name,action,target,note)
 values(auth.uid(),coalesce(who,'Administrator'),'application_deleted',code,
 left(trim(p_reason),800)||' | preserved payments: '||n::text||' | retained documents: '||docs::text);
 return jsonb_build_object('ok',true,'reference',code,'passport_path',a.passport_path,'detached_payments',n,'retained_documents',docs);
end $$;
revoke all on function public.admin_delete_nonadmitted(uuid,text,text) from public,anon;
grant execute on function public.admin_delete_nonadmitted(uuid,text,text) to authenticated;

-- Only a transitioned student can request academic documents, even by calling RPC directly.
-- This definition also removes a stale alternative HTML rendering for the admission letter
-- by returning the canonical PDF document ID to both portals.
create or replace function public.student_document_snapshot(p_application uuid,p_key text)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare a public.applications%rowtype; d public.student_documents%rowtype;
 grades jsonb; pay jsonb; fullname text; intake_name text; course_names text; k text;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select * into a from public.applications where id=p_application and user_id=auth.uid();
 if not found then raise exception 'Application is not linked to this account'; end if;
 k:=case when p_key='result' then 'result_statement' else p_key end;
 if k not in('admission_letter','deferment_letter','payment_receipt','academic_transcript','result_statement') then raise exception 'Unknown document type'; end if;
 if k in('academic_transcript','result_statement','deferment_letter') and not public.student_portal_access() then
   raise exception 'Academic and enrolment documents are available only in the student portal after transition';
 end if;
 if k in('admission_letter','academic_transcript','result_statement') and a.admission_decision<>'approved' then
   raise exception 'Current admission approval required'; end if;
 select * into d from public.student_documents where application_id=a.id and user_id=auth.uid()
 and document_key=k and status='available' limit 1;
 if k not in('result_statement','deferment_letter','academic_transcript') and not found then raise exception 'Document has not been issued yet'; end if;
 if k='deferment_letter' and not exists(select 1 from public.deferments where application_id=a.id and status='approved') then raise exception 'No approved deferment is recorded'; end if;
 select p.full_name into fullname from public.profiles p where p.id=a.user_id;
 select i.label into intake_name from public.intakes i where i.id=a.intake_id;
 select string_agg(c.name,', ' order by c.name) into course_names from public.application_courses ac join public.courses c on c.code=ac.course_code where ac.application_id=a.id;
 select coalesce(jsonb_agg(jsonb_build_object('course',c.name,'code',r.course_code,'total',r.total,'grade',r.band) order by c.name),'[]'::jsonb) into grades
 from public.exam_results r join public.courses c on c.code=r.course_code
 where r.application_id=a.id and r.published_at is not null and r.grading_model<>'needs_review';
 select to_jsonb(z) into pay from (select reference,paid_ngn,verified_at from public.payments
  where application_id=a.id and verified_at is not null and paid_ngn>0 order by verified_at desc limit 1) z;
 return jsonb_build_object('document_id',d.id,'key',k,'reference',coalesce(a.student_id,a.pay_reference,a.id::text),
 'name',fullname,'intake',intake_name,'courses',course_names,'decision',a.admission_decision,
 'admission_date',a.reviewed_at,'grades',grades,'payment',pay);
end $$;
revoke all on function public.student_document_snapshot(uuid,text) from public,anon;
grant execute on function public.student_document_snapshot(uuid,text) to authenticated;

-- Guard student RPCs at the DATABASE boundary (not just URL hiding).
-- portal_data transition enforcement
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
  if not public.student_portal_access() then raise exception 'Complete the permanent transition before opening the student workspace'; end if;
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

-- student_academic_record transition enforcement
create or replace function public.student_academic_record(p_application uuid default null)
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare uid uuid:=auth.uid(); aid uuid; result_payload jsonb;
begin
  if not public.student_portal_access() then raise exception 'Complete the permanent transition before opening the student workspace'; end if;
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

-- published_student_results transition enforcement
create or replace function public.published_student_results(p_application uuid)
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare uid uuid:=auth.uid(); result_payload jsonb;
begin
  if not public.student_portal_access() then raise exception 'Complete the permanent transition before opening the student workspace'; end if;
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

-- portal_phase5_data transition enforcement
create or replace function public.portal_phase5_data() returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); res jsonb;
begin
 if not public.student_portal_access() then raise exception 'Complete the permanent transition before opening the student workspace'; end if;
 if uid is null then raise exception 'Not signed in'; end if;
 select jsonb_build_object(
  'notifications', coalesce((select jsonb_agg(x order by x.created_at desc) from (select n.id::text id,n.title,n.message,n.kind,n.action_url,n.read_at,n.created_at from student_notifications n where n.user_id=uid union all select a.id::text||':status','Application status update',case when a.admission_decision='approved' then 'Congratulations — your application has been admitted.' when a.admission_decision='rejected' then 'Your application has received an admissions decision.' when a.admission_decision='under_review' then 'Your application is currently being reviewed by the admissions team.' when a.payment_claimed_at is not null and a.payment_review='pending' then 'Your payment claim has been received and is awaiting verification.' when a.status='paid' then 'Payment confirmed. Your application is ready for review.' else 'Your application is progressing through the admissions process.' end,case when a.admission_decision='approved' then 'success' when a.admission_decision='rejected' then 'warning' else 'info' end,null,null,coalesce(a.reviewed_at,a.paid_at,a.submitted_at,a.created_at) from applications a where a.user_id=uid) x),'[]'::jsonb),
  'documents', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc) from student_documents d where d.user_id=uid),'[]'::jsonb),
  'timeline', coalesce((
    select jsonb_agg(x order by x.at desc)
    from (
      select a.id::text id,'application' kind,'Application submitted' title,
             coalesce(a.status,'') detail,a.created_at at
      from applications a where a.user_id=uid
      union all
      select p.id::text,'payment','Payment recorded',case when coalesce(p.paid_ngn,0) >= coalesce(p.expected_ngn,0) then 'Payment verified' else 'Payment recorded' end,coalesce(p.created_at,p.paid_at)
      from payments p join applications a on a.id=p.application_id where a.user_id=uid
      union all
      select a.id::text||':admission','admission',
             case when a.admission_decision='approved' then 'Admission approved' when a.admission_decision='rejected' then 'Admission decision recorded' else 'Application under review' end,
             coalesce(a.admission_note,a.admission_decision,'Under review'),coalesce(a.reviewed_at,a.paid_at,a.submitted_at,a.created_at)
      from applications a where a.user_id=uid and a.admission_decision is not null
      union all
      select s.id::text,'assessment','Assessment submitted',coalesce(s.assignment_id::text,s.id::text),s.submitted_at
      from submissions s join applications a on a.id=s.application_id where a.user_id=uid and s.submitted_at is not null
      union all
      select at.id::text,'exam','Exam submitted','Exam assessment',at.submitted_at
      from assessment_attempts at where at.user_id=uid and at.status='submitted' and at.submitted_at is not null
    ) x where x.at is not null
  ),'[]'::jsonb)
 ) into res;
 return res;
end $$;

-- Previously issued academic records must be withdrawn when underlying published
-- grades change. Issued PDF bytes are retained as historical evidence in private
-- storage; the portal refuses the replaced record rather than serving stale marks.
create or replace function public.withdraw_documents_after_grade_change()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare aid uuid;
begin
 if tg_op='DELETE' then aid:=old.application_id; else aid:=new.application_id; end if;
 if tg_op='DELETE' or (tg_op='UPDATE' and (
   old.published_at is distinct from new.published_at or
   old.total is distinct from new.total or old.band is distinct from new.band or
   old.ca is distinct from new.ca or old.exams is distinct from new.exams or
   old.attendance is distinct from new.attendance or old.grading_model is distinct from new.grading_model)) then
  update public.student_documents set status='replaced',
   metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('academic_source_modified_at',now())
   where application_id=aid and document_key in('academic_transcript','result_statement') and status='available';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
drop trigger if exists v183_withdraw_grade_documents on public.exam_results;
create trigger v183_withdraw_grade_documents after update or delete on public.exam_results
for each row execute function public.withdraw_documents_after_grade_change();
