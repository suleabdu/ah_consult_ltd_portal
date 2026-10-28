-- V18.6: additive and security-conscious. Apply after 033, only after staging backup.
-- Age is enforced in the FINALIZER (the browser/API cannot bypass it).
-- A student number previously assigned to a paid record is not recycled.

-- Create an indexed immutable document-to-payment relationship and recovery endpoint.
create or replace function public.student_repair_verified_receipts(p_application uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
 if auth.uid() is null or not exists(select 1 from public.applications where id=p_application and user_id=auth.uid()) then
   raise exception 'Application access denied';
 end if;
 insert into public.student_documents(user_id,application_id,title,document_type,status,document_key,issued_at,metadata)
 select a.user_id,a.id,'Payment Receipt','payment_receipt','pending','payment_receipt:'||p.id::text,null,
 jsonb_build_object('payment_reference',p.reference,'payment_id',p.id,'source','applicant_verification_reconciliation','verified_at',p.verified_at)
 from public.payments p join public.applications a on a.id=p.application_id
 where a.id=p_application and p.verified_at is not null and p.expected_ngn>0 and p.paid_ngn>=p.expected_ngn
 on conflict(user_id,document_key) where document_key is not null do nothing;
 get diagnostics n=row_count;
 return n;
end $$;
revoke all on function public.student_repair_verified_receipts(uuid) from public,anon;
grant execute on function public.student_repair_verified_receipts(uuid) to authenticated;

-- A reusable library of published stationery assets. 'Archive' hides an item, never erases historical bytes.
create table if not exists public.institution_letterhead_versions(
 id uuid primary key default gen_random_uuid(),
 revision integer not null unique,
 file_path text not null unique,
 image_mime text not null check(image_mime in ('image/png','image/jpeg')),
 uploaded_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 retired_at timestamptz,
 retired_by uuid references auth.users(id)
);
alter table public.institution_letterhead_versions enable row level security;
revoke all on public.institution_letterhead_versions from public,anon,authenticated;
insert into public.institution_letterhead_versions(revision,file_path,image_mime)
 select revision,file_path,image_mime from public.institution_document_branding
 where file_path is not null and revision>0
on conflict do nothing;

-- Admin receipt register: verified payment-linked documents only.
create or replace function public.admin_verified_receipt_register(p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not public.has_role('administrator','finance') then raise exception 'Finance or administrator required'; end if;
 return coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc) from (
  select d.id,d.application_id,d.user_id,d.document_key,d.status,d.issued_at,d.created_at,
    d.metadata->>'payment_reference' as payment_reference,
    (d.metadata ? 'pdf_path') as archived,
    a.student_id,coalesce(pr.full_name,'Applicant') as applicant,
    p.paid_ngn as amount_ngn,p.verified_at
  from public.student_documents d
  join public.payments p on p.id::text=d.metadata->>'payment_id'
  left join public.applications a on a.id=d.application_id
  left join public.profiles pr on pr.id=d.user_id
  where d.document_type='payment_receipt' and d.document_key like 'payment_receipt:%'
    and p.verified_at is not null and p.paid_ngn>=p.expected_ngn and p.expected_ngn>0
  order by d.created_at desc limit least(300,greatest(1,coalesce(p_limit,100)))
 ) t),'[]'::jsonb);
end $$;
revoke all on function public.admin_verified_receipt_register(integer) from public,anon;
grant execute on function public.admin_verified_receipt_register(integer) to authenticated;

-- Reissue means deliver the SAME legally archived bytes, NOT silently rewriting the original.
create or replace function public.admin_record_receipt_redelivery(p_document uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.student_documents%rowtype;
begin
 if auth.uid() is null or not public.has_role('administrator','finance') then raise exception 'Finance or administrator required'; end if;
 if length(trim(coalesce(p_reason,'')))<8 or length(p_reason)>500 then raise exception 'Provide a reason of 8–500 characters'; end if;
 select * into d from public.student_documents where id=p_document and document_type='payment_receipt';
 if not found or d.status<>'available' or not d.metadata ? 'pdf_path' or not d.metadata ? 'sha256' then
  raise exception 'The original receipt is not archived. Process pending receipts first.';
 end if;
 insert into public.audit_log(actor,action,target,note)
 values(auth.uid(),'receipt_reissued_certified_copy',p_document::text,trim(p_reason));
 return jsonb_build_object('document_id',d.id,'mode','same_original_archived_pdf');
end $$;
revoke all on function public.admin_record_receipt_redelivery(uuid,text) from public,anon;
grant execute on function public.admin_record_receipt_redelivery(uuid,text) to authenticated;

-- Historic student IDs are referenced in payments, audit entries, documents and exports.
-- This facility refuses to recycle those identifiers, while allowing a clean EMPTY
-- and NEVER-ISSUED staging intake counter to be set back to zero.
create or replace function public.admin_reset_unused_intake_counter(p_intake uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare used_count integer;
begin
 if auth.uid() is null or not public.has_role('administrator') then raise exception 'Administrator required'; end if;
 if length(trim(coalesce(p_reason,'')))<12 then raise exception 'Reason must be at least 12 characters'; end if;
 if not exists(select 1 from public.intakes where id=p_intake) then raise exception 'Intake not found'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_intake::text,1824));
 select (select count(*) from public.applications where intake_id=p_intake)
       +(select count(*) from public.student_id_reservations where intake_id=p_intake)
       +(select count(*) from public.payments p join public.applications a on a.id=p.application_id where a.intake_id=p_intake)
 into used_count;
 if used_count>0 then raise exception 'Reset blocked: existing applications, historic ID reservations or payments must retain their identifiers. Do not recycle issued student IDs.'; end if;
 update public.intake_counters set last_serial=0 where intake_id=p_intake;
 insert into public.audit_log(actor,action,target,note) values(auth.uid(),'unused_intake_counter_reset',p_intake::text,left(trim(p_reason),500));
 return jsonb_build_object('ok',true,'last_serial',0,'note','Only an unused intake counter was reset. Historical identifiers are not recycled.');
end $$;
revoke all on function public.admin_reset_unused_intake_counter(uuid,text) from public,anon;
grant execute on function public.admin_reset_unused_intake_counter(uuid,text) to authenticated;

-- Retention-aware housekeeping: purge ONLY orphaned state events for deleted, nonfinancial
-- applications; keep erasure register and financial/audit trails (never delete audit history).
create or replace function public.admin_clean_orphan_application_state(p_reason text)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
 if auth.uid() is null or not public.has_role('administrator') then raise exception 'Administrator required'; end if;
 if length(trim(coalesce(p_reason,'')))<12 then raise exception 'Reason must be at least 12 characters'; end if;
 -- Current schema enforces ON DELETE CASCADE and normally leaves no orphan events.
 -- This safe operation is intentionally a no-op when all FKs are healthy.
 delete from public.application_state_history h
 where not exists(select 1 from public.applications a where a.id=h.application_id)
 and not exists(select 1 from public.payments p where p.application_id=h.application_id)
 and not exists(select 1 from public.application_erasure_register e where e.application_id=h.application_id and (e.detached_payments>0 or e.amount_paid_ngn>0));
 get diagnostics n=row_count;
 insert into public.audit_log(actor,action,target,note)
 values(auth.uid(),'safe_orphan_state_cleanup','application_state_history',left(trim(p_reason),500)||' | rows='||n);
 return n;
end $$;
revoke all on function public.admin_clean_orphan_application_state(text) from public,anon;
grant execute on function public.admin_clean_orphan_application_state(text) to authenticated;

-- Strict date parsing: invalid leap dates, future dates, and applicants under 16 reject.
create or replace function public.eligible_applicant_dob(p_dob text) returns boolean
language plpgsql stable set search_path=public,pg_temp as $$
declare parsed date;
begin
 if coalesce(p_dob,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
 begin
  parsed:=make_date(substring(p_dob,1,4)::integer,substring(p_dob,6,2)::integer,substring(p_dob,9,2)::integer);
 exception when others then return false; end;
 return parsed <= (current_date - interval '16 years')::date;
end $$;
revoke all on function public.eligible_applicant_dob(text) from public,anon;
grant execute on function public.eligible_applicant_dob(text) to authenticated,service_role;

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
 if not public.eligible_applicant_dob(p_form->>'dob') then raise exception 'Applicants must be at least 16 years old'; end if;
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


-- Non-financial administrative tombstones may be pruned only where the associated
-- application and any financial / document evidence are already absent.
-- Permanent audit_log records are deliberately preserved.
create or replace function public.admin_prune_nonfinancial_erasure_register(p_reason text)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
 if auth.uid() is null or not public.has_role('administrator') then raise exception 'Administrator required'; end if;
 if length(trim(coalesce(p_reason,'')))<12 then raise exception 'Reason must be at least 12 characters'; end if;
 delete from public.application_erasure_register e
 where e.detached_payments=0 and e.amount_paid_ngn=0
 and not exists(select 1 from public.applications a where a.id=e.application_id)
 and not exists(select 1 from public.payments p where p.application_id=e.application_id)
 and not exists(select 1 from public.student_documents d where d.application_id=e.application_id);
 get diagnostics n=row_count;
 insert into public.audit_log(actor,action,target,note)
 values(auth.uid(),'nonfinancial_erasure_register_pruned','application_erasure_register',left(trim(p_reason),500)||' | rows='||n);
 return n;
end $$;
revoke all on function public.admin_prune_nonfinancial_erasure_register(text) from public,anon;
grant execute on function public.admin_prune_nonfinancial_erasure_register(text) to authenticated;

-- Also enforce the age rule for correction RPCs and any direct application updates.
-- Draft applications may omit DOB; provided DOB values must be valid, and final
-- submission always re-checks this condition in finalize_paid_application.
create or replace function public.reject_ineligible_applicant_dob()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.form_data ? 'dob' and not public.eligible_applicant_dob(new.form_data->>'dob') then
  raise exception 'Applicant must be at least 16 years old with a valid date of birth';
 end if;
 return new;
end $$;
drop trigger if exists v18_6_minimum_applicant_age on public.applications;
create trigger v18_6_minimum_applicant_age before insert or update of form_data on public.applications
for each row execute function public.reject_ineligible_applicant_dob();
