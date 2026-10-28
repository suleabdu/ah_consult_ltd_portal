-- AH Student Hub V18: restricted deletion and document eligibility
-- Apply after 001..028 on a BACKED UP STAGING database; do not skip prerequisite migrations.
-- No existing submitted/paid/student records are deleted by this migration.

-- Administrative archive: remove a record from active work queues without deleting its ledger.
alter table public.applications
  add column if not exists admin_archived_at timestamptz,
  add column if not exists admin_archived_by uuid,
  add column if not exists admin_archive_reason text;

create or replace function public.admin_archive_application(p_application uuid, p_reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.applications%rowtype; who text;
begin
 if auth.uid() is null or not public.has_role('administrator') then raise exception 'Administrator access required'; end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Explain why you are archiving this application (at least five characters)'; end if;
 select * into a from public.applications where id=p_application for update;
 if not found then raise exception 'Application not found'; end if;
 if a.admin_archived_at is not null then return; end if;
 update public.applications set admin_archived_at=now(),admin_archived_by=auth.uid(),admin_archive_reason=left(trim(p_reason),800) where id=p_application;
 select full_name into who from public.staff where id=auth.uid();
 insert into public.audit_log(actor,actor_name,action,target,note)
 values(auth.uid(),coalesce(who,'Administrator'),'application_archived',coalesce(a.student_id,a.id::text),left(trim(p_reason),800));
end $$;
revoke all on function public.admin_archive_application(uuid,text) from public,anon;
grant execute on function public.admin_archive_application(uuid,text) to authenticated;

create or replace function public.admin_restore_application(p_application uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.applications%rowtype; who text;
begin
 if auth.uid() is null or not public.has_role('administrator') then raise exception 'Administrator access required'; end if;
 select * into a from public.applications where id=p_application for update;
 if not found then raise exception 'Application not found'; end if;
 if a.admin_archived_at is null then return; end if;
 update public.applications set admin_archived_at=null,admin_archived_by=null,admin_archive_reason=null where id=p_application;
 select full_name into who from public.staff where id=auth.uid();
 insert into public.audit_log(actor,actor_name,action,target,note)
 values(auth.uid(),coalesce(who,'Administrator'),'application_restored',coalesce(a.student_id,a.id::text),'Restored from administrative archive');
end $$;
revoke all on function public.admin_restore_application(uuid) from public,anon;
grant execute on function public.admin_restore_application(uuid) to authenticated;

create or replace function public.admin_delete_unpaid_draft(
 p_application uuid, p_confirm text, p_reason text
) returns jsonb language plpgsql security definer set search_path=public, pg_temp as $$
declare a public.applications%rowtype; expected text; actor_name text;
begin
 if auth.uid() is null or not public.has_role('administrator') then
   raise exception using errcode='42501',message='Only an approved administrator may remove a draft.';
 end if;
 if p_application is null or length(trim(coalesce(p_reason,''))) < 5 then
   raise exception using errcode='22023',message='Provide a record and a reason of at least five characters.';
 end if;
 select * into a from public.applications where id=p_application for update;
 if not found then raise exception using errcode='P0002',message='Application not found.'; end if;
 expected := coalesce(nullif(a.student_id,''),nullif(a.pay_reference,''),upper(left(a.id::text,8)));
 if upper(trim(coalesce(p_confirm,''))) <> upper(expected) then
   raise exception using errcode='22023',message='Confirmation does not match the record reference.';
 end if;
 -- Never erase a paid/submitted/approved record or any record linked to finance / documents.
 if a.status not in ('draft','pending_payment','expired')
    or a.paid_at is not null or a.submitted_at is not null or a.payment_claimed_at is not null
    or coalesce(a.admission_decision,'pending') <> 'pending'
    or exists(select 1 from public.payments where application_id=a.id)
    or exists(select 1 from public.document_jobs where application_id=a.id)
    or exists(select 1 from public.student_documents where application_id=a.id) then
   raise exception using errcode='23514',message='This record has payment, admission or document history. Retain it and use an administrative status action instead.';
 end if;
 -- All DB operations below occur in one PostgreSQL transaction. Any FK failure rolls everything back.
 delete from public.sheet_outbox where application_id=a.id and done=false;
 delete from public.applications where id=a.id;
 insert into public.sheet_outbox(application_id,kind) values(a.id,'delete_app');
 select full_name into actor_name from public.staff where id=auth.uid();
 insert into public.audit_log(actor,actor_name,action,target,note)
 values(auth.uid(),coalesce(actor_name,'Administrator'),'application_deleted',expected,left(trim(p_reason),800));
 return jsonb_build_object('ok',true,'reference',expected,'passport_path',a.passport_path,'user_id',a.user_id);
end $$;
revoke all on function public.admin_delete_unpaid_draft(uuid,text,text) from public,anon,authenticated;
grant execute on function public.admin_delete_unpaid_draft(uuid,text,text) to authenticated,service_role;

-- Official document job creation is gated server-side, not by hidden UI controls.
-- Certificates are withheld until a formal completion/award check can be proved.
create or replace function public.request_document_job(p_application uuid,p_document_key text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); a public.applications; t public.document_templates; job_id uuid;
begin
 if uid is null or not public.has_role('administrator','registrar','finance','academic') then
  raise exception 'Authorized staff account required';
 end if;
 select * into a from public.applications where id=p_application;
 if not found then raise exception 'Application not found'; end if;
 select * into t from public.document_templates where key=p_document_key and active=true;
 if not found then raise exception 'Document template unavailable'; end if;
 if p_document_key='admission_letter' and coalesce(a.admission_decision,'')<>'approved' then
  raise exception 'Admission letter requires approved admission';
 elsif p_document_key='payment_receipt' and not exists (
  select 1 from public.payments p where p.application_id=a.id
  and coalesce(p.paid_ngn,0)>0 and p.verified_at is not null
 ) then
  raise exception 'A verified payment is required for a payment receipt';
 elsif p_document_key='academic_transcript' and not exists (
  select 1 from public.exam_results r where r.application_id=a.id and r.published_at is not null
 ) then
  raise exception 'Only published results may appear on an academic transcript';
 elsif p_document_key='certificate' then
  raise exception 'Certificate issuance is on hold until authorized award/completion verification is implemented';
 end if;
 insert into public.document_jobs(user_id,application_id,document_key,template_version,requested_by,metadata)
 values(a.user_id,a.id,t.key,t.version,uid,jsonb_build_object('student_id',a.student_id,'template',t.key,'preview_only',true))
 returning id into job_id;
 insert into public.audit_log(actor,action,target,note)
 values(uid,'document_preview_requested',coalesce(a.student_id,a.id::text),t.key);
 return job_id;
end $$;
revoke all on function public.request_document_job(uuid,text) from public,anon;
grant execute on function public.request_document_job(uuid,text) to authenticated;
