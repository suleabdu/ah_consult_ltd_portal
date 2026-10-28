-- tests/sql/hardening_test.sql
-- Behavioural tests for migration 024 and the access model. Runs inside a transaction and rolls back.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/hardening_test.sql
begin;
create temp table _r(name text, ok boolean);
grant all on _r to public;

-- fixtures ----------------------------------------------------------------------------------------
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','alice@test.local'), ('00000000-0000-0000-0000-0000000000b2','bob@test.local');
insert into profiles(id, full_name) values ('00000000-0000-0000-0000-0000000000a1','Alice'), ('00000000-0000-0000-0000-0000000000b2','Bob') on conflict (id) do nothing;
insert into intakes(label, year, month) values ('Test Intake', 2026, 11);
insert into courses(code, name, category, fee_ngn) values ('T101','Test One','A',10000), ('T102','Test Two','B',15000), ('T103','Test Three','C',20000);
insert into applications(id, user_id, intake_id, total_ngn, status)
  select '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', id, 25000, 'pending_payment' from intakes where label='Test Intake';
insert into applications(id, user_id, intake_id, total_ngn, status)
  select '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2', id, 10000, 'paid' from intakes where label='Test Intake';

-- 1. rate limiter: 3 calls, limit 2 -> true,true,false ; independent keys do not interfere ------------
select set_config('role','service_role',true);
insert into _r select 'rate limit allows up to max', (select public.check_rate_limit('t:k1',2,60)) and (select public.check_rate_limit('t:k1',2,60));
insert into _r select 'rate limit blocks the next hit', not public.check_rate_limit('t:k1',2,60);
insert into _r select 'rate limit keys are independent', public.check_rate_limit('t:k2',2,60);
insert into _r select 'rate limit rejects bad input', not public.check_rate_limit(null,2,60) and not public.check_rate_limit('x',0,60);
update public.rate_limits set window_start = now() - interval '2 minutes' where key='t:k1';
insert into _r select 'rate limit window resets', public.check_rate_limit('t:k1',2,60);

-- 2. atomic course replacement -----------------------------------------------------------------------
select public.replace_application_courses('10000000-0000-0000-0000-000000000001', '[{"course_code":"T101","fee_ngn":10000},{"course_code":"T102","fee_ngn":15000}]'::jsonb);
insert into _r select 'courses inserted', (select count(*) from application_courses where application_id='10000000-0000-0000-0000-000000000001')=2;
select public.replace_application_courses('10000000-0000-0000-0000-000000000001', '[{"course_code":"T103","fee_ngn":20000}]'::jsonb);
insert into _r select 'courses replaced, not appended', (select string_agg(course_code,',') from application_courses where application_id='10000000-0000-0000-0000-000000000001')='T103';
do $$ begin
  begin perform public.replace_application_courses('10000000-0000-0000-0000-000000000001','[{"course_code":"NOPE","fee_ngn":1}]'::jsonb); insert into _r values ('bad course rolls the whole swap back', false);
  exception when foreign_key_violation then insert into _r values ('bad course rolls the whole swap back', (select string_agg(course_code,',') from application_courses where application_id='10000000-0000-0000-0000-000000000001')='T103'); end;
  begin perform public.replace_application_courses('10000000-0000-0000-0000-000000000002','[{"course_code":"T101","fee_ngn":1}]'::jsonb); insert into _r values ('paid application is immutable', false);
  exception when others then insert into _r values ('paid application is immutable', true); end;
  begin perform public.replace_application_courses('10000000-0000-0000-0000-000000000001','[]'::jsonb); insert into _r values ('empty course list refused', false);
  exception when others then insert into _r values ('empty course list refused', true); end;
end $$;

-- 3. privilege boundaries: browsers must not reach these functions ------------------------------------
select set_config('role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
do $$ begin
  begin perform public.check_rate_limit('x',1,1); insert into _r values ('authenticated cannot call check_rate_limit', false); exception when insufficient_privilege then insert into _r values ('authenticated cannot call check_rate_limit', true); end;
  begin perform public.replace_application_courses('10000000-0000-0000-0000-000000000001','[]'::jsonb); insert into _r values ('authenticated cannot call replace_application_courses', false); exception when insufficient_privilege then insert into _r values ('authenticated cannot call replace_application_courses', true); end;
  begin perform 1 from public.rate_limits; insert into _r values ('authenticated cannot read rate_limits', false); exception when insufficient_privilege then insert into _r values ('authenticated cannot read rate_limits', true); end;
end $$;

-- 4. row isolation between students ----------------------------------------------------------------------
insert into _r select 'student sees only own application', (select count(*) from applications)=1 and (select user_id from applications)='00000000-0000-0000-0000-0000000000a1';
insert into _r select 'student cannot read other student profile', (select count(*) from profiles where id='00000000-0000-0000-0000-0000000000b2')=0;
do $$ begin
  begin update applications set status='paid' where id='10000000-0000-0000-0000-000000000001'; insert into _r values ('student cannot mark own application paid', (select status from applications)<>'paid'); exception when insufficient_privilege then insert into _r values ('student cannot mark own application paid', true); end;
  begin insert into payments(application_id, reference, expected_ngn, paid_ngn) values ('10000000-0000-0000-0000-000000000001','FAKE',1,1); insert into _r values ('student cannot forge a payment row', false); exception when insufficient_privilege then insert into _r values ('student cannot forge a payment row', true); end;
  begin insert into staff(id, full_name, email, role, status) values ('00000000-0000-0000-0000-0000000000a1','x','x@x','administrator','approved'); insert into _r values ('student cannot self-register as staff', false); exception when insufficient_privilege then insert into _r values ('student cannot self-register as staff', true); end;
end $$;

-- 5. anonymous visitors ---------------------------------------------------------------------------------
select set_config('role','anon',true); select set_config('request.jwt.claim.sub','',true);
do $$ begin
  begin perform 1 from applications; insert into _r values ('anon cannot read applications', false); exception when insufficient_privilege then insert into _r values ('anon cannot read applications', true); end;
  begin perform 1 from payment_providers; insert into _r values ('anon cannot read payment providers', false); exception when insufficient_privilege then insert into _r values ('anon cannot read payment providers', true); end;
end $$;

reset role;
select format('%s  %s', case when ok then 'PASS' else 'FAIL' end, name) from _r order by ok, name;
do $$ declare f int; begin select count(*) into f from _r where not ok; if f > 0 then raise exception '% hardening test(s) failed', f; end if; end $$;
rollback;
