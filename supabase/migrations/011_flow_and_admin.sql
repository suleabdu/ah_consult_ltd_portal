-- =============================================================================
-- SETUP GUIDE - 011_flow_and_admin.sql
-- WHAT IT ADDS: the new application order (intake, details, courses, payment, review and submit), draft applications,
--   deferment requests, removing an unpaid extra-course request, the first-time welcome flag, tutor feedback with names,
--   and lecturer admin tools (student counts, deactivate, delete, pick a registered tutor account).
-- HOW TO RUN: Supabase dashboard, SQL Editor, paste this whole file, Run. Run it AFTER 001 to 010. Safe to run twice.
-- AFTER IT: redeploy the create-application function (it now works on the draft application).
-- =============================================================================

-- 1. Draft applications: the student picks an intake, fills their details, THEN chooses courses and pays
alter table applications drop constraint if exists applications_status_check;
alter table applications add constraint applications_status_check check (status in ('draft','pending_payment','paid','submitted','under_review','approved','rejected','expired'));
alter table applications alter column total_ngn set default 0;
alter table applications add column if not exists welcomed_at timestamptz;
create or replace function queue_sheet() returns trigger language plpgsql as $$
begin
  if new.payment_claimed_at is not null or new.status not in ('draft','pending_payment','expired') then insert into sheet_outbox(application_id) values(new.id); end if;
  return new;
end $$;
drop policy if exists pp_write on storage.objects;
create policy pp_write on storage.objects for insert to authenticated with check (bucket_id = 'passports' and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from applications a where a.user_id = auth.uid() and a.id::text = (storage.foldername(name))[2] and a.status in ('draft','pending_payment','paid')));
select cron.schedule('expire-drafts', '30 3 * * *', $$update applications set status = 'expired' where status = 'draft' and created_at < now() - interval '30 days'$$);

create or replace function validate_form(f jsonb) returns text language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if length(trim(coalesce(f->>'surname',''))) < 1 then return 'Enter your surname.'; end if;
  if length(trim(coalesce(f->>'firstName',''))) < 1 then return 'Enter your first name.'; end if;
  if regexp_replace(coalesce(f->>'phone',''), '\s', '', 'g') !~ '^(\+234|0)[789][01][0-9]{8}$' then return 'Enter a valid Nigerian phone number.'; end if;
  if coalesce(f->>'dob','') !~ '^\d{4}-\d{2}-\d{2}$' then return 'Enter your date of birth.'; end if;
  if coalesce(f->>'gender','') not in ('Male','Female') then return 'Select your gender.'; end if;
  if length(trim(coalesce(f->>'address',''))) < 3 then return 'Enter your address.'; end if;
  if length(trim(coalesce(f->>'state',''))) < 2 then return 'Select your state.'; end if;
  if coalesce(f->>'education','') not in ('Primary','Secondary','Bachelor Degree','Masters Degree','Ph.D Holder') then return 'Select your education level.'; end if;
  if coalesce(f->>'occupation','') not in ('Civil Servant','Private Worker','Student') then return 'Select your occupation.'; end if;
  if length(trim(coalesce(f->>'skills',''))) < 1 or length(f->>'skills') > 300 then return 'Tell us your skills (up to 300 characters).'; end if;
  if coalesce(f->>'laptop','') not in ('Yes','No') then return 'Do you have a laptop?'; end if;
  if f->>'laptop' = 'Yes' and coalesce(f->>'battery','') not in ('3 Hours and Above','Less than 3 hours','Desktop') then return 'Select your laptop battery duration.'; end if;
  return null;
end $$;

create or replace function start_application(p_intake uuid) returns applications language plpgsql security definer set search_path = public, pg_temp as $$
declare a applications; i intakes;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into a from applications where user_id = auth.uid() and intake_id = p_intake and status not in ('expired','rejected'); if found then return a; end if;
  select * into i from intakes where id = p_intake;
  if not found or not i.is_active or (i.opens_at is not null and i.opens_at > now()) or (i.closes_at is not null and i.closes_at < now()) then raise exception 'This intake is not open for applications'; end if;
  insert into applications(user_id, intake_id, status, total_ngn) values (auth.uid(), p_intake, 'draft', 0) returning * into a; return a;
end $$;

create or replace function save_application_form(p_app uuid, p_form jsonb, p_passport text) returns applications language plpgsql security definer set search_path = public, pg_temp as $$
declare a applications; msg text; f jsonb;
begin
  select * into a from applications where id = p_app and user_id = auth.uid(); if not found then raise exception 'Application not found'; end if;
  if a.status not in ('draft','pending_payment','paid') then raise exception 'Your details can no longer be changed'; end if;
  msg := validate_form(p_form); if msg is not null then raise exception '%', msg; end if;
  f := jsonb_build_object('surname', trim(p_form->>'surname'), 'firstName', trim(p_form->>'firstName'), 'otherNames', trim(coalesce(p_form->>'otherNames','')), 'phone', regexp_replace(p_form->>'phone','\s','','g'),
    'dob', p_form->>'dob', 'gender', p_form->>'gender', 'state', trim(p_form->>'state'), 'address', trim(p_form->>'address'), 'education', p_form->>'education', 'occupation', p_form->>'occupation',
    'skills', trim(p_form->>'skills'), 'laptop', p_form->>'laptop', 'battery', case when p_form->>'laptop' = 'No' then 'Not applicable' else p_form->>'battery' end);
  if p_passport is not null and p_passport not like auth.uid()::text || '/' || p_app::text || '/%' then raise exception 'Invalid passport file'; end if;
  if coalesce(p_passport, a.passport_path) is null then raise exception 'Upload your passport photograph.'; end if;
  update applications set form_data = f, passport_path = coalesce(p_passport, passport_path) where id = p_app returning * into a; return a;
end $$;

create or replace function submit_application(p_app uuid) returns applications language plpgsql security definer set search_path = public, pg_temp as $$
declare a applications; msg text;
begin
  select * into a from applications where id = p_app and user_id = auth.uid(); if not found then raise exception 'Application not found'; end if;
  if a.student_id is not null and a.status in ('submitted','under_review','approved') then return a; end if;
  if a.status <> 'paid' then raise exception 'Payment has not been confirmed yet'; end if;
  msg := validate_form(coalesce(a.form_data, '{}'::jsonb)); if msg is not null then raise exception '%', msg; end if;
  if a.passport_path is null then raise exception 'Upload your passport photograph.'; end if;
  update applications set status = 'submitted', student_id = next_student_id(a.intake_id), submitted_at = now() where id = p_app returning * into a; return a;
end $$;

create or replace function revert_application_to_draft(p_app uuid) returns applications language plpgsql security definer set search_path = public, pg_temp as $$
declare a applications;
begin
  select * into a from applications where id = p_app and user_id = auth.uid(); if not found then raise exception 'Application not found'; end if;
  if a.status <> 'pending_payment' then raise exception 'Your courses can no longer be changed because payment has been confirmed'; end if;
  if exists (select 1 from payments where application_id = p_app) then raise exception 'A payment has already been received for this application. Please contact the training office'; end if;
  if a.payment_claimed_at is not null and a.payment_review = 'pending' then raise exception 'You have already told us you paid. Please contact the training office before changing your courses'; end if;
  delete from application_courses where application_id = p_app;
  update applications set status = 'draft', total_ngn = 0, package_code = null, pay_reference = null, pay_bank = null, pay_account = null, pay_url = null, pay_gateway_ref = null, pay_provider = null, pay_provider_id = null, pay_mode = null,
    payment_claimed_at = null, payment_review = 'pending', payment_note = null where id = p_app returning * into a; return a;
end $$;

create or replace function mark_welcomed(p_app uuid) returns void language sql security definer set search_path = public, pg_temp as $$
  update applications set welcomed_at = coalesce(welcomed_at, now()) where id = p_app and user_id = auth.uid() $$;

-- 2. Cancel an extra-course request that has not been paid
create or replace function cancel_addition(p_id uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from course_additions ca using applications ap where ca.id = p_id and ap.id = ca.application_id and ap.user_id = auth.uid() and ca.status = 'pending_payment';
  if not found then raise exception 'This request can no longer be removed (you may already have told us you paid)'; end if;
end $$;

-- 3. Deferment requests
alter table application_courses add column if not exists deferred boolean not null default false;
create table if not exists deferments(id uuid primary key default gen_random_uuid(), application_id uuid not null references applications on delete cascade,
  scope text not null check (scope in ('courses','intake')), course_codes text[] not null default '{}',
  reason_type text not null check (reason_type in ('financial','health','work','relocation','family','academic','other')), reason text not null, return_intake_id uuid references intakes,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')), admin_note text, created_at timestamptz default now(), decided_at timestamptz, decided_by uuid);
alter table deferments enable row level security;
drop policy if exists staff_read on deferments; create policy staff_read on deferments for select using (can_read('applications'));

create or replace function request_deferment(p_application uuid, p_scope text, p_courses text[], p_reason_type text, p_reason text, p_return uuid) returns deferments
language plpgsql security definer set search_path = public, pg_temp as $$
declare a applications; codes text[]; r deferments;
begin
  select * into a from applications where id = p_application and user_id = auth.uid(); if not found then raise exception 'Application not found'; end if;
  if a.admission_decision <> 'approved' then raise exception 'Deferment is available once you have been admitted'; end if;
  if length(trim(coalesce(p_reason,''))) < 15 then raise exception 'Please explain your reason in at least 15 characters'; end if;
  if p_scope = 'intake' then select array_agg(course_code) into codes from application_courses where application_id = a.id and not deferred;
  else codes := p_courses; end if;
  if codes is null or array_length(codes,1) is null then raise exception 'Choose at least one course to defer'; end if;
  if exists (select 1 from unnest(codes) c where not exists (select 1 from application_courses ac where ac.application_id = a.id and ac.course_code = c and not ac.deferred)) then raise exception 'One of the selected courses is not active on your application'; end if;
  if exists (select 1 from deferments d where d.application_id = a.id and d.status = 'pending' and d.course_codes && codes) then raise exception 'You already have a pending deferment request for one of these courses'; end if;
  insert into deferments(application_id, scope, course_codes, reason_type, reason, return_intake_id) values (a.id, p_scope, codes, p_reason_type, trim(p_reason), p_return) returning * into r; return r;
end $$;
create or replace function cancel_deferment(p_id uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update deferments d set status = 'cancelled', decided_at = now() from applications ap where d.id = p_id and ap.id = d.application_id and ap.user_id = auth.uid() and d.status = 'pending';
  if not found then raise exception 'This request has already been decided and can no longer be cancelled'; end if;
end $$;
create or replace function admin_review_deferment(p_id uuid, p_decision text, p_note text default null) returns deferments language plpgsql security definer set search_path = public, pg_temp as $$
declare r deferments; who text; a applications;
begin
  if not can_write('applications') then raise exception 'Your role cannot decide deferments'; end if;
  select full_name into who from staff where id = auth.uid();
  select * into r from deferments where id = p_id; if not found then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then raise exception 'This request is already %', r.status; end if;
  select * into a from applications where id = r.application_id;
  if p_decision = 'approved' then
    update application_courses set deferred = true where application_id = r.application_id and course_code = any(r.course_codes);
    update deferments set status = 'approved', admin_note = p_note, decided_at = now(), decided_by = auth.uid() where id = p_id returning * into r;
  elsif p_decision = 'rejected' then
    if length(trim(coalesce(p_note,''))) < 3 then raise exception 'Please explain why the request is declined'; end if;
    update deferments set status = 'rejected', admin_note = p_note, decided_at = now(), decided_by = auth.uid() where id = p_id returning * into r;
  else raise exception 'Invalid decision'; end if;
  insert into audit_log(actor, actor_name, action, target, note) values (auth.uid(), who, 'deferment_' || p_decision, coalesce(a.student_id, a.pay_reference), p_note);
  return r;
end $$;

-- 4. Lecturers: only ACTIVE lecturers can act; admin tools for stats, (de)activation, deletion and picking registered accounts
create or replace function my_lecturer_ids() returns setof uuid language sql security definer stable set search_path = public, pg_temp as $$ select id from lecturers where user_id = auth.uid() and is_active $$;
create or replace function tutor_roster() returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not has_role('tutor') then raise exception 'Tutors only'; end if;
  return coalesce((select jsonb_agg(x order by x.name) from (
    select ap.id as application_id, ap.student_id, coalesce(nullif(trim(coalesce(ap.form_data->>'surname','') || ' ' || coalesce(ap.form_data->>'firstName','')), ''), pr.full_name) as name,
      pr.email, coalesce(ap.form_data->>'phone', pr.phone) as phone, ap.intake_id, i.label as intake_label, c.code as course_code, c.name as course_name, c.category as course_category,
      (select to_jsonb(r) from (select ca, exam_obj, exam_prac, total, band from exam_results er where er.application_id = ap.id and er.course_code = c.code) r) as result
    from lecturers l join lecturer_courses lc on lc.lecturer_id = l.id join application_courses ac on ac.course_code = lc.course_code and not ac.deferred
    join applications ap on ap.id = ac.application_id and ap.admission_decision = 'approved' join profiles pr on pr.id = ap.user_id join intakes i on i.id = ap.intake_id join courses c on c.code = ac.course_code
    where l.user_id = auth.uid() and l.is_active) x), '[]'::jsonb);
end $$;
create or replace function tutor_save_result(p_application uuid, p_course text, p_ca int, p_obj int, p_prac int) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_role('tutor') then raise exception 'Tutors only'; end if;
  if not exists (select 1 from lecturers l join lecturer_courses lc on lc.lecturer_id = l.id where l.user_id = auth.uid() and l.is_active and lc.course_code = p_course) then raise exception 'You do not teach this course'; end if;
  if not exists (select 1 from application_courses where application_id = p_application and course_code = p_course and not deferred) then raise exception 'The student is not actively enrolled in this course'; end if;
  insert into exam_results(application_id, course_code, ca, exam_obj, exam_prac, graded_by) values (p_application, p_course, coalesce(p_ca,0), coalesce(p_obj,0), coalesce(p_prac,0), auth.uid())
  on conflict (application_id, course_code) do update set ca = excluded.ca, exam_obj = excluded.exam_obj, exam_prac = excluded.exam_prac, graded_by = auth.uid(), updated_at = now();
end $$;
create or replace function tutor_feedback() returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not has_role('tutor') then raise exception 'Tutors only'; end if;
  return coalesce((select jsonb_agg(x order by x.created_at desc) from (
    select f.id, f.rating, f.comment, f.created_at, f.course_code, c.name as course_name, c.category as course_category, i.label as intake_label, ap.student_id,
      coalesce(nullif(trim(coalesce(ap.form_data->>'surname','') || ' ' || coalesce(ap.form_data->>'firstName','')), ''), pr.full_name) as student
    from student_feedback f join lecturers l on l.id = f.lecturer_id and l.user_id = auth.uid() and l.is_active
    left join applications ap on ap.id = f.application_id left join profiles pr on pr.id = ap.user_id left join intakes i on i.id = ap.intake_id left join courses c on c.code = f.course_code) x), '[]'::jsonb);
end $$;

create or replace function admin_lecturer_stats() returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not can_read('lecturers') then raise exception 'Not authorised'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id,
    'students', (select count(distinct ap.id) from lecturer_courses lc join application_courses ac on ac.course_code = lc.course_code and not ac.deferred join applications ap on ap.id = ac.application_id and ap.admission_decision = 'approved' where lc.lecturer_id = l.id),
    'enrolled', (select count(distinct ap.id) from lecturer_courses lc join application_courses ac on ac.course_code = lc.course_code join applications ap on ap.id = ac.application_id and ap.status in ('submitted','under_review','approved') where lc.lecturer_id = l.id),
    'lectures', (select count(*) from lectures x where x.lecturer_id = l.id), 'assignments', (select count(*) from assignments x where x.lecturer_id = l.id), 'exams', (select count(*) from exams x where x.lecturer_id = l.id),
    'to_grade', (select count(*) from submissions s join assignments a on a.id = s.assignment_id where a.lecturer_id = l.id and s.graded_at is null),
    'rating', (select round(avg(rating), 1) from student_feedback f where f.lecturer_id = l.id and f.rating is not null), 'ratings', (select count(*) from student_feedback f where f.lecturer_id = l.id and f.rating is not null))) from lecturers l), '[]'::jsonb);
end $$;
create or replace function admin_set_lecturer_active(p_id uuid, p_active boolean) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare l lecturers; who text;
begin
  if not can_write('lecturers') then raise exception 'Your role cannot manage lecturers'; end if;
  select full_name into who from staff where id = auth.uid();
  select * into l from lecturers where id = p_id; if not found then raise exception 'Lecturer not found'; end if;
  update lecturers set is_active = p_active where id = p_id;
  if l.user_id is not null then update staff set status = case when p_active then 'approved' else 'suspended' end where id = l.user_id and role = 'tutor' and status in ('approved','suspended'); end if;
  insert into audit_log(actor, actor_name, action, target, note) values (auth.uid(), who, case when p_active then 'lecturer_activated' else 'lecturer_deactivated' end, l.full_name, null);
end $$;
create or replace function admin_delete_lecturer(p_id uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare l lecturers; who text;
begin
  if not can_write('lecturers') then raise exception 'Your role cannot manage lecturers'; end if;
  select full_name into who from staff where id = auth.uid();
  select * into l from lecturers where id = p_id; if not found then raise exception 'Lecturer not found'; end if;
  if l.user_id is not null then update staff set status = 'suspended' where id = l.user_id and role = 'tutor' and status = 'approved'; end if;
  insert into audit_log(actor, actor_name, action, target, note) values (auth.uid(), who, 'lecturer_deleted', l.full_name, l.email);
  delete from lecturers where id = p_id;   -- their courses, lectures, assignments, exams and feedback go with them; student grades are kept
end $$;
create or replace function admin_tutor_accounts() returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not can_write('lecturers') then raise exception 'Your role cannot manage lecturers'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name, 'email', s.email, 'phone', s.phone, 'status', s.status, 'lecturer_id', l.id) order by s.full_name)
    from staff s left join lecturers l on l.user_id = s.id where s.role = 'tutor' and s.status in ('approved','suspended')), '[]'::jsonb);
end $$;
create or replace function admin_add_lecturer(p_staff uuid, p_name text, p_email text, p_phone text) returns lecturers language plpgsql security definer set search_path = public, pg_temp as $$
declare s staff; l lecturers;
begin
  if not can_write('lecturers') then raise exception 'Your role cannot manage lecturers'; end if;
  if p_staff is not null then
    select * into s from staff where id = p_staff and role = 'tutor'; if not found then raise exception 'That account is not a tutor account'; end if;
    insert into lecturers(full_name, email, phone, user_id) values (s.full_name, lower(s.email), s.phone, s.id) on conflict (email) do update set user_id = excluded.user_id, is_active = true returning * into l;
  else
    if length(trim(coalesce(p_name,''))) < 3 then raise exception 'Enter the lecturer''s full name'; end if;
    insert into lecturers(full_name, email, phone) values (trim(p_name), nullif(lower(trim(coalesce(p_email,''))), ''), nullif(trim(coalesce(p_phone,'')), '')) returning * into l;
  end if;
  return l;
end $$;

-- 5. Student portal data: aware of deferred courses and deferment requests
create or replace function portal_data() returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); perf jsonb; res jsonb;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  select to_jsonb(z) into perf from (
    with avgs as (select a.id aid, a.intake_id, a.user_id, avg(e.total) av, count(*) n from applications a join exam_results e on e.application_id = a.id where a.admission_decision = 'approved' group by a.id, a.intake_id, a.user_id),
    ranked as (select aid, intake_id, user_id, av, n, rank() over (partition by intake_id order by av desc) rk from avgs)
    select r.aid as application_id, round(r.av, 1) as average, r.rk as rank, r.n as graded,
      (select count(*) from applications x where x.intake_id = r.intake_id and x.admission_decision = 'approved') as class_size
    from ranked r where r.user_id = uid order by r.aid desc limit 1) z;
  select jsonb_build_object(
    'profile', (select to_jsonb(p) from (select full_name, phone, email from profiles where id = uid) p),
    'applications', coalesce((select jsonb_agg(a order by a.created_at desc) from (
      select ap.id, ap.student_id, ap.status, ap.admission_decision, ap.admission_note, ap.intake_id, i.label as intake_label,
        (i.is_active and (i.opens_at is null or i.opens_at <= now()) and (i.closes_at is null or i.closes_at >= now())) as intake_open,
        ap.total_ngn, ap.package_code, ap.pay_bank, ap.pay_account, ap.pay_reference, ap.passport_path, ap.form_data, ap.created_at, ap.welcomed_at, (ap.admission_decision = 'approved') as admitted,
        coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name, 'category', c.category, 'fee', ac.fee_ngn, 'deferred', ac.deferred,
          'tutors', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.full_name, 'email', l.email, 'phone', l.phone)), '[]'::jsonb) from lecturer_courses lc join lecturers l on l.id = lc.lecturer_id where lc.course_code = c.code and l.is_active),
          'result', (select to_jsonb(r) from (select ca, exam_obj, exam_prac, total, band from exam_results er where er.application_id = ap.id and er.course_code = c.code) r)))
          from application_courses ac join courses c on c.code = ac.course_code where ac.application_id = ap.id), '[]'::jsonb) as courses
      from applications ap join intakes i on i.id = ap.intake_id where ap.user_id = uid and ap.status <> 'expired') a), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(x order by x.due_at nulls last) from (
      select s.id, s.title, s.description, s.due_at, s.max_score, s.closed, s.course_code, c.name as course_name, c.category as course_category, ap.id as application_id,
        (select to_jsonb(q) from (select id, body, file_path, submitted_at, marks, feedback, graded_at from submissions sub where sub.assignment_id = s.id and sub.application_id = ap.id) q) as submission
      from assignments s join application_courses ac on ac.course_code = s.course_code and not ac.deferred
      join applications ap on ap.id = ac.application_id and ap.user_id = uid and ap.admission_decision = 'approved' and (s.intake_id is null or s.intake_id = ap.intake_id)
      join courses c on c.code = s.course_code) x), '[]'::jsonb),
    'lectures', coalesce((select jsonb_agg(x order by x.held_at desc) from (
      select lt.id, lt.title, lt.description, lt.held_at, lt.course_code, c.name as course_name, c.category as course_category, lt.material_path, l.full_name as tutor
      from lectures lt join application_courses ac on ac.course_code = lt.course_code and not ac.deferred
      join applications ap on ap.id = ac.application_id and ap.user_id = uid and ap.admission_decision = 'approved' and (lt.intake_id is null or lt.intake_id = ap.intake_id)
      join courses c on c.code = lt.course_code left join lecturers l on l.id = lt.lecturer_id) x), '[]'::jsonb),
    'exams', coalesce((select jsonb_agg(x order by x.due_at nulls last) from (
      select e.id, e.title, e.instructions, e.due_at, e.course_code, c.name as course_name, c.category as course_category
      from exams e join application_courses ac on ac.course_code = e.course_code and not ac.deferred
      join applications ap on ap.id = ac.application_id and ap.user_id = uid and ap.admission_decision = 'approved' and (e.intake_id is null or e.intake_id = ap.intake_id)
      join courses c on c.code = e.course_code) x), '[]'::jsonb),
    'performance', perf,
    'additions', coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from (
      select ca.id, ca.application_id, ca.course_code, c.name as course_name, c.category as course_category, ca.fee_ngn, ca.status, ca.note, ca.created_at
      from course_additions ca join applications ap on ap.id = ca.application_id join courses c on c.code = ca.course_code where ap.user_id = uid) q), '[]'::jsonb),
    'deferments', coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from (
      select d.id, d.application_id, d.scope, d.course_codes, d.reason_type, d.reason, d.status, d.admin_note, d.created_at, d.decided_at, ri.label as return_label,
        (select coalesce(jsonb_agg(c.name || ' (' || c.category || ')'), '[]'::jsonb) from courses c where c.code = any(d.course_codes)) as course_names
      from deferments d join applications ap on ap.id = d.application_id left join intakes ri on ri.id = d.return_intake_id where ap.user_id = uid) q), '[]'::jsonb),
    'catalog', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'category', category, 'fee', fee_ngn)) from courses where is_active), '[]'::jsonb),
    'open_intakes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label)) from intakes where is_active and (opens_at is null or opens_at <= now()) and (closes_at is null or closes_at >= now())), '[]'::jsonb)
  ) into res;
  return res;
end $$;

do $$ declare f text; begin foreach f in array array['validate_form(jsonb)','start_application(uuid)','save_application_form(uuid,jsonb,text)','submit_application(uuid)','revert_application_to_draft(uuid)','mark_welcomed(uuid)','cancel_addition(uuid)','request_deferment(uuid,text,text[],text,text,uuid)','cancel_deferment(uuid)','admin_review_deferment(uuid,text,text)','tutor_feedback()','admin_lecturer_stats()','admin_set_lecturer_active(uuid,boolean)','admin_delete_lecturer(uuid)','admin_tutor_accounts()','admin_add_lecturer(uuid,text,text,text)'] loop
  execute format('revoke all on function %s from public, anon', f); execute format('grant execute on function %s to authenticated', f); end loop; end $$;
