-- AH STUDENT HUB — Migration 028
-- Purpose: make application intake genuinely minimal.
-- Keeps identity/contact requirements, while treating course-readiness details
-- (education, occupation, skills, and laptop/battery information) as optional.
-- Existing saved values remain valid and are not changed by this migration.
-- Apply this migration BEFORE deploying the matching minimal apply.html.

create or replace function public.validate_form(f jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if length(trim(coalesce(f->>'surname',''))) < 1 then
    return 'Enter your surname.';
  end if;

  if length(trim(coalesce(f->>'firstName',''))) < 1 then
    return 'Enter your first name.';
  end if;

  if regexp_replace(coalesce(f->>'phone',''), '\s', '', 'g') !~ '^(\+234|0)[789][01][0-9]{8}$' then
    return 'Enter a valid Nigerian phone number.';
  end if;

  if coalesce(f->>'dob','') !~ '^\d{4}-\d{2}-\d{2}$' then
    return 'Enter your date of birth.';
  end if;

  if coalesce(f->>'gender','') not in ('Male','Female') then
    return 'Select your gender.';
  end if;

  if length(trim(coalesce(f->>'address',''))) < 3 then
    return 'Enter your address.';
  end if;

  if length(trim(coalesce(f->>'state',''))) < 2 then
    return 'Select your state.';
  end if;

  -- Optional fields remain validated when provided, but no longer block submission.
  if coalesce(nullif(trim(f->>'education'),''),'') <> ''
     and f->>'education' not in ('Primary','Secondary','Bachelor Degree','Masters Degree','Ph.D Holder') then
    return 'Select a valid education level.';
  end if;

  if coalesce(nullif(trim(f->>'occupation'),''),'') <> ''
     and f->>'occupation' not in ('Civil Servant','Private Worker','Student') then
    return 'Select a valid occupation.';
  end if;

  if length(coalesce(f->>'skills','')) > 300 then
    return 'Keep skills or experience within 300 characters.';
  end if;

  if coalesce(nullif(trim(f->>'laptop'),''),'') <> ''
     and f->>'laptop' not in ('Yes','No') then
    return 'Select a valid laptop-access answer.';
  end if;

  if f->>'laptop' = 'Yes'
     and coalesce(nullif(trim(f->>'battery'),''),'') not in ('3 Hours and Above','Less than 3 hours','Desktop') then
    return 'Select a valid laptop battery duration.';
  end if;

  return null;
end;
$$;

comment on function public.validate_form(jsonb) is
  'Validates essential application identity/contact data; education, occupation, skills and laptop-readiness fields are optional and can be collected during onboarding.';
