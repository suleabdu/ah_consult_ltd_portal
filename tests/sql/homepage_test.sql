-- tests/sql/homepage_test.sql : gallery visibility/permissions and the public impact figures. Rolls back.
begin;
create temp table _r(name text, ok boolean);
grant all on _r to public;
-- fixtures (as superuser) --------------------------------------------------------------------------------
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-0000000000a1','admin@test.local'), ('00000000-0000-0000-0000-0000000000b2','student@test.local'),
  ('00000000-0000-0000-0000-0000000000c3','s3@test.local'), ('00000000-0000-0000-0000-0000000000d4','s4@test.local'), ('00000000-0000-0000-0000-0000000000e5','s5@test.local');
insert into profiles(id, full_name) select id, 'T' from auth.users on conflict (id) do nothing;
insert into staff(id, full_name, email, role, status) values ('00000000-0000-0000-0000-0000000000a1','Test Admin','admin@test.local','administrator','approved');
delete from gallery_items;
insert into gallery_items(id, image_url, caption, category, status, sort_order) values
  ('20000000-0000-0000-0000-000000000001','https://img.example/pub.jpg','Published one','training','published',1),
  ('20000000-0000-0000-0000-000000000002','https://img.example/draft.jpg','Draft one','projects','draft',2),
  ('20000000-0000-0000-0000-000000000003','https://img.example/arch.jpg','Archived one','events','archived',3);
insert into intakes(label, year, month) values ('Impact test intake', 2027, 1), ('Impact test intake 2', 2027, 2);

-- 1. anonymous visitors -------------------------------------------------------------------------------------
select set_config('role','anon',true);
insert into _r select 'anon sees only the published photo', (select count(*) from gallery_items)=1 and (select caption from gallery_items)='Published one';
do $$ begin
  begin insert into gallery_items(image_url) values ('https://x.example/a.jpg'); insert into _r values ('anon cannot insert gallery rows', false); exception when insufficient_privilege then insert into _r values ('anon cannot insert gallery rows', true); end;
  begin update gallery_items set caption='hacked'; insert into _r values ('anon cannot update gallery rows', false); exception when insufficient_privilege then insert into _r values ('anon cannot update gallery rows', true); end;
  begin delete from gallery_items; insert into _r values ('anon cannot delete gallery rows', false); exception when insufficient_privilege then insert into _r values ('anon cannot delete gallery rows', true); end;
  begin perform 1 from document_jobs; insert into _r values ('anon cannot read document_jobs', false); exception when insufficient_privilege then insert into _r values ('anon cannot read document_jobs', true); end;
end $$;
insert into _r select 'public_impact_stats returns exactly the approved keys', (select array(select jsonb_object_keys(public_impact_stats()) order by 1)) = array['active_intakes','as_of','graduates','learners_enrolled','programmes'];
insert into _r select 'impact stats contain no row data (all values are numbers, null or a timestamp)',
  (select bool_and(jsonb_typeof(v) in ('number','null') or k='as_of') from jsonb_each(public_impact_stats()) as t(k,v));
insert into _r select 'legacy v17 metrics RPC returns only its four approved aggregate keys',
  (select array(select jsonb_object_keys(public_homepage_metrics()) order by 1)) = array['active_course_options','active_intakes','active_programmes','admitted_learners'];
insert into _r select 'legacy v17 metrics RPC includes no row-level data',
  (select bool_and(jsonb_typeof(v) in ('number','null')) from jsonb_each(public_homepage_metrics()) as t(k,v));
reset role;

-- 2. a signed-in student is still just a visitor to the gallery ------------------------------------------------------
select set_config('role','authenticated',true); select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',true);
insert into _r select 'student sees only published photos', (select count(*) from gallery_items)=1;
do $$ begin
  begin insert into gallery_items(image_url, status) values ('https://x.example/s.jpg','published'); insert into _r values ('student cannot add photos', false); exception when insufficient_privilege then insert into _r values ('student cannot add photos', true); end;
  begin update gallery_items set status='archived' where id='20000000-0000-0000-0000-000000000001'; insert into _r values ('student cannot unpublish', (select count(*) from gallery_items)=1); exception when insufficient_privilege then insert into _r values ('student cannot unpublish', true); end;
end $$;
reset role;

-- 3. administrator: full lifecycle, audited ------------------------------------------------------------------------------
select set_config('role','authenticated',true); select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
insert into _r select 'admin sees drafts and archived photos too', (select count(*) from gallery_items)=3;
insert into gallery_items(id, image_url, caption, category, status, featured) values ('20000000-0000-0000-0000-000000000009','https://img.example/new.jpg','New','graduation','draft',true);
insert into _r select 'draft has no published_at', (select published_at is null from gallery_items where id='20000000-0000-0000-0000-000000000009');
update gallery_items set status='published' where id='20000000-0000-0000-0000-000000000009';
insert into _r select 'publishing stamps published_at', (select published_at is not null from gallery_items where id='20000000-0000-0000-0000-000000000009');
update gallery_items set status='archived' where id='20000000-0000-0000-0000-000000000009';
insert into _r select 'archiving clears published_at', (select published_at is null from gallery_items where id='20000000-0000-0000-0000-000000000009');
insert into _r select 'admin actions are written to audit_log', (select count(*) from audit_log where action like 'gallery.%' and target='20000000-0000-0000-0000-000000000009') >= 3;
do $$ begin
  begin insert into gallery_items(image_url) values ('http://insecure.example/a.jpg'); insert into _r values ('http:// image URLs are rejected', false); exception when check_violation then insert into _r values ('http:// image URLs are rejected', true); end;
  begin insert into gallery_items(image_url, category) values ('https://x.example/a.jpg','nonsense'); insert into _r values ('unknown category rejected', false); exception when check_violation then insert into _r values ('unknown category rejected', true); end;
end $$;
reset role;
select set_config('role','anon',true);
insert into _r select 'anon cannot see the admin''s archived photo', (select count(*) from gallery_items where id='20000000-0000-0000-0000-000000000009')=0;
reset role;

-- 4. counting rules for public_impact_stats --------------------------------------------------------------------------------
-- (a) approved + paid -> counts; (b) submitted only -> not; (c) approved but unpaid -> not; (d) rejected -> not;
-- (e) one student approved+paid in TWO different intakes -> counted once
insert into applications(user_id, intake_id, total_ngn, status, admission_decision, paid_at)
select u, (select id from intakes where label='Impact test intake'), 1000, st, dec, case when paid then now() end
from (values
  ('00000000-0000-0000-0000-0000000000b2'::uuid,'approved','approved',true),
  ('00000000-0000-0000-0000-0000000000c3'::uuid,'submitted','pending',true),
  ('00000000-0000-0000-0000-0000000000d4'::uuid,'approved','approved',false),
  ('00000000-0000-0000-0000-0000000000e5'::uuid,'rejected','rejected',true)
) as v(u, st, dec, paid);
insert into applications(user_id, intake_id, total_ngn, status, admission_decision, paid_at)
select '00000000-0000-0000-0000-0000000000b2', id, 1000, 'approved', 'approved', now() from intakes where label='Impact test intake 2';
insert into _r select 'enrolled counts only approved+paid students, once each', (public_impact_stats() ->> 'learners_enrolled')::int = 1;
insert into _r select 'drafts/unpaid/submitted/rejected are not enrolled', (
  select count(*) from applications
  where user_id in (
    '00000000-0000-0000-0000-0000000000b2'::uuid,
    '00000000-0000-0000-0000-0000000000c3'::uuid,
    '00000000-0000-0000-0000-0000000000d4'::uuid,
    '00000000-0000-0000-0000-0000000000e5'::uuid
  )
  and intake_id in (select id from intakes where label in ('Impact test intake', 'Impact test intake 2'))
) = 5;

insert into _r select 'graduates is NULL before any certificate is issued', (public_impact_stats() -> 'graduates') = 'null'::jsonb;
insert into document_jobs(user_id, document_key, status) values ('00000000-0000-0000-0000-0000000000b2','certificate','generated');
insert into _r select 'a generated-but-not-issued certificate is not a graduate', (public_impact_stats() -> 'graduates') = 'null'::jsonb;
insert into document_jobs(user_id, document_key, status) values ('00000000-0000-0000-0000-0000000000b2','certificate','issued'), ('00000000-0000-0000-0000-0000000000b2','certificate','issued');
insert into _r select 'issued certificates count each student once', (public_impact_stats() ->> 'graduates')::int = 1;
insert into document_jobs(user_id, document_key, status) values ('00000000-0000-0000-0000-0000000000c3','admission_letter','issued');
insert into _r select 'other issued documents are not graduations', (public_impact_stats() ->> 'graduates')::int = 1;
update courses set is_active=false;
insert into _r select 'programmes is NULL when no course is active', (public_impact_stats() -> 'programmes') = 'null'::jsonb;
update courses set is_active=true where name in ('AutoCAD','Revit');
insert into _r select 'programmes counts distinct names, not levels', (public_impact_stats() ->> 'programmes')::int = 2;
update intakes set is_active=true, closes_at = now() - interval '1 day' where label='Impact test intake';
update intakes set is_active=false where label <> 'Impact test intake';   -- seeded intake and the second test intake
insert into _r select 'a closed intake is not "active"', (public_impact_stats() -> 'active_intakes') = 'null'::jsonb;
update intakes set closes_at = now() + interval '30 days' where label='Impact test intake';
insert into _r select 'an open intake is active', (public_impact_stats() ->> 'active_intakes')::int = 1;

select format('%s  %s', case when ok then 'PASS' else 'FAIL' end, name) from _r order by ok, name;
do $$
declare
  f int;
  failed_tests text;
begin
  select count(*), string_agg(name, '; ' order by name)
    into f, failed_tests
  from _r where not ok;
  if f > 0 then
    raise exception '% homepage test(s) failed: %', f, failed_tests;
  end if;
end $$;
rollback;
