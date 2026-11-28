-- Allocate stable, globally unique serials to recruitment documents. The title
-- and applicant name are frozen so renaming a vacancy never changes an ID.
create table public.recruitment_application_documents (
  application_id uuid not null references public.recruitment_applications(id) on delete cascade,
  storage_path text not null,
  serial bigint generated always as identity unique,
  job_title_snapshot text not null,
  applicant_name_snapshot text not null,
  primary key (application_id, storage_path)
);

alter table public.recruitment_application_documents enable row level security;
revoke all on public.recruitment_application_documents from public, anon, authenticated;
grant select on public.recruitment_application_documents to authenticated;
create policy recruitment_document_identifiers_read on public.recruitment_application_documents
  for select to authenticated using (public.can_read('recruitment'));

-- Application data is finalized on insert. A private, security-definer trigger
-- assigns IDs without granting applicants access to the identifier registry.
create or replace function public.recruitment_assign_document_identifiers() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.recruitment_application_documents(application_id,storage_path,job_title_snapshot,applicant_name_snapshot)
  select distinct new.id, files.path, vacancy.title, new.full_name
    from public.recruitment_vacancies vacancy
    cross join lateral (
      select new.cv_path as path
      union all select new.passport_path
      union all select jsonb_array_elements_text(coalesce(new.attachments,'[]'::jsonb))
    ) files
   where vacancy.id=new.vacancy_id and files.path is not null and files.path<>''
  on conflict (application_id,storage_path) do nothing;
  return new;
end $$;
revoke all on function public.recruitment_assign_document_identifiers() from public,anon,authenticated;
create trigger recruitment_assign_document_identifiers_after_insert
  after insert on public.recruitment_applications
  for each row execute function public.recruitment_assign_document_identifiers();

-- Assign IDs to already-submitted documents as well; de-duplicate paths that
-- may occur in both a standard field and the attachment list.
insert into public.recruitment_application_documents(application_id,storage_path,job_title_snapshot,applicant_name_snapshot)
select distinct app.id, files.path, vacancy.title, app.full_name
  from public.recruitment_applications app
  join public.recruitment_vacancies vacancy on vacancy.id=app.vacancy_id
  cross join lateral (
    select app.cv_path as path
    union all select app.passport_path
    union all select jsonb_array_elements_text(coalesce(app.attachments,'[]'::jsonb))
  ) files
 where files.path is not null and files.path<>''
on conflict (application_id,storage_path) do nothing;
