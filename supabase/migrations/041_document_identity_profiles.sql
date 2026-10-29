-- V18.7.1: versioned native identity profiles and atomic default publishing.
-- Keep original issued PDF bytes unchanged. An identity revision applies to new issuance
-- and explicitly authorized reissued copies, never by rewriting an archived original.
create table if not exists public.institution_document_identity_profiles (
 id uuid primary key default gen_random_uuid(),
 label text not null check(length(btrim(label)) between 2 and 100),
 organisation_name text not null check(length(organisation_name) between 3 and 130),
 organisation_tagline text not null default '' check(length(organisation_tagline)<=150),
 postal_address text not null default '' check(length(postal_address)<=300),
 phone text not null default '' check(length(phone)<=80),
 email text not null default '' check(length(email)<=150),
 website text not null default '' check(length(website)<=250),
 header_alignment text not null default 'left' check(header_alignment in ('left','center')),
 logo_path text, logo_mime text check(logo_mime in ('image/png','image/jpeg')),
 is_default boolean not null default false,
 status text not null default 'draft' check(status in ('draft','published')),
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id),
 check(not is_default or status='published')
);
create unique index if not exists ahct_one_default_identity on public.institution_document_identity_profiles(is_default) where is_default;
create index if not exists ahct_identity_profiles_updated on public.institution_document_identity_profiles(updated_at desc);
alter table public.institution_document_identity_profiles enable row level security;
revoke all on public.institution_document_identity_profiles from public,anon,authenticated;
-- Take the source of truth from the existing active identity, without changing it.
insert into public.institution_document_identity_profiles
 (label,organisation_name,organisation_tagline,postal_address,phone,email,website,header_alignment,logo_path,logo_mime,is_default,status,revision,updated_by)
select 'Original published identity',organisation_name,organisation_tagline,postal_address,phone,email,website,
 header_alignment,logo_path,logo_mime,true,'published',revision,updated_by
from public.institution_document_identity where id=true
and not exists(select 1 from public.institution_document_identity_profiles where is_default);

-- Atomic promotion ensures exactly one default; renderer's compatibility singleton is updated
-- in the same transaction, so every portal sees the same published identity.
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
  header_alignment=p.header_alignment,logo_path=p.logo_path,logo_mime=p.logo_mime,
  revision=revision+1,updated_by=p_actor,updated_at=now() where id=true returning revision into new_rev;
 insert into public.audit_log(actor,action,target,note) values(p_actor,'document_identity_default_published',p_profile::text,'Native identity revision '||new_rev);
 return new_rev;
end $$;
revoke all on function public.ahct_publish_document_identity(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ahct_publish_document_identity(uuid,uuid) to service_role;

-- Removing a live logo is also atomic; never remove logos from archived PDF bytes.
create or replace function public.ahct_remove_published_document_logo(p_profile uuid, p_actor uuid)
returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare new_rev bigint;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Restricted service action'; end if;
 if not exists(select 1 from public.staff where id=p_actor and role='administrator' and status='approved') then
   raise exception 'Approved administrator required'; end if;
 perform 1 from public.institution_document_identity where id=true for update;
 if not exists(select 1 from public.institution_document_identity_profiles where id=p_profile and is_default) then
  raise exception 'Active published identity not found'; end if;
 update public.institution_document_identity_profiles set logo_path=null,logo_mime=null,revision=revision+1,updated_at=now(),updated_by=p_actor where id=p_profile;
 update public.institution_document_identity set logo_path=null,logo_mime=null,revision=revision+1,updated_at=now(),updated_by=p_actor where id=true returning revision into new_rev;
 insert into public.audit_log(actor,action,target,note) values(p_actor,'document_identity_published_logo_removed',p_profile::text,'Identity revision '||new_rev);
 return new_rev;
end $$;
revoke all on function public.ahct_remove_published_document_logo(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ahct_remove_published_document_logo(uuid,uuid) to service_role;

-- Immutable, independently hashed current-style reprints, distinct from the issued original.
create table if not exists public.document_style_reprints (
 document_id uuid not null references public.student_documents(id) on delete restrict,
 identity_revision bigint not null check(identity_revision>0),
 pdf_path text not null,
 sha256 text not null check(sha256~'^[0-9a-f]{64}$'),
 original_sha256 text not null check(original_sha256~'^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(),
 primary key(document_id,identity_revision)
);
alter table public.document_style_reprints enable row level security;
revoke all on public.document_style_reprints from public,anon,authenticated;
