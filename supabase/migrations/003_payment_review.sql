-- Payment review: applicant taps "I have paid" -> row goes to the sheet -> staff set Approved / Rejected / Pending.
alter table applications
  add column if not exists payment_claimed_at timestamptz,
  add column if not exists payment_review text not null default 'pending' check (payment_review in ('pending','approved','rejected'));

-- Only send an application to the sheet once the applicant has claimed payment (or has moved past payment).
create or replace function queue_sheet() returns trigger language plpgsql as $$
begin
  if new.payment_claimed_at is not null or new.status <> 'pending_payment' then
    insert into sheet_outbox(application_id) values(new.id);
  end if;
  return new;
end $$;
drop trigger if exists app_to_sheet on applications;
create trigger app_to_sheet after insert or update of status, payment_claimed_at, payment_review on applications
  for each row execute function queue_sheet();
