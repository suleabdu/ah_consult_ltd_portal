-- Guest applications contain no Auth identity; existing signed-in applications
-- and their uniqueness constraint remain unchanged.
alter table public.recruitment_applications alter column user_id drop not null;
alter table public.recruitment_applications add column if not exists guest_submission_id uuid unique;
grant execute on function public.recruitment_public_vacancy(uuid) to service_role;

-- Serialize question edits with submission's vacancy lock. That keeps the
-- validation and stored question snapshot consistent during HR edits.
create or replace function public.recruitment_lock_question_vacancy() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' then
   perform id from public.recruitment_vacancies where id=new.vacancy_id for update;
 elsif tg_op='DELETE' then
   perform id from public.recruitment_vacancies where id=old.vacancy_id for update;
 else
   perform id from public.recruitment_vacancies where id in (old.vacancy_id,new.vacancy_id) order by id for update;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.recruitment_lock_question_vacancy() from public,anon,authenticated;
create trigger recruitment_question_vacancy_lock before insert or update or delete on public.recruitment_questions
for each row execute function public.recruitment_lock_question_vacancy();

-- A high-entropy request identifier can confirm a previous submission after
-- a lost response, including if the vacancy has since closed.
create or replace function public.recruitment_guest_submission_status(p_vacancy uuid,p_submission_id uuid)
returns jsonb language sql security definer stable set search_path=public,pg_temp as $$
 select jsonb_build_object('id',a.id,'submitted_at',a.submitted_at,'replayed',true)
 from public.recruitment_applications a where a.vacancy_id=p_vacancy and a.guest_submission_id=p_submission_id
$$;
revoke all on function public.recruitment_guest_submission_status(uuid,uuid) from public,anon,authenticated;
grant execute on function public.recruitment_guest_submission_status(uuid,uuid) to service_role;

-- Only the trusted Edge Function may submit guest records. Files remain in the
-- private recruitment bucket and HR's existing read policy still applies.
create or replace function public.recruitment_submit_guest_application(
  p_vacancy uuid, p_application jsonb, p_upload_id uuid, p_submission_id uuid
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v public.recruitment_vacancies%rowtype; q public.recruitment_questions%rowtype;
 a public.recruitment_applications%rowtype; answers jsonb; attachments jsonb:='[]'::jsonb;
 passport text; cv text; path text; answer text; prefix text; applicant_email text;
begin
 if p_upload_id is null or p_submission_id is null or jsonb_typeof(p_application)<>'object' or length(p_application::text)>100000 then raise exception 'Invalid application'; end if;
 perform pg_advisory_xact_lock(hashtextextended('guest-application:'||p_submission_id::text,0));
 select * into a from public.recruitment_applications where guest_submission_id=p_submission_id;
 if found then
   if a.vacancy_id<>p_vacancy then raise exception 'Invalid submission'; end if;
   return jsonb_build_object('id',a.id,'submitted_at',a.submitted_at,'replayed',true);
 end if;
 select * into v from public.recruitment_vacancies where id=p_vacancy for update;
 if not found or not public.recruitment_is_open(p_vacancy::text) then raise exception 'This vacancy is no longer open'; end if;
 if p_application->'consent' is distinct from 'true'::jsonb then raise exception 'Consent is required'; end if;
 if length(trim(coalesce(p_application->>'full_name',''))) not between 2 and 160 then raise exception 'Enter your full name'; end if;
 applicant_email:=lower(trim(coalesce(p_application->>'email','')));
 if applicant_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(applicant_email)>254 then raise exception 'Enter a valid email address'; end if;
 if length(trim(coalesce(p_application->>'phone',''))) not between 7 and 40 then raise exception 'Enter your phone number'; end if;
 -- Email is unverified. Do not block or disclose an existing candidate's record.
 answers:=coalesce(p_application->'answers','{}'::jsonb);
 if jsonb_typeof(answers)<>'object' then raise exception 'Invalid answers'; end if;
 if exists(select 1 from jsonb_object_keys(answers) k where not exists(select 1 from public.recruitment_questions where vacancy_id=v.id and id::text=k)) then raise exception 'Invalid question'; end if;
 passport:=nullif(trim(p_application->>'passport_path'),''); cv:=nullif(trim(p_application->>'cv_path'),'');
 if v.requires_passport and passport is null then raise exception 'A passport photograph is required'; end if;
 if v.requires_cv and cv is null then raise exception 'A CV is required'; end if;
 prefix:='guest/'||p_upload_id::text||'/'||v.id::text||'/';
 for q in select * from public.recruitment_questions where vacancy_id=v.id loop
   answer:=nullif(trim(answers->>q.id::text),'');
   if q.required and answer is null then raise exception 'Please answer: %',left(q.prompt,100); end if;
   if answer is not null and length(answer)>5000 then raise exception 'An answer is too long'; end if;
   if q.kind='select' and answer is not null and not q.options @> jsonb_build_array(answer) then raise exception 'Select an available answer'; end if;
   if q.kind='file' and answer is not null then attachments:=attachments||jsonb_build_array(answer); end if;
 end loop;
 if jsonb_array_length(attachments)>20 then raise exception 'Too many attachments'; end if;
 for path in select x from (select passport x union all select cv union all select jsonb_array_elements_text(attachments)) paths where x is not null loop
   if left(path,length(prefix))<>prefix or not exists(select 1 from storage.objects o where o.bucket_id='recruitment-applications' and o.name=path) then
     raise exception 'An attachment is missing or invalid';
   end if;
 end loop;
 insert into public.recruitment_applications(vacancy_id,user_id,guest_submission_id,full_name,email,phone,answers,question_snapshot,passport_path,cv_path,attachments)
 values(v.id,null,p_submission_id,trim(p_application->>'full_name'),applicant_email,trim(p_application->>'phone'),answers,
   coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'prompt',q.prompt,'kind',q.kind,'required',q.required,'options',q.options) order by q.sort_order,q.created_at) from public.recruitment_questions q where q.vacancy_id=v.id),'[]'::jsonb),passport,cv,attachments)
 returning * into a;
 return jsonb_build_object('id',a.id,'submitted_at',a.submitted_at);
end $$;
revoke all on function public.recruitment_submit_guest_application(uuid,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.recruitment_submit_guest_application(uuid,jsonb,uuid,uuid) to service_role;
