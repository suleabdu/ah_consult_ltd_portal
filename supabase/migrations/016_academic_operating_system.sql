-- AH STUDENT HUB - Phase 6: Academic Operating System
-- Depends on 001-015. Safe to re-run.
-- Purpose: explicit lifecycle states, authoritative academic record, result publication/locking,
-- student 360 data, stronger admin action-center authorization and operational auditability.

-- 1) Explicit lifecycle state history ---------------------------------------
create table if not exists application_state_history(
  id bigserial primary key,
  application_id uuid not null references applications(id) on delete cascade,
  from_state text,
  to_state text not null,
  actor uuid,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists application_state_history_app_idx on application_state_history(application_id,created_at desc);
alter table application_state_history enable row level security;
drop policy if exists own_state_history on application_state_history;
create policy own_state_history on application_state_history for select to authenticated
using (exists(select 1 from applications a where a.id=application_id and a.user_id=auth.uid()));

create or replace function record_application_state_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op='INSERT' then
    insert into application_state_history(application_id,from_state,to_state,actor)
    values(new.id,null,new.status,auth.uid());
  elsif new.status is distinct from old.status then
    insert into application_state_history(application_id,from_state,to_state,actor)
    values(new.id,old.status,new.status,auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists applications_state_history on applications;
create trigger applications_state_history after insert or update of status on applications
for each row execute function record_application_state_change();

-- 2) Result publication lifecycle ------------------------------------------
alter table exam_results add column if not exists published_at timestamptz;
alter table exam_results add column if not exists published_by uuid references auth.users(id);
alter table exam_results add column if not exists locked_at timestamptz;
alter table exam_results add column if not exists locked_by uuid references auth.users(id);
alter table exam_results add column if not exists revision_no int not null default 1;
create index if not exists exam_results_publication_idx on exam_results(published_at,locked_at);

create or replace function publish_result(p_result uuid) returns exam_results
language plpgsql security definer set search_path = public, pg_temp as $$
declare r exam_results;
begin
  if not has_role('administrator','academic','registrar') then raise exception 'Academic publication permission required'; end if;
  select * into r from exam_results where id=p_result for update;
  if not found then raise exception 'Result not found'; end if;
  if r.locked_at is not null then raise exception 'This result is locked'; end if;
  update exam_results set published_at=now(), published_by=auth.uid() where id=p_result returning * into r;
  insert into audit_log(actor,action,target,note) values(auth.uid(),'result_published',p_result::text,'Result published to student portal');
  return r;
end $$;

create or replace function lock_result(p_result uuid) returns exam_results
language plpgsql security definer set search_path = public, pg_temp as $$
declare r exam_results;
begin
  if not has_role('administrator','academic') then raise exception 'Only Academic or Administrator can lock results'; end if;
  select * into r from exam_results where id=p_result for update;
  if not found then raise exception 'Result not found'; end if;
  if r.published_at is null then raise exception 'Publish the result before locking it'; end if;
  update exam_results set locked_at=now(), locked_by=auth.uid() where id=p_result returning * into r;
  insert into audit_log(actor,action,target,note) values(auth.uid(),'result_locked',p_result::text,'Result locked against normal edits');
  return r;
end $$;

-- Recreate tutor save guard so published/locked results cannot be silently changed.
drop function if exists tutor_save_result(uuid,text,int,int,int);
create or replace function tutor_save_result(p_application uuid,p_course text,p_attendance int,p_ca int,p_exams int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare rid uuid;
begin
  if not has_role('tutor') then raise exception 'Tutors only'; end if;
  if not exists(select 1 from lecturers l join lecturer_courses lc on lc.lecturer_id=l.id where l.user_id=auth.uid() and l.is_active and lc.course_code=p_course) then raise exception 'You do not teach this course'; end if;
  if not exists(select 1 from application_courses where application_id=p_application and course_code=p_course) then raise exception 'The student is not enrolled in this course'; end if;
  if p_attendance not between 0 and 40 or p_ca not between 0 and 30 or p_exams not between 0 and 30 then raise exception 'Scores must be Attendance 0-40, CA 0-30, Exams 0-30'; end if;
  select id into rid from exam_results where application_id=p_application and course_code=p_course for update;
  if rid is not null then
    if exists(select 1 from exam_results where id=rid and (locked_at is not null or published_at is not null)) then raise exception 'This result has been published or locked and cannot be edited by a tutor'; end if;
    update exam_results set attendance=p_attendance,ca=p_ca,exams=p_exams,graded_by=auth.uid(),revision_no=revision_no+1 where id=rid;
  else
    insert into exam_results(application_id,course_code,attendance,ca,exams,exam_obj,exam_prac,graded_by) values(p_application,p_course,p_attendance,p_ca,p_exams,0,0,auth.uid());
  end if;
end $$;

-- 3) Authoritative student academic record ---------------------------------
create or replace function student_academic_record(p_application uuid default null) returns jsonb
language plpgsql security definer stable set search_path = public, pg_temp as $$
declare uid uuid:=auth.uid(); aid uuid; result jsonb;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  select id into aid from applications where user_id=uid and admission_decision='approved' and (p_application is null or id=p_application) order by created_at desc limit 1;
  if aid is null then return jsonb_build_object('student',null,'courses','[]'::jsonb,'summary',null,'timeline','[]'::jsonb); end if;
  select jsonb_build_object(
    'student',(select jsonb_build_object('application_id',a.id,'student_id',a.student_id,'name',coalesce(nullif(trim(coalesce(a.form_data->>'surname','')||' '||coalesce(a.form_data->>'firstName','')),''),p.full_name),'email',p.email,'intake',i.label,'admission_decision',a.admission_decision) from applications a join profiles p on p.id=a.user_id join intakes i on i.id=a.intake_id where a.id=aid),
    'courses',coalesce((select jsonb_agg(jsonb_build_object('code',c.code,'name',c.name,'category',c.category,'deferred',ac.deferred,'result',case when er.id is null then null else jsonb_build_object('attendance',er.attendance,'ca',er.ca,'exams',er.exams,'total',er.total,'band',er.band,'published',er.published_at is not null,'locked',er.locked_at is not null,'revision',er.revision_no) end) order by c.category,c.name) from application_courses ac join courses c on c.code=ac.course_code left join exam_results er on er.application_id=ac.application_id and er.course_code=ac.course_code where ac.application_id=aid),'[]'::jsonb),
    'summary',(select jsonb_build_object('graded',count(er.id) filter(where er.published_at is not null),'courses',count(ac.course_code),'average',round(avg(er.total) filter(where er.published_at is not null),1),'published',count(*) filter(where er.published_at is not null),'locked',count(*) filter(where er.locked_at is not null)) from application_courses ac left join exam_results er on er.application_id=ac.application_id and er.course_code=ac.course_code where ac.application_id=aid and not ac.deferred),
    'timeline',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc) from application_state_history h where h.application_id=aid),'[]'::jsonb)
  ) into result;
  return result;
end $$;

-- 4) Admin 360 view ---------------------------------------------------------
create or replace function admin_student_360(p_query text) returns jsonb
language plpgsql security definer stable set search_path = public, pg_temp as $$
declare q text:=lower(trim(coalesce(p_query,''))); result jsonb;
begin
  if not has_role('administrator','registrar','academic','operations','viewer') then raise exception 'Staff access required'; end if;
  select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb) into result
  from (
    select a.id,a.student_id,a.status,a.admission_decision,a.total_ngn,a.created_at,i.label intake_label,
      coalesce(nullif(trim(coalesce(a.form_data->>'surname','')||' '||coalesce(a.form_data->>'firstName','')),''),p.full_name) name,
      p.email,p.phone,
      (select count(*) from application_courses ac where ac.application_id=a.id) course_count,
      (select count(*) from exam_results er where er.application_id=a.id) graded_count
    from applications a join profiles p on p.id=a.user_id join intakes i on i.id=a.intake_id
    where q='' or lower(coalesce(a.student_id,'')) like '%'||q||'%' or lower(coalesce(p.full_name,'')) like '%'||q||'%' or lower(coalesce(p.email,'')) like '%'||q||'%' or lower(coalesce(p.phone,'')) like '%'||q||'%'
    limit 50
  ) x;
  return result;
end $$;

-- 5) Harden Phase 5 action center to actual admin-capable roles.
create or replace function admin_action_center() returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare res jsonb;
begin
 if not has_role('administrator','registrar','finance','academic','operations','viewer') then raise exception 'Staff access required'; end if;
 select jsonb_build_object(
  'applications_review',(select count(*) from applications where status in ('paid','submitted','under_review') and coalesce(admission_decision,'pending')='pending'),
  'payments_review',(select count(*) from applications where payment_claimed_at is not null and payment_review='pending'),
  'deferments_review',(select count(*) from deferments where status='pending'),
  'inactive_tutors',(select count(*) from lecturers where is_active=false),
  'students',(select count(distinct user_id) from applications where admission_decision='approved'),
  'active_courses',(select count(*) from courses where is_active=true),
  'failed_sync',(select count(*) from sheet_outbox where done=false and attempts>=8),
  'unread_notifications',(select count(*) from student_notifications where read_at is null),
  'unpublished_results',(select count(*) from exam_results where published_at is null),
  'locked_results',(select count(*) from exam_results where locked_at is not null)
 ) into res;
 return res;
end $$;

-- 6) Student portal gets only published results through an authoritative helper.
create or replace function published_student_results(p_application uuid) returns jsonb
language plpgsql security definer stable set search_path = public, pg_temp as $$
declare uid uuid:=auth.uid(); r jsonb;
begin
 if uid is null then raise exception 'Not signed in'; end if;
 if not exists(select 1 from applications where id=p_application and user_id=uid and admission_decision='approved') then raise exception 'Application not found'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('code',er.course_code,'attendance',er.attendance,'ca',er.ca,'exams',er.exams,'total',er.total,'band',er.band,'published_at',er.published_at) order by er.course_code),'[]'::jsonb) into r
 from exam_results er where er.application_id=p_application and er.published_at is not null;
 return r;
end $$;

-- Permissions
revoke all on function publish_result(uuid) from public,anon;
revoke all on function lock_result(uuid) from public,anon;
revoke all on function student_academic_record(uuid) from public,anon;
revoke all on function admin_student_360(text) from public,anon;
revoke all on function admin_action_center() from public,anon;
revoke all on function published_student_results(uuid) from public,anon;
grant execute on function publish_result(uuid) to authenticated;
grant execute on function lock_result(uuid) to authenticated;
grant execute on function student_academic_record(uuid) to authenticated;
grant execute on function admin_student_360(text) to authenticated;
grant execute on function admin_action_center() to authenticated;
grant execute on function published_student_results(uuid) to authenticated;

comment on table application_state_history is 'Immutable application lifecycle transition history.';
comment on function student_academic_record(uuid) is 'Authoritative student academic record and lifecycle history.';
comment on function publish_result(uuid) is 'Publishes a tutor result to the student portal.';
comment on function lock_result(uuid) is 'Locks a published result against normal tutor edits.';
