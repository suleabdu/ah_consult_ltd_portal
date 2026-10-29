-- V18.6.2 | Document Designer: non-destructive removal of superseded versions.
-- Additive migration; do not rewrite any previously applied migrations (001-034).
-- Current published templates, stored PDF bytes, and immutable audit records are protected.

alter table public.document_template_versions
 add column if not exists retired_at timestamptz,
 add column if not exists retired_by uuid references auth.users(id),
 add column if not exists retirement_reason text;

create index if not exists document_template_versions_visible_idx
 on public.document_template_versions (template_key, version desc) where retired_at is null;

-- No client reads document_templates directly; only role-checked RPCs can manage them.
-- A deleted draft is never a published template and does not impact issued documents.
create or replace function public.admin_delete_document_template_draft(p_key text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare deleted_count integer;
begin
 if auth.uid() is null or not public.has_role('administrator') then
  raise exception using errcode='42501',message='Administrator required';
 end if;
 if p_key not in ('admission_letter','deferment_letter','payment_receipt','academic_transcript','result_statement','certificate') then
  raise exception using errcode='22023',message='Unsupported document type';
 end if;
 delete from public.document_template_drafts where template_key=p_key;
 get diagnostics deleted_count=row_count;
 if deleted_count=0 then
  raise exception using errcode='P0002',message='No saved draft exists for this document type';
 end if;
 insert into public.audit_log(actor,action,target,note)
 values(auth.uid(),'document_draft_deleted',p_key,'Administrator removed unpublished draft');
 return true;
end $$;
revoke all on function public.admin_delete_document_template_draft(text) from public,anon,authenticated;
grant execute on function public.admin_delete_document_template_draft(text) to authenticated;

-- "Delete revision" hides a superseded template from the designer. The row remains
-- for compliance and older issued records. In particular, do not cascade from
-- document_templates (which would corrupt document_jobs and version provenance).
create or replace function public.admin_retire_document_template_revision
 (p_key text,p_version integer,p_reason text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.document_templates%rowtype; v public.document_template_versions%rowtype;
begin
 if auth.uid() is null or not public.has_role('administrator') then
  raise exception using errcode='42501',message='Administrator required';
 end if;
 if p_key not in ('admission_letter','deferment_letter','payment_receipt','academic_transcript','result_statement','certificate')
  or p_version is null or p_version<1 then
  raise exception using errcode='22023',message='Invalid template or revision';
 end if;
 if length(trim(coalesce(p_reason,'')))<10 or length(trim(p_reason))>500 then
  raise exception using errcode='22023',message='Provide a deletion reason of 10 to 500 characters';
 end if;
 -- Serialize retirement and publication on the canonical template row.
 select * into t from public.document_templates where key=p_key for update;
 if not found then raise exception using errcode='P0002',message='Template does not exist'; end if;
 if t.version=p_version then
  raise exception using errcode='23514',message='Current published template cannot be deleted. Publish a replacement revision first.';
 end if;
 select * into v from public.document_template_versions
  where template_key=p_key and version=p_version and retired_at is null for update;
 if not found then raise exception using errcode='P0002',message='Revision not found or already deleted'; end if;
 update public.document_template_versions
  set retired_at=now(),retired_by=auth.uid(),retirement_reason=trim(p_reason)
  where id=v.id;
 insert into public.audit_log(actor,action,target,note)
 values(auth.uid(),'document_revision_deleted',p_key,
  'Revision '||p_version||' removed from designer; archived provenance preserved. Reason: '||left(trim(p_reason),500));
 return true;
end $$;
revoke all on function public.admin_retire_document_template_revision(text,integer,text) from public,anon,authenticated;
grant execute on function public.admin_retire_document_template_revision(text,integer,text) to authenticated;

-- Expose only non-deleted revisions in the editor, including an explicit current flag.
create or replace function public.admin_list_document_template_versions(p_key text)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare output jsonb;
begin
 if auth.uid() is null or not public.has_role('administrator') then
  raise exception using errcode='42501',message='Administrator required';
 end if;
 if p_key not in ('admission_letter','deferment_letter','payment_receipt','academic_transcript','result_statement','certificate') then
  raise exception using errcode='22023',message='Unsupported document type';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('version',x.version,'date',x.created_at,
  'restorable',x.snapshot_complete,'current',x.version=t.version) order by x.version desc),'[]'::jsonb)
 into output
 from public.document_templates t
 left join lateral (select version,created_at,snapshot_complete from public.document_template_versions
   where template_key=t.key and retired_at is null order by version desc limit 25) x on true
 where t.key=p_key and x.version is not null;
 return coalesce(output,'[]'::jsonb);
end $$;
revoke all on function public.admin_list_document_template_versions(text) from public,anon,authenticated;
grant execute on function public.admin_list_document_template_versions(text) to authenticated;

-- A deleted template revision may not be restored through the former RPC bypass.
create or replace function public.admin_restore_document_version_as_draft(p_key text,p_version integer)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.document_template_versions%rowtype;
begin
 if auth.uid() is null or not public.has_role('administrator') then
  raise exception using errcode='42501',message='Administrator required';
 end if;
 select * into v from public.document_template_versions
 where template_key=p_key and version=p_version and snapshot_complete=true and retired_at is null;
 if not found then
  raise exception using errcode='P0002',message='Revision has been deleted or does not have a verified content snapshot';
 end if;
 perform public.admin_save_document_template_draft(p_key,v.body_text,v.signatory_name,v.signatory_title,v.footer_text);
 insert into public.audit_log(actor,action,target,note)
 values(auth.uid(),'document_revision_restored_as_draft',p_key,'Revision '||p_version||' copied to draft');
end $$;
revoke all on function public.admin_restore_document_version_as_draft(text,integer) from public,anon,authenticated;
grant execute on function public.admin_restore_document_version_as_draft(text,integer) to authenticated;
