-- AHCT V18.9: governed additional-course enrolment and next-intake progression.
--
-- This migration deliberately keeps payment confirmation, academic approval and
-- document revision as separate, auditable events. It does not overwrite an
-- archived admission letter: an approved extra course produces a versioned
-- admission update alongside the original institutional record.

-- An intake now carries the explicit duration policy used for progression.
-- Existing and newly created intakes default to the organisation's 3-month
-- programme model, while allowing an authorised intake manager to set a
-- different duration when the programme policy changes.
alter table public.intakes
  add column if not exists programme_duration_months smallint not null default 3;
alter table public.intakes
  drop constraint if exists intakes_programme_duration_months_check;
alter table public.intakes
  add constraint intakes_programme_duration_months_check
  check (programme_duration_months between 1 and 36);

-- Keep the applicant payment claim, Finance confirmation and academic approval
-- independently visible. A verified payment is not an enrolment decision.
alter table public.course_additions
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists payment_confirmed_by uuid references auth.users(id),
  add column if not exists payment_id uuid references public.payments(id),
  add column if not exists approval_requested_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id);
alter table public.course_additions
  drop constraint if exists course_additions_status_check;
alter table public.course_additions
  add constraint course_additions_status_check
  check (status in ('pending_payment','payment_claimed','approval_pending','approved','rejected'));
create unique index if not exists course_additions_payment_uidx
  on public.course_additions(payment_id) where payment_id is not null;
create index if not exists course_additions_workflow_idx
  on public.course_additions(status,created_at desc);

-- A revised admission record is additive and versioned. It is intentionally
-- not an UPDATE of the original letter, which may already be fingerprinted and
-- retained as an issued historical record.
create or replace function public.ahct_queue_admission_update(
  p_addition uuid,
  p_application uuid,
  p_course text,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare a public.applications%rowtype; c public.courses%rowtype; did uuid;
begin
  select * into a from public.applications where id=p_application;
  if not found or a.admission_decision<>'approved' then
    raise exception 'An admission update requires an approved student application';
  end if;
  select * into c from public.courses where code=p_course;
  if not found then raise exception 'Course record not found'; end if;
  insert into public.student_documents(
    user_id,application_id,title,document_type,status,document_key,issued_at,metadata
  ) values (
    a.user_id,a.id,'Revised Admission Letter','admission_letter','available',
    'admission_update:'||p_addition::text,now(),
    jsonb_build_object(
      'revision_kind','course_addition',
      'course_addition_id',p_addition,
      'added_course_code',c.code,
      'added_course_name',c.name,
      'created_by',p_actor,
      'source','approved_course_addition'
    )
  )
  on conflict(user_id,document_key) where document_key is not null do nothing
  returning id into did;
  if did is null then
    select id into did from public.student_documents
    where user_id=a.user_id and document_key='admission_update:'||p_addition::text;
  end if;
  return did;
end $$;
revoke all on function public.ahct_queue_admission_update(uuid,uuid,text,uuid) from public,anon,authenticated;

-- Students can only select currently published catalogue items in a currently
-- open intake. Full-package entitlements remain fee-free, but still create the
-- same traceable admission update after the enrolment row is written.
create or replace function public.request_course_addition(p_application uuid,p_course text)
returns public.course_additions
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare a public.applications%rowtype; c public.courses%rowtype;
  pkg public.packages%rowtype; fee int; r public.course_additions%rowtype;
  covered boolean:=false; added_count integer:=0; enrolled_count integer:=0;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into a from public.applications
   where id=p_application and user_id=auth.uid() for update;
  if not found then raise exception 'Application not found'; end if;
  if a.admission_decision<>'approved' then
    raise exception 'You can add another course after your admission is approved';
  end if;
  if not exists(
    select 1 from public.intakes i where i.id=a.intake_id and i.is_active
      and (i.opens_at is null or i.opens_at<=now())
      and (i.closes_at is null or i.closes_at>=now())
  ) then
    raise exception 'This intake is closed, so another course cannot be added';
  end if;
  select * into c from public.courses
   where code=p_course and is_active and workflow_status='published';
  if not found then raise exception 'Select a currently published course'; end if;
  if exists(select 1 from public.application_courses
    where application_id=a.id and course_code=p_course) then
    raise exception 'This course is already active in your programme';
  end if;
  if exists(select 1 from public.course_additions
    where application_id=a.id and course_code=p_course
      and status in ('pending_payment','payment_claimed','approval_pending')) then
    raise exception 'There is already an active request for this course';
  end if;

  fee:=c.fee_ngn;
  if a.package_code is not null and c.in_full_package then
    select * into pkg from public.packages where code=a.package_code;
    if found then
      select count(*) into enrolled_count from public.application_courses
       where application_id=a.id and coalesce(deferred,false)=false;
      if (pkg.max_courses is null or enrolled_count<pkg.max_courses)
         and not exists(
           select 1 from public.application_courses ac
           join public.courses enrolled on enrolled.code=ac.course_code
           where ac.application_id=a.id and enrolled.category=c.category
             and coalesce(ac.deferred,false)=false
         ) then
        covered:=true;
        fee:=0;
      end if;
    end if;
  end if;

  insert into public.course_additions(application_id,course_code,fee_ngn,status,note)
  values(a.id,c.code,fee,case when covered then 'approved' else 'pending_payment' end,
    case when covered then 'Included in the existing Full Package entitlement.' else null end)
  returning * into r;

  if covered then
    insert into public.application_courses(application_id,course_code,fee_ngn)
    values(a.id,c.code,0) on conflict do nothing;
    get diagnostics added_count=row_count;
    update public.course_additions
       set approval_requested_at=now(),approved_at=now()
     where id=r.id
     returning * into r;
    if added_count=1 then
      perform public.ahct_queue_admission_update(r.id,a.id,c.code,auth.uid());
      insert into public.student_notifications(user_id,title,message,kind,action_url,metadata)
      values(a.user_id,'Additional course activated',
        c.name||' has been added under your Full Package entitlement. Your revised admission letter is available in Documents.',
        'success','portal#documents',jsonb_build_object('course_addition_id',r.id));
      insert into public.audit_log(actor,actor_name,action,target,note)
      values(auth.uid(),'Student entitlement automation','course_addition_auto_approved',r.id::text,
        'Full Package entitlement applied; published course included and course limit checked.');
    end if;
  end if;
  return r;
end $$;

-- The student UI uses this server-filtered catalogue for the additional-course
-- journey. Draft, review and retired offerings are never shown as purchasable
-- options, even if they happen to remain in a broad historic portal payload.
create or replace function public.student_course_addition_options(p_application uuid default null)
returns jsonb
language plpgsql
security definer
stable
set search_path=public,pg_temp
as $$
declare a public.applications%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select ap.* into a
    from public.applications ap
    join public.intakes i on i.id=ap.intake_id
   where ap.user_id=auth.uid()
     and ap.admission_decision='approved'
     and (p_application is null or ap.id=p_application)
     and i.is_active
     and (i.opens_at is null or i.opens_at<=now())
     and (i.closes_at is null or i.closes_at>=now())
   order by ap.created_at desc
   limit 1;
  if not found then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code',c.code,'name',c.name,'category',c.category,'fee',c.fee_ngn,
      'in_full_package',c.in_full_package,
      'included_with_package',(
        a.package_code is not null and c.in_full_package
        and exists(select 1 from public.packages p where p.code=a.package_code
          and (p.max_courses is null or (select count(*) from public.application_courses acn
            where acn.application_id=a.id and coalesce(acn.deferred,false)=false)<p.max_courses))
        and not exists(select 1 from public.application_courses ace
          join public.courses enrolled on enrolled.code=ace.course_code
          where ace.application_id=a.id and enrolled.category=c.category
            and coalesce(ace.deferred,false)=false)
      )
    ) order by c.category,c.name)
    from public.courses c
    where c.is_active and c.workflow_status='published'
      and not exists(select 1 from public.application_courses ac
        where ac.application_id=a.id and ac.course_code=c.code)
      and not exists(select 1 from public.course_additions ca
        where ca.application_id=a.id and ca.course_code=c.code
          and ca.status in ('pending_payment','payment_claimed','approval_pending'))
  ),'[]'::jsonb);
end $$;

-- A student declaration simply moves the request into Finance's queue. It
-- cannot create a receipt, enrolment, or approved course by itself.
create or replace function public.claim_addition(p_id uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  update public.course_additions ca
     set status='payment_claimed',claimed_at=now(),note=null
    from public.applications ap
   where ca.id=p_id and ap.id=ca.application_id and ap.user_id=auth.uid()
     and ca.status='pending_payment';
  if not found then
    raise exception 'This payment declaration is no longer available';
  end if;
end $$;

-- Finance confirms the specific additional-course payment. The receipt trigger
-- runs from the verified payment ledger insertion; no browser action can forge
-- the transaction or skip financial review.
create or replace function public.admin_confirm_addition_payment(
  p_id uuid,p_decision text,p_note text default null
) returns public.course_additions
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare r public.course_additions%rowtype; a public.applications%rowtype;
  who text; receipt_payment uuid;
begin
  if auth.uid() is null or not public.can_write('payments') then
    raise exception 'Your role cannot confirm additional-course payments';
  end if;
  if p_decision not in ('confirmed','query','rejected') then
    raise exception 'Invalid payment decision';
  end if;
  select full_name into who from public.staff
   where id=auth.uid() and status='approved';
  select * into r from public.course_additions where id=p_id for update;
  if not found then raise exception 'Course request not found'; end if;
  if r.status<>'payment_claimed' then
    raise exception 'This course payment is currently %',r.status;
  end if;
  select * into a from public.applications where id=r.application_id for update;
  if not found or a.admission_decision<>'approved' then
    raise exception 'The linked approved student application is unavailable';
  end if;

  if p_decision='confirmed' then
    if coalesce(r.fee_ngn,0)<=0 then raise exception 'Invalid additional-course amount'; end if;
    select id into receipt_payment from public.payments
      where reference='ADD-'||r.id::text for update;
    if receipt_payment is null then
      insert into public.payments(
        application_id,reference,expected_ngn,paid_ngn,provider,source,
        provider_transaction_id,raw_event,paid_at,verified_at
      ) values (
        a.id,'ADD-'||r.id::text,r.fee_ngn,r.fee_ngn,'manual','admin_manual',
        'ADMIN-ADD-'||r.id::text,
        jsonb_build_object('source','admin','payment_confirmed_by',auth.uid(),
          'method','bank_transfer','course',r.course_code,
          'review_note',left(coalesce(p_note,''),500)),now(),now()
      ) returning id into receipt_payment;
    else
      if not exists(select 1 from public.payments p where p.id=receipt_payment
        and p.application_id=a.id and p.expected_ngn=r.fee_ngn
        and p.paid_ngn>=p.expected_ngn and p.verified_at is not null) then
        raise exception 'Conflicting payment evidence requires Finance investigation';
      end if;
    end if;
    update public.course_additions
       set status='approval_pending',payment_confirmed_at=now(),
           payment_confirmed_by=auth.uid(),payment_id=receipt_payment,
           approval_requested_at=now(),note=null
     where id=r.id returning * into r;
    insert into public.student_notifications(user_id,title,message,kind,action_url,metadata)
    values(a.user_id,'Additional-course payment confirmed',
      'Finance has confirmed your payment for the requested course. It is now awaiting academic approval before it becomes active.',
      'info','portal#courses',jsonb_build_object('course_addition_id',r.id,'payment_id',receipt_payment));
  elsif p_decision='query' then
    if length(trim(coalesce(p_note,'')))<3 then
      raise exception 'Explain what the student needs to check';
    end if;
    update public.course_additions
       set status='pending_payment',claimed_at=null,note=left(trim(p_note),500)
     where id=r.id returning * into r;
  else
    if length(trim(coalesce(p_note,'')))<3 then
      raise exception 'Give a reason for declining the payment claim';
    end if;
    update public.course_additions
       set status='rejected',note=left(trim(p_note),500)
     where id=r.id returning * into r;
  end if;
  insert into public.audit_log(actor,actor_name,action,target,note)
  values(auth.uid(),coalesce(who,'Finance'),'course_addition_payment_'||p_decision,r.id::text,
    case when p_decision='confirmed' then 'Verified payment_id='||receipt_payment::text||'; '||coalesce(p_note,'') else p_note end);
  return r;
end $$;

-- Academic authorisation activates the course only after the payment has been
-- independently verified. The approved course appears in the active enrolment,
-- the application total is incremented exactly once, and a revised admission
-- record is registered without replacing the historic admission letter.
create or replace function public.admin_review_addition(
  p_id uuid,p_decision text,p_note text default null
) returns public.course_additions
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare r public.course_additions%rowtype; a public.applications%rowtype;
  who text; added_count integer:=0;
begin
  if auth.uid() is null or not public.has_role('administrator','registrar','academic') then
    raise exception 'Academic, registrar, or administrator approval is required';
  end if;
  if p_decision not in ('approved','rejected') then raise exception 'Invalid academic decision'; end if;
  select full_name into who from public.staff where id=auth.uid() and status='approved';
  select * into r from public.course_additions where id=p_id for update;
  if not found then raise exception 'Course request not found'; end if;
  if r.status<>'approval_pending' then
    raise exception 'This request is currently % and is not ready for academic approval',r.status;
  end if;
  select * into a from public.applications where id=r.application_id for update;
  if not found or a.admission_decision<>'approved' then
    raise exception 'The linked approved student application is unavailable';
  end if;

  if p_decision='approved' then
    if r.payment_id is null or not exists(select 1 from public.payments p
      where p.id=r.payment_id and p.application_id=a.id and p.verified_at is not null
        and p.expected_ngn=r.fee_ngn and p.paid_ngn>=p.expected_ngn) then
      raise exception 'A verified course payment is required before activation';
    end if;
    insert into public.application_courses(application_id,course_code,fee_ngn)
    values(a.id,r.course_code,r.fee_ngn) on conflict do nothing;
    get diagnostics added_count=row_count;
    if added_count=1 then
      update public.applications set total_ngn=coalesce(total_ngn,0)+r.fee_ngn
       where id=a.id;
      perform public.ahct_queue_admission_update(r.id,a.id,r.course_code,auth.uid());
    end if;
    update public.course_additions
       set status='approved',approved_at=now(),approved_by=auth.uid(),note=null
     where id=r.id returning * into r;
    insert into public.student_notifications(user_id,title,message,kind,action_url,metadata)
    values(a.user_id,'Additional course activated',
      'Your additional course has been approved and is now active in Courses. Your revised admission letter and official payment receipt are available in Documents.',
      'success','portal#courses',jsonb_build_object('course_addition_id',r.id,'payment_id',r.payment_id));
  else
    if length(trim(coalesce(p_note,'')))<3 then
      raise exception 'Give a reason for declining the course approval';
    end if;
    update public.course_additions
       set status='rejected',approved_at=now(),approved_by=auth.uid(),note=left(trim(p_note),500)
     where id=r.id returning * into r;
    insert into public.student_notifications(user_id,title,message,kind,action_url,metadata)
    values(a.user_id,'Additional course request not approved',
      'Your payment remains recorded, but the requested course was not approved. Please review the office note or contact the training office.',
      'warning','portal#courses',jsonb_build_object('course_addition_id',r.id));
  end if;
  insert into public.audit_log(actor,actor_name,action,target,note)
  values(auth.uid(),coalesce(who,'Academic Office'),'course_addition_'||p_decision,r.id::text,
    coalesce(p_note,'')||case when added_count=1 then ' | enrolment activated and admission update issued' else '' end);
  return r;
end $$;

-- Server-side progression check. A student whose latest admitted programme is
-- incomplete is guided to add a course inside the existing intake, instead of
-- being allowed to bypass academic completion by opening another intake.
create or replace function public.ahct_next_intake_eligibility_for_user(
  p_user uuid,p_intake uuid default null
) returns jsonb
language plpgsql
security definer
stable
set search_path=public,pg_temp
as $$
declare a record; active_courses integer:=0; reviewed_courses integer:=0;
  statement_issued boolean:=false; programme_due_at timestamptz;
begin
  if p_user is null then
    return jsonb_build_object('eligible',false,'reason','A signed-in student account is required.');
  end if;
  if p_intake is not null and not exists(
    select 1 from public.intakes i where i.id=p_intake and i.is_active
      and (i.opens_at is null or i.opens_at<=now())
      and (i.closes_at is null or i.closes_at>=now())
  ) then
    return jsonb_build_object('eligible',false,'reason','This intake is no longer open for applications.');
  end if;
  if exists(
    select 1 from public.applications ap
     where ap.user_id=p_user
       and ap.status not in ('expired','rejected')
       and coalesce(ap.admission_decision,'pending')<>'approved'
  ) then
    return jsonb_build_object('eligible',false,
      'reason','You already have an application in progress. Complete its payment, submission and admission decision before starting another intake.');
  end if;
  select ap.id,ap.intake_id,ap.reviewed_at,ap.submitted_at,ap.created_at,
         i.label,i.programme_duration_months
    into a
    from public.applications ap
    join public.intakes i on i.id=ap.intake_id
   where ap.user_id=p_user and ap.admission_decision='approved'
   order by coalesce(ap.reviewed_at,ap.submitted_at,ap.created_at) desc,ap.created_at desc
   limit 1;
  if not found then
    return jsonb_build_object('eligible',true,'reason','You may begin your first application.','current_application_id',null);
  end if;
  programme_due_at:=coalesce(a.reviewed_at,a.submitted_at,a.created_at)
    + make_interval(months=>coalesce(a.programme_duration_months,3)::integer);
  if now()<programme_due_at then
    return jsonb_build_object('eligible',false,'current_application_id',a.id,
      'programme_due_at',programme_due_at,
      'reason','Your current programme is still in progress. A new intake becomes available after the three-month completion date, all active results are published, and an official statement of results is issued. You can still add another course from Courses.');
  end if;
  select count(distinct ac.course_code) into active_courses
    from public.application_courses ac
   where ac.application_id=a.id and coalesce(ac.deferred,false)=false;
  if active_courses=0 then
    return jsonb_build_object('eligible',false,'current_application_id',a.id,
      'programme_due_at',programme_due_at,
      'reason','Your current programme has no active course record for completion review. Please contact the Academic Office.');
  end if;
  select count(distinct ac.course_code) into reviewed_courses
    from public.application_courses ac
    join public.exam_results er on er.application_id=ac.application_id and er.course_code=ac.course_code
   where ac.application_id=a.id and coalesce(ac.deferred,false)=false
     and er.published_at is not null and er.grading_model is not null
     and er.grading_model<>'needs_review';
  if reviewed_courses<active_courses then
    return jsonb_build_object('eligible',false,'current_application_id',a.id,
      'programme_due_at',programme_due_at,'required_courses',active_courses,
      'completed_courses',reviewed_courses,
      'reason','Your current programme is awaiting published and reviewed results for every active course. You can still add another course from Courses.');
  end if;
  select exists(
    select 1 from public.student_documents d
     where d.user_id=p_user and d.application_id=a.id
       and d.document_key='result_statement' and d.status='available'
       and d.issued_at is not null
  ) into statement_issued;
  if not statement_issued then
    return jsonb_build_object('eligible',false,'current_application_id',a.id,
      'programme_due_at',programme_due_at,'required_courses',active_courses,
      'completed_courses',reviewed_courses,
      'reason','Your course results are complete. A registrar-issued statement of results is still required before a new intake application can begin.');
  end if;
  return jsonb_build_object('eligible',true,'current_application_id',a.id,
    'programme_due_at',programme_due_at,'required_courses',active_courses,
    'completed_courses',reviewed_courses,
    'reason','Your current programme is complete and your statement of results has been issued. You may apply to an open intake.');
end $$;

create or replace function public.student_next_intake_eligibility(p_intake uuid default null)
returns jsonb
language plpgsql
security definer
stable
set search_path=public,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  return public.ahct_next_intake_eligibility_for_user(auth.uid(),p_intake);
end $$;

-- The draft RPC is enforced at the database boundary, so URL changes and
-- hand-crafted browser calls cannot sidestep the completion policy.
create or replace function public.start_application(p_intake uuid)
returns public.applications
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare a public.applications%rowtype; i public.intakes%rowtype; gate jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into a from public.applications
   where user_id=auth.uid() and intake_id=p_intake and status not in ('expired','rejected');
  if found then return a; end if;
  select * into i from public.intakes where id=p_intake;
  if not found or not i.is_active or (i.opens_at is not null and i.opens_at>now())
    or (i.closes_at is not null and i.closes_at<now()) then
    raise exception 'This intake is not open for applications';
  end if;
  gate:=public.ahct_next_intake_eligibility_for_user(auth.uid(),p_intake);
  if coalesce((gate->>'eligible')::boolean,false) is distinct from true then
    raise exception '%',coalesce(gate->>'reason','You are not eligible to begin another intake yet');
  end if;
  insert into public.applications(user_id,intake_id,status,total_ngn)
  values(auth.uid(),p_intake,'draft',0) returning * into a;
  return a;
end $$;

revoke all on function public.ahct_next_intake_eligibility_for_user(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ahct_next_intake_eligibility_for_user(uuid,uuid) to service_role;
revoke all on function public.ahct_queue_admission_update(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.admin_confirm_addition_payment(uuid,text,text) from public,anon;
revoke all on function public.admin_review_addition(uuid,text,text) from public,anon;
revoke all on function public.student_next_intake_eligibility(uuid) from public,anon;
revoke all on function public.student_course_addition_options(uuid) from public,anon;
revoke all on function public.request_course_addition(uuid,text) from public,anon;
revoke all on function public.claim_addition(uuid) from public,anon;
revoke all on function public.start_application(uuid) from public,anon;
grant execute on function public.admin_confirm_addition_payment(uuid,text,text),
  public.admin_review_addition(uuid,text,text),public.student_next_intake_eligibility(uuid),
  public.student_course_addition_options(uuid),
  public.request_course_addition(uuid,text),public.claim_addition(uuid),
  public.start_application(uuid) to authenticated;

-- Finance sees the payment-confirmation queue; Academic and Registrar see the
-- post-payment approval queue. All state transitions remain in guarded RPCs.
drop policy if exists staff_read on public.course_additions;
create policy staff_read on public.course_additions for select using (
  public.can_read('payments') or public.has_role('academic','registrar')
);
