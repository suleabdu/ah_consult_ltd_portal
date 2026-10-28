-- Run only after migrations 001-021 have completed in a staging project.
-- Read-only diagnostics; no data is changed. Run with an approved administrator.

-- 1. Confirm current SQL functions use explicitly qualified ordinality columns.
select
  position('qi.question_ordinal' in pg_get_functiondef('public.submit_assessment(uuid,jsonb)'::regprocedure)) > 0 as submit_assessment_alias_ok,
  position('qi.question_ordinal' in pg_get_functiondef('public.submit_assignment(uuid,uuid,text,text)'::regprocedure)) > 0 as submit_assignment_alias_ok;

-- 2. Inspect supported grading models and counts. NULL totals mean a record
-- needs source-record review, not that a zero grade was awarded.
select pg_get_expr(ad.adbin, ad.adrelid) as effective_total_expression
from pg_attribute a
join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum
where a.attrelid='public.exam_results'::regclass and a.attname='total' and not a.attisdropped;

select grading_model, count(*) as records, count(*) filter(where total is null) as no_reliable_total
from public.exam_results group by grading_model order by grading_model;

select count(*) as durable_legacy_archive_rows from public.legacy_exam_results_archive;

-- 3. Confirm profile relationship and append-only audit guard are present.
select c.conname, c.convalidated
from pg_constraint c
join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
where c.conrelid='public.applications'::regclass and c.confrelid='public.profiles'::regclass
  and c.contype='f' and array_length(c.conkey,1)=1 and a.attname='user_id';

select tgname, tgenabled
from pg_trigger
where tgrelid='public.audit_log'::regclass and tgname='audit_log_immutable' and not tgisinternal;

-- 4. Check queue counts without exposing message bodies or secrets.
select
  (select count(*) from public.sheet_outbox where not done) as sheet_pending,
  (select count(*) from public.sheet_outbox where not done and coalesce(attempts,0)>=8) as sheet_failed,
  (select count(*) from public.communication_outbox where status='failed') as communication_failed,
  (select count(*) from public.document_jobs where status='failed') as document_failed;

-- 5. In an authenticated Administrator/Academic app context, these should return data:
-- select public.release_readiness_snapshot();
-- select public.admin_legacy_result_archive(25);
