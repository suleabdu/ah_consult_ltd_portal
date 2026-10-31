-- Run after migration 040 in disposable staging Postgres/Supabase.
do $$
begin
 if to_regclass('public.institution_document_identity') is null then
   raise exception 'Native PDF identity table missing'; end if;
 if to_regclass('public.document_issuance_reviews') is null then
   raise exception 'Two-stage academic review table missing'; end if;
 if (select public from storage.buckets where id='institution-document-logos') is distinct from false then
   raise exception 'Institutional logo bucket must be private'; end if;
 if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('institution_document_identity','document_issuance_reviews')
    and not c.relrowsecurity) then raise exception 'Document identity/review tables must enforce RLS'; end if;
 if has_table_privilege('authenticated','public.institution_document_identity','SELECT')
   or has_table_privilege('anon','public.document_issuance_reviews','SELECT') then
   raise exception 'Native identity or academic reviews exposed directly'; end if;
 if to_regprocedure('public.ahct_review_document_issuance(uuid,text,text)') is null then
   raise exception 'Independent academic and registrar approvals unavailable'; end if;
 if to_regprocedure('public.ahct_academic_document_eligibility(uuid,text)') is null then
   raise exception 'Official document eligibility RPC unavailable'; end if;
 if has_function_privilege('anon','public.ahct_review_document_issuance(uuid,text,text)','EXECUTE') then
   raise exception 'Anon cannot review academic credentials'; end if;
 if not exists(select 1 from pg_trigger where tgname='ahct_invalidate_reviews_on_results' and not tgisinternal)
   or not exists(select 1 from pg_trigger where tgname='ahct_invalidate_reviews_on_enrolment' and not tgisinternal) then
   raise exception 'Grade/enrolment invalidation triggers missing'; end if;
 raise notice 'PASS native private identity, logo privacy, academic review separation, invalidation triggers';
end $$;
