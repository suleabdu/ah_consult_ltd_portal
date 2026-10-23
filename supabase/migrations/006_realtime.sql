-- Let the applicant's page update the instant a row changes (otherwise it only refreshes every 15-60 seconds).
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='applications') then
    alter publication supabase_realtime add table public.applications;
  end if;
end $$;
