-- V18.6.3 | Preserve verified payment provenance for distinct manual/online receipts.
-- Apply AFTER 035. This is additive: never edit migrations already deployed.
-- Manual approval means an authorized Finance/Administrator has checked bank evidence.
-- Neither the applicant nor a payment-provider callback can invoke these staff RPCs.

create or replace function public.admin_review_payment(p_app uuid, p_decision text, p_note text default null)
returns public.applications language plpgsql security definer
set search_path=public,pg_temp as $$
declare a public.applications%rowtype; who text; receipt_payment uuid;
begin
 if auth.uid() is null or not public.can_write('payments') then
   raise exception 'Your role cannot review payments';
 end if;
 if p_decision not in ('approved','query') then raise exception 'Invalid decision'; end if;
 select full_name into who from public.staff where id=auth.uid() and status='approved';
 select * into a from public.applications where id=p_app for update;
 if not found then raise exception 'Application not found'; end if;
 if a.status <> 'pending_payment' then raise exception 'This payment is already %',a.status; end if;
 if p_decision='approved' then
   if a.total_ngn is null or a.total_ngn<=0 then raise exception 'Invalid application amount'; end if;
   if nullif(trim(coalesce(a.pay_reference,'')),'') is null then raise exception 'Missing payment reference'; end if;
   -- Prevent a second bank receipt for an application that has already settled electronically.
   if exists(select 1 from public.payments p where p.application_id=a.id and
     p.verified_at is not null and p.expected_ngn>0 and p.paid_ngn>=p.expected_ngn) then
     raise exception 'A verified transaction already exists. Do not approve a second payment';
   end if;
   insert into public.payments(application_id,reference,expected_ngn,paid_ngn,
       provider,source,provider_transaction_id,raw_event,paid_at,verified_at)
   values(a.id,'MANUAL-'||a.pay_reference,a.total_ngn,a.total_ngn,'manual','admin_manual',
       'ADMIN-'||a.id::text,
       jsonb_build_object('source','admin','approved_by',auth.uid(),'method','bank_transfer',
         'review_note',left(coalesce(p_note,''),500)),now(),now())
   on conflict(reference) do update
     set verified_at=coalesce(public.payments.verified_at,excluded.verified_at),
         provider='manual',source='admin_manual',
         provider_transaction_id=coalesce(public.payments.provider_transaction_id,excluded.provider_transaction_id),
         raw_event=coalesce(public.payments.raw_event,'{}'::jsonb)||excluded.raw_event
     where public.payments.application_id=excluded.application_id
       and public.payments.paid_ngn=excluded.paid_ngn
       and public.payments.expected_ngn=excluded.expected_ngn
       and (public.payments.raw_event->>'source'='admin'
         or public.payments.source in ('admin_manual','admin_manual_legacy'))
   returning id into receipt_payment;
   if receipt_payment is null then raise exception 'Conflicting payment evidence requires Finance review'; end if;
   update public.applications set status='paid',paid_at=coalesce(paid_at,now()),
      payment_review='approved',payment_note=p_note where id=p_app returning * into a;
 else
   update public.applications set payment_review='rejected',payment_note=p_note
     where id=p_app returning * into a;
 end if;
 insert into public.audit_log(actor,actor_name,action,target,note)
 values(auth.uid(),who,'payment_'||p_decision,a.pay_reference,
   case when p_decision='approved' then 'Manual bank confirmation; payment_id='||receipt_payment::text||'; '||coalesce(p_note,'')
        else p_note end);
 return a;
end $$;

create or replace function public.admin_review_addition(p_id uuid,p_decision text,p_note text default null)
returns public.course_additions language plpgsql security definer
set search_path=public,pg_temp as $$
declare r public.course_additions%rowtype; who text; a public.applications%rowtype; receipt_payment uuid;
begin
 if auth.uid() is null or not public.can_write('payments') then raise exception 'Your role cannot review payments'; end if;
 if p_decision not in ('approved','query','rejected') then raise exception 'Invalid decision'; end if;
 select full_name into who from public.staff where id=auth.uid() and status='approved';
 select * into r from public.course_additions where id=p_id for update;
 if not found then raise exception 'Request not found'; end if;
 if r.status not in ('pending_payment','payment_claimed') then raise exception 'This request is already %',r.status; end if;
 select * into a from public.applications where id=r.application_id for update;
 if not found then raise exception 'Application not found'; end if;
 if p_decision='approved' then
   if coalesce(r.fee_ngn,0)<=0 then raise exception 'Invalid course payment amount'; end if;
   insert into public.application_courses(application_id,course_code,fee_ngn)
     values(r.application_id,r.course_code,r.fee_ngn) on conflict do nothing;
   update public.applications set total_ngn=total_ngn+r.fee_ngn where id=r.application_id;
   insert into public.payments(application_id,reference,expected_ngn,paid_ngn,
      provider,source,provider_transaction_id,raw_event,paid_at,verified_at)
   values(r.application_id,'ADD-'||r.id::text,r.fee_ngn,r.fee_ngn,'manual','admin_manual',
      'ADMIN-ADD-'||r.id::text,jsonb_build_object('source','admin','approved_by',auth.uid(),
        'method','bank_transfer','course',r.course_code,'review_note',left(coalesce(p_note,''),500)),now(),now())
   on conflict(reference) do update
     set verified_at=coalesce(public.payments.verified_at,excluded.verified_at),
         provider='manual',source='admin_manual',
         provider_transaction_id=coalesce(public.payments.provider_transaction_id,excluded.provider_transaction_id),
         raw_event=coalesce(public.payments.raw_event,'{}'::jsonb)||excluded.raw_event
     where public.payments.application_id=excluded.application_id
       and public.payments.paid_ngn=excluded.paid_ngn
       and public.payments.expected_ngn=excluded.expected_ngn
       and (public.payments.raw_event->>'source'='admin'
         or public.payments.source in ('admin_manual','admin_manual_legacy'))
   returning id into receipt_payment;
   if receipt_payment is null then raise exception 'Conflicting course payment evidence requires Finance review'; end if;
   update public.course_additions set status='approved',note=p_note where id=p_id returning * into r;
 elsif p_decision='query' then
   update public.course_additions set status='pending_payment',note=p_note,claimed_at=null
      where id=p_id returning * into r;
 else
   update public.course_additions set status='rejected',note=p_note where id=p_id returning * into r;
 end if;
 insert into public.audit_log(actor,actor_name,action,target,note)
 values(auth.uid(),who,'addition_'||p_decision,r.id::text,
   case when p_decision='approved' then 'Manual bank confirmation; payment_id='||receipt_payment::text||'; '||coalesce(p_note,'')
        else p_note end);
 return r;
end $$;

revoke all on function public.admin_review_payment(uuid,text,text) from public,anon;
revoke all on function public.admin_review_addition(uuid,text,text) from public,anon;
grant execute on function public.admin_review_payment(uuid,text,text) to authenticated;
grant execute on function public.admin_review_addition(uuid,text,text) to authenticated;

-- Repair ONLY existing approvals that were already explicitly recorded as admin-made.
-- Do not convert an unverified provider notification or applicant's payment claim.
-- Updating verified_at activates the existing receipt-queue trigger from migration 033.
update public.payments p set
 verified_at=coalesce(p.paid_at,a.paid_at,now()),
 source='admin_manual_legacy',provider='manual',
 provider_transaction_id=coalesce(p.provider_transaction_id,'ADMIN-LEGACY-'||p.id::text)
from public.applications a
where p.application_id=a.id and p.verified_at is null
 and p.reference='MANUAL-'||a.pay_reference
 and p.raw_event->>'source'='admin'
 and a.paid_at is not null and a.payment_review='approved'
 and p.expected_ngn>0 and p.paid_ngn=p.expected_ngn and p.expected_ngn=a.total_ngn;

update public.payments p set
 verified_at=coalesce(p.paid_at,now()),
 source='admin_manual_legacy',provider='manual',
 provider_transaction_id=coalesce(p.provider_transaction_id,'ADMIN-LEGACY-'||p.id::text)
from public.course_additions ca
where p.application_id=ca.application_id and p.verified_at is null
 and p.reference='ADD-'||ca.id::text
 and p.raw_event->>'source'='admin'
 and ca.status='approved' and p.expected_ngn>0
 and p.paid_ngn=p.expected_ngn and p.expected_ngn=ca.fee_ngn;
