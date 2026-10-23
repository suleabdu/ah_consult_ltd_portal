-- AH STUDENT HUB — Phase 11: Academic Integrity & Release Readiness
-- Depends on migrations 001-020. Apply after 020_reported_bug_fixes.sql.
-- Safe to rerun. Legacy assessment components are preserved, not discarded.

-- -----------------------------------------------------------------------------
-- 1. Preserve legacy results and make the effective total match the grading model
-- -----------------------------------------------------------------------------
-- Phase 3 introduced Attendance/CA/Exams (40/30/30), while the original table
-- retained CA/Objective/Practical fields. Some historical rows still have
-- non-zero legacy exam components. Archive those source components before
-- changing how their displayed total is calculated.

begin;

alter table public.exam_results
  add column if not exists grading_model text;
alter table public.exam_results
  add column if not exists legacy_ca integer;
-- A safe fallback for databases where 013 ran before legacy_ca was introduced.
-- This fallback may contain a capped value; Phase 12 marks legacy rows for manual
-- source verification and never treats this fallback as a verified official grade.
update public.exam_results
set legacy_ca = ca
where legacy_ca is null
  and (coalesce(exam_obj,0) <> 0 or coalesce(exam_prac,0) <> 0);

create table if not exists public.legacy_exam_results_archive (
  result_id uuid primary key,
  application_id uuid not null,
  course_code text not null,
  legacy_ca integer not null,
  legacy_exam_obj integer not null,
  legacy_exam_prac integer not null,
  reconstructed_total integer not null,
  reconstructed_band text not null,
  source_confidence text not null default 'requires_source_verification',
  was_published boolean not null default false,
  was_locked boolean not null default false,
  archived_at timestamptz not null default now()
);
alter table public.legacy_exam_results_archive
  add column if not exists source_confidence text not null default 'requires_source_verification';
-- Remove a cascading FK if an earlier staging draft created one. The archive
-- must survive deletion of the live result row.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid='public.legacy_exam_results_archive'::regclass
      and contype='f' and confrelid='public.exam_results'::regclass
  loop
    execute format('alter table public.legacy_exam_results_archive drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.legacy_exam_results_archive enable row level security;
revoke all on public.legacy_exam_results_archive from public, anon, authenticated;

-- Record source components before totals are redefined. Keep this archive
-- independent of exam_results deletion so it remains an audit reference.
insert into public.legacy_exam_results_archive(
  result_id, application_id, course_code, legacy_ca, legacy_exam_obj,
  legacy_exam_prac, reconstructed_total, reconstructed_band, source_confidence, was_published, was_locked
)
select er.id, er.application_id, er.course_code, coalesce(er.legacy_ca,er.ca,0),
       coalesce(er.exam_obj,0), coalesce(er.exam_prac,0),
       coalesce(er.legacy_ca,er.ca,0)+coalesce(er.exam_obj,0)+coalesce(er.exam_prac,0),
       case when coalesce(er.legacy_ca,er.ca,0)+coalesce(er.exam_obj,0)+coalesce(er.exam_prac,0) >= 70 then 'Distinction'
            when coalesce(er.legacy_ca,er.ca,0)+coalesce(er.exam_obj,0)+coalesce(er.exam_prac,0) >= 60 then 'Credit'
            when coalesce(er.legacy_ca,er.ca,0)+coalesce(er.exam_obj,0)+coalesce(er.exam_prac,0) >= 50 then 'Pass'
            else 'Fail' end,
       'requires_source_verification', er.published_at is not null, er.locked_at is not null
from public.exam_results er
where coalesce(er.exam_obj,0) <> 0 or coalesce(er.exam_prac,0) <> 0
on conflict (result_id) do nothing;

-- Classify every existing row conservatively. A zero-attendance/zero-exam row
-- cannot be distinguished from an old CA-only result with certainty, so it is
-- marked needs_review instead of being silently represented as 40/30/30.
update public.exam_results
set grading_model = case
  when (coalesce(exam_obj,0) <> 0 or coalesce(exam_prac,0) <> 0)
       and coalesce(attendance,0)=0 and coalesce(exams,0)=0
    then 'needs_review'
  when (coalesce(exam_obj,0) <> 0 or coalesce(exam_prac,0) <> 0)
       and (coalesce(attendance,0) <> 0 or coalesce(exams,0) <> 0)
    then 'needs_review'
  when coalesce(attendance,0)=0 and coalesce(exams,0)=0
    then 'needs_review'
  else 'attendance_ca_exams_40_30_30'
end
where grading_model is null
   or grading_model not in ('attendance_ca_exams_40_30_30','legacy_ca_exam_obj_prac','needs_review')
   or ((coalesce(exam_obj,0) <> 0 or coalesce(exam_prac,0) <> 0)
       and grading_model <> 'needs_review');

alter table public.exam_results
  alter column grading_model set default 'attendance_ca_exams_40_30_30';
update public.exam_results set grading_model='attendance_ca_exams_40_30_30' where grading_model is null;
alter table public.exam_results alter column grading_model set not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid='public.exam_results'::regclass and conname='exam_results_grading_model_check'
  ) then
    alter table public.exam_results drop constraint exam_results_grading_model_check;
  end if;
  alter table public.exam_results
    add constraint exam_results_grading_model_check
    check (grading_model in ('attendance_ca_exams_40_30_30','legacy_ca_exam_obj_prac','needs_review'));
end $$;

-- Current results use Attendance+CA+Exams; confidently identified legacy results
-- use CA+Objective+Practical. Ambiguous rows intentionally have NULL total/band
-- until reviewed so we do not show a fabricated grade to a student.
alter table public.exam_results drop column if exists band;
alter table public.exam_results drop column if exists total;
alter table public.exam_results
  add column total integer generated always as (
    case
      when grading_model='needs_review' then null
      when grading_model='legacy_ca_exam_obj_prac'
        then coalesce(legacy_ca,ca,0)+coalesce(exam_obj,0)+coalesce(exam_prac,0)
      else coalesce(attendance,0)+coalesce(ca,0)+coalesce(exams,0)
    end
  ) stored;
alter table public.exam_results
  add column band text generated always as (
    case
      when grading_model='needs_review' then null
      when (case when grading_model='legacy_ca_exam_obj_prac'
             then coalesce(legacy_ca,ca,0)+coalesce(exam_obj,0)+coalesce(exam_prac,0)
             else coalesce(attendance,0)+coalesce(ca,0)+coalesce(exams,0) end) >= 70 then 'Distinction'
      when (case when grading_model='legacy_ca_exam_obj_prac'
             then coalesce(legacy_ca,ca,0)+coalesce(exam_obj,0)+coalesce(exam_prac,0)
             else coalesce(attendance,0)+coalesce(ca,0)+coalesce(exams,0) end) >= 60 then 'Credit'
      when (case when grading_model='legacy_ca_exam_obj_prac'
             then coalesce(legacy_ca,ca,0)+coalesce(exam_obj,0)+coalesce(exam_prac,0)
             else coalesce(attendance,0)+coalesce(ca,0)+coalesce(exams,0) end) >= 50 then 'Pass'
      else 'Fail'
    end
  ) stored;

comment on column public.exam_results.grading_model is
  'attendance_ca_exams_40_30_30 is current; legacy_ca_exam_obj_prac is only for source-verified historical scores; needs_review represents historical/ambiguous rows requiring source verification.';
comment on column public.exam_results.legacy_ca is 'Historical CA snapshot captured before current-model CA normalization when possible. Verify against the original record before treating it as authoritative.';
comment on column public.exam_results.exam_obj is 'Deprecated legacy Objective component; retained for historical results.';
comment on column public.exam_results.exam_prac is 'Deprecated legacy Practical component; retained for historical results.';
comment on table public.legacy_exam_results_archive is 'Durable snapshot of historical result components. source_confidence defaults to requires_source_verification because older migrations may have capped CA before archival.';

-- -----------------------------------------------------------------------------
-- 2. Explicitly qualify ordinality output to remove any alias resolution ambiguity
-- -----------------------------------------------------------------------------
create or replace function public.submit_assessment(p_attempt uuid, p_answers jsonb)
returns public.assessment_attempts
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  a public.assessment_attempts;
  qset jsonb := '[]'::jsonb;
  question_item jsonb;
  zero_index integer;
  answer text;
  qfiles jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object' then
    raise exception 'Answers must be a JSON object.';
  end if;

  select * into a
  from public.assessment_attempts
  where id = p_attempt and user_id = auth.uid()
  for update;
  if not found then raise exception 'Assessment attempt not found.'; end if;
  if a.status <> 'in_progress' then return a; end if;
  if a.expires_at is not null and a.expires_at < now() then
    update public.assessment_attempts
      set status='expired', submitted_at=now(), answers=coalesce(p_answers,'{}'::jsonb)
      where id=a.id returning * into a;
    return a;
  end if;

  if a.assessment_type = 'exam' then
    select coalesce(e.question_set,'[]'::jsonb) into qset
      from public.exams e where e.id=a.assessment_id;
    if exists(select 1 from public.exams e where e.id=a.assessment_id and e.file_required)
       and nullif(trim(coalesce(p_answers->>'__drive_link','')),'') is null then
      raise exception 'Please provide the required Drive/file link.';
    end if;
  else
    select coalesce(x.question_set,'[]'::jsonb) into qset
      from public.assignments x where x.id=a.assessment_id;
  end if;
  if jsonb_typeof(coalesce(qset,'[]'::jsonb)) <> 'array' then
    raise exception 'Assessment question set is misconfigured. Please contact your tutor.';
  end if;

  qfiles := case
    when jsonb_typeof(coalesce(p_answers->'__question_files','{}'::jsonb))='object'
      then p_answers->'__question_files'
    else '{}'::jsonb end;

  for question_item, zero_index in
    select qi.question_json, (qi.question_ordinal - 1)::integer
    from jsonb_array_elements(coalesce(qset,'[]'::jsonb)) with ordinality
      as qi(question_json, question_ordinal)
  loop
    answer := nullif(trim(coalesce(p_answers->>(zero_index::text),'')),'');
    if coalesce((question_item->>'mandatory')::boolean,false) and answer is null then
      raise exception 'Please answer required question %.', zero_index+1;
    end if;
    if coalesce((question_item->>'file_required')::boolean,false)
       and nullif(trim(coalesce(qfiles->>(zero_index::text),'')),'') is null then
      raise exception 'Please provide the required Drive/file link for question %.', zero_index+1;
    end if;
  end loop;

  if coalesce(p_answers->>'__external_submitted','') <> ''
     and lower(coalesce(p_answers->>'__external_submitted','')) <> 'true' then
    raise exception 'Please complete the external assessment and confirm submission.';
  end if;

  update public.assessment_attempts
    set answers=coalesce(p_answers,'{}'::jsonb), submitted_at=now(), status='submitted'
    where id=a.id returning * into a;
  return a;
end $$;

create or replace function public.submit_assignment(
  p_assignment uuid, p_application uuid, p_body text, p_file text
) returns public.submissions
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  s public.assignments;
  a public.applications;
  r public.submissions;
  payload jsonb := '{}'::jsonb;
  question_item jsonb;
  zero_index integer;
  answer text;
  qfiles jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;

  select * into a from public.applications
  where id=p_application and user_id=auth.uid() and admission_decision='approved';
  if not found then raise exception 'Only admitted students can submit work'; end if;
  select * into s from public.assignments where id=p_assignment;
  if not found then raise exception 'Assignment not found'; end if;
  if s.closed then raise exception 'This assignment is closed'; end if;
  if not exists (
    select 1 from public.application_courses
    where application_id=a.id and course_code=s.course_code and not deferred
  ) or (s.intake_id is not null and s.intake_id <> a.intake_id) then
    raise exception 'This assignment is not for your course';
  end if;
  if nullif(trim(coalesce(p_body,'')),'') is null and p_file is null then
    raise exception 'Write a response or attach a file';
  end if;
  -- Storage policy folders are user_id/assignment_id/file. Do not let a client
  -- attach another user's file or reuse a file uploaded for a different assignment.
  if p_file is not null and (
       split_part(p_file,'/',1) <> auth.uid()::text
       or split_part(p_file,'/',2) <> p_assignment::text
       or p_file ~ '(^|/)\.\.?(/|$)'
     ) then
    raise exception 'The uploaded file path does not belong to this student and assignment.';
  end if;

  begin
    payload := p_body::jsonb;
    if jsonb_typeof(payload) = 'object' then
      payload := coalesce(payload->'answers','{}'::jsonb);
      if jsonb_typeof(payload) <> 'object' then payload := '{}'::jsonb; end if;
    else
      payload := '{}'::jsonb;
    end if;
  exception when others then payload := '{}'::jsonb;
  end;

  if s.file_required and p_file is null
     and nullif(trim(coalesce(payload->>'__drive_link','')),'') is null then
    raise exception 'This assignment requires a file or Drive link.';
  end if;
  if jsonb_typeof(coalesce(s.question_set,'[]'::jsonb)) <> 'array' then
    raise exception 'Assignment question set is misconfigured. Please contact your tutor.';
  end if;

  qfiles := case
    when jsonb_typeof(coalesce(payload->'__question_files','{}'::jsonb))='object'
      then payload->'__question_files'
    else '{}'::jsonb end;

  for question_item, zero_index in
    select qi.question_json, (qi.question_ordinal - 1)::integer
    from jsonb_array_elements(coalesce(s.question_set,'[]'::jsonb)) with ordinality
      as qi(question_json, question_ordinal)
  loop
    answer := nullif(trim(coalesce(payload->>(zero_index::text),'')),'');
    if coalesce((question_item->>'mandatory')::boolean,false) and answer is null then
      raise exception 'Please answer required question %.', zero_index+1;
    end if;
    if coalesce((question_item->>'file_required')::boolean,false)
       and nullif(trim(coalesce(qfiles->>(zero_index::text),'')),'') is null then
      raise exception 'Please provide the required Drive/file link for question %.', zero_index+1;
    end if;
  end loop;

  if coalesce(payload->>'__external_submitted','') <> ''
     and lower(coalesce(payload->>'__external_submitted','')) <> 'true' then
    raise exception 'Please complete the external assessment and confirm submission.';
  end if;

  if exists(select 1 from public.submissions where assignment_id=p_assignment and application_id=p_application and graded_at is not null) then
    raise exception 'This submission has already been graded';
  end if;

  insert into public.submissions(assignment_id,application_id,user_id,body,file_path)
  values(p_assignment,p_application,auth.uid(),p_body,p_file)
  on conflict (assignment_id,application_id) do update
    set body=excluded.body,
        file_path=coalesce(excluded.file_path,public.submissions.file_path),
        submitted_at=now()
  returning * into r;
  return r;
end $$;

revoke all on function public.submit_assessment(uuid,jsonb) from public,anon;
grant execute on function public.submit_assessment(uuid,jsonb) to authenticated;
revoke all on function public.submit_assignment(uuid,uuid,text,text) from public,anon;
grant execute on function public.submit_assignment(uuid,uuid,text,text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Result writes use one explicit grading model and cannot edit deferred courses
-- -----------------------------------------------------------------------------
drop function if exists public.tutor_save_result(uuid,text,int,int,int);
create or replace function public.tutor_save_result(
  p_application uuid, p_course text, p_attendance int, p_ca int, p_exams int
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  existing_result public.exam_results;
  who text;
  was_new boolean := false;
begin
  if not has_role('tutor') then raise exception 'Tutors only'; end if;
  if not exists(
    select 1 from public.lecturers l
    join public.lecturer_courses lc on lc.lecturer_id=l.id
    where l.user_id=auth.uid() and l.is_active and lc.course_code=p_course
  ) then raise exception 'You do not teach this course'; end if;
  if not exists(
    select 1 from public.application_courses
    where application_id=p_application and course_code=p_course and not deferred
  ) then raise exception 'The student is not actively enrolled in this course'; end if;
  if p_attendance not between 0 and 40 or p_ca not between 0 and 30 or p_exams not between 0 and 30 then
    raise exception 'Scores must be Attendance 0-40, CA 0-30 and Exams 0-30.';
  end if;

  select * into existing_result from public.exam_results
    where application_id=p_application and course_code=p_course for update;
  if found then
    if existing_result.locked_at is not null or existing_result.published_at is not null then
      raise exception 'This result has been published or locked. An administrator or Academic Coordinator must reopen it for correction.';
    end if;
    update public.exam_results
      set attendance=p_attendance, ca=p_ca, exams=p_exams,
          exam_obj=0, exam_prac=0,
          grading_model='attendance_ca_exams_40_30_30',
          graded_by=auth.uid(), updated_at=now(), revision_no=coalesce(revision_no,1)+1
      where id=existing_result.id;
  else
    was_new := true;
    insert into public.exam_results(
      application_id,course_code,attendance,ca,exams,exam_obj,exam_prac,
      grading_model,graded_by,revision_no,updated_at
    ) values(
      p_application,p_course,p_attendance,p_ca,p_exams,0,0,
      'attendance_ca_exams_40_30_30',auth.uid(),1,now()
    );
  end if;

  select full_name into who from public.staff where id=auth.uid();
  insert into public.audit_log(actor,actor_name,action,target,note)
  values(auth.uid(),who,case when was_new then 'result_saved' else 'result_revised' end,
         p_application::text||':'||p_course,
         format('model=attendance_ca_exams_40_30_30; attendance=%s; ca=%s; exams=%s; previous_model=%s; previous_legacy_obj=%s; previous_legacy_prac=%s',p_attendance,p_ca,p_exams,case when was_new then 'new' else existing_result.grading_model end,case when was_new then 0 else coalesce(existing_result.exam_obj,0) end,case when was_new then 0 else coalesce(existing_result.exam_prac,0) end));
end $$;
revoke all on function public.tutor_save_result(uuid,text,int,int,int) from public,anon;
grant execute on function public.tutor_save_result(uuid,text,int,int,int) to authenticated;

-- Controlled correction: temporarily withdraw publication and unlock a result;
-- the next tutor save applies the current grading model, and the Academic team
-- must publish it again. A reason is mandatory and is recorded in the audit log.
create or replace function public.reopen_result_for_correction(p_result uuid, p_reason text)
returns public.exam_results
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.exam_results; who text;
begin
  if not has_role('administrator','academic') then
    raise exception 'Only an Administrator or Academic Coordinator can reopen results.';
  end if;
  if length(trim(coalesce(p_reason,''))) < 10 then
    raise exception 'Provide a correction reason of at least 10 characters.';
  end if;
  select * into r from public.exam_results where id=p_result for update;
  if not found then raise exception 'Result not found.'; end if;
  if r.published_at is null and r.locked_at is null then
    raise exception 'This result is already open for editing.';
  end if;
  update public.exam_results
    set published_at=null, published_by=null, locked_at=null, locked_by=null,
        revision_no=coalesce(revision_no,1)+1, updated_at=now()
    where id=p_result returning * into r;
  select full_name into who from public.staff where id=auth.uid();
  insert into public.audit_log(actor,actor_name,action,target,note)
    values(auth.uid(),who,'result_reopened_for_correction',p_result::text,trim(p_reason));
  return r;
end $$;
revoke all on function public.reopen_result_for_correction(uuid,text) from public,anon;
grant execute on function public.reopen_result_for_correction(uuid,text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Expose the grading model with every academic result payload
-- -----------------------------------------------------------------------------
create or replace function public.tutor_roster()
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp
as $$
begin
  if not has_role('tutor') then raise exception 'Tutors only'; end if;
  return coalesce((
    select jsonb_agg(x order by x.name) from (
      select ap.id application_id, ap.student_id,
        coalesce(nullif(trim(coalesce(ap.form_data->>'surname','')||' '||coalesce(ap.form_data->>'firstName','')),''),pr.full_name) name,
        pr.email, coalesce(ap.form_data->>'phone',pr.phone) phone,
        ap.intake_id, i.label intake_label, c.code course_code, c.name course_name, c.category course_category,
        (select to_jsonb(rr) from (
          select case when er.grading_model='needs_review' then null else er.attendance end attendance,
                 case when er.grading_model='needs_review' then null else er.ca end ca,
                 case when er.grading_model='needs_review' then null else er.exams end exams,
                 case when er.grading_model='needs_review' then null else er.exam_obj end legacy_exam_obj,
                 case when er.grading_model='needs_review' then null else er.exam_prac end legacy_exam_prac,
                 er.total,er.band,er.grading_model,er.published_at,er.locked_at,er.revision_no
          from public.exam_results er where er.application_id=ap.id and er.course_code=c.code
            and (er.published_at is not null or er.grading_model='needs_review')
        ) rr) result
      from public.lecturers l
      join public.lecturer_courses lc on lc.lecturer_id=l.id
      join public.application_courses ac on ac.course_code=lc.course_code and not ac.deferred
      join public.applications ap on ap.id=ac.application_id and ap.admission_decision='approved'
      join public.profiles pr on pr.id=ap.user_id
      join public.intakes i on i.id=ap.intake_id
      join public.courses c on c.code=ac.course_code
      where l.user_id=auth.uid() and l.is_active
    ) x
  ),'[]'::jsonb);
end $$;
revoke all on function public.tutor_roster() from public,anon;
grant execute on function public.tutor_roster() to authenticated;

-- Rebuild portal_data from migration 013 with grading_model and legacy component
-- details in result objects. The generated total/band columns are already aware
-- of the appropriate model, so all existing consumers continue to receive them.
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
          select id, body, file_path, submitted_at, marks, feedback, graded_at
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
        select to_jsonb(attempt_row)
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
revoke all on function public.portal_data() from public,anon;
grant execute on function public.portal_data() to authenticated;

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
    'summary',(select jsonb_build_object('graded',count(er.total) filter(where er.published_at is not null),
      'courses',count(ac.course_code),'average',round(avg(er.total) filter(where er.published_at is not null),1),
      'published',count(*) filter(where er.published_at is not null),'locked',count(*) filter(where er.locked_at is not null))
      from public.application_courses ac left join public.exam_results er on er.application_id=ac.application_id and er.course_code=ac.course_code
      where ac.application_id=aid and not ac.deferred),
    'timeline',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc) from public.application_state_history h where h.application_id=aid),'[]'::jsonb)
  ) into result_payload;
  return result_payload;
end $$;
revoke all on function public.student_academic_record(uuid) from public,anon;
grant execute on function public.student_academic_record(uuid) to authenticated;

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
revoke all on function public.published_student_results(uuid) from public,anon;
grant execute on function public.published_student_results(uuid) to authenticated;

create or replace function public.admin_student_360_detail(p_application uuid)
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare r jsonb;
begin
  if not has_role('administrator','registrar','academic','operations','viewer') then raise exception 'Staff access required'; end if;
  select jsonb_build_object(
    'application',(select jsonb_build_object('id',a.id,'student_id',a.student_id,'status',a.status,
      'admission_decision',a.admission_decision,'admission_note',a.admission_note,'payment_review',a.payment_review,
      'payment_note',a.payment_note,'total_ngn',a.total_ngn,'pay_reference',a.pay_reference,'created_at',a.created_at,
      'submitted_at',a.submitted_at,'paid_at',a.paid_at,'reviewed_at',a.reviewed_at,'intake',i.label,
      'form_data',a.form_data,'name',coalesce(nullif(trim(coalesce(a.form_data->>'firstName','')||' '||coalesce(a.form_data->>'surname','')),''),p.full_name),
      'email',p.email,'phone',p.phone)
      from public.applications a join public.profiles p on p.id=a.user_id join public.intakes i on i.id=a.intake_id where a.id=p_application),
    'courses',coalesce((select jsonb_agg(jsonb_build_object('code',c.code,'name',c.name,'category',c.category,'fee',ac.fee_ngn,'deferred',ac.deferred) order by c.category,c.name)
      from public.application_courses ac join public.courses c on c.code=ac.course_code where ac.application_id=p_application),'[]'::jsonb),
    'results',coalesce((select jsonb_agg(jsonb_build_object('code',er.course_code,'attendance',er.attendance,'ca',er.ca,'exams',er.exams,
      'legacy_exam_obj',er.exam_obj,'legacy_exam_prac',er.exam_prac,'grading_model',er.grading_model,
      'total',er.total,'band',er.band,'published',er.published_at is not null,'locked',er.locked_at is not null,
      'revision',er.revision_no,'result_id',er.id) order by er.course_code) from public.exam_results er where er.application_id=p_application),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(jsonb_build_object('reference',py.reference,'expected_ngn',py.expected_ngn,'paid_ngn',py.paid_ngn,
      'paid_at',py.paid_at,'verified_at',py.verified_at,'provider',py.provider,'source',py.source) order by coalesce(py.paid_at,py.created_at) desc)
      from public.payments py where py.application_id=p_application),'[]'::jsonb),
    'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'document_type',d.document_type,
      'document_key',d.document_key,'status',d.status,'file_url',d.file_url,'issued_at',d.issued_at) order by d.created_at desc)
      from public.student_documents d join public.applications a on a.user_id=d.user_id where a.id=p_application),'[]'::jsonb),
    'notifications',coalesce((select jsonb_agg(q) from (select jsonb_build_object('title',n.title,'message',n.message,'kind',n.kind,'read_at',n.read_at,'created_at',n.created_at) as q
      from public.student_notifications n join public.applications a on a.user_id=n.user_id where a.id=p_application order by n.created_at desc limit 20) notes),'[]'::jsonb),
    'timeline',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc) from public.application_state_history h where h.application_id=p_application),'[]'::jsonb)
  ) into r;
  if (r->'application') is null then raise exception 'Application not found'; end if;
  return r;
end $$;
revoke all on function public.admin_student_360_detail(uuid) from public,anon;
grant execute on function public.admin_student_360_detail(uuid) to authenticated;

-- Restricted read access for staff reviewing archived historical scores.
create or replace function public.admin_legacy_result_archive(p_limit integer default 100)
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare payload jsonb;
begin
  if not has_role('administrator','academic') then
    raise exception 'Administrator or Academic Coordinator access required';
  end if;
  if p_limit is null or p_limit < 1 then p_limit := 100; end if;
  p_limit := least(p_limit,200);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.archived_at desc),'[]'::jsonb)
    into payload
  from (
    select ar.result_id,ar.application_id,ar.course_code,ar.legacy_ca,
      ar.legacy_exam_obj,ar.legacy_exam_prac,ar.reconstructed_total,
      ar.reconstructed_band,ar.source_confidence,ar.was_published,ar.was_locked,ar.archived_at,
      ap.student_id,coalesce(p.full_name,concat_ws(' ',ap.form_data->>'firstName',ap.form_data->>'surname')) student_name
    from public.legacy_exam_results_archive ar
    left join public.applications ap on ap.id=ar.application_id
    left join public.profiles p on p.id=ap.user_id
    order by ar.archived_at desc
    limit p_limit
  ) x;
  return payload;
end $$;
revoke all on function public.admin_legacy_result_archive(integer) from public,anon;
grant execute on function public.admin_legacy_result_archive(integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Administrator/Academic Coordinator release readiness diagnostics
-- -----------------------------------------------------------------------------
create or replace function public.release_readiness_snapshot()
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare
  checks jsonb;
  result_payload jsonb;
  profile_fk boolean;
  orphan_apps bigint;
  assessment_ok boolean;
  assignment_ok boolean;
  student_score_privacy_ok boolean;
  total_expr text;
  legacy_rows bigint;
  review_rows bigint;
  pending_sheet bigint;
  failed_sheet bigint;
  failed_comms bigint := 0;
  failed_documents bigint := 0;
  immutable_audit boolean;
  overall text;
begin
  if not has_role('administrator','academic') then raise exception 'Administrator or Academic Coordinator access required'; end if;

  select exists(
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.conrelid='public.applications'::regclass
      and c.confrelid='public.profiles'::regclass and c.contype='f'
      and array_length(c.conkey,1)=1 and a.attname='user_id' and c.convalidated
  ) into profile_fk;
  select count(*) into orphan_apps from public.applications a
    left join public.profiles p on p.id=a.user_id where p.id is null;
  select position('question_ordinal' in pg_get_functiondef('public.submit_assessment(uuid,jsonb)'::regprocedure))>0
    and position('qi.question_ordinal' in pg_get_functiondef('public.submit_assessment(uuid,jsonb)'::regprocedure))>0
    into assessment_ok;
  select position('question_ordinal' in pg_get_functiondef('public.submit_assignment(uuid,uuid,text,text)'::regprocedure))>0
    and position('qi.question_ordinal' in pg_get_functiondef('public.submit_assignment(uuid,uuid,text,text)'::regprocedure))>0
    into assignment_ok;
  select position('er.published_at is not null' in pg_get_functiondef('public.portal_data()'::regprocedure))>0
    and position('when er.published_at is null then jsonb_build_object' in pg_get_functiondef('public.student_academic_record(uuid)'::regprocedure))>0
    into student_score_privacy_ok;
  select pg_get_expr(ad.adbin,ad.adrelid) into total_expr
    from pg_attribute at join pg_attrdef ad on ad.adrelid=at.attrelid and ad.adnum=at.attnum
    where at.attrelid='public.exam_results'::regclass and at.attname='total' and not at.attisdropped;
  select count(*) into legacy_rows from public.exam_results where grading_model='legacy_ca_exam_obj_prac';
  select count(*) into review_rows from public.exam_results where grading_model='needs_review';
  select count(*) into pending_sheet from public.sheet_outbox where not done;
  select count(*) into failed_sheet from public.sheet_outbox where not done and coalesce(attempts,0)>=8;
  if to_regclass('public.communication_outbox') is not null then
    execute 'select count(*) from public.communication_outbox where status = ''failed''' into failed_comms;
  end if;
  if to_regclass('public.document_jobs') is not null then
    execute 'select count(*) from public.document_jobs where status = ''failed''' into failed_documents;
  end if;
  select exists(select 1 from pg_trigger where tgrelid='public.audit_log'::regclass
    and tgname='audit_log_immutable' and not tgisinternal) into immutable_audit;

  checks := jsonb_build_array(
    jsonb_build_object('key','profile_fk','label','Applications link to profiles','status',case when profile_fk and orphan_apps=0 then 'pass' else 'fail' end,
      'detail',case when profile_fk and orphan_apps=0 then 'Validated foreign key exists and no orphan applications were found.' else format('Validated FK: %s; applications with missing profiles: %s.',profile_fk,orphan_apps) end),
    jsonb_build_object('key','assessment_ord','label','Exam assessment question indexing','status',case when assessment_ok then 'pass' else 'fail' end,
      'detail',case when assessment_ok then 'Uses the explicitly qualified question_ordinal column.' else 'Assessment function does not contain the expected qualified ordinality alias.' end),
    jsonb_build_object('key','assignment_ord','label','Assignment question indexing','status',case when assignment_ok then 'pass' else 'fail' end,
      'detail',case when assignment_ok then 'Uses the explicitly qualified question_ordinal column.' else 'Assignment function does not contain the expected qualified ordinality alias.' end),
    jsonb_build_object('key','student_score_privacy','label','Unpublished grades are hidden from students','status',case when student_score_privacy_ok then 'pass' else 'fail' end,
      'detail',case when student_score_privacy_ok then 'Student RPCs return numeric score components only after publication.' else 'Review portal_data/student_academic_record: a student response may still include draft scores.' end),
    jsonb_build_object('key','grading_model','label','Grading model compatibility','status',case when total_expr like '%grading_model%' and total_expr like '%exam_obj%' and total_expr like '%exam_prac%' then 'pass' else 'fail' end,
      'detail',coalesce(total_expr,'Generated total expression was not found.')),
    jsonb_build_object('key','legacy_results','label','Legacy grading records','status',case when legacy_rows=0 then 'pass' else 'warning' end,
      'detail',format('%s result(s) retain identifiable historical CA + Objective + Practical scoring.',legacy_rows)),
    jsonb_build_object('key','grading_review','label','Ambiguous grading records','status',case when review_rows=0 then 'pass' else 'warning' end,
      'detail',format('%s result(s) need staff review before a reliable total can be displayed.',review_rows)),
    jsonb_build_object('key','immutable_audit','label','Append-only audit trigger','status',case when immutable_audit then 'pass' else 'fail' end,
      'detail',case when immutable_audit then 'Audit UPDATE/DELETE trigger is installed.' else 'audit_log_immutable trigger is missing.' end),
    jsonb_build_object('key','sheet_queue','label','Google Sheets mirror queue','status',case when failed_sheet=0 and pending_sheet=0 then 'pass' when failed_sheet>0 then 'warning' when pending_sheet>0 then 'warning' else 'pass' end,
      'detail',format('%s pending; %s retry-exhausted.',pending_sheet,failed_sheet)),
    jsonb_build_object('key','communication_queue','label','Communication delivery queue','status',case when failed_comms=0 then 'pass' else 'warning' end,
      'detail',format('%s failed communication job(s).',failed_comms)),
    jsonb_build_object('key','document_queue','label','Institutional document jobs','status',case when failed_documents=0 then 'pass' else 'warning' end,
      'detail',format('%s failed document job(s).',failed_documents))
  );
  select case when exists(select 1 from jsonb_array_elements(checks) as elem(value) where elem.value->>'status'='fail') then 'fail'
              when exists(select 1 from jsonb_array_elements(checks) as elem(value) where elem.value->>'status'='warning') then 'warning'
              else 'ready' end into overall;
  select jsonb_build_object('generated_at',now(),'overall_status',overall,'checks',checks,
    'metrics',jsonb_build_object('applications',(select count(*) from public.applications),
      'profiles',(select count(*) from public.profiles),'results',(select count(*) from public.exam_results),
      'legacy_results',legacy_rows,'grading_review',review_rows,'unpublished_results',(select count(*) from public.exam_results where published_at is null),
      'locked_results',(select count(*) from public.exam_results where locked_at is not null),
      'sheet_pending',pending_sheet,'sheet_failed',failed_sheet,'communication_failed',failed_comms,'document_failed',failed_documents))
  into result_payload;
  return result_payload;
end $$;
revoke all on function public.release_readiness_snapshot() from public,anon;
grant execute on function public.release_readiness_snapshot() to authenticated;

comment on function public.release_readiness_snapshot() is 'Administrator/Academic Coordinator pre-production diagnostics. Does not replace live staging or provider-delivery tests.';
notify pgrst, 'reload schema';

commit;
