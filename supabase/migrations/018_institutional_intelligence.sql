-- AH STUDENT HUB — Phase 8: Institutional Intelligence & Document Automation
-- Depends on 001-017. Safe to re-run.
-- Purpose: Student 360, management analytics, document automation registry,
-- communication outbox architecture, audit centre and sheet reconciliation.

-- -----------------------------------------------------------------------------
-- 1. Document automation registry
-- -----------------------------------------------------------------------------
create table if not exists document_templates (
  key text primary key,
  title text not null,
  document_type text not null,
  version int not null default 1,
  template_html text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into document_templates(key,title,document_type,template_html) values
('admission_letter','Admission Letter','admission_letter','AH CONSULT LTD|ADMISSION LETTER'),
('payment_receipt','Payment Receipt','payment_receipt','AH CONSULT LTD|OFFICIAL PAYMENT RECEIPT'),
('academic_transcript','Academic Transcript','transcript','AH CONSULT LTD|ACADEMIC TRANSCRIPT'),
('certificate','Certificate of Completion','certificate','AH CONSULT LTD|CERTIFICATE OF COMPLETION')
on conflict (key) do nothing;

create table if not exists document_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid references applications(id) on delete set null,
  document_key text not null references document_templates(key),
  template_version int not null default 1,
  status text not null default 'requested' check(status in ('requested','generated','issued','failed','cancelled')),
  file_path text,
  metadata jsonb not null default '{}'::jsonb,
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  generated_at timestamptz,
  issued_at timestamptz,
  error_message text
);
create index if not exists document_jobs_user_idx on document_jobs(user_id,requested_at desc);
create index if not exists document_jobs_app_idx on document_jobs(application_id,requested_at desc);

alter table document_templates enable row level security;
revoke all on document_templates from anon, authenticated;

alter table document_jobs enable row level security;
drop policy if exists document_jobs_own on document_jobs;
create policy document_jobs_own on document_jobs for select to authenticated using(user_id=auth.uid());
revoke insert,update,delete on document_jobs from authenticated;

create or replace function request_document_job(p_application uuid,p_document_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid:=auth.uid(); a applications; t document_templates; j uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not has_role('administrator','registrar','finance','academic') then raise exception 'Document generation access required'; end if;
  select * into a from applications where id=p_application;
  if not found then raise exception 'Application not found'; end if;
  select * into t from document_templates where key=p_document_key and active;
  if not found then raise exception 'Document template not found or inactive'; end if;
  insert into document_jobs(user_id,application_id,document_key,template_version,requested_by,metadata)
  values(a.user_id,a.id,t.key,t.version,uid,jsonb_build_object('student_id',a.student_id,'template',t.key))
  returning id into j;
  insert into audit_log(actor,action,target,note) values(uid,'document_requested',coalesce(a.student_id,a.id::text),t.key);
  return j;
end $$;
revoke all on function request_document_job(uuid,text) from public,anon;
grant execute on function request_document_job(uuid,text) to authenticated;

-- Staff can register the issued/printed document. File generation itself remains
-- provider-neutral; Phase 8 frontend supplies a print-ready document.
create or replace function issue_document_job(p_job uuid,p_file_path text default null,p_metadata jsonb default '{}'::jsonb)
returns document_jobs language plpgsql security definer set search_path = public, pg_temp as $$
declare j document_jobs; who text;
begin
  if not has_role('administrator','registrar','finance','academic') then raise exception 'Document issue access required'; end if;
  select * into j from document_jobs where id=p_job for update;
  if not found then raise exception 'Document job not found'; end if;
  select full_name into who from staff where id=auth.uid();
  update document_jobs set status='issued',file_path=coalesce(p_file_path,file_path),metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb),generated_at=coalesce(generated_at,now()),issued_at=now() where id=p_job returning * into j;
  insert into student_documents(user_id,application_id,title,document_type,file_url,status,document_key,issued_at,metadata)
  select j.user_id,j.application_id,t.title,t.document_type,j.file_path,'available',j.document_key,j.issued_at,j.metadata
  from document_templates t where t.key=j.document_key
  on conflict (user_id,document_key) where document_key is not null
  do update set title=excluded.title,document_type=excluded.document_type,file_url=excluded.file_url,status='available',issued_at=excluded.issued_at,metadata=excluded.metadata;
  insert into audit_log(actor,actor_name,action,target,note) values(auth.uid(),who,'document_issued',j.document_key,j.application_id::text);
  return j;
end $$;
revoke all on function issue_document_job(uuid,text,jsonb) from public,anon;
grant execute on function issue_document_job(uuid,text,jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Communication outbox — provider-neutral email/SMS/WhatsApp architecture
-- -----------------------------------------------------------------------------
create table if not exists communication_outbox (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  notification_id uuid references student_notifications(id) on delete set null,
  channel text not null check(channel in ('email','sms','whatsapp')),
  recipient text,
  subject text,
  message text not null,
  status text not null default 'queued' check(status in ('queued','processing','sent','failed','cancelled')),
  attempts int not null default 0,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  provider text,
  provider_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists communication_outbox_status_idx on communication_outbox(status,next_attempt_at,created_at);
create index if not exists communication_outbox_user_idx on communication_outbox(user_id,created_at desc);
alter table communication_outbox enable row level security;
revoke all on communication_outbox from anon,authenticated;

create or replace function queue_communication(p_notification uuid,p_channels text[] default array['email'])
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n student_notifications; p profiles; c text; recipient text; count_added int:=0;
begin
  if not has_role('administrator','registrar','finance','academic','operations') then raise exception 'Communication queue access required'; end if;
  select * into n from student_notifications where id=p_notification;
  if not found then raise exception 'Notification not found'; end if;
  select * into p from profiles where id=n.user_id;
  foreach c in array p_channels loop
    if c not in ('email','sms','whatsapp') then continue; end if;
    recipient:=case c when 'email' then p.email else p.phone end;
    if nullif(trim(coalesce(recipient,'')),'') is null then continue; end if;
    insert into communication_outbox(user_id,notification_id,channel,recipient,subject,message,metadata)
    values(n.user_id,n.id,c,recipient,n.title,n.message,jsonb_build_object('action_url',n.action_url,'event_key',n.event_key));
    count_added:=count_added+1;
  end loop;
  return count_added;
end $$;
revoke all on function queue_communication(uuid,text[]) from public,anon;
grant execute on function queue_communication(uuid,text[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Management intelligence
-- -----------------------------------------------------------------------------
create or replace function management_analytics()
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare r jsonb;
begin
  if not has_role('administrator','registrar','finance','academic','operations','viewer') then raise exception 'Staff access required'; end if;
  select jsonb_build_object(
    'generated_at',now(),
    'applications_total',(select count(*) from applications),
    'applications_live',(select count(*) from applications where status <> 'expired'),
    'submitted',(select count(*) from applications where status in ('submitted','under_review','approved','rejected')),
    'approved',(select count(*) from applications where admission_decision='approved'),
    'rejected',(select count(*) from applications where admission_decision='rejected'),
    'pending_admission',(select count(*) from applications where status in ('submitted','under_review') and coalesce(admission_decision,'pending') in ('pending','under_review')),
    'payments_verified',(select count(*) from payments where coalesce(paid_ngn,0)>=coalesce(expected_ngn,0)),
    'payment_value_ngn',(select coalesce(sum(paid_ngn),0) from payments where coalesce(paid_ngn,0)>=coalesce(expected_ngn,0)),
    'approved_students',(select count(distinct user_id) from applications where admission_decision='approved'),
    'active_courses',(select count(*) from courses where is_active),
    'active_lecturers',(select count(*) from lecturers where is_active),
    'pending_deferments',(select count(*) from deferments where status='pending'),
    'unpublished_results',(select count(*) from exam_results where published_at is null),
    'published_results',(select count(*) from exam_results where published_at is not null),
    'sheet_pending',(select count(*) from sheet_outbox where not done),
    'sheet_failed',(select count(*) from sheet_outbox where not done and attempts>=8),
    'documents_issued',(select count(*) from student_documents where status='available')
  ) into r;
  return r;
end $$;

create or replace function management_analytics_breakdown()
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare r jsonb;
begin
  if not has_role('administrator','registrar','finance','academic','operations','viewer') then raise exception 'Staff access required'; end if;
  select jsonb_build_object(
    'by_intake',coalesce((select jsonb_agg(x order by x.total desc) from (select i.label,count(a.id) total,count(*) filter(where a.admission_decision='approved') approved from intakes i left join applications a on a.intake_id=i.id group by i.id,i.label) x),'[]'::jsonb),
    'by_status',coalesce((select jsonb_agg(x order by x.total desc) from (select status,count(*) total from applications group by status) x),'[]'::jsonb),
    'by_course',coalesce((select jsonb_agg(x order by x.total desc) from (select c.code,c.name,c.category,count(ac.application_id) total from courses c left join application_courses ac on ac.course_code=c.code group by c.code,c.name,c.category) x),'[]'::jsonb),
    'results_by_band',coalesce((select jsonb_agg(x order by x.total desc) from (select band,count(*) total from exam_results where published_at is not null group by band) x),'[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke all on function management_analytics(),management_analytics_breakdown() from public,anon;
grant execute on function management_analytics(),management_analytics_breakdown() to authenticated;

-- -----------------------------------------------------------------------------
-- Detailed Student 360 record for authorized staff.
create or replace function admin_student_360_detail(p_application uuid)
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare r jsonb;
begin
  if not has_role('administrator','registrar','academic','operations','viewer') then raise exception 'Staff access required'; end if;
  select jsonb_build_object(
    'application',(select jsonb_build_object('id',a.id,'student_id',a.student_id,'status',a.status,'admission_decision',a.admission_decision,'admission_note',a.admission_note,'payment_review',a.payment_review,'payment_note',a.payment_note,'total_ngn',a.total_ngn,'pay_reference',a.pay_reference,'created_at',a.created_at,'submitted_at',a.submitted_at,'paid_at',a.paid_at,'reviewed_at',a.reviewed_at,'intake',i.label,'form_data',a.form_data,'name',coalesce(nullif(trim(coalesce(a.form_data->>'firstName','')||' '||coalesce(a.form_data->>'surname','')),''),p.full_name),'email',p.email,'phone',p.phone) from applications a join profiles p on p.id=a.user_id join intakes i on i.id=a.intake_id where a.id=p_application),
    'courses',coalesce((select jsonb_agg(jsonb_build_object('code',c.code,'name',c.name,'category',c.category,'fee',ac.fee_ngn,'deferred',ac.deferred) order by c.category,c.name) from application_courses ac join courses c on c.code=ac.course_code where ac.application_id=p_application),'[]'::jsonb),
    'results',coalesce((select jsonb_agg(jsonb_build_object('code',er.course_code,'attendance',er.attendance,'ca',er.ca,'exams',er.exams,'total',er.total,'band',er.band,'published',er.published_at is not null,'locked',er.locked_at is not null,'revision',er.revision_no) order by er.course_code) from exam_results er where er.application_id=p_application),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(jsonb_build_object('reference',py.reference,'expected_ngn',py.expected_ngn,'paid_ngn',py.paid_ngn,'paid_at',py.paid_at,'verified_at',py.verified_at,'provider',py.provider,'source',py.source) order by coalesce(py.paid_at,py.created_at) desc) from payments py where py.application_id=p_application),'[]'::jsonb),
    'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'document_type',d.document_type,'document_key',d.document_key,'status',d.status,'file_url',d.file_url,'issued_at',d.issued_at) order by d.created_at desc) from student_documents d join applications a on a.user_id=d.user_id where a.id=p_application),'[]'::jsonb),
    'notifications',coalesce((select jsonb_agg(jsonb_build_object('title',n.title,'message',n.message,'kind',n.kind,'read_at',n.read_at,'created_at',n.created_at) order by n.created_at desc) from student_notifications n join applications a on a.user_id=n.user_id where a.id=p_application limit 20),'[]'::jsonb),
    'timeline',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc) from application_state_history h where h.application_id=p_application),'[]'::jsonb)
  ) into r;
  if (r->'application') is null then raise exception 'Application not found'; end if;
  return r;
end $$;
revoke all on function admin_student_360_detail(uuid) from public,anon;
grant execute on function admin_student_360_detail(uuid) to authenticated;

-- 4. Audit centre and sheet reconciliation
-- -----------------------------------------------------------------------------
create or replace function audit_center(p_action text default null,p_limit int default 100)
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare r jsonb;
begin
  if not is_admin() then raise exception 'Administrator access required'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into r
  from (select id,actor,actor_name,action,target,note,created_at from audit_log where p_action is null or action=p_action order by created_at desc limit greatest(1,least(coalesce(p_limit,100),500))) x;
  return r;
end $$;

create or replace function sheet_reconciliation()
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare r jsonb;
begin
  if not is_admin() then raise exception 'Administrator access required'; end if;
  select jsonb_build_object(
    'database_applications',(select count(*) from applications),
    'queued_application_jobs',(select count(*) from sheet_outbox where kind='application' and not done),
    'queued_staff_jobs',(select count(*) from sheet_outbox where kind='staff' and not done),
    'completed_jobs',(select count(*) from sheet_outbox where done),
    'failed_jobs',(select count(*) from sheet_outbox where not done and attempts>=8),
    'retry_waiting',(select count(*) from sheet_outbox where not done and next_attempt_at is not null and next_attempt_at>now()),
    'last_completed_at',(select max(completed_at) from sheet_outbox where done),
    'last_error_at',(select max(last_attempt_at) from sheet_outbox where not done and last_error is not null)
  ) into r;
  return r;
end $$;
revoke all on function audit_center(text,int),sheet_reconciliation() from public,anon;
grant execute on function audit_center(text,int),sheet_reconciliation() to authenticated;

comment on table document_jobs is 'Provider-neutral document generation/issuance workflow. Phase 8 browser printing may be replaced by server PDF generation later.';
comment on table communication_outbox is 'Provider-neutral outbound communication queue for email, SMS and WhatsApp adapters.';
comment on function management_analytics() is 'Management KPI snapshot for the institutional command centre.';
comment on function management_analytics_breakdown() is 'Management breakdowns by intake, application status, course and result band.';
comment on function audit_center(text,int) is 'Administrator-only operational audit centre.';
comment on function sheet_reconciliation() is 'Administrator-only Google Sheets mirror queue/reconciliation metrics.';

-- Security hardening carried forward from the baseline migration.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles(id,full_name,phone,email)
  values(new.id,new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'phone',new.email)
  on conflict (id) do update set email=excluded.email;
  return new;
end $$;
revoke all on function public.handle_new_user() from public,anon,authenticated;

