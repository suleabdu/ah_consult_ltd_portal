-- Public homepage figures: aggregate-only output, no names, IDs, grades, contact details or row data.
-- The homepage calls this RPC with the Supabase anon key. Course/intake changes and
-- admission decisions automatically change the values without manual editing.

create or replace function public.public_homepage_metrics()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'admitted_learners', (
      select count(distinct a.user_id)::integer
      from public.applications a
      where a.admission_decision = 'approved'
    ),
    'active_programmes', (
      select count(distinct c.name)::integer
      from public.courses c
      where c.is_active is true
    ),
    'active_course_options', (
      select count(*)::integer
      from public.courses c
      where c.is_active is true
    ),
    'active_intakes', (
      select count(*)::integer
      from public.intakes i
      where i.is_active is true
        and (i.opens_at is null or i.opens_at <= now())
        and (i.closes_at is null or i.closes_at >= now())
    )
  );
$$;

comment on function public.public_homepage_metrics() is
  'Public aggregate-only metrics for the AH Consult homepage; returns four counts and no individual learner or academic records.';

revoke all on function public.public_homepage_metrics() from public, anon, authenticated;
grant execute on function public.public_homepage_metrics() to anon, authenticated;
