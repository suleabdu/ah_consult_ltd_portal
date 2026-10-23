-- AH STUDENT HUB — Phase 12: Full-system audit and release hardening
-- Depends on corrected migrations 001-021. Apply after the corrected 021 migration.
-- Safe to repeat: catalog uses upsert, columns use IF NOT EXISTS, and legacy flags
-- are only moved toward a safer review state, never silently marked source-verified.

begin;

-- -----------------------------------------------------------------------------
-- 1. Maintain the historical CA snapshot and require verification of legacy totals
-- -----------------------------------------------------------------------------
alter table public.exam_results add column if not exists legacy_ca integer;
update public.exam_results
   set legacy_ca = ca
 where legacy_ca is null
   and (coalesce(exam_obj,0) <> 0 or coalesce(exam_prac,0) <> 0);

alter table public.legacy_exam_results_archive
  add column if not exists source_confidence text not null default 'requires_source_verification';
update public.legacy_exam_results_archive
   set source_confidence = 'requires_source_verification'
 where source_confidence is null or source_confidence not in ('requires_source_verification','source_verified');

-- Migration 013 previously clamped the shared CA field to 0–30 before Phase 11
-- archival. Older CA values may therefore already be irrecoverably capped in the
-- live database unless an original export/backup exists. Keep those rows visible to
-- staff, but hide their numeric totals from students until a source-backed review.
update public.exam_results
   set grading_model = 'needs_review', updated_at = now()
 where (coalesce(exam_obj,0) <> 0 or coalesce(exam_prac,0) <> 0)
   and grading_model <> 'needs_review';

-- Do not trust a generated legacy total unless the source has been verified by an
-- administrator/Academic Coordinator. Existing archive entries are diagnostic
-- snapshots only; they are not a substitute for the original grade book.
comment on column public.legacy_exam_results_archive.source_confidence is
  'requires_source_verification until cross-checked against an original grade book/export. Historical CA may have been capped by migration 013 on older deployments.';

-- -----------------------------------------------------------------------------
-- 2. Align course catalog with the supplied authoritative courses_rows.csv
-- -----------------------------------------------------------------------------
insert into public.courses(code,name,category,fee_ngn,is_active) values
 ('ACAD1','AutoCAD','Beginner',20000,true),
 ('ACAD2','AutoCAD','Intermediate',30000,true),
 ('ACAD3','AutoCAD','Professional',60000,true),
 ('GRD1','Graphic Design','Beginner',20000,true),
 ('GRD2','Graphic Design','Intermediate',30000,true),
 ('GRD3','Graphic Design','Professional',60000,true),
 ('LSF1','Lumion/Animation','Beginner',20000,true),
 ('LSF2','Lumion/Animation','Intermediate',30000,true),
 ('LSF3','Lumion/Animation','Professional',60000,true),
 ('PLN1','ArchiCAD','Beginner',20000,true),
 ('PLN2','ArchiCAD','Intermediate',30000,true),
 ('PLN3','ArchiCAD','Professional',60000,true),
 ('RVT1','Revit','Beginner',20000,true),
 ('RVT2','Revit','Intermediate',30000,true),
 ('RVT3','Revit','Professional',60000,true),
 ('SKT1','SketchUp','Beginner',20000,true),
 ('SKT2','SketchUp','Intermediate',30000,true),
 ('SKT3','SketchUp','Professional',60000,true)
on conflict (code) do update
set name=excluded.name, category=excluded.category, fee_ngn=excluded.fee_ngn,
    is_active=excluded.is_active;

-- Keep historical course rows (and their application references) intact, but stop
-- any course absent from the supplied authoritative CSV being offered to new applicants.
update public.courses
set is_active=false
where is_active and code not in (
  'ACAD1','ACAD2','ACAD3','GRD1','GRD2','GRD3','LSF1','LSF2','LSF3',
  'PLN1','PLN2','PLN3','RVT1','RVT2','RVT3','SKT1','SKT2','SKT3'
);

-- -----------------------------------------------------------------------------
-- 3. Enforce course-scoped access to private academic files
-- -----------------------------------------------------------------------------
create or replace function public.can_read_course_material(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    has_role('administrator','academic')
    or (has_role('tutor') and split_part(coalesce(p_object_name,''),'/',1)=auth.uid()::text)
    or exists (
      select 1
      from public.lectures lt
      join public.applications ap on ap.user_id=auth.uid() and ap.admission_decision='approved'
      join public.application_courses ac on ac.application_id=ap.id and ac.course_code=lt.course_code and not ac.deferred
      where lt.material_path=p_object_name and (lt.intake_id is null or lt.intake_id=ap.intake_id)
    )
  );
$$;
revoke all on function public.can_read_course_material(text) from public, anon;
grant execute on function public.can_read_course_material(text) to authenticated;

drop policy if exists mat_read on storage.objects;
create policy mat_read on storage.objects for select to authenticated
  using (bucket_id='materials' and public.can_read_course_material(name));

create or replace function public.can_read_submission_file(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    split_part(coalesce(p_object_name,''),'/',1)=auth.uid()::text
    or has_role('administrator','academic')
    or exists (
      select 1
      from public.submissions sub
      join public.assignments a on a.id=sub.assignment_id
      join public.lecturers l on l.id=a.lecturer_id and l.is_active and l.user_id=auth.uid()
      where sub.file_path=p_object_name
    )
  );
$$;
revoke all on function public.can_read_submission_file(text) from public, anon;
grant execute on function public.can_read_submission_file(text) to authenticated;

drop policy if exists sub_read on storage.objects;
create policy sub_read on storage.objects for select to authenticated
  using (bucket_id='submissions' and public.can_read_submission_file(name));
comment on function public.can_read_course_material(text) is 'Allows academic staff/tutors to access authorized materials and students to access materials attached to courses in which they are admitted and actively enrolled.';
comment on function public.can_read_submission_file(text) is 'Allows students to access their own submission files and assigned tutors/Academic staff to review permitted submissions.';

-- -----------------------------------------------------------------------------
-- 4. Close privilege gaps in notification and background-worker RPCs
-- -----------------------------------------------------------------------------
-- These are server-side worker primitives. A frontend user must not be able to claim,
-- complete, or fail jobs, or to send arbitrary template notifications to another user.
revoke all on function public.emit_student_notification(uuid,text,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.emit_student_notification(uuid,text,text,uuid,jsonb) to service_role;
-- This is an internal publication helper. Students/staff must use publish_result(),
-- which performs the authorization and publication-state checks.
revoke all on function public.notify_result_published(uuid) from public, anon, authenticated;

revoke all on function public.claim_sheet_jobs(text,integer) from public, anon, authenticated;
revoke all on function public.complete_sheet_job(bigint,text) from public, anon, authenticated;
revoke all on function public.fail_sheet_job(bigint,text,integer) from public, anon, authenticated;
grant execute on function public.claim_sheet_jobs(text,integer) to service_role;
grant execute on function public.complete_sheet_job(bigint,text) to service_role;
grant execute on function public.fail_sheet_job(bigint,text,integer) to service_role;

revoke all on function public.claim_communication_jobs(text,integer) from public, anon, authenticated;
revoke all on function public.complete_communication_job(bigint,text,text) from public, anon, authenticated;
revoke all on function public.fail_communication_job(bigint,text,text) from public, anon, authenticated;
grant execute on function public.claim_communication_jobs(text,integer) to service_role;
grant execute on function public.complete_communication_job(bigint,text,text) to service_role;
grant execute on function public.fail_communication_job(bigint,text,text) to service_role;

-- The Edge Function that allocates a student ID uses the service key. Direct browser
-- execution could consume intake serials, so it is restricted to service_role.
revoke all on function public.next_student_id(uuid) from public, anon, authenticated;
grant execute on function public.next_student_id(uuid) to service_role;

-- Trigger entry points should not be callable as client RPCs. Their attached triggers
-- continue to execute normally; trigger execution does not need a client EXECUTE grant.
revoke all on function public.queue_sheet() from public, anon, authenticated;
revoke all on function public.queue_staff_sheet() from public, anon, authenticated;
revoke all on function public.link_tutor() from public, anon, authenticated;
revoke all on function public.record_application_state_change() from public, anon, authenticated;
revoke all on function public.trg_application_notifications() from public, anon, authenticated;
revoke all on function public.trg_deferment_notifications() from public, anon, authenticated;
revoke all on function public.trg_queue_notification_communications() from public, anon, authenticated;
revoke all on function public.prevent_audit_mutation() from public, anon, authenticated;

-- is_admin() is used inside authenticated RLS policies and role-guarded RPCs.
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- Remove the implicit PUBLIC EXECUTE default from every SECURITY DEFINER function in
-- public. Explicit grants to authenticated/service_role remain intact; PUBLIC and anon
-- access is not required for authenticated application journeys or trigger execution.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.signature);
    execute format('revoke execute on function %s from public, anon', f.signature);
  end loop;
end $$;

-- The hardening loop above deliberately removes implicit PUBLIC execution. Re-grant
-- the intended application RPCs explicitly to authenticated users; their own
-- SECURITY DEFINER role/ownership/state checks remain authoritative. This list also
-- protects existing installs where the original code relied on PostgreSQL's default
-- PUBLIC EXECUTE grant and would otherwise start failing after the hardening loop.
grant execute on function public.admin_action_center() to authenticated;
grant execute on function public.admin_add_lecturer(uuid,text,text,text) to authenticated;
grant execute on function public.admin_delete_lecturer(uuid) to authenticated;
grant execute on function public.admin_lecturer_stats() to authenticated;
grant execute on function public.admin_legacy_result_archive(integer) to authenticated;
grant execute on function public.admin_resync_sheet() to authenticated;
grant execute on function public.admin_review_addition(uuid,text,text) to authenticated;
grant execute on function public.admin_review_deferment(uuid,text,text) to authenticated;
grant execute on function public.admin_review_payment(uuid,text,text) to authenticated;
grant execute on function public.admin_set_admission(uuid,text,text) to authenticated;
grant execute on function public.admin_set_lecturer_active(uuid,boolean) to authenticated;
grant execute on function public.admin_set_permission(text,text,text) to authenticated;
grant execute on function public.admin_set_staff(uuid,text,text) to authenticated;
grant execute on function public.admin_student_360(text) to authenticated;
grant execute on function public.admin_student_360_detail(uuid) to authenticated;
grant execute on function public.admin_sync_status() to authenticated;
grant execute on function public.admin_tutor_accounts() to authenticated;
grant execute on function public.audit_center(text,integer) to authenticated;
grant execute on function public.cancel_course_addition(uuid) to authenticated;
grant execute on function public.cancel_deferment(uuid) to authenticated;
grant execute on function public.claim_addition(uuid) to authenticated;
grant execute on function public.claim_payment(uuid) to authenticated;
grant execute on function public.issue_document_job(uuid,text,jsonb) to authenticated;
grant execute on function public.management_analytics() to authenticated;
grant execute on function public.management_analytics_breakdown() to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_welcomed(uuid) to authenticated;
grant execute on function public.portal_data() to authenticated;
grant execute on function public.rate_tutor(uuid,text,uuid,integer,text) to authenticated;
grant execute on function public.release_readiness_snapshot() to authenticated;
grant execute on function public.reopen_result_for_correction(uuid,text) to authenticated;
grant execute on function public.request_course_addition(uuid,text) to authenticated;
grant execute on function public.request_deferment(uuid,text,text[],text,text,uuid) to authenticated;
grant execute on function public.request_document_job(uuid,text) to authenticated;
grant execute on function public.save_application_form(uuid,jsonb,text) to authenticated;
grant execute on function public.sheet_reconciliation() to authenticated;
grant execute on function public.start_application(uuid) to authenticated;
grant execute on function public.start_assessment(text,uuid,uuid) to authenticated;
grant execute on function public.student_academic_record(uuid) to authenticated;
grant execute on function public.student_deferment_options(uuid) to authenticated;
grant execute on function public.submit_application(uuid) to authenticated;
grant execute on function public.submit_assessment(uuid,jsonb) to authenticated;
grant execute on function public.submit_assignment(uuid,uuid,text,text) to authenticated;
grant execute on function public.system_health_snapshot() to authenticated;
grant execute on function public.tutor_bulk_save_results(jsonb) to authenticated;
grant execute on function public.tutor_feedback() to authenticated;
grant execute on function public.tutor_grade_submission(uuid,integer,text) to authenticated;
grant execute on function public.tutor_roster() to authenticated;
grant execute on function public.tutor_save_result(uuid,text,integer,integer,integer) to authenticated;
grant execute on function public.tutor_submissions(uuid) to authenticated;

-- RLS policy helpers also need explicit EXECUTE after removing PUBLIC access.
grant execute on function public.has_role(text[]) to authenticated, service_role;
grant execute on function public.staff_role() to authenticated, service_role;
grant execute on function public.my_lecturer_ids() to authenticated;
grant execute on function public.perm(text) to authenticated;
grant execute on function public.can_read(text) to authenticated;
grant execute on function public.can_write(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Admin-only structural / security diagnostics
-- -----------------------------------------------------------------------------
create or replace function public.system_audit_snapshot()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  checks jsonb;
  output jsonb;
  missing_rls text[];
  unsafe_definers text[];
  public_execute_definers text[];
  missing_constraints text[];
  missing_courses text[];
  catalog_mismatches bigint;
  applications_without_profile bigint;
  profile_fk_ok boolean;
  assessment_ordinal_ok boolean;
  assignment_ordinal_ok boolean;
  student_result_privacy_ok boolean;
  audit_immutable_ok boolean;
  settlement_permissions_ok boolean;
  worker_permissions_ok boolean;
  notification_emit_permissions_ok boolean;
  notification_helper_permissions_ok boolean;
  student_id_permissions_ok boolean;
  application_rpc_permissions_ok boolean;
  storage_policies_ok boolean;
  course_count bigint;
  catalog_total bigint;
  needs_review_count bigint;
  overall text;
begin
  if not has_role('administrator','academic') then
    raise exception 'Administrator or Academic Coordinator access required';
  end if;

  select coalesce(array_agg(req.name order by req.name), array[]::text[])
    into missing_rls
  from (values
    ('profiles'),('applications'),('application_courses'),('payments'),('sheet_outbox'),('staff'),
    ('submissions'),('exam_results'),('assessment_attempts'),('student_notifications'),
    ('student_documents'),('document_jobs'),('communication_outbox'),('audit_log'),
    ('intakes'),('courses'),('packages'),('intake_counters'),('lecturers'),('lecturer_courses'),
    ('lectures'),('assignments'),('exams'),('student_feedback'),('course_additions'),('deferments'),
    ('role_permissions'),('payment_providers'),('site_settings'),('access_codes'),('payment_attempts'),
    ('application_state_history'),('notification_templates'),('notification_events'),
    ('document_templates'),('communication_preferences'),('document_template_versions'),
    ('legacy_exam_results_archive')
  ) as req(name)
  left join pg_class c on c.relname=req.name and c.relnamespace='public'::regnamespace
  where c.oid is null or not c.relrowsecurity;

  select coalesce(array_agg(n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' order by p.proname), array[]::text[])
    into unsafe_definers
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef
    and not exists (
      select 1 from unnest(coalesce(p.proconfig,array[]::text[])) as cfg(setting)
      where replace(lower(cfg.setting),' ','')='search_path=public,pg_temp'
    );

  select coalesce(array_agg(n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' order by p.proname), array[]::text[])
    into public_execute_definers
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef
    and exists (
      select 1
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where acl.grantee in (0,(select oid from pg_roles where rolname='anon')) and acl.privilege_type='EXECUTE'
    );

  select coalesce(array_agg(expected.name order by expected.name),array[]::text[])
    into missing_constraints
  from (values
    ('exam_results_attendance_check'),('exam_results_ca_30_check'),
    ('exam_results_exams_30_check'),('exam_results_grading_model_check')
  ) as expected(name)
  where not exists (
    select 1 from pg_constraint c
    where c.conrelid='public.exam_results'::regclass
      and c.conname=expected.name and c.contype='c' and c.convalidated
  );

  with expected(code,name,category,fee_ngn,is_active) as (
    values
      ('ACAD1','AutoCAD','Beginner',20000,true),('ACAD2','AutoCAD','Intermediate',30000,true),('ACAD3','AutoCAD','Professional',60000,true),
      ('GRD1','Graphic Design','Beginner',20000,true),('GRD2','Graphic Design','Intermediate',30000,true),('GRD3','Graphic Design','Professional',60000,true),
      ('LSF1','Lumion/Animation','Beginner',20000,true),('LSF2','Lumion/Animation','Intermediate',30000,true),('LSF3','Lumion/Animation','Professional',60000,true),
      ('PLN1','ArchiCAD','Beginner',20000,true),('PLN2','ArchiCAD','Intermediate',30000,true),('PLN3','ArchiCAD','Professional',60000,true),
      ('RVT1','Revit','Beginner',20000,true),('RVT2','Revit','Intermediate',30000,true),('RVT3','Revit','Professional',60000,true),
      ('SKT1','SketchUp','Beginner',20000,true),('SKT2','SketchUp','Intermediate',30000,true),('SKT3','SketchUp','Professional',60000,true)
  )
  select coalesce(array_agg(e.code order by e.code),array[]::text[])
    into missing_courses
  from expected e left join public.courses c on c.code=e.code
  where c.code is null;

  with expected(code,name,category,fee_ngn,is_active) as (
    values
      ('ACAD1','AutoCAD','Beginner',20000,true),('ACAD2','AutoCAD','Intermediate',30000,true),('ACAD3','AutoCAD','Professional',60000,true),
      ('GRD1','Graphic Design','Beginner',20000,true),('GRD2','Graphic Design','Intermediate',30000,true),('GRD3','Graphic Design','Professional',60000,true),
      ('LSF1','Lumion/Animation','Beginner',20000,true),('LSF2','Lumion/Animation','Intermediate',30000,true),('LSF3','Lumion/Animation','Professional',60000,true),
      ('PLN1','ArchiCAD','Beginner',20000,true),('PLN2','ArchiCAD','Intermediate',30000,true),('PLN3','ArchiCAD','Professional',60000,true),
      ('RVT1','Revit','Beginner',20000,true),('RVT2','Revit','Intermediate',30000,true),('RVT3','Revit','Professional',60000,true),
      ('SKT1','SketchUp','Beginner',20000,true),('SKT2','SketchUp','Intermediate',30000,true),('SKT3','SketchUp','Professional',60000,true)
  )
  select count(*) into catalog_mismatches
  from expected e join public.courses c on c.code=e.code
  where c.name is distinct from e.name or c.category is distinct from e.category
     or c.fee_ngn is distinct from e.fee_ngn or c.is_active is distinct from e.is_active;

  select exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.conrelid='public.applications'::regclass
      and c.confrelid='public.profiles'::regclass and c.contype='f'
      and array_length(c.conkey,1)=1 and a.attname='user_id' and c.convalidated
  ) into profile_fk_ok;
  select count(*) into applications_without_profile
  from public.applications a left join public.profiles p on p.id=a.user_id where p.id is null;

  select case when to_regprocedure('public.submit_assessment(uuid,jsonb)') is null then false
    else position('qi.question_ordinal' in pg_get_functiondef(to_regprocedure('public.submit_assessment(uuid,jsonb)')))>0 end
    into assessment_ordinal_ok;
  select case when to_regprocedure('public.submit_assignment(uuid,uuid,text,text)') is null then false
    else position('qi.question_ordinal' in pg_get_functiondef(to_regprocedure('public.submit_assignment(uuid,uuid,text,text)')))>0 end
    into assignment_ordinal_ok;
  select case
    when to_regprocedure('public.portal_data()') is null
      or to_regprocedure('public.student_academic_record(uuid)') is null
      or to_regprocedure('public.published_student_results(uuid)') is null then false
    else position('er.published_at is not null and er.grading_model <> '||quote_literal('needs_review') in pg_get_functiondef(to_regprocedure('public.portal_data()')))>0
      and position('when er.grading_model='||quote_literal('needs_review') in pg_get_functiondef(to_regprocedure('public.student_academic_record(uuid)')))>0
      and position('review_required' in pg_get_functiondef(to_regprocedure('public.published_student_results(uuid)')))>0
  end into student_result_privacy_ok;
  select exists(select 1 from pg_trigger where tgrelid='public.audit_log'::regclass and tgname='audit_log_immutable' and not tgisinternal)
    into audit_immutable_ok;
  select not coalesce(has_function_privilege('authenticated',to_regprocedure('public.record_verified_payment(uuid,text,text,integer,jsonb,text)'),'EXECUTE'),false)
     and not coalesce(has_function_privilege('anon',to_regprocedure('public.record_verified_payment(uuid,text,text,integer,jsonb,text)'),'EXECUTE'),false)
     and coalesce(has_function_privilege('service_role',to_regprocedure('public.record_verified_payment(uuid,text,text,integer,jsonb,text)'),'EXECUTE'),false)
    into settlement_permissions_ok;

  select
    not coalesce(has_function_privilege('authenticated',to_regprocedure('public.claim_sheet_jobs(text,integer)'),'EXECUTE'),false)
    and not coalesce(has_function_privilege('authenticated',to_regprocedure('public.complete_sheet_job(bigint,text)'),'EXECUTE'),false)
    and not coalesce(has_function_privilege('authenticated',to_regprocedure('public.fail_sheet_job(bigint,text,integer)'),'EXECUTE'),false)
    and not coalesce(has_function_privilege('authenticated',to_regprocedure('public.claim_communication_jobs(text,integer)'),'EXECUTE'),false)
    and not coalesce(has_function_privilege('authenticated',to_regprocedure('public.complete_communication_job(bigint,text,text)'),'EXECUTE'),false)
    and not coalesce(has_function_privilege('authenticated',to_regprocedure('public.fail_communication_job(bigint,text,text)'),'EXECUTE'),false)
    and coalesce(has_function_privilege('service_role',to_regprocedure('public.claim_sheet_jobs(text,integer)'),'EXECUTE'),false)
    and coalesce(has_function_privilege('service_role',to_regprocedure('public.complete_sheet_job(bigint,text)'),'EXECUTE'),false)
    and coalesce(has_function_privilege('service_role',to_regprocedure('public.fail_sheet_job(bigint,text,integer)'),'EXECUTE'),false)
    and coalesce(has_function_privilege('service_role',to_regprocedure('public.claim_communication_jobs(text,integer)'),'EXECUTE'),false)
    and coalesce(has_function_privilege('service_role',to_regprocedure('public.complete_communication_job(bigint,text,text)'),'EXECUTE'),false)
    and coalesce(has_function_privilege('service_role',to_regprocedure('public.fail_communication_job(bigint,text,text)'),'EXECUTE'),false)
    into worker_permissions_ok;
  select not coalesce(has_function_privilege('authenticated',to_regprocedure('public.emit_student_notification(uuid,text,text,uuid,jsonb)'),'EXECUTE'),false)
     and not coalesce(has_function_privilege('anon',to_regprocedure('public.emit_student_notification(uuid,text,text,uuid,jsonb)'),'EXECUTE'),false)
     and coalesce(has_function_privilege('service_role',to_regprocedure('public.emit_student_notification(uuid,text,text,uuid,jsonb)'),'EXECUTE'),false)
    into notification_emit_permissions_ok;
  select not coalesce(has_function_privilege('authenticated',to_regprocedure('public.notify_result_published(uuid)'),'EXECUTE'),false)
     and not coalesce(has_function_privilege('anon',to_regprocedure('public.notify_result_published(uuid)'),'EXECUTE'),false)
    into notification_helper_permissions_ok;
  select not coalesce(has_function_privilege('authenticated',to_regprocedure('public.next_student_id(uuid)'),'EXECUTE'),false)
     and not coalesce(has_function_privilege('anon',to_regprocedure('public.next_student_id(uuid)'),'EXECUTE'),false)
     and coalesce(has_function_privilege('service_role',to_regprocedure('public.next_student_id(uuid)'),'EXECUTE'),false)
    into student_id_permissions_ok;
  select coalesce(has_function_privilege('authenticated',to_regprocedure('public.portal_data()'),'EXECUTE'),false)
     and coalesce(has_function_privilege('authenticated',to_regprocedure('public.start_application(uuid)'),'EXECUTE'),false)
     and coalesce(has_function_privilege('authenticated',to_regprocedure('public.submit_application(uuid)'),'EXECUTE'),false)
     and coalesce(has_function_privilege('authenticated',to_regprocedure('public.tutor_roster()'),'EXECUTE'),false)
     and coalesce(has_function_privilege('authenticated',to_regprocedure('public.admin_action_center()'),'EXECUTE'),false)
     and coalesce(has_function_privilege('authenticated',to_regprocedure('public.has_role(text[])'),'EXECUTE'),false)
     and coalesce(has_function_privilege('authenticated',to_regprocedure('public.my_lecturer_ids()'),'EXECUTE'),false)
     and coalesce(has_function_privilege('authenticated',to_regprocedure('public.can_read(text)'),'EXECUTE'),false)
     and coalesce(has_function_privilege('authenticated',to_regprocedure('public.can_write(text)'),'EXECUTE'),false)
    into application_rpc_permissions_ok;
  select exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
                  and policyname='mat_read' and position('can_read_course_material' in coalesce(qual,''))>0)
     and exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
                  and policyname='sub_read' and position('can_read_submission_file' in coalesce(qual,''))>0)
    into storage_policies_ok;

  select count(*) into course_count from public.courses where code in
    ('ACAD1','ACAD2','ACAD3','GRD1','GRD2','GRD3','LSF1','LSF2','LSF3','PLN1','PLN2','PLN3','RVT1','RVT2','RVT3','SKT1','SKT2','SKT3');
  select count(*) into catalog_total from public.courses where is_active;
  select count(*) into needs_review_count from public.exam_results where grading_model='needs_review';

  checks := jsonb_build_array(
    jsonb_build_object('key','profiles_fk','label','Application/profile integrity','status',case when profile_fk_ok and applications_without_profile=0 then 'pass' else 'fail' end,
      'detail',format('Validated foreign key: %s; applications without profiles: %s.',profile_fk_ok,applications_without_profile)),
    jsonb_build_object('key','rls','label','Row-level security on sensitive tables','status',case when cardinality(missing_rls)=0 then 'pass' else 'fail' end,
      'detail',case when cardinality(missing_rls)=0 then 'All required sensitive tables have RLS enabled.' else 'Missing or disabled RLS: '||array_to_string(missing_rls,', ') end),
    jsonb_build_object('key','definer_search_path','label','Security-definer function search paths','status',case when cardinality(unsafe_definers)=0 then 'pass' else 'fail' end,
      'detail',case when cardinality(unsafe_definers)=0 then 'All public security-definer functions declare a fixed search_path.' else 'Review: '||array_to_string(unsafe_definers,', ') end),
    jsonb_build_object('key','definer_public_execute','label','No PUBLIC/anonymous execution of security-definer RPCs','status',case when cardinality(public_execute_definers)=0 then 'pass' else 'fail' end,
      'detail',case when cardinality(public_execute_definers)=0 then 'No SECURITY DEFINER function remains executable by PUBLIC or anon.' else 'Review: '||array_to_string(public_execute_definers,', ') end),
    jsonb_build_object('key','result_constraints','label','Academic result constraints','status',case when cardinality(missing_constraints)=0 then 'pass' else 'fail' end,
      'detail',case when cardinality(missing_constraints)=0 then 'All score bounds and grading-model constraints exist and are validated.' else 'Missing/unvalidated: '||array_to_string(missing_constraints,', ') end),
    jsonb_build_object('key','assessment_ord','label','Assessment question indexing','status',case when coalesce(assessment_ordinal_ok,false) then 'pass' else 'fail' end,
      'detail',case when coalesce(assessment_ordinal_ok,false) then 'Exam answers use a qualified ordinality column.' else 'submit_assessment is missing or has an unqualified ordinality alias.' end),
    jsonb_build_object('key','assignment_ord','label','Assignment question indexing','status',case when coalesce(assignment_ordinal_ok,false) then 'pass' else 'fail' end,
      'detail',case when coalesce(assignment_ordinal_ok,false) then 'Assignment answers use a qualified ordinality column.' else 'submit_assignment is missing or has an unqualified ordinality alias.' end),
    jsonb_build_object('key','student_score_privacy','label','Student result publication controls','status',case when coalesce(student_result_privacy_ok,false) then 'pass' else 'fail' end,
      'detail',case when coalesce(student_result_privacy_ok,false) then 'Student RPCs suppress numeric data for unpublished and review-required grades.' else 'Review portal_data, student_academic_record and published_student_results.' end),
    jsonb_build_object('key','audit_immutability','label','Append-only audit history','status',case when audit_immutable_ok then 'pass' else 'fail' end,
      'detail',case when audit_immutable_ok then 'The immutable audit trigger is installed.' else 'audit_log_immutable trigger is missing.' end),
    jsonb_build_object('key','payment_permissions','label','Payment settlement function access','status',case when settlement_permissions_ok then 'pass' else 'fail' end,
      'detail',case when settlement_permissions_ok then 'Provider settlement is callable by service_role only, not anon/authenticated.' else 'Check execute grants on record_verified_payment.' end),
    jsonb_build_object('key','worker_permissions','label','Background worker privileges','status',case when worker_permissions_ok then 'pass' else 'fail' end,
      'detail',case when worker_permissions_ok then 'Sheet/communication queue primitives are service_role-only and reachable by the service worker.' else 'Authenticated users must not execute worker primitives; service_role must have execute grants.' end),
    jsonb_build_object('key','notification_emitter_permissions','label','System notification emission privileges','status',case when notification_emit_permissions_ok then 'pass' else 'fail' end,
      'detail',case when notification_emit_permissions_ok then 'Only server-side service_role can call the raw notification emitter.' else 'The arbitrary-recipient notification emitter is exposed or not service-enabled.' end),
    jsonb_build_object('key','notification_helper_permissions','label','Internal result notification helper','status',case when notification_helper_permissions_ok then 'pass' else 'fail' end,
      'detail',case when notification_helper_permissions_ok then 'The internal helper is not callable as an arbitrary browser RPC.' else 'Revoke direct browser execution and use publish_result().' end),
    jsonb_build_object('key','student_id_permissions','label','Student ID allocation privileges','status',case when student_id_permissions_ok then 'pass' else 'fail' end,
      'detail',case when student_id_permissions_ok then 'Student ID allocation is service-role only.' else 'The student ID allocator must not be executable by authenticated/anonymous browser roles.' end),
    jsonb_build_object('key','application_rpc_permissions','label','Authenticated RPC and RLS helper permissions','status',case when application_rpc_permissions_ok then 'pass' else 'fail' end,
      'detail',case when application_rpc_permissions_ok then 'Core student, tutor, admin and RLS helper functions have explicit authenticated grants after removal of implicit PUBLIC access.' else 'A required application RPC/RLS helper has lost its authenticated EXECUTE grant.' end),
    jsonb_build_object('key','storage_policies','label','Course material and submission file access','status',case when storage_policies_ok then 'pass' else 'fail' end,
      'detail',case when storage_policies_ok then 'Storage reads are restricted to enrolled students, the owning tutor, assigned teaching staff and authorized academic staff.' else 'Check the mat_read/sub_read Storage policies and their helper functions.' end),
    jsonb_build_object('key','course_catalog','label','Course catalog matches supplied CSV','status',case when cardinality(missing_courses)=0 and catalog_mismatches=0 and course_count=18 and catalog_total=18 then 'pass' else 'fail' end,
      'detail',format('%s/18 expected codes present; %s active catalog rows; %s code(s) missing; %s row(s) with mismatched name/category/fee/active state.',course_count,catalog_total,cardinality(missing_courses),catalog_mismatches)),
    jsonb_build_object('key','legacy_results','label','Legacy score source verification','status',case when needs_review_count=0 then 'pass' else 'warning' end,
      'detail',format('%s result(s) require source-backed Academic review before their numeric total can be shown.',needs_review_count))
  );
  select case when exists(select 1 from jsonb_array_elements(checks) as elem(value) where elem.value->>'status'='fail') then 'fail'
              when exists(select 1 from jsonb_array_elements(checks) as elem(value) where elem.value->>'status'='warning') then 'warning'
              else 'ready' end into overall;
  output := jsonb_build_object('generated_at',now(),'overall_status',overall,'checks',checks,
    'metrics',jsonb_build_object('required_course_codes_present',course_count,'active_course_catalog_rows',catalog_total,'course_catalog_mismatches',catalog_mismatches,
      'applications_without_profiles',applications_without_profile,'legacy_results_needing_review',needs_review_count,
      'tables_missing_rls',cardinality(missing_rls),'unsafe_security_definers',cardinality(unsafe_definers),'security_definers_public_or_anon_execute',cardinality(public_execute_definers)));
  return output;
end $$;
revoke all on function public.system_audit_snapshot() from public, anon;
grant execute on function public.system_audit_snapshot() to authenticated;
comment on function public.system_audit_snapshot() is 'Admin/Academic-only structural, RLS, function privilege, academic integrity and course catalog diagnostic snapshot.';

commit;
