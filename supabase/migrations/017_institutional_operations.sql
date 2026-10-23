-- AH STUDENT HUB — Phase 7 Institutional Operations & Communication
-- Notifications, document registry, event log, and controlled operational actions.

create table if not exists notification_templates (
  key text primary key,
  title text not null,
  body text not null,
  kind text not null default 'info' check(kind in ('info','success','warning','error')),
  action_url text,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  event_key text not null,
  source_type text,
  source_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(event_key, source_type, source_id, user_id)
);
create index if not exists notification_events_user_created_idx on notification_events(user_id, created_at desc);

alter table student_documents add column if not exists document_key text;
alter table student_documents add column if not exists issued_at timestamptz;
alter table student_documents add column if not exists metadata jsonb not null default '{}'::jsonb;
create unique index if not exists student_documents_user_key_uq on student_documents(user_id, document_key) where document_key is not null;

alter table student_notifications add column if not exists event_key text;
alter table student_notifications add column if not exists metadata jsonb not null default '{}'::jsonb;

insert into notification_templates(key,title,body,kind,action_url) values
('application_submitted','Application submitted','Your application has been submitted and is now awaiting review.','info','portal#applications'),
('payment_verified','Payment verified','Your payment has been verified. Your application can now proceed to the next stage.','success','portal'),
('admission_approved','Admission approved','Congratulations. Your admission has been approved. Welcome to AH Consult.','success','portal'),
('admission_rejected','Admission decision','Your admission application has received a decision. Please review your portal for details.','warning','portal'),
('deferment_approved','Deferment approved','Your course deferment request has been approved.','success','portal#defer'),
('deferment_rejected','Deferment request declined','Your deferment request was not approved. Please review the office note in your portal.','warning','portal#defer'),
('result_published','Result published','A new academic result is now available in your Academic Record.','success','portal#results')
on conflict (key) do update set title=excluded.title,body=excluded.body,kind=excluded.kind,action_url=excluded.action_url,updated_at=now();

alter table notification_templates enable row level security;
revoke all on notification_templates from anon,authenticated;

alter table notification_events enable row level security;
revoke all on notification_events from anon,authenticated;

create or replace function emit_student_notification(p_user uuid,p_event_key text,p_source_type text default null,p_source_id uuid default null,p_metadata jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare tid uuid; nid uuid; t notification_templates%rowtype; payload jsonb:=coalesce(p_metadata,'{}'::jsonb);
begin
 if p_user is null then return null; end if;
 select * into t from notification_templates where key=p_event_key and active=true;
 if not found then return null; end if;
 insert into notification_events(user_id,event_key,source_type,source_id,payload) values(p_user,p_event_key,p_source_type,p_source_id,payload)
 on conflict(event_key,source_type,source_id,user_id) do nothing returning id into tid;
 if tid is null then return null; end if;
 insert into student_notifications(user_id,title,message,kind,action_url,event_key,metadata)
 values(p_user,t.title,t.body,t.kind,t.action_url,p_event_key,payload) returning id into nid;
 return nid;
end $$;

revoke all on function public.emit_student_notification(uuid,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.emit_student_notification(uuid,text,text,uuid,jsonb) to service_role;

-- Application lifecycle notifications.
create or replace function trg_application_notifications() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if new.submitted_at is not null and old.submitted_at is null then
   perform emit_student_notification(new.user_id,'application_submitted','applications',new.id,'{}'::jsonb);
 end if;
 if new.paid_at is not null and old.paid_at is null then
   perform emit_student_notification(new.user_id,'payment_verified','applications',new.id,'{}'::jsonb);
 end if;
 if coalesce(new.admission_decision,'pending') is distinct from coalesce(old.admission_decision,'pending') then
   if new.admission_decision='approved' then
     perform emit_student_notification(new.user_id,'admission_approved','applications',new.id,jsonb_build_object('student_id',new.student_id));
   elsif new.admission_decision in ('rejected','declined') then
     perform emit_student_notification(new.user_id,'admission_rejected','applications',new.id,'{}'::jsonb);
   end if;
 end if;
 return new;
end $$;

drop trigger if exists applications_phase7_notifications on applications;
create trigger applications_phase7_notifications after update on applications for each row execute function trg_application_notifications();

create or replace function trg_deferment_notifications() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid;
begin
 if new.status is distinct from old.status and new.status in ('approved','rejected') then
   select user_id into uid from applications where id=new.application_id;
   if new.status='approved' then perform emit_student_notification(uid,'deferment_approved','deferments',new.id,jsonb_build_object('scope',new.scope));
   else perform emit_student_notification(uid,'deferment_rejected','deferments',new.id,jsonb_build_object('scope',new.scope)); end if;
 end if;
 return new;
end $$;
drop trigger if exists deferments_phase7_notifications on deferments;
create trigger deferments_phase7_notifications after update on deferments for each row execute function trg_deferment_notifications();

create or replace function notify_result_published(p_result uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid; aid uuid;
begin
 if not has_role('administrator','academic','registrar') then raise exception 'Academic staff access required'; end if;
 select application_id into aid from exam_results where id=p_result;
 select user_id into uid from applications where id=aid;
 perform emit_student_notification(uid,'result_published','exam_results',p_result,'{}'::jsonb);
end $$;
-- Internal helper only: staff must go through publish_result(), which validates and publishes the record.
revoke all on function notify_result_published(uuid) from public,anon,authenticated;

-- Extend publication so a student notification is generated atomically.
create or replace function publish_result(p_result uuid) returns exam_results language plpgsql security definer set search_path = public, pg_temp as $$
declare r exam_results;
begin
 if not has_role('administrator','academic') then raise exception 'Only Academic or Administrator can publish results'; end if;
 select * into r from exam_results where id=p_result for update;
 if not found then raise exception 'Result not found'; end if;
 if r.published_at is not null then return r; end if;
 update exam_results set published_at=now(),published_by=auth.uid() where id=p_result returning * into r;
 insert into audit_log(actor,action,target,note) values(auth.uid(),'result_published',p_result::text,'Result published to student portal');
 perform notify_result_published(p_result);
 return r;
end $$;

-- Operational document registry helper. Actual file generation/storage remains an explicit staff action.
create or replace function register_student_document(p_user uuid,p_title text,p_type text,p_url text,p_application uuid default null,p_key text default null,p_metadata jsonb default '{}'::jsonb)
returns student_documents language plpgsql security definer set search_path = public, pg_temp as $$
declare r student_documents;
begin
 if not has_role('administrator','registrar','academic','operations') then raise exception 'Staff access required'; end if;
 if p_user is null or nullif(trim(p_title),'') is null then raise exception 'Document title is required'; end if;
 if p_key is not null then
   insert into student_documents(user_id,application_id,title,document_type,file_url,status,document_key,issued_at,metadata)
   values(p_user,p_application,p_title,p_type,p_url,'available',p_key,now(),coalesce(p_metadata,'{}'::jsonb))
   on conflict(user_id,document_key) do update set title=excluded.title,document_type=excluded.document_type,file_url=excluded.file_url,status='available',issued_at=now(),metadata=excluded.metadata
   returning * into r;
 else
   insert into student_documents(user_id,application_id,title,document_type,file_url,status,issued_at,metadata)
   values(p_user,p_application,p_title,p_type,p_url,'available',now(),coalesce(p_metadata,'{}'::jsonb)) returning * into r;
 end if;
 return r;
end $$;
revoke all on function register_student_document(uuid,text,text,text,uuid,text,jsonb) from public,anon;
grant execute on function register_student_document(uuid,text,text,text,uuid,text,jsonb) to authenticated;

comment on table notification_events is 'Idempotent event ledger for student communication triggers.';
comment on function register_student_document(uuid,text,text,text,uuid,text,jsonb) is 'Registers an institutional document for a student; generation/storage is performed by authorized staff workflow.';
