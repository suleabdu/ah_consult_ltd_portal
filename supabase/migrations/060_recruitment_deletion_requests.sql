-- Recruitment application removal requires a separate super-administrator
-- decision. Private storage objects are removed through the Storage API before
-- the application row can be finalized by the service-only function below.
create table public.recruitment_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.recruitment_applications(id) on delete set null,
  application_ref uuid not null,
  requested_by uuid references auth.users(id) on delete set null,
  requested_by_name text not null,
  reason text not null check (length(trim(reason)) between 10 and 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected','completed')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_reason text,
  completed_at timestamptz
);
create unique index recruitment_deletion_requests_active_idx
  on public.recruitment_deletion_requests(application_id)
  where status in ('pending','approved');
alter table public.recruitment_deletion_requests enable row level security;
revoke all on public.recruitment_deletion_requests from public,anon,authenticated;
grant select on public.recruitment_deletion_requests to authenticated;
create policy recruitment_deletion_requests_read on public.recruitment_deletion_requests
  for select to authenticated using (public.is_admin() or public.can_read('recruitment'));

create or replace function public.recruitment_request_deletion(p_application uuid,p_reason text)
returns public.recruitment_deletion_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare request_row public.recruitment_deletion_requests%rowtype; actor_name text;
begin
 if auth.uid() is null or not public.can_write('recruitment') then raise exception 'Recruitment management access required'; end if;
 if length(trim(coalesce(p_reason,''))) not between 10 and 500 then raise exception 'Enter a reason of 10 to 500 characters'; end if;
 perform 1 from public.recruitment_applications where id=p_application for update;
 if not found then raise exception 'Application not found'; end if;
 if exists(select 1 from public.recruitment_deletion_requests where application_id=p_application and status in ('pending','approved')) then
   raise exception 'A deletion request is already awaiting review or completion';
 end if;
 select full_name into actor_name from public.staff where id=auth.uid();
 insert into public.recruitment_deletion_requests(application_id,application_ref,requested_by,requested_by_name,reason)
 values(p_application,p_application,auth.uid(),coalesce(actor_name,'Staff'),trim(p_reason)) returning * into request_row;
 insert into public.audit_log(actor,actor_name,action,target,note)
 values(auth.uid(),coalesce(actor_name,'Staff'),'recruitment_deletion_requested',p_application::text,'Deletion request '||request_row.id::text);
 return request_row;
end $$;
revoke all on function public.recruitment_request_deletion(uuid,text) from public,anon;
grant execute on function public.recruitment_request_deletion(uuid,text) to authenticated;

create or replace function public.recruitment_reject_deletion(p_request uuid,p_reason text)
returns public.recruitment_deletion_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare request_row public.recruitment_deletion_requests%rowtype; actor_name text;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Super administrator access required'; end if;
 if length(trim(coalesce(p_reason,''))) not between 10 and 500 then raise exception 'Enter a reason of 10 to 500 characters'; end if;
 select * into request_row from public.recruitment_deletion_requests where id=p_request for update;
 if not found then raise exception 'Deletion request not found'; end if;
 if request_row.status<>'pending' then raise exception 'Only pending requests can be rejected'; end if;
 select full_name into actor_name from public.staff where id=auth.uid();
 update public.recruitment_deletion_requests set status='rejected',reviewed_by=auth.uid(),reviewed_by_name=coalesce(actor_name,'Administrator'),reviewed_at=now(),review_reason=trim(p_reason)
 where id=p_request returning * into request_row;
 insert into public.audit_log(actor,actor_name,action,target,note)
 values(auth.uid(),coalesce(actor_name,'Administrator'),'recruitment_deletion_rejected',request_row.application_ref::text,'Deletion request '||p_request::text);
 return request_row;
end $$;
revoke all on function public.recruitment_reject_deletion(uuid,text) from public,anon;
grant execute on function public.recruitment_reject_deletion(uuid,text) to authenticated;

-- This function does not delete anything. It records approval and returns only
-- the authoritative paths to the authorized caller. A retry is safe.
create or replace function public.recruitment_approve_deletion(p_request uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare request_row public.recruitment_deletion_requests%rowtype; app_row public.recruitment_applications%rowtype;
 actor_name text; file_paths text[]; shared_path text;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Super administrator access required'; end if;
 select * into request_row from public.recruitment_deletion_requests where id=p_request for update;
 if not found then raise exception 'Deletion request not found'; end if;
 if request_row.status='completed' then return jsonb_build_object('status','completed','paths','[]'::jsonb); end if;
 if request_row.status not in ('pending','approved') then raise exception 'This deletion request is not awaiting approval'; end if;
 select * into app_row from public.recruitment_applications where id=request_row.application_id for update;
 if not found then raise exception 'Application not found; contact an administrator'; end if;
 select coalesce(array_agg(distinct file_path) filter (where file_path is not null and file_path<>''),'{}'::text[]) into file_paths
 from (
   select app_row.cv_path as file_path union all select app_row.passport_path
   union all select j.value #>> '{}' from jsonb_array_elements(case when jsonb_typeof(app_row.attachments)='array' then app_row.attachments else '[]'::jsonb end) j(value) where jsonb_typeof(j.value)='string'
   union all select app_row.answers->>(question.value->>'id') from jsonb_array_elements(case when jsonb_typeof(app_row.question_snapshot)='array' then app_row.question_snapshot else '[]'::jsonb end) question(value) where question.value->>'kind'='file'
 ) paths;
 -- Never delete an application when any of its files is referenced by another
 -- application, including exact matches in answers from legacy submissions.
 select p.path into shared_path from unnest(file_paths) p(path)
 where exists (
   select 1 from public.recruitment_applications other_app
    where other_app.id<>app_row.id and (
      other_app.cv_path=p.path or other_app.passport_path=p.path
      or (jsonb_typeof(other_app.attachments)='array' and other_app.attachments @> jsonb_build_array(p.path))
      or exists(select 1 from jsonb_each_text(case when jsonb_typeof(other_app.answers)='object' then other_app.answers else '{}'::jsonb end) answer where answer.value=p.path)
    )
 ) limit 1;
 if shared_path is not null then raise exception 'This application has documents shared with another application; contact an administrator'; end if;
 if request_row.status='pending' then
   select full_name into actor_name from public.staff where id=auth.uid();
   update public.recruitment_deletion_requests set status='approved',reviewed_by=auth.uid(),reviewed_by_name=coalesce(actor_name,'Administrator'),reviewed_at=now() where id=p_request;
   insert into public.audit_log(actor,actor_name,action,target,note)
   values(auth.uid(),coalesce(actor_name,'Administrator'),'recruitment_deletion_approved',request_row.application_ref::text,'Deletion request '||p_request::text||'; storage cleanup pending');
 end if;
 return jsonb_build_object('status','approved','paths',to_jsonb(file_paths));
end $$;
revoke all on function public.recruitment_approve_deletion(uuid) from public,anon;
grant execute on function public.recruitment_approve_deletion(uuid) to authenticated;

-- Only the service function can finalize after Storage API cleanup succeeds.
create or replace function public.recruitment_finalize_deletion(p_request uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare request_row public.recruitment_deletion_requests%rowtype;
begin
 select * into request_row from public.recruitment_deletion_requests where id=p_request for update;
 if not found then raise exception 'Deletion request not found'; end if;
 if request_row.status='completed' then return jsonb_build_object('ok',true,'status','completed'); end if;
 if request_row.status<>'approved' or request_row.application_id is null then raise exception 'Deletion has not been approved'; end if;
 delete from public.recruitment_applications where id=request_row.application_id;
 if not found then raise exception 'Application not found'; end if;
 update public.recruitment_deletion_requests set status='completed',completed_at=now() where id=p_request;
 insert into public.audit_log(actor,actor_name,action,target,note)
 values(request_row.reviewed_by,coalesce(request_row.reviewed_by_name,'Administrator'),'recruitment_deletion_completed',request_row.application_ref::text,'Deletion request '||p_request::text||'; private document cleanup completed');
 return jsonb_build_object('ok',true,'status','completed');
end $$;
revoke all on function public.recruitment_finalize_deletion(uuid) from public,anon,authenticated;
grant execute on function public.recruitment_finalize_deletion(uuid) to service_role;
