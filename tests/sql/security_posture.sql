-- tests/sql/security_posture.sql : fails (raises) if the database drifts from the intended security model.
-- Run after all migrations (SQL Editor, or: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/security_posture.sql).
--
-- It reports EVERY problem it finds in one message (not just the first). A finding is not automatically a bug in this
-- project: on an older or customised database it can point at an object that existed before these migrations. Never
-- ignore a finding. Inspect it with tests/sql/inspect_public_functions.sql, then either fix/drop the object or, after
-- a deliberate review, add its name to the matching allow-list below.
do $$
declare
  -- Reviewed, intentionally public SECURITY DEFINER functions (each must return aggregates only, never rows):
  allowed_anon_functions text[] := array['public_impact_stats', 'public_homepage_metrics'];
  -- Reviewed, intentionally public read-only tables (row-level security still applies):
  allowed_anon_tables    text[] := array['courses', 'intakes', 'packages', 'site_settings', 'gallery_items'];
  problems text[] := '{}';
  v text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v is not null then problems := problems || ('Tables without row level security: ' || v); end if;

  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  if v is not null then problems := problems || ('SECURITY DEFINER functions without a pinned search_path: ' || v); end if;

  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute') and not (p.proname = any (allowed_anon_functions));
  if v is not null then
    problems := problems || ('SECURITY DEFINER functions callable by anon (they run with elevated rights, so anyone on the internet can call them): ' || v
      || '. Inspect with tests/sql/inspect_public_functions.sql. If a function returns only aggregate numbers and you still need it, add its name to allowed_anon_functions above; '
      || 'if nothing uses it any more, drop it or run: revoke execute on function <name> from anon, public;');
  end if;

  select string_agg(c.relname, ', ' order by c.relname) into v from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege('anon', c.oid, 'insert,update,delete,truncate');
  if v is not null then problems := problems || ('anon can WRITE to tables: ' || v); end if;

  select string_agg(c.relname, ', ' order by c.relname) into v from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege('anon', c.oid, 'select') and not (c.relname = any (allowed_anon_tables));
  if v is not null then problems := problems || ('anon can read non-public tables: ' || v || '. Fix with: revoke all on <table> from anon;'); end if;

  select string_agg(tablename || '.' || policyname, ', ' order by tablename) into v from pg_policies
   where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL') and (qual = 'true' or with_check = 'true');
  if v is not null then problems := problems || ('Unconditional write policies: ' || v); end if;

  if array_length(problems, 1) is not null then
    raise exception E'Security posture check found % problem(s):\n  - %', array_length(problems, 1), array_to_string(problems, E'\n  - ');
  end if;
  raise notice 'security posture OK';
end $$;
