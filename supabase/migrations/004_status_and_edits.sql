-- Applicants can read their own payment records (transaction history + receipts).
drop policy if exists own_pay on payments;
create policy own_pay on payments for select using(exists(select 1 from applications a where a.id=application_id and a.user_id=auth.uid()));
-- Do not push cancelled/expired, unclaimed applications to the sheet.
create or replace function queue_sheet() returns trigger language plpgsql as $$
begin
  if new.payment_claimed_at is not null or new.status not in ('pending_payment','expired') then
    insert into sheet_outbox(application_id) values(new.id);
  end if;
  return new;
end $$;
