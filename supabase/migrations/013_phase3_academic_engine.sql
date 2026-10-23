-- AH STUDENT HUB - Phase 3 Academic Experience & Production Architecture
-- Depends on 001-012. Constraint installation is safe to re-run in this migration slot.
-- IMPORTANT: do not replay the complete 013 migration after 021 has added grading_model.
-- It is a historical baseline migration that redefines earlier portal functions.
begin;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='exam_results' and column_name='grading_model'
  ) then
    raise exception 'Migration 013 must not be replayed after grading_model exists. On an upgraded database, apply the corrected 021 and 022 release repair files instead.';
  end if;
end $$;

-- 1) Assessment engine -------------------------------------------------------
alter table assignments add column if not exists submission_type text not null default 'Online' check (submission_type in ('Online','Paper'));
alter table assignments add column if not exists file_required boolean not null default false;
alter table assignments add column if not exists external_url text;
alter table assignments add column if not exists question_set jsonb not null default '[]'::jsonb;
alter table exams add column if not exists submission_type text not null default 'Online' check (submission_type in ('Online','Paper'));
alter table exams add column if not exists file_required boolean not null default false;
alter table exams add column if not exists external_url text;
alter table exams add column if not exists time_limit_minutes int;
alter table exams add column if not exists question_set jsonb not null default '[]'::jsonb;

-- 2) Assessment attempts/answers. The server remains authoritative for timing.
create table if not exists assessment_attempts(
  id uuid primary key default gen_random_uuid(),
  assessment_type text not null check (assessment_type in ('assignment','exam')),
  assessment_id uuid not null,
  application_id uuid not null references applications on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  submitted_at timestamptz,
  status text not null default 'in_progress' check(status in ('in_progress','submitted','expired')),
  answers jsonb not null default '{}'::jsonb,
  unique(assessment_type, assessment_id, application_id)
);
alter table assessment_attempts enable row level security;
drop policy if exists assessment_attempts_own on assessment_attempts;
create policy assessment_attempts_own on assessment_attempts for select using(user_id = auth.uid());

-- 3) New grading model: Attendance 40%, CA 30%, Exams 30%.
-- IMPORTANT: snapshot pre-existing legacy CA before normalizing the current-model CA
-- field. Phase 12 consumes legacy_ca for audited historical totals.
alter table public.exam_results add column if not exists attendance int not null default 0;
alter table public.exam_results add column if not exists exams int not null default 0;
alter table public.exam_results add column if not exists legacy_ca int;
update public.exam_results
   set legacy_ca = ca
 where legacy_ca is null
   and (coalesce(exam_obj,0) <> 0 or coalesce(exam_prac,0) <> 0);
update public.exam_results
   set attendance = least(40, greatest(0, coalesce(attendance,0))),
       ca = least(30, greatest(0, coalesce(ca,0))),
       exams = least(30, greatest(0, coalesce(exams,0)));
-- Keep the historical objective/practical columns for compatibility; the new current
-- grading model uses Attendance/CA/Exams. Remove only obsolete legacy constraint names.
-- The current named checks are installed conditionally so a retry after partial execution
-- cannot fail with SQLSTATE 42710 (duplicate_object).
alter table public.exam_results drop constraint if exists exam_results_ca_check;
alter table public.exam_results drop constraint if exists exam_results_exam_obj_check;
alter table public.exam_results drop constraint if exists exam_results_exam_prac_check;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.exam_results'::regclass and conname='exam_results_attendance_check') then
    alter table public.exam_results add constraint exam_results_attendance_check check(attendance between 0 and 40);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.exam_results'::regclass and conname='exam_results_ca_30_check') then
    alter table public.exam_results add constraint exam_results_ca_30_check check(ca between 0 and 30);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.exam_results'::regclass and conname='exam_results_exams_30_check') then
    alter table public.exam_results add constraint exam_results_exams_30_check check(exams between 0 and 30);
  end if;
end $$;
-- Rebuild generated columns only in the Phase 3 grading model, before migration 021
-- installs the model-aware versions. The top-level guard stops this file from downgrading
-- those Phase 11 definitions on upgraded databases.
alter table public.exam_results drop column if exists total;
alter table public.exam_results drop column if exists band;
alter table public.exam_results add column total int generated always as (attendance + ca + exams) stored;
alter table public.exam_results add column band text generated always as (case when attendance + ca + exams >= 70 then 'Distinction' when attendance + ca + exams >= 60 then 'Credit' when attendance + ca + exams >= 50 then 'Pass' else 'Fail' end) stored;
comment on column public.exam_results.legacy_ca is 'Pre-normalization CA snapshot for records containing legacy Objective/Practical scores; treat as a historical snapshot requiring verification unless source records confirm it.';

-- 4) Course addition lifecycle: an unpaid request can be removed by the student.
create or replace function cancel_course_addition(p_id uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from course_additions ca using applications ap
   where ca.id=p_id and ap.id=ca.application_id and ap.user_id=auth.uid() and ca.status='pending_payment';
  if not found then raise exception 'This course request has already been paid, reviewed or removed.'; end if;
end $$;

-- 5) Secure student deferment view/action helpers.
create or replace function student_deferment_options(p_application uuid) returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare a applications; r jsonb;
begin
 select * into a from applications where id=p_application and user_id=auth.uid();
 if not found or a.admission_decision <> 'approved' then raise exception 'Deferment is available only for admitted students.'; end if;
 select jsonb_build_object('intakes',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',label) order by opens_at) from intakes where is_active and id<>a.intake_id),'[]'::jsonb),
   'courses',coalesce((select jsonb_agg(jsonb_build_object('code',c.code,'name',c.name,'category',c.category) order by c.category,c.name) from application_courses ac join courses c on c.code=ac.course_code where ac.application_id=a.id and not ac.deferred),'[]'::jsonb)) into r;
 return r;
end $$;

-- 6) Assessment start/submit RPCs. Server validates enrolment and exam time.
create or replace function start_assessment(p_type text,p_id uuid,p_application uuid) returns assessment_attempts language plpgsql security definer set search_path = public, pg_temp as $$
declare a assessment_attempts; uid uuid:=auth.uid(); intake uuid; course text; limitm int; due timestamptz; closed boolean:=false; q jsonb;
begin
 if uid is null then raise exception 'Not signed in'; end if;
 select ap.intake_id into intake from applications ap join application_courses ac on ac.application_id=ap.id and not ac.deferred where ap.id=p_application and ap.user_id=uid and ap.admission_decision='approved';
 if intake is null then raise exception 'You are not enrolled in this class.'; end if;
 if p_type='exam' then
   select e.course_code,e.time_limit_minutes,e.due_at,e.question_set into course,limitm,due,q from exams e where e.id=p_id;
   if course is null then raise exception 'Exam not found.'; end if;
   if due is not null and due < now() then raise exception 'This exam has closed.'; end if;
 else
   select x.course_code,x.due_at,x.closed,x.question_set into course,due,closed,q from assignments x where x.id=p_id;
   if course is null then raise exception 'Assignment not found.'; end if;
   if closed then raise exception 'This assignment is closed.'; end if;
   if due is not null and due < now() then raise exception 'This assignment has passed its due date.'; end if;
 end if;
 if not exists(select 1 from application_courses where application_id=p_application and course_code=course and not deferred) then raise exception 'You are not enrolled in this course.'; end if;
 select * into a from assessment_attempts where assessment_type=p_type and assessment_id=p_id and application_id=p_application;
 if found then
   if a.status='submitted' then return a; end if;
   if a.expires_at is not null and a.expires_at < now() then update assessment_attempts set status='expired',submitted_at=now() where id=a.id returning * into a; raise exception 'Your assessment time has expired.'; end if;
   return a;
 end if;
 insert into assessment_attempts(assessment_type,assessment_id,application_id,user_id,expires_at) values(p_type,p_id,p_application,uid,case when p_type='exam' and limitm is not null then now()+make_interval(mins=>limitm) else null end) returning * into a;
 return a;
end $$;

create or replace function submit_assessment(p_attempt uuid,p_answers jsonb) returns assessment_attempts language plpgsql security definer set search_path = public, pg_temp as $$
declare a assessment_attempts; q jsonb; mandatory jsonb; k text; v jsonb;
begin
 select * into a from assessment_attempts where id=p_attempt and user_id=auth.uid() for update;
 if not found then raise exception 'Assessment attempt not found.'; end if;
 if a.status<>'in_progress' then return a; end if;
 if a.expires_at is not null and a.expires_at < now() then update assessment_attempts set status='expired',submitted_at=now(),answers=p_answers where id=a.id returning * into a; return a; end if;
 if a.assessment_type='exam' then
   select question_set into q from exams where id=a.assessment_id;
   if exists(select 1 from exams where id=a.assessment_id and file_required) and nullif(trim(coalesce(p_answers->>'__drive_link','')),'') is null then raise exception 'Please provide the required Drive/file link.'; end if;
 else select question_set into q from assignments where id=a.assessment_id; end if;
 for k,v in select key,value from jsonb_each(coalesce(q,'[]'::jsonb)) loop
   if coalesce((v->>'mandatory')::boolean,false) and nullif(trim(coalesce(p_answers->>k,'')),'') is null then raise exception 'Please answer required question %.', (k::int+1); end if;
 end loop;
 if coalesce(p_answers->>'__external_submitted','') <> '' and lower(coalesce(p_answers->>'__external_submitted','')) <> 'true' then raise exception 'Please complete the external assessment and confirm submission.'; end if;
 update assessment_attempts set answers=coalesce(p_answers,'{}'::jsonb),submitted_at=now(),status='submitted' where id=a.id returning * into a;
 return a;
end $$;

-- 7) Tutor grading RPCs and bulk import.
drop function if exists tutor_save_result(uuid,text,int,int,int);
create or replace function tutor_save_result(p_application uuid,p_course text,p_attendance int,p_ca int,p_exams int) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if not has_role('tutor') then raise exception 'Tutors only'; end if;
 if not exists(select 1 from lecturers l join lecturer_courses lc on lc.lecturer_id=l.id where l.user_id=auth.uid() and l.is_active and lc.course_code=p_course) then raise exception 'You do not teach this course'; end if;
 if not exists(select 1 from application_courses where application_id=p_application and course_code=p_course and not deferred) then raise exception 'The student is not actively enrolled in this course'; end if;
 if p_attendance not between 0 and 40 or p_ca not between 0 and 30 or p_exams not between 0 and 30 then raise exception 'Scores must be Attendance 0-40, CA 0-30 and Exams 0-30.'; end if;
 insert into exam_results(application_id,course_code,attendance,ca,exams,exam_obj,exam_prac,graded_by) values(p_application,p_course,p_attendance,p_ca,p_exams,0,0,auth.uid())
 on conflict(application_id,course_code) do update set attendance=excluded.attendance,ca=excluded.ca,exams=excluded.exams,graded_by=auth.uid(),updated_at=now();
end $$;

create or replace function tutor_bulk_save_results(p_rows jsonb) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb; ok int:=0; bad int:=0; msg text; app uuid; course text; att int; caa int; ex int; out jsonb:='[]'::jsonb;
begin
 if not has_role('tutor') then raise exception 'Tutors only'; end if;
 if jsonb_typeof(p_rows)<>'array' then raise exception 'Rows must be a JSON array.'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  begin
   app := (r->>'application_id')::uuid; course:=trim(r->>'course_code'); att:=coalesce((r->>'attendance')::int,0); caa:=coalesce((r->>'ca')::int,0); ex:=coalesce((r->>'exams')::int,0);
   perform tutor_save_result(app,course,att,caa,ex); ok:=ok+1;
  exception when others then bad:=bad+1; out:=out||jsonb_build_array(jsonb_build_object('row',r,'error',sqlerrm)); end;
 end loop;
 return jsonb_build_object('saved',ok,'failed',bad,'errors',out);
end $$;

create or replace function tutor_roster() returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
 if not has_role('tutor') then raise exception 'Tutors only'; end if;
 return coalesce((select jsonb_agg(x order by x.name) from (select ap.id application_id,ap.student_id,coalesce(nullif(trim(coalesce(ap.form_data->>'surname','')||' '||coalesce(ap.form_data->>'firstName','')),''),pr.full_name) name,pr.email,coalesce(ap.form_data->>'phone',pr.phone) phone,ap.intake_id,i.label intake_label,c.code course_code,c.name course_name,c.category course_category,(select to_jsonb(r) from(select attendance,ca,exams,total,band from exam_results er where er.application_id=ap.id and er.course_code=c.code)r) result from lecturers l join lecturer_courses lc on lc.lecturer_id=l.id join application_courses ac on ac.course_code=lc.course_code and not ac.deferred join applications ap on ap.id=ac.application_id and ap.admission_decision='approved' join profiles pr on pr.id=ap.user_id join intakes i on i.id=ap.intake_id join courses c on c.code=ac.course_code where l.user_id=auth.uid() and l.is_active)x),'[]'::jsonb);
end $$;

-- 8) Portal payload: full profile, 40/30/30 results, question sets, deferments and additions.
create or replace function portal_data() returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare uid uuid:=auth.uid(); perf jsonb; res jsonb;
begin
 if uid is null then raise exception 'Not signed in'; end if;
 select to_jsonb(z) into perf from (with avgs as(select a.id aid,a.intake_id,a.user_id,avg(e.total) av,count(*) n from applications a join exam_results e on e.application_id=a.id where a.admission_decision='approved' group by a.id,a.intake_id,a.user_id), ranked as(select *,rank() over(partition by intake_id order by av desc) rk from avgs) select aid application_id,round(av,1) average,rk rank,n graded,(select count(*) from applications x where x.intake_id=ranked.intake_id and x.admission_decision='approved') class_size from ranked where user_id=uid order by aid desc limit 1) z;
 select jsonb_build_object(
 'profile',(select to_jsonb(p) from(select full_name,phone,email from profiles where id=uid)p),
 'applications',coalesce((select jsonb_agg(a order by a.created_at desc) from(select ap.id,ap.student_id,ap.status,ap.admission_decision,ap.admission_note,ap.intake_id,i.label intake_label,ap.total_ngn,ap.package_code,ap.pay_bank,ap.pay_account,ap.pay_reference,ap.passport_path,ap.form_data,ap.created_at,ap.paid_at,ap.submitted_at,ap.reviewed_at,ap.welcomed_at,(ap.admission_decision='approved') admitted,
 coalesce((select jsonb_agg(jsonb_build_object('code',c.code,'name',c.name,'category',c.category,'fee',ac.fee_ngn,'deferred',ac.deferred,'tutors',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.full_name,'email',l.email,'phone',l.phone)),'[]'::jsonb) from lecturer_courses lc join lecturers l on l.id=lc.lecturer_id where lc.course_code=c.code and l.is_active),'result',(select to_jsonb(rr) from(select attendance,ca,exams,total,band from exam_results er where er.application_id=ap.id and er.course_code=c.code)rr))) from application_courses ac join courses c on c.code=ac.course_code where ac.application_id=ap.id),'[]'::jsonb) courses
 from applications ap join intakes i on i.id=ap.intake_id where ap.user_id=uid and ap.status<>'expired')a),'[]'::jsonb),
 'assignments',coalesce((select jsonb_agg(x order by x.due_at nulls last) from(select s.id,s.title,s.description,s.due_at,s.max_score,s.closed,s.course_code,c.name course_name,c.category course_category,s.submission_type,s.file_required,s.external_url,s.question_set,ap.id application_id,(select to_jsonb(q) from(select id,body,file_path,submitted_at,marks,feedback,graded_at from submissions sub where sub.assignment_id=s.id and sub.application_id=ap.id)q)submission from assignments s join application_courses ac on ac.course_code=s.course_code and not ac.deferred join applications ap on ap.id=ac.application_id and ap.user_id=uid and ap.admission_decision='approved' and(s.intake_id is null or s.intake_id=ap.intake_id) join courses c on c.code=s.course_code)x),'[]'::jsonb),
 'lectures',coalesce((select jsonb_agg(x order by x.held_at desc) from(select lt.id,lt.title,lt.description,lt.held_at,lt.course_code,c.name course_name,c.category course_category,lt.material_path,l.full_name tutor from lectures lt join application_courses ac on ac.course_code=lt.course_code and not ac.deferred join applications ap on ap.id=ac.application_id and ap.user_id=uid and ap.admission_decision='approved' and(lt.intake_id is null or lt.intake_id=ap.intake_id) join courses c on c.code=lt.course_code left join lecturers l on l.id=lt.lecturer_id)x),'[]'::jsonb),
 'exams',coalesce((select jsonb_agg(x order by x.due_at nulls last) from(select e.id,e.title,e.instructions,e.due_at,e.course_code,c.name course_name,c.category course_category,e.submission_type,e.file_required,e.external_url,e.time_limit_minutes,e.question_set,ap.id application_id,(select to_jsonb(at) from assessment_attempts at where at.assessment_type='exam' and at.assessment_id=e.id and at.application_id=ap.id) attempt from exams e join application_courses ac on ac.course_code=e.course_code and not ac.deferred join applications ap on ap.id=ac.application_id and ap.user_id=uid and ap.admission_decision='approved' and(e.intake_id is null or e.intake_id=ap.intake_id) join courses c on c.code=e.course_code)x),'[]'::jsonb),
 'performance',perf,
 'additions',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from(select ca.id,ca.application_id,ca.course_code,c.name course_name,c.category course_category,ca.fee_ngn,ca.status,ca.note,ca.created_at from course_additions ca join applications ap on ap.id=ca.application_id join courses c on c.code=ca.course_code where ap.user_id=uid)q),'[]'::jsonb),
 'deferments',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from(select d.id,d.application_id,d.scope,d.course_codes,d.reason_type,d.reason,d.status,d.admin_note,d.created_at,d.decided_at,ri.label return_label,(select coalesce(jsonb_agg(c.name||' ('||c.category||')'),'[]'::jsonb) from courses c where c.code=any(d.course_codes)) course_names from deferments d join applications ap on ap.id=d.application_id left join intakes ri on ri.id=d.return_intake_id where ap.user_id=uid)q),'[]'::jsonb),
 'catalog',coalesce((select jsonb_agg(jsonb_build_object('code',code,'name',name,'category',category,'fee',fee_ngn)) from courses where is_active),'[]'::jsonb),
 'open_intakes',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',label)) from intakes where is_active and (opens_at is null or opens_at<=now()) and (closes_at is null or closes_at>=now())),'[]'::jsonb)
 ) into res; return res;
end $$;

-- 9) Only active tutor accounts can use tutor portal. Deleting a lecturer suspends login.
create or replace function admin_delete_lecturer(p_id uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare l lecturers; who text;
begin
 if not can_write('lecturers') then raise exception 'Your role cannot manage lecturers'; end if;
 select * into l from lecturers where id=p_id; if not found then raise exception 'Lecturer not found'; end if;
 select full_name into who from staff where id=auth.uid();
 if l.user_id is not null then update staff set status='suspended' where id=l.user_id and role='tutor'; end if;
 insert into audit_log(actor,actor_name,action,target,note) values(auth.uid(),who,'lecturer_deleted',l.full_name,l.email);
 delete from lecturers where id=p_id;
end $$;

-- 10) Function privileges.
do $$ declare f text; begin foreach f in array array['cancel_course_addition(uuid)','student_deferment_options(uuid)','start_assessment(text,uuid,uuid)','submit_assessment(uuid,jsonb)','tutor_save_result(uuid,text,int,int,int)','tutor_bulk_save_results(jsonb)','portal_data()','admin_delete_lecturer(uuid)'] loop execute format('revoke all on function %s from public,anon; grant execute on function %s to authenticated',f,f); end loop; end $$;

create index if not exists assessment_attempts_user_idx on assessment_attempts(user_id,started_at desc);
create index if not exists assessment_attempts_assessment_idx on assessment_attempts(assessment_type,assessment_id);

commit;
