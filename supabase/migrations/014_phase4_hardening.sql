-- AH STUDENT HUB - Phase 4 workflow hardening
-- Depends on 001-013. Safe to re-run.

-- 1) Harden assessment submission against malformed/missing question answers.
-- The previous implementation iterated jsonb_each() over a JSON array. This
-- replaces it with jsonb_array_elements() + ordinality and supports the new
-- per-question file-required / Drive-link flag.
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

-- 2) Harden direct assignment submission with the same question rules.
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

-- Keep the public surface closed; authenticated students reach these through RLS/RPC.
revoke all on function submit_assessment(uuid,jsonb) from public,anon;
grant execute on function submit_assessment(uuid,jsonb) to authenticated;
revoke all on function submit_assignment(uuid,uuid,text,text) from public,anon;
grant execute on function submit_assignment(uuid,uuid,text,text) to authenticated;

comment on function submit_assessment(uuid,jsonb) is 'Phase 4: server-authoritative validation for mandatory and per-question file-required assessment items.';
comment on function submit_assignment(uuid,uuid,text,text) is 'Phase 4: validates assignment question requirements before accepting a submission.';
