-- V18.5 | Additive upgrade, apply AFTER 032 on a backed-up staging copy.
-- Maintain historical migrations and the existing user/document_key uniqueness contract.
-- Transaction receipts use payment_receipt:<payment UUID> as an instance key; this
-- permits multiple receipts without breaking legacy upserts for other document types.

alter table public.institution_document_branding
 add column if not exists top_safe_mm numeric(5,1) not null default 85.0,
 add column if not exists bottom_safe_mm numeric(5,1) not null default 20.0;

alter table public.institution_document_branding
 drop constraint if exists document_branding_safe_margins;
alter table public.institution_document_branding
 add constraint document_branding_safe_margins check (top_safe_mm between 25 and 120 and bottom_safe_mm between 12 and 60 and top_safe_mm+bottom_safe_mm<240);

-- Version content, not just a number and a header string. Old rows may represent
-- historical layouts not recoverable from the old schema: do not claim they do.
alter table public.document_template_versions
 add column if not exists body_text text,
 add column if not exists signatory_name text,
 add column if not exists signatory_title text,
 add column if not exists footer_text text,
 add column if not exists snapshot_complete boolean not null default false;

-- Snapshot only the CURRENT version's latest text if no complete snapshot exists.
insert into public.document_template_versions
 (template_key,version,title,document_type,template_html,body_text,signatory_name,signatory_title,footer_text,snapshot_complete)
select t.key,t.version,t.title,t.document_type,t.template_html,t.body_text,t.signatory_name,t.signatory_title,t.footer_text,true
from public.document_templates t
on conflict(template_key,version) do update set
 body_text=excluded.body_text,signatory_name=excluded.signatory_name,
 signatory_title=excluded.signatory_title,footer_text=excluded.footer_text,
 snapshot_complete=true
where public.document_template_versions.snapshot_complete=false;

create or replace function public.admin_update_document_template
(p_key text,p_letterhead text,p_body text,p_signatory text,p_title text,p_footer text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.document_templates%rowtype;
begin
 if auth.uid() is null or not public.has_role('administrator') then raise exception 'Administrator required'; end if;
 if p_key not in ('admission_letter','payment_receipt','academic_transcript','certificate','deferment_letter','result_statement') then raise exception 'Unsupported template'; end if;
 if length(coalesce(p_body,''))>6000 or length(coalesce(p_letterhead,''))>250 or length(coalesce(p_footer,''))>500 or
    length(coalesce(p_signatory,''))>150 or length(coalesce(p_title,''))>150 then raise exception 'Template text too long'; end if;
 if regexp_replace(coalesce(p_body,'')||coalesce(p_footer,''), '\{\{[[:space:]]*(student_name|student_id|intake|programme|payment_reference|payment_amount|issue_date|document_reference)[[:space:]]*\}\}', '', 'gi') ~ '\{\{[^}]*\}\}' then
   raise exception 'An unknown dynamic field was used in the template'; end if;
 update public.document_templates set letterhead=left(trim(coalesce(p_letterhead,'')),250),body_text=trim(coalesce(p_body,'')),
 signatory_name=trim(coalesce(p_signatory,'')),signatory_title=trim(coalesce(p_title,'')),footer_text=trim(coalesce(p_footer,'')),
 version=version+1,updated_at=now() where key=p_key returning * into t;
 if not found then raise exception 'Template not found'; end if;
 insert into public.document_template_versions
 (template_key,version,title,document_type,template_html,created_by,body_text,signatory_name,signatory_title,footer_text,snapshot_complete)
 values(t.key,t.version,t.title,t.document_type,t.template_html,auth.uid(),t.body_text,t.signatory_name,t.signatory_title,t.footer_text,true);
 insert into public.audit_log(actor,action,target,note)
 values(auth.uid(),'document_template_updated',p_key,'Published template revision '||t.version);
end $$;
revoke all on function public.admin_update_document_template(text,text,text,text,text,text) from public,anon;
grant execute on function public.admin_update_document_template(text,text,text,text,text,text) to authenticated;

-- A receipt is associated with exactly one verified provider payment; the general
-- unique (user_id, document_key) index stays in place for compatibility.
create unique index if not exists student_document_receipt_payment_unique
 on public.student_documents ((metadata->>'payment_id'))
 where document_type='payment_receipt' and document_key like 'payment_receipt:%' and metadata ? 'payment_id';

create or replace function public.auto_verified_receipts() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.applications%rowtype;
begin
 if new.verified_at is null or coalesce(new.expected_ngn,0)<=0 or
    coalesce(new.paid_ngn,0)<new.expected_ngn or new.application_id is null then return new; end if;
 select * into a from public.applications where id=new.application_id;
 if not found then return new; end if;
 insert into public.student_documents(user_id,application_id,title,document_type,status,document_key,issued_at,metadata)
 values(a.user_id,a.id,'Payment Receipt','payment_receipt','pending','payment_receipt:'||new.id::text,null,
        jsonb_build_object('payment_reference',new.reference,'payment_id',new.id,'source','verified_provider','verified_at',new.verified_at))
 -- The unique document key makes retries safe, and previous PDFs remain untouched.
 on conflict(user_id,document_key) where document_key is not null do nothing;
 return new;
end $$;
drop trigger if exists v18_auto_verified_receipts on public.payments;
create trigger v18_auto_verified_receipts after insert or update of verified_at on public.payments
for each row execute function public.auto_verified_receipts();

-- Queue one immutable receipt per verified payment. No copy of the old generic
-- payment_receipt document is removed; any archived legacy bytes remain retained.
insert into public.student_documents(user_id,application_id,title,document_type,status,document_key,issued_at,metadata)
select a.user_id,a.id,'Payment Receipt','payment_receipt','pending','payment_receipt:'||p.id::text,null,
 jsonb_build_object('payment_reference',p.reference,'payment_id',p.id,'source','v18_5_backfill','verified_at',p.verified_at)
from public.payments p join public.applications a on a.id=p.application_id
where p.verified_at is not null and p.expected_ngn>0 and p.paid_ngn>=p.expected_ngn
on conflict(user_id,document_key) where document_key is not null do nothing;

create index if not exists student_docs_pending_receipts on public.student_documents(created_at)
 where document_type='payment_receipt' and status='pending';

-- Prevent a receipt from silently being linked to a different provider payment,
-- or the fingerprint of an already archived document from being substituted.
create or replace function public.guard_canonical_receipt() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if old.document_type='payment_receipt' and old.document_key like 'payment_receipt:%' then
   if new.user_id is distinct from old.user_id or new.document_key is distinct from old.document_key or
      new.document_type is distinct from old.document_type or
      new.metadata->>'payment_id' is distinct from old.metadata->>'payment_id' then
     raise exception 'An official receipt cannot be reassigned to another payment';
   end if;
   if old.metadata ? 'pdf_path' and
       (new.metadata->>'pdf_path' is distinct from old.metadata->>'pdf_path' or
        new.metadata->>'sha256' is distinct from old.metadata->>'sha256' or
        new.issued_at is distinct from old.issued_at or
        new.status not in ('available','replaced')) then
     raise exception 'Archived receipt content is immutable; issue a replacement record';
   end if;
 end if;
 return new;
end $$;
drop trigger if exists official_receipt_integrity on public.student_documents;
create trigger official_receipt_integrity before update on public.student_documents
for each row execute function public.guard_canonical_receipt();

-- Standard student queries remain RLS-controlled, but shared document data is
-- read-only to clients. Only trusted server functions archive/mark issuance.
revoke insert,update,delete on public.student_documents from authenticated,anon;

comment on function public.auto_verified_receipts() is
 'Transaction-specific pending receipts. Worker archives the real PDF before status becomes available.';

-- Old deletion RPC only detaches generic payment_receipt, leaving new per-payment
-- rows subject to the historical ON DELETE CASCADE. Intercept any application
-- delete centrally: require a completed archive, then retain every receipt.
create or replace function public.detach_canonical_receipts_before_app_delete()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.student_documents d where d.application_id=old.id
     and d.document_type='payment_receipt' and d.document_key like 'payment_receipt:%'
     and (d.status='pending' or not(d.metadata ? 'pdf_path') or not(d.metadata ? 'sha256'))) then
   raise exception 'Verified payment receipts must be archived before deleting an application';
 end if;
 update public.student_documents set application_id=null where application_id=old.id
   and document_type='payment_receipt' and document_key like 'payment_receipt:%';
 return old;
end $$;
drop trigger if exists preserve_receipts_on_app_delete on public.applications;
create trigger preserve_receipts_on_app_delete before delete on public.applications
 for each row execute function public.detach_canonical_receipts_before_app_delete();

-- Document Studio: make the authoring state distinct from the approved version.
-- Administrators can preview drafts privately, publish deliberately, and create a
-- NEW revision from a historical snapshot. Previously published rows stay intact.
create table if not exists public.document_template_drafts (
 template_key text primary key references public.document_templates(key) on delete cascade,
 body_text text not null default '',
 signatory_name text not null default '',
 signatory_title text not null default '',
 footer_text text not null default '',
 edited_by uuid references auth.users(id),
 edited_at timestamptz not null default now()
);
alter table public.document_template_drafts enable row level security;
revoke all on public.document_template_drafts from public,anon,authenticated;

create or replace function public.admin_save_document_template_draft
(p_key text,p_body text,p_signatory text,p_title text,p_footer text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not public.has_role('administrator') then raise exception 'Administrator required'; end if;
 if p_key not in('admission_letter','payment_receipt','academic_transcript','certificate','deferment_letter','result_statement') then raise exception 'Unsupported template'; end if;
 if length(coalesce(p_body,''))>6000 or length(coalesce(p_footer,''))>500 or
    length(coalesce(p_signatory,''))>150 or length(coalesce(p_title,''))>150 then raise exception 'Document draft exceeds field limits'; end if;
 if regexp_replace(coalesce(p_body,'')||coalesce(p_footer,''), '\{\{[[:space:]]*(student_name|student_id|intake|programme|payment_reference|payment_amount|issue_date|document_reference)[[:space:]]*\}\}', '', 'gi') ~ '\{\{[^}]*\}\}' then
   raise exception 'An unknown dynamic field was used in the template'; end if;
 insert into public.document_template_drafts(template_key,body_text,signatory_name,signatory_title,footer_text,edited_by,edited_at)
 values(p_key,trim(coalesce(p_body,'')),trim(coalesce(p_signatory,'')),trim(coalesce(p_title,'')),trim(coalesce(p_footer,'')),auth.uid(),now())
 on conflict(template_key) do update set body_text=excluded.body_text,signatory_name=excluded.signatory_name,
 signatory_title=excluded.signatory_title,footer_text=excluded.footer_text,edited_by=excluded.edited_by,edited_at=now();
 insert into public.audit_log(actor,action,target,note) values(auth.uid(),'document_draft_saved',p_key,'Unpublished wording saved');
end $$;
revoke all on function public.admin_save_document_template_draft(text,text,text,text,text) from public,anon;
grant execute on function public.admin_save_document_template_draft(text,text,text,text,text) to authenticated;

create or replace function public.admin_read_document_draft(p_key text)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare t public.document_templates%rowtype; d public.document_template_drafts%rowtype;
begin
 if auth.uid() is null or not public.has_role('administrator') then raise exception 'Administrator required'; end if;
 select * into t from public.document_templates where key=p_key;
 if not found then raise exception 'Template not found'; end if;
 select * into d from public.document_template_drafts where template_key=p_key;
 return jsonb_build_object('key',p_key,'published_version',t.version,'has_draft',found,
  'body_text',case when found then d.body_text else coalesce(t.body_text,'') end,
  'signatory_name',case when found then d.signatory_name else coalesce(t.signatory_name,'') end,
  'signatory_title',case when found then d.signatory_title else coalesce(t.signatory_title,'') end,
  'footer_text',case when found then d.footer_text else coalesce(t.footer_text,'') end,
  'last_edited',case when found then d.edited_at else null end);
end $$;
revoke all on function public.admin_read_document_draft(text) from public,anon;
grant execute on function public.admin_read_document_draft(text) to authenticated;

create or replace function public.admin_publish_document_template_draft(p_key text)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.document_template_drafts%rowtype; v integer; existing_letterhead text;
begin
 if auth.uid() is null or not public.has_role('administrator') then raise exception 'Administrator required'; end if;
 select * into d from public.document_template_drafts where template_key=p_key for update;
 if not found then raise exception 'Save a draft before publishing'; end if;
 select letterhead into existing_letterhead from public.document_templates where key=p_key;
 perform public.admin_update_document_template(p_key,coalesce(existing_letterhead,''),d.body_text,d.signatory_name,d.signatory_title,d.footer_text);
 select version into v from public.document_templates where key=p_key;
 delete from public.document_template_drafts where template_key=p_key;
 insert into public.audit_log(actor,action,target,note) values(auth.uid(),'document_template_published',p_key,'Published revision '||v);
 return v;
end $$;
revoke all on function public.admin_publish_document_template_draft(text) from public,anon;
grant execute on function public.admin_publish_document_template_draft(text) to authenticated;

create or replace function public.admin_list_document_template_versions(p_key text)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare output jsonb;
begin
 if auth.uid() is null or not public.has_role('administrator') then raise exception 'Administrator required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('version',x.version,'date',x.created_at,
  'restorable',x.snapshot_complete) order by x.version desc),'[]'::jsonb) into output
 from (select version,created_at,snapshot_complete from public.document_template_versions
  where template_key=p_key order by version desc limit 25) x;
 return output;
end $$;
revoke all on function public.admin_list_document_template_versions(text) from public,anon;
grant execute on function public.admin_list_document_template_versions(text) to authenticated;

create or replace function public.admin_restore_document_version_as_draft(p_key text,p_version integer)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.document_template_versions%rowtype;
begin
 if auth.uid() is null or not public.has_role('administrator') then raise exception 'Administrator required'; end if;
 select * into v from public.document_template_versions
 where template_key=p_key and version=p_version and snapshot_complete=true;
 if not found then raise exception 'Historical revision has no verified content snapshot'; end if;
 perform public.admin_save_document_template_draft(p_key,v.body_text,v.signatory_name,v.signatory_title,v.footer_text);
 insert into public.audit_log(actor,action,target,note) values(auth.uid(),'document_revision_restored_as_draft',p_key,'Revision '||p_version||' copied to draft');
end $$;
revoke all on function public.admin_restore_document_version_as_draft(text,integer) from public,anon;
grant execute on function public.admin_restore_document_version_as_draft(text,integer) to authenticated;
