-- AH STUDENT HUB - Phase 5: Student Lifecycle + Command Center
-- Depends on 001-014. Safe to re-run.

create table if not exists student_notifications(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null,
 message text not null,
 kind text not null default 'info' check(kind in ('info','success','warning','error')),
 action_url text,
 read_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists student_notifications_user_idx on student_notifications(user_id,created_at desc);

create table if not exists student_documents(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 application_id uuid references applications(id) on delete cascade,
 title text not null,
 document_type text not null default 'other',
 file_url text,
 status text not null default 'available' check(status in ('available','pending','replaced')),
 created_at timestamptz not null default now()
);
create index if not exists student_documents_user_idx on student_documents(user_id,created_at desc);

alter table student_notifications enable row level security;
alter table student_documents enable row level security;
drop policy if exists student_notifications_own on student_notifications;
create policy student_notifications_own on student_notifications for select to authenticated using(user_id=auth.uid());
drop policy if exists student_documents_own on student_documents;
create policy student_documents_own on student_documents for select to authenticated using(user_id=auth.uid());

-- Keep writes server-side so a student cannot manufacture official notifications/documents.
revoke insert,update,delete on student_notifications from authenticated;
revoke insert,update,delete on student_documents from authenticated;

create or replace function mark_notification_read(p_id uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
 update student_notifications set read_at=now() where id=p_id and user_id=auth.uid();
end $$;
revoke all on function mark_notification_read(uuid) from public,anon;
grant execute on function mark_notification_read(uuid) to authenticated;

create or replace function portal_phase5_data() returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); res jsonb;
begin
 if uid is null then raise exception 'Not signed in'; end if;
 select jsonb_build_object(
  'notifications', coalesce((select jsonb_agg(x order by x.created_at desc) from (select n.id::text id,n.title,n.message,n.kind,n.action_url,n.read_at,n.created_at from student_notifications n where n.user_id=uid union all select a.id::text||':status','Application status update',case when a.admission_decision='approved' then 'Congratulations — your application has been admitted.' when a.admission_decision='rejected' then 'Your application has received an admissions decision.' when a.admission_decision='under_review' then 'Your application is currently being reviewed by the admissions team.' when a.payment_claimed_at is not null and a.payment_review='pending' then 'Your payment claim has been received and is awaiting verification.' when a.status='paid' then 'Payment confirmed. Your application is ready for review.' else 'Your application is progressing through the admissions process.' end,case when a.admission_decision='approved' then 'success' when a.admission_decision='rejected' then 'warning' else 'info' end,null,null,coalesce(a.reviewed_at,a.paid_at,a.submitted_at,a.created_at) from applications a where a.user_id=uid) x),'[]'::jsonb),
  'documents', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc) from student_documents d where d.user_id=uid),'[]'::jsonb),
  'timeline', coalesce((
    select jsonb_agg(x order by x.at desc)
    from (
      select a.id::text id,'application' kind,'Application submitted' title,
             coalesce(a.status,'') detail,a.created_at at
      from applications a where a.user_id=uid
      union all
      select p.id::text,'payment','Payment recorded',case when coalesce(p.paid_ngn,0) >= coalesce(p.expected_ngn,0) then 'Payment verified' else 'Payment recorded' end,coalesce(p.created_at,p.paid_at)
      from payments p join applications a on a.id=p.application_id where a.user_id=uid
      union all
      select a.id::text||':admission','admission',
             case when a.admission_decision='approved' then 'Admission approved' when a.admission_decision='rejected' then 'Admission decision recorded' else 'Application under review' end,
             coalesce(a.admission_note,a.admission_decision,'Under review'),coalesce(a.reviewed_at,a.paid_at,a.submitted_at,a.created_at)
      from applications a where a.user_id=uid and a.admission_decision is not null
      union all
      select s.id::text,'assessment','Assessment submitted',coalesce(s.assignment_id::text,s.id::text),s.submitted_at
      from submissions s join applications a on a.id=s.application_id where a.user_id=uid and s.submitted_at is not null
      union all
      select at.id::text,'exam','Exam submitted','Exam assessment',at.submitted_at
      from assessment_attempts at where at.user_id=uid and at.status='submitted' and at.submitted_at is not null
    ) x where x.at is not null
  ),'[]'::jsonb)
 ) into res;
 return res;
end $$;
revoke all on function portal_phase5_data() from public,anon;
grant execute on function portal_phase5_data() to authenticated;

create or replace function admin_action_center() returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare res jsonb;
begin
 if not is_admin() then raise exception 'Administrator access required'; end if;
 select jsonb_build_object(
  'applications_review', (select count(*) from applications where status in ('paid','submitted') and coalesce(admission_decision,'pending')='pending'),
  'payments_review', (select count(*) from applications where payment_claimed_at is not null and payment_review='pending'),
  'deferments_review', (select count(*) from deferments where status='pending'),
  'inactive_tutors', (select count(*) from lecturers where is_active=false),
  'students', (select count(distinct user_id) from applications where admission_decision='approved'),
  'active_courses', (select count(*) from courses where is_active=true),
  'failed_sync', (select count(*) from sheet_outbox where done=false and attempts>=8),
  'unread_notifications', (select count(*) from student_notifications where read_at is null)
 ) into res;
 return res;
end $$;
revoke all on function admin_action_center() from public,anon;
grant execute on function admin_action_center() to authenticated;

comment on table student_notifications is 'Phase 5 in-app student notifications; authoritative messages are server-created.';
comment on table student_documents is 'Phase 5 student document center records.';
comment on function portal_phase5_data() is 'Phase 5 student lifecycle timeline, documents and notifications.';
