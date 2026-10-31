-- Run only against disposable, migrated test DB (035 applied).
do $$
declare 
 versions_count integer;
begin
 select count(*) into versions_count from public.document_templates
 where key in ('admission_letter','deferment_letter','payment_receipt','academic_transcript','result_statement','certificate') and active=true;
 if versions_count<>6 then raise exception 'Expected six active canonical document types, found %',versions_count; end if;
 if not exists (select 1 from information_schema.columns where table_schema='public'
   and table_name='document_template_versions' and column_name='retired_at') then
  raise exception 'Document revision retirement metadata missing'; end if;
 if to_regprocedure('public.admin_delete_document_template_draft(text)') is null then
  raise exception 'Private draft deletion RPC missing'; end if;
 if to_regprocedure('public.admin_retire_document_template_revision(text,integer,text)') is null then
  raise exception 'Revision retirement RPC missing'; end if;
 if has_function_privilege('anon','public.admin_delete_document_template_draft(text)','EXECUTE')
  or has_function_privilege('anon','public.admin_retire_document_template_revision(text,integer,text)','EXECUTE') then
  raise exception 'Anonymous user can execute template deletion RPCs'; end if;
 if not has_function_privilege('authenticated','public.admin_delete_document_template_draft(text)','EXECUTE')
  or not has_function_privilege('authenticated','public.admin_retire_document_template_revision(text,integer,text)','EXECUTE') then
  raise exception 'Authenticated users cannot reach administrator-checked RPCs'; end if;
 if not exists (select 1 from pg_proc where oid='public.admin_retire_document_template_revision(text,integer,text)'::regprocedure
  and exists (select 1 from unnest(coalesce(proconfig,'{}'::text[])) setting
   where regexp_replace(setting,'[[:space:]]','','g')='search_path=public,pg_temp')) then
  raise exception 'Template retirement function search_path is not pinned'; end if;
 raise notice 'PASS six canonical document types, protected deletion RPCs, security-definer hardening and retirement provenance';
end $$;
