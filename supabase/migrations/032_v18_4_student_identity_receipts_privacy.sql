-- V18.4: atomic student assignment, receipt issuance, and staff-record safeguards.
-- IMPORTANT: never recycle a previously issued institutional student number.
create table if not exists public.student_id_reservations (
 student_id text primary key,
 intake_id uuid not null references public.intakes(id),
 application_id uuid unique,
 assigned_at timestamptz not null default now()
);
revoke all on public.student_id_reservations from public,anon,authenticated;
-- Reserve existing IDs before allocating new numbers; deleted IDs cannot be recovered
-- unless they were previously recorded in audit/archival sources.
insert into public.student_id_reservations(student_id,intake_id,application_id)
 select student_id,intake_id,id from public.applications where student_id is not null
on conflict (student_id) do nothing;

create or replace function public.finalize_paid_application(p_app uuid,p_form jsonb,p_passport text)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.applications%rowtype; i public.intakes%rowtype; n integer; prefix text; sid text; prev integer;
begin
 select * into a from public.applications where id=p_app for update;
 if not found then raise exception 'Application not found'; end if;
 if a.student_id is not null then return a.student_id; end if;
 if a.status not in('paid','submitted') then raise exception 'Verified payment required'; end if;
 if not exists(select 1 from public.payments p where p.application_id=a.id and p.verified_at is not null and p.paid_ngn>=p.expected_ngn and p.expected_ngn>0) then
  raise exception 'A verified settled transaction is required'; end if;
 if p_passport is null or p_passport not like a.user_id::text || '/' || a.id::text || '/%' then raise exception 'Invalid passport location'; end if;
 if nullif(trim(coalesce(p_form->>'firstName','')),'') is null or nullif(trim(coalesce(p_form->>'surname','')),'') is null then raise exception 'Applicant name required'; end if;
 if exists(select 1 from public.staff s where s.id=a.user_id) then raise exception 'Staff accounts cannot obtain student IDs'; end if;
 select * into i from public.intakes where id=a.intake_id;
 if not found then raise exception 'Intake unavailable'; end if;
 prefix:='AHCT'||lpad((i.year % 100)::text,2,'0')||i.month::text;
 -- Serialize student-number allocation per intake even across simultaneous transactions.
 perform pg_advisory_xact_lock(hashtextextended(a.intake_id::text,1824));
 insert into public.intake_counters(intake_id,last_serial) values(a.intake_id,0) on conflict do nothing;
 select greatest(coalesce(max(substring(s.student_id from length(prefix)+1)::integer),0),0) into prev
 from public.student_id_reservations s where s.intake_id=a.intake_id and s.student_id like prefix || '%'
  and substring(s.student_id from length(prefix)+1) ~ '^[0-9]+$';
 select greatest(coalesce(last_serial,0),coalesce(prev,0)) into n from public.intake_counters where intake_id=a.intake_id for update;
 loop
  n:=n+1; sid:=prefix||lpad(n::text,4,'0');
  exit when not exists(select 1 from public.applications where student_id=sid)
    and not exists(select 1 from public.student_id_reservations where student_id=sid);
 end loop;
 insert into public.student_id_reservations(student_id,intake_id,application_id) values(sid,a.intake_id,a.id);
 update public.applications set status='submitted',form_data=p_form,passport_path=p_passport,student_id=sid,submitted_at=coalesce(submitted_at,now()) where id=a.id;
 update public.intake_counters set last_serial=n where intake_id=a.intake_id;
 return sid;
end $$;
revoke all on function public.finalize_paid_application(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.finalize_paid_application(uuid,jsonb,text) to service_role;

-- Backfill verified receipts and retain an automatic, idempotent trigger.
insert into public.student_documents(user_id,application_id,title,document_type,status,document_key,issued_at,metadata)
select a.user_id,a.id,'Payment Receipt','payment_receipt','available','payment_receipt',p.verified_at,
 jsonb_build_object('payment_reference',p.reference,'payment_id',p.id,'source','v18_4_backfill')
from public.payments p join public.applications a on a.id=p.application_id
where p.verified_at is not null and p.expected_ngn>0 and p.paid_ngn>=p.expected_ngn
on conflict(user_id,document_key) where document_key is not null do update
set application_id=excluded.application_id,status='available',issued_at=excluded.issued_at,
metadata=case when public.student_documents.metadata ? 'pdf_path' then public.student_documents.metadata else excluded.metadata end;
-- Do not allow student admission views to treat staff as applicants.
create index if not exists staff_id_admin_filter_idx on public.staff(id);

-- Receipt read-through repair for verified legacy payments.
create or replace function public.student_document_snapshot(p_application uuid,p_key text)
returns jsonb language plpgsql security definer volatile set search_path=public,pg_temp as $$
declare a public.applications%rowtype; d public.student_documents%rowtype;
 grades jsonb; pay jsonb; fullname text; intake_name text; course_names text; k text;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select * into a from public.applications where id=p_application and user_id=auth.uid();
 if not found then raise exception 'Application is not linked to this account'; end if;
 k:=case when p_key='result' then 'result_statement' else p_key end;
 if k not in('admission_letter','deferment_letter','payment_receipt','academic_transcript','result_statement') then raise exception 'Unknown document type'; end if;
 if k in('academic_transcript','result_statement','deferment_letter') and not public.student_portal_access() then
   raise exception 'Academic and enrolment documents are available only in the student portal after transition';
 end if;
 if k in('admission_letter','academic_transcript','result_statement') and a.admission_decision<>'approved' then
   raise exception 'Current admission approval required'; end if;
 select * into d from public.student_documents where application_id=a.id and user_id=auth.uid()
 and document_key=k and status='available' limit 1;
 if k='payment_receipt' and d.id is null and exists(select 1 from public.payments pp where pp.application_id=a.id and pp.verified_at is not null and pp.paid_ngn>=pp.expected_ngn and pp.expected_ngn>0) then
   insert into public.student_documents(user_id,application_id,title,document_type,status,document_key,issued_at,metadata)
   values(a.user_id,a.id,'Payment Receipt','payment_receipt','available','payment_receipt',now(),jsonb_build_object('source','verified_payment_repair'))
   on conflict(user_id,document_key) where document_key is not null do update
   set application_id=excluded.application_id,status='available',issued_at=excluded.issued_at
   returning * into d;
 end if;
 if k not in('result_statement','deferment_letter','academic_transcript') and d.id is null then raise exception 'Document has not been issued yet'; end if;
 if k='deferment_letter' and not exists(select 1 from public.deferments where application_id=a.id and status='approved') then raise exception 'No approved deferment is recorded'; end if;
 select p.full_name into fullname from public.profiles p where p.id=a.user_id;
 select i.label into intake_name from public.intakes i where i.id=a.intake_id;
 select string_agg(c.name,', ' order by c.name) into course_names from public.application_courses ac join public.courses c on c.code=ac.course_code where ac.application_id=a.id;
 select coalesce(jsonb_agg(jsonb_build_object('course',c.name,'code',r.course_code,'total',r.total,'grade',r.band) order by c.name),'[]'::jsonb) into grades
 from public.exam_results r join public.courses c on c.code=r.course_code
 where r.application_id=a.id and r.published_at is not null and r.grading_model<>'needs_review';
 select to_jsonb(z) into pay from (select reference,paid_ngn,verified_at from public.payments
  where application_id=a.id and verified_at is not null and paid_ngn>0 order by verified_at desc limit 1) z;
 return jsonb_build_object('document_id',d.id,'key',k,'reference',coalesce(a.student_id,a.pay_reference,a.id::text),
 'name',fullname,'intake',intake_name,'courses',course_names,'decision',a.admission_decision,
 'admission_date',a.reviewed_at,'grades',grades,'payment',pay);
end $$;
revoke all on function public.student_document_snapshot(uuid,text) from public,anon;
grant execute on function public.student_document_snapshot(uuid,text) to authenticated;

-- A staff-only identity filter for admin dashboards; no public access.
create or replace function public.admin_staff_identity_ids() returns uuid[]
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.staff where id=auth.uid() and status='approved') then
   raise exception 'Authorized staff required';
 end if;
 return coalesce((select array_agg(id) from public.staff),array[]::uuid[]);
end $$;
revoke all on function public.admin_staff_identity_ids() from public,anon;
grant execute on function public.admin_staff_identity_ids() to authenticated;

-- Prevent new staff identities being inserted as applicants, even through alternate API paths.
create or replace function public.reject_staff_application() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.staff s where s.id=new.user_id) then
   raise exception 'Staff accounts are not applicant accounts';
 end if;
 return new;
end $$;
drop trigger if exists v18_4_no_staff_applications on public.applications;
create trigger v18_4_no_staff_applications before insert or update of user_id on public.applications
 for each row execute function public.reject_staff_application();

-- Public counts explicitly exclude staff identities. This view exposes only aggregates.
create or replace view public.public_website_aggregates as
select
 (select nullif(count(distinct a.user_id)::integer,0) from public.applications a
  where a.admission_decision='approved' and a.paid_at is not null
    and a.status in('paid','submitted','under_review','approved')
    and not exists(select 1 from public.staff s where s.id=a.user_id)) as learners_enrolled,
 (select nullif(count(distinct j.user_id)::integer,0) from public.document_jobs j
  where j.document_key='certificate' and j.status='issued'
   and not exists(select 1 from public.staff s where s.id=j.user_id)) as graduates,
 (select nullif(count(distinct c.name)::integer,0) from public.courses c where c.is_active) as programmes,
 (select nullif(count(*)::integer,0) from public.courses c where c.is_active) as active_course_options,
 (select nullif(count(*)::integer,0) from public.intakes i where i.is_active and (i.closes_at is null or i.closes_at>=now())) as active_intakes;
revoke all on public.public_website_aggregates from public;
grant select on public.public_website_aggregates to anon,authenticated;
