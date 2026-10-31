-- Execute in a disposable Supabase PostgreSQL database after migration 041.
do $$
declare defaults integer;
begin
 if to_regclass('public.institution_document_identity_profiles') is null or
    to_regclass('public.document_style_reprints') is null then
   raise exception 'Identity profile and reprint tables are missing';
 end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in('institution_document_identity_profiles','document_style_reprints')
  and c.relrowsecurity is distinct from true) then
   raise exception 'Profile/reprint table missing row-level security';
 end if;
 if has_table_privilege('authenticated','public.institution_document_identity_profiles','SELECT')
  or has_table_privilege('authenticated','public.document_style_reprints','SELECT') then
   raise exception 'Identity profiles or reprints are readable outside restricted Edge Functions';
 end if;
 if has_function_privilege('authenticated','public.ahct_publish_document_identity(uuid,uuid)','EXECUTE') then
   raise exception 'Untrusted clients can publish identity profiles';
 end if;
 select count(*) into defaults from public.institution_document_identity_profiles where is_default;
 if defaults<>1 then raise exception 'Expected one default identity, found %',defaults; end if;
 raise notice 'Native identity profile security and current default: PASS';
end $$;
