-- Safe to run even if 003/004 were skipped (everything is idempotent).
alter table applications
  add column if not exists payment_claimed_at timestamptz,
  add column if not exists payment_review text not null default 'pending' check (payment_review in ('pending','approved','rejected'));
alter table applications add column if not exists package_code text references packages(code);

-- Applicants may read their own payments and their own passport file.
drop policy if exists own_pay on payments;
create policy own_pay on payments for select using(exists(select 1 from applications a where a.id=application_id and a.user_id=auth.uid()));
drop policy if exists pp_read on storage.objects;
create policy pp_read on storage.objects for select to authenticated using(bucket_id='passports' and (storage.foldername(name))[1]=auth.uid()::text);

-- Queue an application for the sheet only after payment is claimed (or it has moved past payment).
create or replace function queue_sheet() returns trigger language plpgsql as $$
begin
  if new.payment_claimed_at is not null or new.status not in ('pending_payment','expired') then
    insert into sheet_outbox(application_id) values(new.id);
  end if;
  return new;
end $$;
drop trigger if exists app_to_sheet on applications;
create trigger app_to_sheet after insert or update of status, payment_claimed_at, payment_review on applications
  for each row execute function queue_sheet();

-- "I have paid": one fast database call (no Edge Function, no cold start, nothing to hang).
create or replace function claim_payment(p_app uuid) returns applications
language plpgsql security definer set search_path = public, pg_temp as $$
declare a applications;
begin
  select * into a from applications where id = p_app and user_id = auth.uid();
  if not found then raise exception 'Application not found'; end if;
  if a.status <> 'pending_payment' then return a; end if;
  if not (a.payment_claimed_at is not null and a.payment_review = 'pending' and a.payment_claimed_at > now() - interval '30 seconds') then
    update applications set payment_claimed_at = now(), payment_review = 'pending' where id = p_app returning * into a;
  end if;
  return a;
end $$;
revoke all on function claim_payment(uuid) from public, anon;
grant execute on function claim_payment(uuid) to authenticated;

-- Retry any jobs that were stuck while the sync was failing.
update sheet_outbox set attempts = 0, last_error = null where done = false;
