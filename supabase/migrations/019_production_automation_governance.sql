-- AH STUDENT HUB — Phase 9: Production Automation & Governance
-- Depends on 001-018.
-- Adds immutable audit governance, versioned institutional documents,
-- communication preferences + idempotent delivery queue, operational health,
-- and safer production controls around document issuance and reconciliation.

-- -----------------------------------------------------------------------------
-- 1. Immutable audit trail
-- -----------------------------------------------------------------------------
create or replace function prevent_audit_mutation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'audit_log is append-only';
end $$;

drop trigger if exists audit_log_immutable on audit_log;
create trigger audit_log_immutable
before update or delete on audit_log
for each row execute function prevent_audit_mutation();

-- Only the server-side/security-definer workflows may append audit entries.
revoke insert,update,delete on audit_log from authenticated,anon;

-- -----------------------------------------------------------------------------
-- 2. Document template version registry
-- -----------------------------------------------------------------------------
create table if not exists document_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_key text not null references document_templates(key) on delete cascade,
  version int not null,
  title text not null,
  document_type text not null,
  template_html text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(template_key,version)
);
create index if not exists document_template_versions_key_idx
  on document_template_versions(template_key,version desc);

insert into document_template_versions(template_key,version,title,document_type,template_html)
select key,version,title,document_type,template_html from document_templates
on conflict (template_key,version) do nothing;

alter table document_jobs add column if not exists template_html_snapshot text;
alter table document_jobs add column if not exists generated_by uuid references auth.users(id);
alter table document_jobs add column if not exists issued_by uuid references auth.users(id);

create or replace function request_document_job(p_application uuid,p_document_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid:=auth.uid();
  a applications;
  t document_templates;
  j uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not has_role('administrator','registrar','finance','academic') then
    raise exception 'Document generation access required';
  end if;
  select * into a from applications where id=p_application;
  if not found then raise exception 'Application not found'; end if;
  select * into t from document_templates where key=p_document_key and active;
  if not found then raise exception 'Document template not found or inactive'; end if;

  insert into document_jobs(user_id,application_id,document_key,template_version,
                            template_html_snapshot,requested_by,metadata)
  values(a.user_id,a.id,t.key,t.version,t.template_html,uid,
         jsonb_build_object('student_id',a.student_id,'template',t.key))
  returning id into j;

  insert into audit_log(actor,action,target,note)
  values(uid,'document_requested',coalesce(a.student_id,a.id::text),t.key);
  return j;
end $$;
revoke all on function request_document_job(uuid,text) from public,anon;
grant execute on function request_document_job(uuid,text) to authenticated;

create or replace function issue_document_job(p_job uuid,p_file_path text default null,p_metadata jsonb default '{}'::jsonb)
returns document_jobs language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j document_jobs;
  who text;
begin
  if not has_role('administrator','registrar','finance','academic') then
    raise exception 'Document issue access required';
  end if;
  select * into j from document_jobs where id=p_job for update;
  if not found then raise exception 'Document job not found'; end if;
  if j.status='issued' then return j; end if;
  if j.status not in ('requested','generated') then raise exception 'Document job is not issuable in status %',j.status; end if;
  select full_name into who from staff where id=auth.uid();

  update document_jobs
  set status='issued',
      file_path=coalesce(p_file_path,file_path),
      metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb),
      generated_at=coalesce(generated_at,now()),
      generated_by=coalesce(generated_by,auth.uid()),
      issued_at=now(),
      issued_by=auth.uid()
  where id=p_job
  returning * into j;

  insert into student_documents(user_id,application_id,title,document_type,file_url,status,document_key,issued_at,metadata)
  select j.user_id,j.application_id,t.title,t.document_type,j.file_path,'available',j.document_key,j.issued_at,j.metadata
  from document_templates t where t.key=j.document_key
  on conflict (user_id,document_key) where document_key is not null
  do update set title=excluded.title,document_type=excluded.document_type,
    file_url=excluded.file_url,status='available',issued_at=excluded.issued_at,metadata=excluded.metadata;

  insert into audit_log(actor,actor_name,action,target,note)
  values(auth.uid(),who,'document_issued',j.document_key,
         coalesce(j.application_id::text,'')||coalesce(' | file: '||j.file_path,''));
  return j;
end $$;
revoke all on function issue_document_job(uuid,text,jsonb) from public,anon;
grant execute on function issue_document_job(uuid,text,jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Communication preferences + idempotent queueing
-- -----------------------------------------------------------------------------
create table if not exists communication_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_enabled boolean not null default true,
  sms_enabled boolean not null default false,
  whatsapp_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table communication_outbox add column if not exists provider_status text;
alter table communication_outbox add column if not exists delivered_at timestamptz;
alter table communication_outbox add column if not exists locked_by text;
alter table communication_outbox add column if not exists locked_at timestamptz;

create unique index if not exists communication_outbox_notification_channel_uq
  on communication_outbox(notification_id,channel)
  where notification_id is not null;

create or replace function enqueue_notification_communications(p_notification uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n student_notifications;
  p profiles;
  pref communication_preferences;
  added int:=0;
begin
  select * into n from student_notifications where id=p_notification;
  if not found then return 0; end if;
  select * into p from profiles where id=n.user_id;
  if not found then return 0; end if;
  select * into pref from communication_preferences where user_id=n.user_id;
  if not found then
    insert into communication_preferences(user_id) values(n.user_id)
    on conflict (user_id) do nothing;
    select * into pref from communication_preferences where user_id=n.user_id;
  end if;

  if pref.email_enabled and nullif(trim(coalesce(p.email,'')),'') is not null then
    insert into communication_outbox(user_id,notification_id,channel,recipient,subject,message,metadata)
    values(n.user_id,n.id,'email',p.email,n.title,n.message,
           jsonb_build_object('action_url',n.action_url,'event_key',n.event_key))
    on conflict (notification_id,channel) where notification_id is not null do nothing;
    if found then added:=added+1; end if;
  end if;

  if pref.sms_enabled and nullif(trim(coalesce(p.phone,'')),'') is not null then
    insert into communication_outbox(user_id,notification_id,channel,recipient,subject,message,metadata)
    values(n.user_id,n.id,'sms',p.phone,null,n.message,
           jsonb_build_object('action_url',n.action_url,'event_key',n.event_key))
    on conflict (notification_id,channel) where notification_id is not null do nothing;
    if found then added:=added+1; end if;
  end if;

  if pref.whatsapp_enabled and nullif(trim(coalesce(p.phone,'')),'') is not null then
    insert into communication_outbox(user_id,notification_id,channel,recipient,subject,message,metadata)
    values(n.user_id,n.id,'whatsapp',p.phone,null,n.message,
           jsonb_build_object('action_url',n.action_url,'event_key',n.event_key))
    on conflict (notification_id,channel) where notification_id is not null do nothing;
    if found then added:=added+1; end if;
  end if;

  return added;
end $$;

revoke all on function enqueue_notification_communications(uuid) from public,anon,authenticated;

create or replace function trg_queue_notification_communications()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform enqueue_notification_communications(new.id);
  return new;
end $$;

drop trigger if exists student_notification_communications on student_notifications;
create trigger student_notification_communications
after insert on student_notifications
for each row execute function trg_queue_notification_communications();

create or replace function queue_communication(p_notification uuid,p_channels text[] default array['email'])
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n student_notifications;
  p profiles;
  c text;
  recipient text;
  pref communication_preferences;
  count_added int:=0;
begin
  if not has_role('administrator','registrar','finance','academic','operations') then
    raise exception 'Communication queue access required';
  end if;
  select * into n from student_notifications where id=p_notification;
  if not found then raise exception 'Notification not found'; end if;
  select * into p from profiles where id=n.user_id;
  select * into pref from communication_preferences where user_id=n.user_id;
  foreach c in array p_channels loop
    if c not in ('email','sms','whatsapp') then continue; end if;
    if c='email' and not coalesce(pref.email_enabled,true) then continue; end if;
    if c='sms' and not coalesce(pref.sms_enabled,false) then continue; end if;
    if c='whatsapp' and not coalesce(pref.whatsapp_enabled,false) then continue; end if;
    recipient:=case c when 'email' then p.email else p.phone end;
    if nullif(trim(coalesce(recipient,'')),'') is null then continue; end if;
    insert into communication_outbox(user_id,notification_id,channel,recipient,subject,message,metadata)
    values(n.user_id,n.id,c,recipient,n.title,n.message,
           jsonb_build_object('action_url',n.action_url,'event_key',n.event_key))
    on conflict (notification_id,channel) where notification_id is not null do nothing;
    if found then count_added:=count_added+1; end if;
  end loop;
  return count_added;
end $$;
revoke all on function queue_communication(uuid,text[]) from public,anon;
grant execute on function queue_communication(uuid,text[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Delivery-worker primitives
-- -----------------------------------------------------------------------------
create or replace function claim_communication_jobs(p_worker text,p_limit int default 25)
returns setof communication_outbox
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_worker is null or length(trim(p_worker))<8 then raise exception 'Invalid worker id'; end if;
  return query
  with picked as (
    select id from communication_outbox
    where status in ('queued','failed')
      and (next_attempt_at is null or next_attempt_at<=now())
      and attempts<8
    order by created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,25),100))
  )
  update communication_outbox q
  set status='processing',attempts=q.attempts+1,last_attempt_at=now(),locked_by=p_worker,locked_at=now()
  from picked
  where q.id=picked.id
  returning q.*;
end $$;

create or replace function complete_communication_job(p_id bigint,p_provider text,p_provider_message_id text default null)
returns communication_outbox language plpgsql security definer set search_path = public, pg_temp as $$
declare q communication_outbox;
begin
  update communication_outbox
  set status='sent',sent_at=now(),provider=p_provider,provider_message_id=p_provider_message_id,
      provider_status='accepted',locked_by=null,locked_at=null,last_error=null
  where id=p_id and status='processing'
  returning * into q;
  if not found then raise exception 'Communication job is not processing'; end if;
  return q;
end $$;

create or replace function fail_communication_job(p_id bigint,p_error text,p_provider text default null)
returns communication_outbox language plpgsql security definer set search_path = public, pg_temp as $$
declare q communication_outbox; delay_seconds int;
begin
  delay_seconds:=least(3600,greatest(30,pow(2,(select attempts from communication_outbox where id=p_id))::int*30));
  update communication_outbox
  set status=case when attempts>=8 then 'failed' else 'queued' end,
      next_attempt_at=case when attempts>=8 then null else now()+make_interval(secs=>delay_seconds) end,
      last_error=left(p_error,1000),provider=coalesce(p_provider,provider),
      provider_status='failed',locked_by=null,locked_at=null
  where id=p_id and status='processing'
  returning * into q;
  if not found then raise exception 'Communication job is not processing'; end if;
  return q;
end $$;
revoke all on function public.claim_communication_jobs(text,integer),public.complete_communication_job(bigint,text,text),public.fail_communication_job(bigint,text,text) from public,anon,authenticated;
grant execute on function public.claim_communication_jobs(text,integer),public.complete_communication_job(bigint,text,text),public.fail_communication_job(bigint,text,text) to service_role;

-- -----------------------------------------------------------------------------
-- 5. Operational health snapshot
-- -----------------------------------------------------------------------------
create or replace function system_health_snapshot()
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare r jsonb;
begin
  if not has_role('administrator','operations','viewer') then raise exception 'System health access required'; end if;
  select jsonb_build_object(
    'generated_at',now(),
    'database','ok',
    'applications',(select count(*) from applications),
    'notifications_24h',(select count(*) from student_notifications where created_at>=now()-interval '24 hours'),
    'communications_queued',(select count(*) from communication_outbox where status in ('queued','processing')),
    'communications_failed',(select count(*) from communication_outbox where status='failed' and created_at>=now()-interval '7 days'),
    'sheet_pending',(select count(*) from sheet_outbox where not done),
    'sheet_failed',(select count(*) from sheet_outbox where not done and attempts>=8),
    'documents_requested',(select count(*) from document_jobs where requested_at>=now()-interval '30 days'),
    'documents_issued',(select count(*) from document_jobs where status='issued' and issued_at>=now()-interval '30 days'),
    'audit_24h',(select count(*) from audit_log where created_at>=now()-interval '24 hours')
  ) into r;
  return r;
end $$;
revoke all on function system_health_snapshot() from public,anon;
grant execute on function system_health_snapshot() to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Governance comments
-- -----------------------------------------------------------------------------
comment on table document_template_versions is 'Immutable version registry for institutional document templates.';
comment on table communication_preferences is 'Per-student communication channel preferences; email is enabled by default, SMS/WhatsApp opt-in.';
comment on function claim_communication_jobs(text,int) is 'Atomically claims outbound communication jobs for a provider worker.';
comment on function system_health_snapshot() is 'Staff operational health snapshot; does not expose secrets or provider credentials.';

-- -----------------------------------------------------------------------------
-- 7. RLS for communication preferences and immutable template history
-- -----------------------------------------------------------------------------
alter table communication_preferences enable row level security;
drop policy if exists communication_preferences_own_read on communication_preferences;
drop policy if exists communication_preferences_own_write on communication_preferences;
create policy communication_preferences_own_read on communication_preferences
for select to authenticated using (user_id=auth.uid());
create policy communication_preferences_own_write on communication_preferences
for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

alter table document_template_versions enable row level security;
revoke all on document_template_versions from anon,authenticated;

-- The client can change only its own channel preferences; no client-side write
-- access is granted to the communication queue or template history.
