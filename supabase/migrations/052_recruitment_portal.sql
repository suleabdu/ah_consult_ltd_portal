-- Recruitment adverts and applications. Applicant records and uploaded files
-- are private; only open vacancies and their questions are exposed publicly.
create table public.recruitment_vacancies (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 2 and 160),
  department text not null default '' check (length(department)<=120),
  location text not null default '' check (length(location)<=160),
  employment_type text not null default '' check (length(employment_type)<=100),
  summary text not null default '' check (length(summary)<=1000),
  description text not null default '' check (length(description)<=30000),
  responsibilities text not null default '' check (length(responsibilities)<=30000),
  requirements text not null default '' check (length(requirements)<=30000),
  status text not null default 'draft' check (status in ('draft','open','closed')),
  opens_at timestamptz,
  closes_at timestamptz,
  requires_passport boolean not null default false,
  requires_cv boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (opens_at is null or closes_at is null or closes_at>opens_at),
  check (status<>'open' or (opens_at is not null and closes_at is not null))
);
create index recruitment_vacancies_open_idx on public.recruitment_vacancies(status,opens_at,closes_at);

create table public.recruitment_questions (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null references public.recruitment_vacancies(id) on delete cascade,
  prompt text not null check (length(trim(prompt)) between 2 and 1000),
  kind text not null default 'text' check (kind in ('text','textarea','select','file')),
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options)='array' and jsonb_array_length(options)<=50),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index recruitment_questions_vacancy_idx on public.recruitment_questions(vacancy_id,sort_order);

create table public.recruitment_applications (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null references public.recruitment_vacancies(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  full_name text not null check (length(trim(full_name)) between 2 and 160),
  email text not null check (length(email) between 3 and 254),
  phone text not null check (length(trim(phone)) between 7 and 40),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers)='object'),
  question_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(question_snapshot)='array'),
  passport_path text,
  cv_path text,
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments)='array'),
  consent_at timestamptz not null default now(),
  submitted_at timestamptz not null default now(),
  unique(vacancy_id,user_id)
);
create index recruitment_applications_vacancy_idx on public.recruitment_applications(vacancy_id,submitted_at desc);

alter table public.recruitment_vacancies enable row level security;
alter table public.recruitment_questions enable row level security;
alter table public.recruitment_applications enable row level security;
revoke all on public.recruitment_vacancies, public.recruitment_questions, public.recruitment_applications from public,anon,authenticated;
grant select,insert,update,delete on public.recruitment_vacancies,public.recruitment_questions to authenticated;
grant select on public.recruitment_applications to authenticated;
create policy recruitment_vacancies_read on public.recruitment_vacancies for select to authenticated using (public.can_read('recruitment'));
create policy recruitment_vacancies_insert on public.recruitment_vacancies for insert to authenticated with check (public.can_write('recruitment') and created_by=auth.uid());
create policy recruitment_vacancies_update on public.recruitment_vacancies for update to authenticated using (public.can_write('recruitment')) with check (public.can_write('recruitment'));
create policy recruitment_vacancies_delete on public.recruitment_vacancies for delete to authenticated using (public.can_write('recruitment'));
create policy recruitment_questions_read on public.recruitment_questions for select to authenticated using (public.can_read('recruitment'));
create policy recruitment_questions_write on public.recruitment_questions for all to authenticated using (public.can_write('recruitment')) with check (public.can_write('recruitment'));
create policy recruitment_applications_read on public.recruitment_applications for select to authenticated using (user_id=auth.uid() or public.can_read('recruitment'));

create or replace function public.recruitment_preserve_creator() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'Vacancy creator cannot be changed';
  end if;
  return new;
end $$;
revoke all on function public.recruitment_preserve_creator() from public,anon,authenticated;
create trigger recruitment_vacancy_creator_immutable before update on public.recruitment_vacancies
  for each row execute function public.recruitment_preserve_creator();

create or replace function public.audit_recruitment_changes() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare target_id uuid; actor_label text;
begin
  target_id:=case when tg_op='DELETE' then old.id else new.id end;
  select full_name into actor_label from public.staff where id=auth.uid();
  insert into public.audit_log(actor,actor_name,action,target,note)
  values(auth.uid(),coalesce(actor_label,'Staff'),tg_table_name||'_'||lower(tg_op),target_id::text,'Recruitment administration');
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.audit_recruitment_changes() from public,anon,authenticated;
create trigger recruitment_vacancy_audit after insert or update or delete on public.recruitment_vacancies for each row execute function public.audit_recruitment_changes();
create trigger recruitment_question_audit after insert or update or delete on public.recruitment_questions for each row execute function public.audit_recruitment_changes();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('recruitment-applications','recruitment-applications',false,10485760,
  array['image/jpeg','image/png','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do nothing;
-- Storage policies run as the caller, who cannot read the private vacancies
-- table. This narrowly scoped helper exposes only the open/closed decision.
create or replace function public.recruitment_is_open(p_vacancy text) returns boolean
language sql security definer stable set search_path=public,pg_temp as $$
  select exists(select 1 from public.recruitment_vacancies v where v.id::text=p_vacancy
    and v.status='open' and v.opens_at<=now() and v.closes_at>=now())
$$;
revoke all on function public.recruitment_is_open(text) from public,anon;
grant execute on function public.recruitment_is_open(text) to authenticated;

-- A transactional counter bounds upload attempts per applicant and vacancy.
-- Successful uploads count even if later removed, preventing repeated upload/
-- delete cycles from evading the quota. Failed transactions do not consume it.
create table public.recruitment_upload_quotas (
  user_id uuid not null references auth.users(id) on delete cascade,
  vacancy_id uuid not null references public.recruitment_vacancies(id) on delete cascade,
  upload_count integer not null default 0 check (upload_count between 0 and 50),
  primary key(user_id,vacancy_id)
);
alter table public.recruitment_upload_quotas enable row level security;
revoke all on public.recruitment_upload_quotas from public,anon,authenticated;
create or replace function public.recruitment_limit_uploads() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); vacancy_text text; vacancy uuid; counted integer;
begin
  if new.bucket_id<>'recruitment-applications' or uid is null then return new; end if;
  vacancy_text:=(storage.foldername(new.name))[2];
  if (storage.foldername(new.name))[1] is distinct from uid::text
     or vacancy_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or not public.recruitment_is_open(vacancy_text) then
    raise exception 'Upload is not permitted for this vacancy';
  end if;
  vacancy:=vacancy_text::uuid;
  insert into public.recruitment_upload_quotas(user_id,vacancy_id,upload_count)
  values(uid,vacancy,1)
  on conflict(user_id,vacancy_id) do update
    set upload_count=public.recruitment_upload_quotas.upload_count+1
    where public.recruitment_upload_quotas.upload_count<50
  returning upload_count into counted;
  if counted is null then raise exception 'Upload limit reached for this vacancy; contact recruitment support'; end if;
  return new;
end $$;
revoke all on function public.recruitment_limit_uploads() from public,anon,authenticated;
create trigger recruitment_upload_quota before insert on storage.objects
  for each row execute function public.recruitment_limit_uploads();

create policy recruitment_files_insert on storage.objects for insert to authenticated
with check (bucket_id='recruitment-applications' and (storage.foldername(name))[1]=auth.uid()::text
  and public.recruitment_is_open((storage.foldername(name))[2]));
create policy recruitment_files_read on storage.objects for select to authenticated
using (bucket_id='recruitment-applications' and ((storage.foldername(name))[1]=auth.uid()::text or public.can_read('recruitment')));

create or replace function public.recruitment_public_vacancies() returns jsonb
language sql security definer stable set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'title',v.title,'department',v.department,
    'location',v.location,'employment_type',v.employment_type,'summary',v.summary,
    'opens_at',v.opens_at,'closes_at',v.closes_at) order by v.closes_at,v.created_at desc),'[]'::jsonb)
  from public.recruitment_vacancies v
  where v.status='open' and v.opens_at<=now() and v.closes_at>=now()
$$;

create or replace function public.recruitment_public_vacancy(p_vacancy uuid) returns jsonb
language sql security definer stable set search_path=public,pg_temp as $$
  select jsonb_build_object('id',v.id,'title',v.title,'department',v.department,'location',v.location,
    'employment_type',v.employment_type,'summary',v.summary,'description',v.description,
    'responsibilities',v.responsibilities,'requirements',v.requirements,'opens_at',v.opens_at,
    'closes_at',v.closes_at,'requires_passport',v.requires_passport,'requires_cv',v.requires_cv,
    'questions',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'prompt',q.prompt,'kind',q.kind,
      'required',q.required,'options',q.options,'sort_order',q.sort_order) order by q.sort_order,q.created_at)
      from public.recruitment_questions q where q.vacancy_id=v.id),'[]'::jsonb))
  from public.recruitment_vacancies v
  where v.id=p_vacancy and v.status='open' and v.opens_at<=now() and v.closes_at>=now()
$$;

create or replace function public.recruitment_submit_application(p_vacancy uuid,p_application jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.recruitment_vacancies%rowtype; q public.recruitment_questions%rowtype;
  uid uuid:=auth.uid(); a public.recruitment_applications%rowtype; answers jsonb; attachments jsonb;
  passport text; cv text; path text; answer text; prefix text;
begin
  if uid is null then raise exception 'Sign in before submitting an application'; end if;
  if jsonb_typeof(p_application)<>'object' or length(p_application::text)>100000 then raise exception 'Invalid application'; end if;
  select * into v from public.recruitment_vacancies where id=p_vacancy for update;
  if not found or v.status<>'open' or v.opens_at>now() or v.closes_at<now() then raise exception 'This vacancy is not open for applications'; end if;
  if p_application->'consent' is distinct from 'true'::jsonb then raise exception 'Consent is required to submit an application'; end if;
  if length(trim(coalesce(p_application->>'full_name',''))) not between 2 and 160 then raise exception 'Enter your full name'; end if;
  if coalesce(p_application->>'email','') !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(p_application->>'email')>254 then raise exception 'Enter a valid email address'; end if;
  if length(trim(coalesce(p_application->>'phone',''))) not between 7 and 40 then raise exception 'Enter your phone number'; end if;
  answers:=coalesce(p_application->'answers','{}'::jsonb); attachments:=coalesce(p_application->'attachments','[]'::jsonb);
  if jsonb_typeof(answers)<>'object' or jsonb_typeof(attachments)<>'array' or jsonb_array_length(attachments)>20 then raise exception 'Invalid answers or attachments'; end if;
  passport:=nullif(trim(p_application->>'passport_path'),''); cv:=nullif(trim(p_application->>'cv_path'),'');
  if v.requires_passport and passport is null then raise exception 'A passport photograph is required'; end if;
  if v.requires_cv and cv is null then raise exception 'A CV is required'; end if;
  prefix:=uid::text||'/'||p_vacancy::text||'/';
  for q in select * from public.recruitment_questions where vacancy_id=v.id loop
    answer:=nullif(trim(answers->>q.id::text),'');
    if q.required and answer is null then raise exception 'Please answer: %',left(q.prompt,100); end if;
    if answer is not null and length(answer)>5000 then raise exception 'An answer is too long'; end if;
    if q.kind='select' and answer is not null and not q.options @> jsonb_build_array(answer) then raise exception 'Select an available answer'; end if;
    if q.kind='file' and answer is not null then attachments:=attachments||jsonb_build_array(answer); end if;
  end loop;
  if jsonb_array_length(attachments)>40 then raise exception 'Too many attachments'; end if;
  for path in select x from (select passport as x union all select cv union all select jsonb_array_elements_text(attachments)) paths where x is not null loop
    if left(path,length(prefix))<>prefix or not exists(select 1 from storage.objects o where o.bucket_id='recruitment-applications' and o.name=path) then
      raise exception 'An attachment is missing or does not belong to this application';
    end if;
  end loop;
  insert into public.recruitment_applications(vacancy_id,user_id,full_name,email,phone,answers,question_snapshot,passport_path,cv_path,attachments)
  values(v.id,uid,trim(p_application->>'full_name'),trim(p_application->>'email'),trim(p_application->>'phone'),answers,
    coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'prompt',q.prompt,'kind',q.kind,'required',q.required,'options',q.options) order by q.sort_order,q.created_at)
      from public.recruitment_questions q where q.vacancy_id=v.id),'[]'::jsonb),passport,cv,attachments)
  returning * into a;
  return jsonb_build_object('id',a.id,'submitted_at',a.submitted_at);
exception when unique_violation then raise exception 'You have already applied for this vacancy';
end $$;

revoke all on function public.recruitment_public_vacancies(),public.recruitment_public_vacancy(uuid),public.recruitment_submit_application(uuid,jsonb) from public;
grant execute on function public.recruitment_public_vacancies(),public.recruitment_public_vacancy(uuid) to anon,authenticated;
grant execute on function public.recruitment_submit_application(uuid,jsonb) to authenticated;
