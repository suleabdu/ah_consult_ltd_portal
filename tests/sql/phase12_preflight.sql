-- AH STUDENT HUB Phase 12 — read-only staging preflight
-- Run AFTER migrations 001-022, using Supabase SQL Editor as a trusted admin.
-- This file reports diagnostics; it makes no database changes.

-- 1. Migration-defect checks: these should all report true / present.
select
  to_regprocedure('public.submit_assessment(uuid,jsonb)') is not null as submit_assessment_exists,
  to_regprocedure('public.submit_assignment(uuid,uuid,text,text)') is not null as submit_assignment_exists,
  to_regprocedure('public.portal_data()') is not null as portal_data_exists,
  to_regprocedure('public.system_audit_snapshot()') is not null as system_audit_snapshot_exists,
  to_regprocedure('public.release_readiness_snapshot()') is not null as release_readiness_snapshot_exists,
  exists(select 1 from pg_constraint where conrelid='public.exam_results'::regclass and conname='exam_results_attendance_check' and contype='c' and convalidated) as attendance_constraint_validated,
  exists(select 1 from pg_constraint where conrelid='public.exam_results'::regclass and conname='exam_results_ca_30_check' and contype='c' and convalidated) as ca_constraint_validated,
  exists(select 1 from pg_constraint where conrelid='public.exam_results'::regclass and conname='exam_results_exams_30_check' and contype='c' and convalidated) as exams_constraint_validated,
  exists(select 1 from pg_constraint where conrelid='public.exam_results'::regclass and conname='exam_results_grading_model_check' and contype='c' and convalidated) as grading_model_constraint_validated;

-- 2. Course rows which are missing or have a different master name/category/fee/active state.
with expected(code,name,category,fee_ngn,is_active) as (
  values
    ('ACAD1','AutoCAD','Beginner',20000,true),('ACAD2','AutoCAD','Intermediate',30000,true),('ACAD3','AutoCAD','Professional',60000,true),
    ('GRD1','Graphic Design','Beginner',20000,true),('GRD2','Graphic Design','Intermediate',30000,true),('GRD3','Graphic Design','Professional',60000,true),
    ('LSF1','Lumion/Animation','Beginner',20000,true),('LSF2','Lumion/Animation','Intermediate',30000,true),('LSF3','Lumion/Animation','Professional',60000,true),
    ('PLN1','ArchiCAD','Beginner',20000,true),('PLN2','ArchiCAD','Intermediate',30000,true),('PLN3','ArchiCAD','Professional',60000,true),
    ('RVT1','Revit','Beginner',20000,true),('RVT2','Revit','Intermediate',30000,true),('RVT3','Revit','Professional',60000,true),
    ('SKT1','SketchUp','Beginner',20000,true),('SKT2','SketchUp','Intermediate',30000,true),('SKT3','SketchUp','Professional',60000,true)
)
select e.code,e.name as expected_name,c.name as actual_name,e.category as expected_category,c.category as actual_category,
       e.fee_ngn as expected_fee,c.fee_ngn as actual_fee,e.is_active as expected_active,c.is_active as actual_active
from expected e left join public.courses c on c.code=e.code
where c.code is null or c.name is distinct from e.name or c.category is distinct from e.category
   or c.fee_ngn is distinct from e.fee_ngn or c.is_active is distinct from e.is_active
order by e.code;

-- 3. Course catalogue cardinality; expected 18 active rows and zero mismatches above.
select count(*) filter(where is_active) as active_course_rows,
       count(*) as all_course_rows,
       count(distinct code) as unique_course_codes
from public.courses;

-- 4. Application/profile foreign-key integrity and orphan check.
select exists(
  select 1 from pg_constraint c
  join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.conrelid='public.applications'::regclass and c.confrelid='public.profiles'::regclass
    and c.contype='f' and array_length(c.conkey,1)=1 and a.attname='user_id' and c.convalidated
) as validated_applications_profile_fk,
(select count(*) from public.applications a left join public.profiles p on p.id=a.user_id where p.id is null) as orphan_application_profiles;

-- 5. Sensitive tables without row-level security (empty result required).
with required(name) as (values
  ('profiles'),('applications'),('application_courses'),('payments'),('sheet_outbox'),('staff'),
  ('submissions'),('exam_results'),('assessment_attempts'),('student_notifications'),('student_documents'),
  ('document_jobs'),('communication_outbox'),('audit_log'),('intakes'),('courses'),('packages'),
  ('intake_counters'),('lecturers'),('lecturer_courses'),('lectures'),('assignments'),('exams'),
  ('student_feedback'),('course_additions'),('deferments'),('role_permissions'),('payment_providers'),
  ('site_settings'),('access_codes'),('payment_attempts'),('application_state_history'),('notification_templates'),
  ('notification_events'),('document_templates'),('communication_preferences'),('document_template_versions'),
  ('legacy_exam_results_archive')
)
select r.name, case when c.oid is null then 'MISSING TABLE' else 'RLS DISABLED' end as problem
from required r left join pg_class c on c.oid=to_regclass('public.'||r.name)
where c.oid is null or not c.relrowsecurity order by r.name;

-- 6. Security-definer routines without a fixed search_path or with direct PUBLIC EXECUTE.
select n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as arguments,
       not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) cfg(setting) where replace(lower(cfg.setting),' ','')='search_path=public,pg_temp') as missing_fixed_search_path,
       exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') as public_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef
  and (not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) cfg(setting) where replace(lower(cfg.setting),' ','')='search_path=public,pg_temp')
       or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE'))
order by p.proname;

-- 7. Worker/external emitter privilege matrix. Server-only calls should be TRUE only for service_role.
select 'sheet.claim' as rpc,
       has_function_privilege('service_role','public.claim_sheet_jobs(text,integer)','EXECUTE') as service_allowed,
       has_function_privilege('authenticated','public.claim_sheet_jobs(text,integer)','EXECUTE') as authenticated_allowed
union all select 'sheet.complete',has_function_privilege('service_role','public.complete_sheet_job(bigint,text)','EXECUTE'),has_function_privilege('authenticated','public.complete_sheet_job(bigint,text)','EXECUTE')
union all select 'sheet.fail',has_function_privilege('service_role','public.fail_sheet_job(bigint,text,integer)','EXECUTE'),has_function_privilege('authenticated','public.fail_sheet_job(bigint,text,integer)','EXECUTE')
union all select 'communications.claim',has_function_privilege('service_role','public.claim_communication_jobs(text,integer)','EXECUTE'),has_function_privilege('authenticated','public.claim_communication_jobs(text,integer)','EXECUTE')
union all select 'communications.complete',has_function_privilege('service_role','public.complete_communication_job(bigint,text,text)','EXECUTE'),has_function_privilege('authenticated','public.complete_communication_job(bigint,text,text)','EXECUTE')
union all select 'communications.fail',has_function_privilege('service_role','public.fail_communication_job(bigint,text,text)','EXECUTE'),has_function_privilege('authenticated','public.fail_communication_job(bigint,text,text)','EXECUTE')
union all select 'notification.emit',has_function_privilege('service_role','public.emit_student_notification(uuid,text,text,uuid,jsonb)','EXECUTE'),has_function_privilege('authenticated','public.emit_student_notification(uuid,text,text,uuid,jsonb)','EXECUTE')
union all select 'student_id.allocate',has_function_privilege('service_role','public.next_student_id(uuid)','EXECUTE'),has_function_privilege('authenticated','public.next_student_id(uuid)','EXECUTE')
order by rpc;

-- 8. Storage read policies must call the course/owner-aware helpers.
select policyname,qual
from pg_policies
where schemaname='storage' and tablename='objects' and policyname in ('mat_read','sub_read')
order by policyname;

-- 9. Academic data review queue. All needs_review rows require source-backed checking.
select grading_model,published_at is not null as currently_published,locked_at is not null as currently_locked,count(*) as rows
from public.exam_results
group by grading_model,published_at is not null,locked_at is not null
order by grading_model,published_at is not null,locked_at is not null;

-- 10. Operational backlog counts. Non-zero queues must be reconciled/investigated before cutover.
select
 (select count(*) from public.sheet_outbox where not done) as pending_sheet_jobs,
 (select count(*) from public.sheet_outbox where not done and coalesce(attempts,0)>=8) as exhausted_sheet_jobs,
 (select count(*) from public.communication_outbox where status='failed') as failed_communications,
 (select count(*) from public.document_jobs where status='failed') as failed_document_jobs,
 (select count(*) from public.exam_results where grading_model='needs_review') as legacy_result_review_rows;

-- 11. Run the server-side diagnostic RPC as a signed-in Administrator/Academic user
-- from the admin UI. SQL Editor runs without a normal end-user JWT, so role-gated RPC
-- invocation from here is not a reliable user-journey test.
select 'Read-only preflight queries completed. Inspect the result sets above; zero-row
catalog/RLS/SECURITY DEFINER findings and service-only worker permissions are required.' as next_step;
