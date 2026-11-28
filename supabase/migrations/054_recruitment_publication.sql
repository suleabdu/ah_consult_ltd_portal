-- Explicit publication and placement for recruitment vacancies.
-- Preserve the visibility of positions that were already open under 052.
alter table public.recruitment_vacancies
  add column if not exists published_at timestamptz,
  add column if not exists feature_homepage boolean not null default false,
  add column if not exists feature_studenthub boolean not null default false,
  add column if not exists feature_recruitment boolean not null default false;

update public.recruitment_vacancies
   set published_at=coalesce(published_at,created_at),
       feature_homepage=true,feature_studenthub=true,feature_recruitment=true
 where status='open' and published_at is null;

-- Direct staff edits may change vacancy content and scheduling, but publication
-- fields are writable only through the security-definer publication function.
revoke update on public.recruitment_vacancies from authenticated;
grant update (title,department,location,employment_type,summary,description,
 responsibilities,requirements,status,opens_at,closes_at,requires_passport,
 requires_cv,updated_at) on public.recruitment_vacancies to authenticated;

-- Only the publishing RPC may set placement fields. Closing a vacancy clears
-- its publication so reopening it always requires a fresh deliberate publish.
create or replace function public.recruitment_guard_publication_fields() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' then
   if new.published_at is not null or new.feature_homepage or new.feature_studenthub or new.feature_recruitment then
     raise exception 'Create the vacancy first, then publish it using the recruitment publishing flow';
   end if;
 elsif coalesce(current_setting('ahct.recruitment_publishing',true),'')<>'1'
   and (new.published_at is distinct from old.published_at
     or new.feature_homepage is distinct from old.feature_homepage
     or new.feature_studenthub is distinct from old.feature_studenthub
     or new.feature_recruitment is distinct from old.feature_recruitment) then
   raise exception 'Use the recruitment publishing flow to change publication or placement';
 end if;
 if new.status<>'open' then
   new.published_at:=null;
   new.feature_homepage:=false; new.feature_studenthub:=false; new.feature_recruitment:=false;
 end if;
 return new;
end $$;
revoke all on function public.recruitment_guard_publication_fields() from public,anon,authenticated;
create trigger recruitment_publication_guard before insert or update on public.recruitment_vacancies
 for each row execute function public.recruitment_guard_publication_fields();

create or replace function public.recruitment_publish_vacancy(
 p_vacancy uuid,p_homepage boolean,p_studenthub boolean,p_recruitment boolean
) returns public.recruitment_vacancies
language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.recruitment_vacancies%rowtype; who text;
begin
 if not public.can_write('recruitment') then raise exception 'Recruitment publishing access required'; end if;
 if not (coalesce(p_homepage,false) or coalesce(p_studenthub,false) or coalesce(p_recruitment,false)) then
  raise exception 'Select at least one destination before publishing';
 end if;
 select * into v from public.recruitment_vacancies where id=p_vacancy for update;
 if not found then raise exception 'Vacancy not found'; end if;
 if v.status<>'open' or v.opens_at is null or v.closes_at is null or v.closes_at<=v.opens_at then
  raise exception 'Set the vacancy to Open and provide valid opening and closing dates before publishing';
 end if;
 if v.closes_at<=now() then raise exception 'The closing date has passed; update it before publishing'; end if;
 perform set_config('ahct.recruitment_publishing','1',true);
 update public.recruitment_vacancies
    set published_at=now(),feature_homepage=coalesce(p_homepage,false),
        feature_studenthub=coalesce(p_studenthub,false),feature_recruitment=coalesce(p_recruitment,false),updated_at=now()
  where id=p_vacancy returning * into v;
 select full_name into who from public.staff where id=auth.uid();
 insert into public.audit_log(actor,actor_name,action,target,note)
 values(auth.uid(),who,'recruitment_vacancy_published',v.id::text,
   'Homepage='||v.feature_homepage::text||'; Student Hub='||v.feature_studenthub::text||'; Recruitment='||v.feature_recruitment::text);
 return v;
end $$;
revoke all on function public.recruitment_publish_vacancy(uuid,boolean,boolean,boolean) from public,anon;
grant execute on function public.recruitment_publish_vacancy(uuid,boolean,boolean,boolean) to authenticated;

-- The featured endpoint is separate from the vacancy index so the HR-selected
-- website placement can be honored without exposing unpublished vacancies.
create or replace function public.recruitment_featured_vacancies(p_surface text) returns jsonb
language sql security definer stable set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'title',v.title,'department',v.department,
   'location',v.location,'employment_type',v.employment_type,'summary',v.summary,
   'opens_at',v.opens_at,'closes_at',v.closes_at) order by v.closes_at,v.created_at desc),'[]'::jsonb)
 from public.recruitment_vacancies v
 where v.status='open' and v.published_at is not null and v.opens_at<=now() and v.closes_at>=now()
   and case p_surface when 'homepage' then v.feature_homepage when 'studenthub' then v.feature_studenthub else false end
$$;
revoke all on function public.recruitment_featured_vacancies(text) from public;
grant execute on function public.recruitment_featured_vacancies(text) to anon,authenticated;

create or replace function public.recruitment_public_vacancies() returns jsonb
language sql security definer stable set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'title',v.title,'department',v.department,
   'location',v.location,'employment_type',v.employment_type,'summary',v.summary,
   'opens_at',v.opens_at,'closes_at',v.closes_at) order by v.closes_at,v.created_at desc),'[]'::jsonb)
 from public.recruitment_vacancies v
 where v.status='open' and v.published_at is not null and v.feature_recruitment
   and v.opens_at<=now() and v.closes_at>=now()
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
 where v.id=p_vacancy and v.status='open' and v.published_at is not null
   and (v.feature_homepage or v.feature_studenthub or v.feature_recruitment)
   and v.opens_at<=now() and v.closes_at>=now()
$$;

create or replace function public.recruitment_is_open(p_vacancy text) returns boolean
language sql security definer stable set search_path=public,pg_temp as $$
 select exists(select 1 from public.recruitment_vacancies v where v.id::text=p_vacancy
   and v.status='open' and v.published_at is not null
   and (v.feature_homepage or v.feature_studenthub or v.feature_recruitment)
   and v.opens_at<=now() and v.closes_at>=now())
$$;

-- Every application, including applications without uploaded files, is checked
-- for publication at the database boundary, not only in the browser.
create or replace function public.recruitment_require_publication() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.recruitment_is_open(new.vacancy_id::text) then
   raise exception 'This vacancy is not published or is no longer open';
 end if;
 return new;
end $$;
revoke all on function public.recruitment_require_publication() from public,anon,authenticated;
create trigger recruitment_application_require_publication before insert on public.recruitment_applications
 for each row execute function public.recruitment_require_publication();
