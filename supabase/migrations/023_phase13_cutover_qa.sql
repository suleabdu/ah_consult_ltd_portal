-- AH STUDENT HUB — Phase 13: End-to-End QA & Production Cutover diagnostics
-- Depends on migrations 001-022. Read-only diagnostic additions; safe to rerun.

begin;

create or replace function public.phase13_cutover_snapshot()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  release jsonb;
  sheet jsonb := null;
  catalog jsonb;
  output jsonb;
  role_ok boolean;
  failed_sheet bigint := 0;
  pending_sheet bigint := 0;
begin
  if not has_role('administrator','academic') then
    raise exception 'Administrator or Academic Coordinator access required';
  end if;

  release := public.release_readiness_snapshot();

  if to_regprocedure('public.sheet_reconciliation()') is not null then
    sheet := public.sheet_reconciliation();
  end if;

  select count(*) filter (where is_active),
         count(*) filter (where not is_active)
    into pending_sheet, failed_sheet
    from public.courses;

  catalog := jsonb_build_object(
    'active_courses', pending_sheet,
    'inactive_courses', failed_sheet,
    'authoritative_active_course_count', 18,
    'catalog_ready', pending_sheet = 18
  );

  select has_role('administrator','academic') into role_ok;

  output := jsonb_build_object(
    'generated_at', now(),
    'overall_status', case
      when coalesce(release->>'overall_status','fail')='fail' then 'fail'
      when coalesce((catalog->>'catalog_ready')::boolean,false)=false then 'warning'
      else 'ready'
    end,
    'checks', jsonb_build_object(
      'release_readiness', release,
      'sheet_reconciliation', sheet,
      'catalog', catalog,
      'caller_authorized', role_ok
    ),
    'cutover_rule', 'Do not ship while overall_status=fail. Review warnings explicitly before production.'
  );

  return output;
end $$;

revoke all on function public.phase13_cutover_snapshot() from public, anon;
grant execute on function public.phase13_cutover_snapshot() to authenticated;

comment on function public.phase13_cutover_snapshot() is
  'Phase 13 administrator/Academic cutover diagnostic combining release readiness, Sheets reconciliation and authoritative course catalog checks. It is diagnostic only and does not mutate business data.';

notify pgrst, 'reload schema';
commit;
