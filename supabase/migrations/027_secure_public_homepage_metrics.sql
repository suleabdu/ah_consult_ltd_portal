-- 027_secure_public_homepage_metrics.sql
-- Keep the RPC used by already-deployed v17 homepages, but align its counting
-- rules with public_impact_stats() so the two public UIs cannot disagree about
-- enrolled learners/programmes/intakes. This returns aggregate values only.
-- Both public SECURITY DEFINER metrics RPCs are explicitly allow-listed by
-- tests/sql/security_posture.sql after source review.
create or replace function public.public_homepage_metrics()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with impact as (
    select public.public_impact_stats() as stats
  )
  select jsonb_build_object(
    'admitted_learners', impact.stats -> 'learners_enrolled',
    'active_programmes', impact.stats -> 'programmes',
    'active_course_options', nullif((select count(*)::integer from public.courses c where c.is_active is true), 0),
    'active_intakes', impact.stats -> 'active_intakes'
  )
  from impact;
$$;

comment on function public.public_homepage_metrics() is
  'Compatibility aggregate-only public metrics RPC for already-deployed v17 homepages; delegates people/programme/intake counts to the reviewed public_impact_stats() contract and returns no student-level data.';

revoke all on function public.public_homepage_metrics() from public, anon, authenticated;
grant execute on function public.public_homepage_metrics() to anon, authenticated;
