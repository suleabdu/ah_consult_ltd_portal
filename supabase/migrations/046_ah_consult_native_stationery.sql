-- V18.9: AH Consult's approved vector-native stationery treatment.
-- This migration deliberately stores a style choice, never an uploaded A4 image.
-- It changes only future rendering and authorised style reprints; archived bytes stay immutable.

alter table public.institution_document_identity
  add column if not exists stationery_style text not null default 'ah_consult_diagonal'
  check (stationery_style in ('native','ah_consult_diagonal'));

alter table public.institution_document_identity_profiles
  add column if not exists stationery_style text not null default 'ah_consult_diagonal'
  check (stationery_style in ('native','ah_consult_diagonal'));

comment on column public.institution_document_identity.stationery_style is
  'Vector-native document layout. No full-page raster letterhead is permitted.';
comment on column public.institution_document_identity_profiles.stationery_style is
  'Draft/published vector-native document layout. No full-page raster letterhead is permitted.';

-- Existing profiles inherit the approved AH Consult diagonal treatment. Bump the
-- published revision so a later authorised current-style reprint is separately
-- fingerprinted instead of being confused with a historic original.
update public.institution_document_identity
set stationery_style='ah_consult_diagonal', revision=revision+1, updated_at=now()
where id=true;

update public.institution_document_identity_profiles
set stationery_style='ah_consult_diagonal', revision=revision+1, updated_at=now()
where is_default=true;

-- Keep the compatibility singleton and the selected versioned profile in lock-step.
create or replace function public.ahct_publish_document_identity(p_profile uuid, p_actor uuid)
returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.institution_document_identity_profiles%rowtype; new_rev bigint;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Restricted service action'; end if;
 if not exists(select 1 from public.staff where id=p_actor and role='administrator' and status='approved') then
   raise exception 'Approved administrator required'; end if;
 perform 1 from public.institution_document_identity where id=true for update;
 select * into p from public.institution_document_identity_profiles where id=p_profile for update;
 if not found then raise exception 'Identity profile not found'; end if;
 if length(btrim(p.postal_address))=0 or (length(btrim(p.phone))=0 and length(btrim(p.email))=0) then
  raise exception 'Set an official address and phone or email before publishing'; end if;
 update public.institution_document_identity_profiles set is_default=false where is_default=true and id<>p_profile;
 update public.institution_document_identity_profiles set is_default=true,status='published',
  revision=revision+1,updated_at=now(),updated_by=p_actor where id=p_profile;
 update public.institution_document_identity set
  organisation_name=p.organisation_name,organisation_tagline=p.organisation_tagline,
  postal_address=p.postal_address,phone=p.phone,email=p.email,website=p.website,
  header_alignment=p.header_alignment,stationery_style=p.stationery_style,
  logo_path=p.logo_path,logo_mime=p.logo_mime,
  revision=revision+1,updated_by=p_actor,updated_at=now() where id=true returning revision into new_rev;
 insert into public.audit_log(actor,action,target,note) values(
  p_actor,'document_identity_default_published',p_profile::text,
  'Native identity revision '||new_rev||' · stationery '||p.stationery_style
 );
 return new_rev;
end $$;
revoke all on function public.ahct_publish_document_identity(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ahct_publish_document_identity(uuid,uuid) to service_role;
