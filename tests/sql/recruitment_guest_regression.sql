-- Run only against a new, disposable PostgreSQL database with a superuser.
-- psql -v ON_ERROR_STOP=1 -f tests/sql/recruitment_guest_regression.sql
\set ON_ERROR_STOP on
begin;
do $$ begin
 if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema storage;
create table storage.objects(bucket_id text, name text);
create table public.recruitment_vacancies(id uuid primary key, status text, requires_cv boolean default false, requires_passport boolean default false);
create table public.recruitment_questions(id uuid primary key, vacancy_id uuid, prompt text, kind text, required boolean, options jsonb, sort_order integer, created_at timestamptz default now());
create table public.recruitment_applications(id uuid primary key default gen_random_uuid(), vacancy_id uuid, user_id uuid not null, full_name text, email text, phone text, answers jsonb, question_snapshot jsonb, passport_path text, cv_path text, attachments jsonb, submitted_at timestamptz default now());
create function public.recruitment_public_vacancy(uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.recruitment_is_open(text) returns boolean language sql as $$ select true $$;
\ir ../../supabase/migrations/058_guest_recruitment_applications.sql
insert into public.recruitment_vacancies(id,status) values ('11111111-1111-4111-8111-111111111111','open');
insert into public.recruitment_questions(id,vacancy_id,prompt,kind,required,options,sort_order) values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Experience','text',true,'[]',1);
\ir ../../supabase/migrations/059_recruitment_guest_snapshot_fix.sql
do $$
declare
 result jsonb;
 repeated jsonb;
 application public.recruitment_applications%rowtype;
begin
 result := public.recruitment_submit_guest_application('11111111-1111-4111-8111-111111111111', '{"full_name":"Example Applicant","email":"test@example.org","phone":"08012345678","consent":true,"answers":{"22222222-2222-4222-8222-222222222222":"Some experience"}}', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444');
 select * into application from public.recruitment_applications where id=(result->>'id')::uuid;
 if application.email <> 'test@example.org' or application.question_snapshot->0->>'prompt' <> 'Experience' or application.answers->>'22222222-2222-4222-8222-222222222222' <> 'Some experience' then raise exception 'Application data or question snapshot is incorrect'; end if;
 repeated := public.recruitment_submit_guest_application('11111111-1111-4111-8111-111111111111', '{}', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444');
 if repeated->>'id' <> result->>'id' or repeated->>'replayed' <> 'true' then raise exception 'Idempotent replay failed'; end if;
 begin
  perform public.recruitment_submit_guest_application('11111111-1111-4111-8111-111111111111', '{"full_name":"Example Applicant","email":"test@example.org","phone":"08012345678","consent":true,"answers":{}}', '33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555');
  raise exception 'Required answer was not enforced';
 exception when raise_exception then
  if sqlerrm <> 'Please answer: Experience' then raise; end if;
 end;
 update public.recruitment_vacancies set requires_cv=true,requires_passport=true where id='11111111-1111-4111-8111-111111111111';
 insert into public.recruitment_questions(id,vacancy_id,prompt,kind,required,options,sort_order) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Portfolio','file',true,'[]',2);
 insert into storage.objects(bucket_id,name) values
 ('recruitment-applications','guest/33333333-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111/cv.pdf'),
 ('recruitment-applications','guest/33333333-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111/passport.jpg'),
 ('recruitment-applications','guest/33333333-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111/portfolio.pdf');
 result := public.recruitment_submit_guest_application('11111111-1111-4111-8111-111111111111', '{"full_name":"Example Applicant","email":"test@example.org","phone":"08012345678","consent":true,"cv_path":"guest/33333333-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111/cv.pdf","passport_path":"guest/33333333-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111/passport.jpg","answers":{"22222222-2222-4222-8222-222222222222":"Some experience","aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa":"guest/33333333-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111/portfolio.pdf"}}', '33333333-3333-4333-8333-333333333333', '66666666-6666-4666-8666-666666666666');
 select * into application from public.recruitment_applications where id=(result->>'id')::uuid;
 if jsonb_array_length(application.attachments) <> 1 or application.cv_path is null or application.passport_path is null then raise exception 'Attachments not saved'; end if;
 raise notice 'Guest submission, snapshot, replay and required answer passed';
end $$;
rollback;
