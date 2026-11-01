-- V18.9: authoritative student-facing availability for the additional-course journey.
-- The mutation RPC remains the final enforcement point; this read-only RPC lets
-- the browser present the same current-intake decision without relying on a
-- legacy portal_data field.

create or replace function public.student_course_addition_eligibility(
  p_application uuid default null
) returns jsonb
language plpgsql
security definer
stable
set search_path=public,pg_temp
as $$
declare a record;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select ap.id, i.label, i.is_active, i.opens_at, i.closes_at
    into a
    from public.applications ap
    join public.intakes i on i.id=ap.intake_id
   where ap.user_id=auth.uid()
     and ap.admission_decision='approved'
     and (p_application is null or ap.id=p_application)
   order by ap.created_at desc
   limit 1;

  if not found then
    return jsonb_build_object(
      'eligible',false,
      'reason','An admitted current intake is required before another course can be added.'
    );
  end if;
  if not a.is_active then
    return jsonb_build_object(
      'eligible',false,'application_id',a.id,
      'reason','This intake is not currently active for additional-course enrolment.'
    );
  end if;
  if a.opens_at is not null and a.opens_at>now() then
    return jsonb_build_object(
      'eligible',false,'application_id',a.id,'opens_at',a.opens_at,
      'reason','Additional-course enrolment for this intake has not opened yet.'
    );
  end if;
  if a.closes_at is not null and a.closes_at<now() then
    return jsonb_build_object(
      'eligible',false,'application_id',a.id,'closes_at',a.closes_at,
      'reason','This intake is closed, so new courses can no longer be added.'
    );
  end if;

  return jsonb_build_object(
    'eligible',true,'application_id',a.id,'intake_label',a.label,
    'closes_at',a.closes_at,
    'reason','Additional courses are available for this current intake.'
  );
end $$;

revoke all on function public.student_course_addition_eligibility(uuid) from public,anon;
grant execute on function public.student_course_addition_eligibility(uuid) to authenticated;

comment on function public.student_course_addition_eligibility(uuid) is
  'Returns the authenticated student''s current-intake availability for an additional course. Request_course_addition enforces the same rule when a request is created.';
