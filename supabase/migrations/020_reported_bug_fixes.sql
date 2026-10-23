-- AH STUDENT HUB — Phase 10 hotfixes for reported production bugs
-- Apply AFTER migrations 001-019. Safe to re-run.
-- Fixes: WITH ORDINALITY alias, PostgREST applications->profiles relationship,
-- mark_welcomed compatibility, and extensionless notification action links.

-- ----------------------------------------------------------------------------
-- 1. Make sure every auth user has a profile and PostgREST can embed profiles
-- from applications. This repairs databases where the original FK was missing
-- or the API schema cache did not know about it.
-- ----------------------------------------------------------------------------
insert into public.profiles as existing(id, full_name, phone, email)
select u.id,
       u.raw_user_meta_data->>'full_name',
       u.raw_user_meta_data->>'phone',
       u.email
from auth.users u
on conflict (id) do update
set email = coalesce(existing.email, excluded.email),
    full_name = coalesce(existing.full_name, excluded.full_name),
    phone = coalesce(existing.phone, excluded.phone);

do $$
declare
  has_profile_fk boolean;
  fk record;
begin
  select exists (
    select 1
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.conrelid = 'public.applications'::regclass
      and c.confrelid = 'public.profiles'::regclass
      and c.contype = 'f'
      and array_length(c.conkey, 1) = 1
      and a.attname = 'user_id'
  ) into has_profile_fk;

  if not has_profile_fk then
    if exists (
      select 1
      from public.applications a
      left join auth.users u on u.id = a.user_id
      where u.id is null
    ) then
      raise exception 'Cannot repair applications->profiles relationship: an application has no matching auth.users row. Resolve orphan application user IDs first.';
    end if;

    alter table public.applications
      add constraint applications_user_id_profiles_fk
      foreign key (user_id) references public.profiles(id) not valid;
  end if;

  for fk in
    select c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.conrelid = 'public.applications'::regclass
      and c.confrelid = 'public.profiles'::regclass
      and c.contype = 'f'
      and array_length(c.conkey, 1) = 1
      and a.attname = 'user_id'
      and not c.convalidated
  loop
    execute format('alter table public.applications validate constraint %I', fk.conname);
  end loop;
end $$;

-- Explicitly reload the PostgREST relationship/schema cache after the FK repair.
notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- 2. Ensure welcomed_at and its authenticated RPC exist on already-deployed DBs.
-- ----------------------------------------------------------------------------
alter table public.applications add column if not exists welcomed_at timestamptz;
create or replace function public.mark_welcomed(p_app uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.applications
  set welcomed_at = coalesce(welcomed_at, now())
  where id = p_app and user_id = auth.uid() and admission_decision = 'approved';
end $$;
revoke all on function public.mark_welcomed(uuid) from public, anon;
grant execute on function public.mark_welcomed(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Replace the assessment functions with the corrected ordinality alias.
-- ----------------------------------------------------------------------------

create or replace function submit_assessment(p_attempt uuid,p_answers jsonb) returns assessment_attempts
language plpgsql security definer set search_path = public, pg_temp as $$
declare
 a assessment_attempts;
 qset jsonb := '[]'::jsonb;
 q jsonb;
 idx int;
 answer text;
 qfiles jsonb;
begin
 select * into a from assessment_attempts where id=p_attempt and user_id=auth.uid() for update;
 if not found then raise exception 'Assessment attempt not found.'; end if;
 if a.status<>'in_progress' then return a; end if;
 if a.expires_at is not null and a.expires_at < now() then
   update assessment_attempts set status='expired',submitted_at=now(),answers=coalesce(p_answers,'{}'::jsonb) where id=a.id returning * into a;
   return a;
 end if;

 if a.assessment_type='exam' then
   select coalesce(question_set,'[]'::jsonb) into qset from exams where id=a.assessment_id;
   if exists(select 1 from exams where id=a.assessment_id and file_required)
      and nullif(trim(coalesce(p_answers->>'__drive_link','')),'') is null
      then raise exception 'Please provide the required Drive/file link.'; end if;
 else
   select coalesce(question_set,'[]'::jsonb) into qset from assignments where id=a.assessment_id;
 end if;

 qfiles := case when jsonb_typeof(coalesce(p_answers->'__question_files','{}'::jsonb))='object'
                then p_answers->'__question_files' else '{}'::jsonb end;

 for q,idx in select qi.question_json,(qi.question_ordinal-1)::int from jsonb_array_elements(qset) with ordinality as qi(question_json, question_ordinal) loop
   answer := nullif(trim(coalesce(p_answers->>(idx::text),'')),'');
   if coalesce((q->>'mandatory')::boolean,false) and answer is null then
     raise exception 'Please answer required question %.', idx+1;
   end if;
   if coalesce((q->>'file_required')::boolean,false)
      and nullif(trim(coalesce(qfiles->>(idx::text),'')),'') is null then
     raise exception 'Please provide the required Drive/file link for question %.', idx+1;
   end if;
 end loop;

 if coalesce(p_answers->>'__external_submitted','') <> ''
    and lower(coalesce(p_answers->>'__external_submitted','')) <> 'true' then
   raise exception 'Please complete the external assessment and confirm submission.';
 end if;

 update assessment_attempts set answers=coalesce(p_answers,'{}'::jsonb),submitted_at=now(),status='submitted'
 where id=a.id returning * into a;
 return a;
end $$;

create or replace function submit_assignment(p_assignment uuid, p_application uuid, p_body text, p_file text) returns submissions
language plpgsql security definer set search_path = public, pg_temp as $$
declare
 s assignments;
 a applications;
 r submissions;
 payload jsonb := '{}'::jsonb;
 q jsonb;
 idx int;
 answer text;
 qfiles jsonb;
begin
 select * into a from applications where id = p_application and user_id = auth.uid() and admission_decision = 'approved';
 if not found then raise exception 'Only admitted students can submit work'; end if;
 select * into s from assignments where id = p_assignment;
 if not found then raise exception 'Assignment not found'; end if;
 if s.closed then raise exception 'This assignment is closed'; end if;
 if not exists (select 1 from application_courses where application_id = a.id and course_code = s.course_code and not deferred)
    or (s.intake_id is not null and s.intake_id <> a.intake_id) then
   raise exception 'This assignment is not for your course';
 end if;
 if coalesce(trim(p_body), '') = '' and p_file is null then raise exception 'Write a response or attach a file'; end if;
 if s.file_required and p_file is null and nullif(trim(coalesce((case when p_body::text like '{%' then p_body::jsonb->'answers'->>'__drive_link' else null end),'')),'') is null then
   raise exception 'This assignment requires a file or Drive link.';
 end if;

 begin
   if p_body::text like '{%}' then payload := p_body::jsonb->'answers'; end if;
 exception when others then payload := '{}'::jsonb; end;
 qfiles := case when jsonb_typeof(coalesce(payload->'__question_files','{}'::jsonb))='object'
                then payload->'__question_files' else '{}'::jsonb end;
 for q,idx in select qi.question_json,(qi.question_ordinal-1)::int from jsonb_array_elements(coalesce(s.question_set,'[]'::jsonb)) with ordinality as qi(question_json, question_ordinal) loop
   answer := nullif(trim(coalesce(payload->>(idx::text),'')),'');
   if coalesce((q->>'mandatory')::boolean,false) and answer is null then
     raise exception 'Please answer required question %.', idx+1;
   end if;
   if coalesce((q->>'file_required')::boolean,false)
      and nullif(trim(coalesce(qfiles->>(idx::text),'')),'') is null then
     raise exception 'Please provide the required Drive/file link for question %.', idx+1;
   end if;
 end loop;

 if exists (select 1 from submissions where assignment_id = p_assignment and application_id = p_application and graded_at is not null) then
   raise exception 'This submission has already been graded';
 end if;
 insert into submissions(assignment_id, application_id, user_id, body, file_path)
 values (p_assignment, p_application, auth.uid(), p_body, p_file)
 on conflict (assignment_id, application_id) do update set body = excluded.body, file_path = coalesce(excluded.file_path, submissions.file_path), submitted_at = now()
 returning * into r;
 return r;
end $$;

revoke all on function submit_assessment(uuid,jsonb) from public,anon;
grant execute on function submit_assessment(uuid,jsonb) to authenticated;
revoke all on function submit_assignment(uuid,uuid,text,text) from public,anon;
grant execute on function submit_assignment(uuid,uuid,text,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Migrate persisted notification links to clean, extensionless routes.
-- ----------------------------------------------------------------------------
update public.notification_templates
set action_url = regexp_replace(action_url, '\.html([?#]|$)', '\1', 'g'),
    updated_at = now()
where action_url ~ '\.html([?#]|$)';

notify pgrst, 'reload schema';
