-- tests/sql/inspect_public_functions.sql : read-only. Shows every function in `public` that the anonymous (logged-out)
-- role can execute, whether it runs with elevated rights, and its full source, so you can decide whether it is safe.
-- The Supabase SQL editor only shows the LAST query's result, so run each query below SEPARATELY.

-- QUERY 1: anon-callable functions (look at "elevated_rights" = true and read the source in "definition")
select p.oid::regprocedure                      as signature,
       p.prosecdef                              as elevated_rights,        -- true = SECURITY DEFINER (runs as its owner, bypassing row-level security)
       pg_get_userbyid(p.proowner)              as owner,
       pg_get_function_result(p.oid)            as returns,
       coalesce(p.proconfig::text, '(none)')    as settings,               -- should contain search_path=...
       pg_get_functiondef(p.oid)                as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and has_function_privilege('anon', p.oid, 'execute')
  and p.prokind = 'f'
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')   -- hide functions that belong to extensions
order by p.prosecdef desc, p.proname;

-- QUERY 2: what does the flagged function actually return to a logged-out visitor?  (change the function name)
-- begin;
--   set local role anon;
--   select public.public_homepage_metrics();
-- rollback;
-- SAFE = only counts/aggregates.  UNSAFE = any names, emails, registration numbers, marks, ids or lists of people.

-- QUERY 3: tables the anonymous role can read (should be only: courses, intakes, packages, site_settings, gallery_items)
-- select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege('anon', c.oid, 'select') order by 1;
