-- V18.7.5: staged, independently authorized manual application imports.
-- Does not grant admission, payment approval, or student IDs. Do not amend applied migrations.
create table if not exists public.manual_import_batches (
 id uuid primary key default gen_random_uuid(),
 created_by uuid not null references auth.users(id),
 file_name text not null,
 checksum text not null,
 status text not null default 'validated' check(status in ('validated','processing','partial','completed')),
 row_count integer not null check (row_count between 1 and 100),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(created_by,checksum)
);
create table if not exists public.manual_import_rows (
 id uuid primary key default gen_random_uuid(),
 batch_id uuid not null references public.manual_import_batches(id) on delete cascade,
 row_number integer not null check(row_number>=2 and row_number<=10001),
 source_reference text not null,
 email text not null,
 data jsonb not null,
 invited_user_id uuid references auth.users(id),
 application_id uuid references public.applications(id),
 status text not null default 'validated' check(status in ('validated','invited','imported','failed')),
 error_message text,
 updated_at timestamptz not null default now(),
 unique(batch_id,row_number),unique(batch_id,email),unique(batch_id,source_reference)
);
create index if not exists manual_import_rows_batch_status_idx on public.manual_import_rows(batch_id,status);
create table if not exists public.manual_registration_sources (
 source_reference text primary key, application_id uuid not null unique references public.applications(id),
 batch_id uuid not null references public.manual_import_batches(id),
 registered_at timestamptz not null default now()
);
-- Service-role only staging: never expose imported personal records through PostgREST.
alter table public.manual_import_batches enable row level security;
alter table public.manual_import_rows enable row level security;
alter table public.manual_registration_sources enable row level security;
revoke all on public.manual_import_batches,public.manual_import_rows,public.manual_registration_sources from public,anon,authenticated;
grant select,insert,update,delete on public.manual_import_batches,public.manual_import_rows to service_role;
grant select,insert on public.manual_registration_sources to service_role;

-- Each row commits as one DB transaction; if the Edge worker times out, the next run
-- resumes without repeating committed rows. The external Auth invite is tracked separately.
create or replace function public.ahct_import_application_row(
 p_batch uuid,p_row integer,p_user uuid,p_actor uuid
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.manual_import_rows%rowtype; b public.manual_import_batches%rowtype;
 i public.intakes%rowtype; c text; codes text[]; n integer; total integer:=0; a_id uuid;
 fullname text; app jsonb;
begin
 select * into b from public.manual_import_batches where id=p_batch for update;
 if not found or b.created_by<>p_actor or b.status<>'processing' then raise exception 'Import batch is not authorized or not processing'; end if;
 if not exists(select 1 from public.staff where id=p_actor and status='approved' and role in ('administrator','registrar')) then
  raise exception 'An approved admissions officer is required'; end if;
 select * into r from public.manual_import_rows where batch_id=p_batch and row_number=p_row for update;
 if not found then raise exception 'Staged row was not found'; end if;
 if r.status='imported' then return r.application_id; end if;
 if r.invited_user_id is distinct from p_user or r.email='' then raise exception 'Invited account does not match staged row'; end if;
 if not exists(select 1 from auth.users where id=p_user and lower(email)=r.email) then raise exception 'Applicant email identity does not match'; end if;
 if exists(select 1 from public.staff where id=p_user) then raise exception 'Staff identities cannot be applicants'; end if;
 if exists(select 1 from public.applications where user_id=p_user and intake_id=(r.data->>'intake_id')::uuid and status not in ('expired','rejected')) then
  raise exception 'An application already exists for this account and intake'; end if;
 if exists(select 1 from public.manual_registration_sources where source_reference=r.source_reference) then
  raise exception 'This paper registration reference has been imported already'; end if;
 select * into i from public.intakes where id=(r.data->>'intake_id')::uuid;
 if not found then raise exception 'Intake was removed; run a new preview'; end if;
 codes := array(select jsonb_array_elements_text(r.data->'course_codes'));
 if coalesce(cardinality(codes),0)=0 or cardinality(codes)>10 then raise exception 'Choose 1 to 10 courses'; end if;
 select count(*),coalesce(sum(fee_ngn),0) into n,total from public.courses
  where code=any(codes) and is_active=true and workflow_status='published';
 if n<>cardinality(codes) or total<=0 then raise exception 'Course availability changed; run a new preview'; end if;
 fullname:=btrim(r.data->>'first_name'||' '||r.data->>'surname');
 app:=jsonb_build_object('firstName',r.data->>'first_name','surname',r.data->>'surname',
  'phone',r.data->>'phone','email',r.email,'source','manual_bulk_import',
  'paperRegistrationReference',r.source_reference,'registrationNote',coalesce(r.data->>'note',''));
 if (r.data ? 'date_of_birth') then app:=app||jsonb_build_object('dob',r.data->>'date_of_birth'); end if;
 if (r.data ? 'gender') then app:=app||jsonb_build_object('gender',r.data->>'gender'); end if;
 update public.profiles set full_name=fullname,phone=r.data->>'phone',email=r.email where id=p_user;
 insert into public.applications(user_id,intake_id,status,total_ngn,form_data,idempotency_key)
  values(p_user,i.id,'draft',total,app,'MANUAL-BULK-'||r.id::text) returning id into a_id;
 insert into public.application_courses(application_id,course_code,fee_ngn)
  select a_id,code,fee_ngn from public.courses where code=any(codes);
 insert into public.manual_registration_sources(source_reference,application_id,batch_id)
  values(r.source_reference,a_id,p_batch);
 update public.manual_import_rows set status='imported',application_id=a_id,error_message=null,updated_at=now()
  where id=r.id;
 insert into public.audit_log(actor,action,target,note)
  values(p_actor,'manual_application.bulk_imported',a_id::text,'Batch '||p_batch::text||' row '||p_row::text||' paper ref '||r.source_reference);
 return a_id;
end $$;
revoke all on function public.ahct_import_application_row(uuid,integer,uuid,uuid) from public,anon,authenticated;
grant execute on function public.ahct_import_application_row(uuid,integer,uuid,uuid) to service_role;
comment on function public.ahct_import_application_row(uuid,integer,uuid,uuid) is
 'Atomic draft import for a previously invited applicant; never grants paid status, admission or a student ID.';

-- Optional maintenance entrypoint: run daily via trusted service job after approval of
-- the organisation's retention schedule. Completed import staging is temporary; the
-- authoritative application, paper-reference mapping and audit history are retained.
create or replace function public.ahct_cleanup_manual_import_staging()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare removed_rows integer:=0; removed_previews integer:=0;
begin
 delete from public.manual_import_rows r using public.manual_import_batches b
  where r.batch_id=b.id and b.status='completed' and b.updated_at<now()-interval '30 days';
 get diagnostics removed_rows = row_count;
 delete from public.manual_import_batches
  where status='validated' and created_at<now()-interval '14 days';
 get diagnostics removed_previews = row_count;
 return jsonb_build_object('completed_rows_purged',removed_rows,'abandoned_previews_purged',removed_previews);
end $$;
revoke all on function public.ahct_cleanup_manual_import_staging() from public,anon,authenticated;
grant execute on function public.ahct_cleanup_manual_import_staging() to service_role;
