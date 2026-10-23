-- ===== 009: student & tutor portals =====
alter table lecturers add column if not exists user_id uuid unique references auth.users on delete set null;
alter table lectures add column if not exists intake_id uuid references intakes, add column if not exists description text, add column if not exists material_path text;
alter table assignments add column if not exists intake_id uuid references intakes, add column if not exists description text, add column if not exists due_at timestamptz,
  add column if not exists max_score int, add column if not exists closed boolean not null default false;
alter table student_feedback add column if not exists application_id uuid references applications on delete cascade, add column if not exists course_code text;
create unique index if not exists one_rating on student_feedback(application_id, course_code, lecturer_id) where application_id is not null;

create table if not exists submissions(id uuid primary key default gen_random_uuid(), assignment_id uuid not null references assignments on delete cascade,
  application_id uuid not null references applications on delete cascade, user_id uuid not null, body text, file_path text, submitted_at timestamptz default now(),
  marks int, feedback text, graded_at timestamptz, unique(assignment_id, application_id));
create table if not exists exam_results(id uuid primary key default gen_random_uuid(), application_id uuid not null references applications on delete cascade,
  course_code text not null references courses, ca int not null default 0 check(ca >= 0), exam_obj int not null default 0 check(exam_obj >= 0), exam_prac int not null default 0 check(exam_prac >= 0),
  total int generated always as (ca + exam_obj + exam_prac) stored,
  band text generated always as (case when ca + exam_obj + exam_prac >= 70 then 'Distinction' when ca + exam_obj + exam_prac >= 60 then 'Credit' when ca + exam_obj + exam_prac >= 50 then 'Pass' else 'Fail' end) stored,
  graded_by uuid, updated_at timestamptz default now(), unique(application_id, course_code));
create table if not exists exams(id uuid primary key default gen_random_uuid(), lecturer_id uuid not null references lecturers on delete cascade, course_code text references courses,
  intake_id uuid references intakes, title text not null, instructions text, questions text, due_at timestamptz, created_at timestamptz default now());
create table if not exists course_additions(id uuid primary key default gen_random_uuid(), application_id uuid not null references applications on delete cascade, course_code text not null references courses,
  fee_ngn int not null, status text not null default 'pending_payment' check(status in ('pending_payment','payment_claimed','approved','rejected')), note text,
  claimed_at timestamptz, created_at timestamptz default now());
alter table submissions enable row level security; alter table exam_results enable row level security; alter table exams enable row level security; alter table course_additions enable row level security;

-- Tutor accounts: an approved staff member with role 'tutor' is linked to (or creates) a lecturer record matched by email.
create or replace function link_tutor() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.role = 'tutor' and new.status = 'approved' then
    insert into lecturers(full_name, email, phone, user_id) values(new.full_name, lower(new.email), new.phone, new.id)
    on conflict (email) do update set user_id = new.id where lecturers.user_id is null or lecturers.user_id = new.id;
  end if; return new; end $$;
drop trigger if exists staff_link_tutor on staff;
create trigger staff_link_tutor after insert or update of status, role on staff for each row execute function link_tutor();
insert into lecturers(full_name, email, phone, user_id) select full_name, lower(email), phone, id from staff where role = 'tutor' and status = 'approved'
  on conflict (email) do update set user_id = excluded.user_id where lecturers.user_id is null;

-- Row-level security
create or replace function my_lecturer_ids() returns setof uuid language sql security definer stable set search_path = public, pg_temp as $$ select id from lecturers where user_id = auth.uid() $$;
drop policy if exists lect_self on lecturers; create policy lect_self on lecturers for select using (user_id = auth.uid());
drop policy if exists lc_self on lecturer_courses; create policy lc_self on lecturer_courses for select using (lecturer_id in (select my_lecturer_ids()));
do $$ declare t text; begin foreach t in array array['lectures','assignments','exams'] loop
  execute format('drop policy if exists tutor_own on %I', t);
  execute format('create policy tutor_own on %I for all using (lecturer_id in (select my_lecturer_ids())) with check (lecturer_id in (select my_lecturer_ids()))', t);
end loop; end $$;
drop policy if exists tutor_fb on student_feedback; create policy tutor_fb on student_feedback for select using (lecturer_id in (select my_lecturer_ids()));
drop policy if exists staff_read on exams; create policy staff_read on exams for select using (has_role('administrator','registrar','finance','academic','operations','viewer'));
drop policy if exists staff_read on exam_results; create policy staff_read on exam_results for select using (has_role('administrator','registrar','finance','academic','operations','viewer'));
drop policy if exists staff_read on submissions; create policy staff_read on submissions for select using (has_role('administrator','academic'));
drop policy if exists staff_read on course_additions; create policy staff_read on course_additions for select using (has_role('administrator','registrar','finance','academic','operations','viewer'));

-- Storage: lecture materials (tutors upload) and student submissions
insert into storage.buckets(id, name, public, file_size_limit) values ('materials','materials',false,10485760), ('submissions','submissions',false,5242880) on conflict (id) do nothing;
drop policy if exists mat_write on storage.objects; create policy mat_write on storage.objects for insert to authenticated with check (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text and has_role('tutor','administrator','academic'));
drop policy if exists mat_update on storage.objects; create policy mat_update on storage.objects for update to authenticated using (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists mat_read on storage.objects; create policy mat_read on storage.objects for select to authenticated using (bucket_id = 'materials');
drop policy if exists sub_write on storage.objects; create policy sub_write on storage.objects for insert to authenticated with check (bucket_id = 'submissions' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists sub_update on storage.objects; create policy sub_update on storage.objects for update to authenticated using (bucket_id = 'submissions' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists sub_read on storage.objects; create policy sub_read on storage.objects for select to authenticated using (bucket_id = 'submissions' and ((storage.foldername(name))[1] = auth.uid()::text or staff_role() is not null));

-- ===== STUDENT: everything the portal needs in one call =====
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
        ap.total_ngn, ap.package_code, ap.pay_bank, ap.pay_account, ap.pay_reference, ap.passport_path, ap.form_data, ap.created_at, (ap.admission_decision = 'approved') as admitted,
        coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name, 'category', c.category, 'fee', ac.fee_ngn,
          'tutors', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.full_name, 'email', l.email, 'phone', l.phone)), '[]'::jsonb) from lecturer_courses lc join lecturers l on l.id = lc.lecturer_id where lc.course_code = c.code and l.is_active),
          'result', (select to_jsonb(r) from (select ca, exam_obj, exam_prac, total, band from exam_results er where er.application_id = ap.id and er.course_code = c.code) r)))
          from application_courses ac join courses c on c.code = ac.course_code where ac.application_id = ap.id), '[]'::jsonb) as courses
      from applications ap join intakes i on i.id = ap.intake_id where ap.user_id = uid and ap.status <> 'expired') a), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(x order by x.due_at nulls last) from (
      select s.id, s.title, s.description, s.due_at, s.max_score, s.closed, s.course_code, c.name as course_name, ap.id as application_id,
        (select to_jsonb(q) from (select id, body, file_path, submitted_at, marks, feedback, graded_at from submissions sub where sub.assignment_id = s.id and sub.application_id = ap.id) q) as submission
      from assignments s join application_courses ac on ac.course_code = s.course_code
      join applications ap on ap.id = ac.application_id and ap.user_id = uid and ap.admission_decision = 'approved' and (s.intake_id is null or s.intake_id = ap.intake_id)
      join courses c on c.code = s.course_code) x), '[]'::jsonb),
    'lectures', coalesce((select jsonb_agg(x order by x.held_at desc) from (
      select lt.id, lt.title, lt.description, lt.held_at, lt.course_code, c.name as course_name, lt.material_path, l.full_name as tutor
      from lectures lt join application_courses ac on ac.course_code = lt.course_code
      join applications ap on ap.id = ac.application_id and ap.user_id = uid and ap.admission_decision = 'approved' and (lt.intake_id is null or lt.intake_id = ap.intake_id)
      join courses c on c.code = lt.course_code left join lecturers l on l.id = lt.lecturer_id) x), '[]'::jsonb),
    'exams', coalesce((select jsonb_agg(x order by x.due_at nulls last) from (
      select e.id, e.title, e.instructions, e.due_at, e.course_code, c.name as course_name
      from exams e join application_courses ac on ac.course_code = e.course_code
      join applications ap on ap.id = ac.application_id and ap.user_id = uid and ap.admission_decision = 'approved' and (e.intake_id is null or e.intake_id = ap.intake_id)
      join courses c on c.code = e.course_code) x), '[]'::jsonb),
    'performance', perf,
    'additions', coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from (
      select ca.id, ca.application_id, ca.course_code, c.name as course_name, ca.fee_ngn, ca.status, ca.note, ca.created_at
      from course_additions ca join applications ap on ap.id = ca.application_id join courses c on c.code = ca.course_code where ap.user_id = uid) q), '[]'::jsonb),
    'catalog', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'category', category, 'fee', fee_ngn)) from courses where is_active), '[]'::jsonb),
    'open_intakes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label)) from intakes where is_active and (opens_at is null or opens_at <= now()) and (closes_at is null or closes_at >= now())), '[]'::jsonb)
  ) into res;
  return res;
end $$;

create or replace function submit_assignment(p_assignment uuid, p_application uuid, p_body text, p_file text) returns submissions
language plpgsql security definer set search_path = public, pg_temp as $$
declare s assignments; a applications; r submissions;
begin
  select * into a from applications where id = p_application and user_id = auth.uid() and admission_decision = 'approved'; if not found then raise exception 'Only admitted students can submit work'; end if;
  select * into s from assignments where id = p_assignment; if not found then raise exception 'Assignment not found'; end if;
  if s.closed then raise exception 'This assignment is closed'; end if;
  if not exists (select 1 from application_courses where application_id = a.id and course_code = s.course_code) or (s.intake_id is not null and s.intake_id <> a.intake_id) then raise exception 'This assignment is not for your course'; end if;
  if coalesce(trim(p_body), '') = '' and p_file is null then raise exception 'Write a response or attach a file'; end if;
  if exists (select 1 from submissions where assignment_id = p_assignment and application_id = p_application and graded_at is not null) then raise exception 'This submission has already been graded'; end if;
  insert into submissions(assignment_id, application_id, user_id, body, file_path) values (p_assignment, p_application, auth.uid(), p_body, p_file)
  on conflict (assignment_id, application_id) do update set body = excluded.body, file_path = coalesce(excluded.file_path, submissions.file_path), submitted_at = now() returning * into r;
  return r;
end $$;

create or replace function rate_tutor(p_application uuid, p_course text, p_lecturer uuid, p_rating int, p_comment text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_rating < 1 or p_rating > 5 then raise exception 'Choose a rating from 1 to 5'; end if;
  if not exists (select 1 from applications a join application_courses ac on ac.application_id = a.id where a.id = p_application and a.user_id = auth.uid() and a.admission_decision = 'approved' and ac.course_code = p_course)
    then raise exception 'You can only rate tutors of courses you are enrolled in'; end if;
  if not exists (select 1 from lecturer_courses where lecturer_id = p_lecturer and course_code = p_course) then raise exception 'That tutor does not teach this course'; end if;
  insert into student_feedback(lecturer_id, rating, comment, application_id, course_code) values (p_lecturer, p_rating, nullif(trim(p_comment), ''), p_application, p_course)
  on conflict (application_id, course_code, lecturer_id) where application_id is not null do update set rating = excluded.rating, comment = excluded.comment, created_at = now();
end $$;

create or replace function request_course_addition(p_application uuid, p_course text) returns course_additions
language plpgsql security definer set search_path = public, pg_temp as $$
declare a applications; c courses; fee int; r course_additions; covered boolean := false;
begin
  select * into a from applications where id = p_application and user_id = auth.uid(); if not found then raise exception 'Application not found'; end if;
  if a.admission_decision <> 'approved' then raise exception 'You can add courses once you have been admitted'; end if;
  if not exists (select 1 from intakes where id = a.intake_id and is_active and (closes_at is null or closes_at >= now())) then raise exception 'This intake is closed, so courses can no longer be added'; end if;
  select * into c from courses where code = p_course and is_active; if not found then raise exception 'Course not available'; end if;
  if exists (select 1 from application_courses where application_id = a.id and course_code = p_course) then raise exception 'You are already enrolled in this course'; end if;
  if exists (select 1 from course_additions where application_id = a.id and course_code = p_course and status in ('pending_payment','payment_claimed')) then raise exception 'You already have a pending request for this course'; end if;
  fee := c.fee_ngn;
  if a.package_code is not null and not exists (select 1 from application_courses ac join courses c2 on c2.code = ac.course_code where ac.application_id = a.id and c2.category = c.category) then covered := true; fee := 0; end if;
  insert into course_additions(application_id, course_code, fee_ngn, status) values (a.id, c.code, fee, case when covered then 'approved' else 'pending_payment' end) returning * into r;
  if covered then insert into application_courses(application_id, course_code, fee_ngn) values (a.id, c.code, 0); end if;
  return r;
end $$;

create or replace function claim_addition(p_id uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update course_additions ca set status = 'payment_claimed', claimed_at = now(), note = null from applications ap
  where ca.id = p_id and ap.id = ca.application_id and ap.user_id = auth.uid() and ca.status in ('pending_payment');
  if not found then raise exception 'Nothing to confirm'; end if;
end $$;

create or replace function admin_review_addition(p_id uuid, p_decision text, p_note text default null) returns course_additions
language plpgsql security definer set search_path = public, pg_temp as $$
declare r course_additions; who text; a applications;
begin
  if not has_role('administrator','finance') then raise exception 'Only Finance or an Administrator can review payments'; end if;
  select full_name into who from staff where id = auth.uid();
  select * into r from course_additions where id = p_id; if not found then raise exception 'Request not found'; end if;
  if r.status not in ('pending_payment','payment_claimed') then raise exception 'This request is already %', r.status; end if;
  select * into a from applications where id = r.application_id;
  if p_decision = 'approved' then
    insert into application_courses(application_id, course_code, fee_ngn) values (r.application_id, r.course_code, r.fee_ngn) on conflict do nothing;
    update applications set total_ngn = total_ngn + r.fee_ngn where id = r.application_id;
    insert into payments(application_id, reference, expected_ngn, paid_ngn, raw_event) values (r.application_id, 'ADD-' || r.id, r.fee_ngn, r.fee_ngn, jsonb_build_object('source', 'admin', 'by', who, 'course', r.course_code)) on conflict (reference) do nothing;
    update course_additions set status = 'approved', note = p_note where id = p_id returning * into r;
  elsif p_decision = 'query' then update course_additions set status = 'pending_payment', note = p_note, claimed_at = null where id = p_id returning * into r;
  elsif p_decision = 'rejected' then update course_additions set status = 'rejected', note = p_note where id = p_id returning * into r;
  else raise exception 'Invalid decision'; end if;
  insert into audit_log(actor, actor_name, action, target, note) values (auth.uid(), who, 'addition_' || p_decision, coalesce(a.student_id, a.pay_reference) || ' ' || r.course_code, p_note);
  return r;
end $$;

-- ===== TUTOR =====
create or replace function tutor_roster() returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not has_role('tutor') then raise exception 'Tutors only'; end if;
  return coalesce((select jsonb_agg(x order by x.name) from (
    select ap.id as application_id, ap.student_id, coalesce(nullif(trim(coalesce(ap.form_data->>'surname','') || ' ' || coalesce(ap.form_data->>'firstName','')), ''), pr.full_name) as name,
      pr.email, coalesce(ap.form_data->>'phone', pr.phone) as phone, ap.intake_id, i.label as intake_label, c.code as course_code, c.name as course_name,
      (select to_jsonb(r) from (select ca, exam_obj, exam_prac, total, band from exam_results er where er.application_id = ap.id and er.course_code = c.code) r) as result
    from lecturers l join lecturer_courses lc on lc.lecturer_id = l.id join application_courses ac on ac.course_code = lc.course_code
    join applications ap on ap.id = ac.application_id and ap.admission_decision = 'approved' join profiles pr on pr.id = ap.user_id join intakes i on i.id = ap.intake_id join courses c on c.code = ac.course_code
    where l.user_id = auth.uid()) x), '[]'::jsonb);
end $$;

create or replace function tutor_save_result(p_application uuid, p_course text, p_ca int, p_obj int, p_prac int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_role('tutor') then raise exception 'Tutors only'; end if;
  if not exists (select 1 from lecturers l join lecturer_courses lc on lc.lecturer_id = l.id where l.user_id = auth.uid() and lc.course_code = p_course) then raise exception 'You do not teach this course'; end if;
  if not exists (select 1 from application_courses where application_id = p_application and course_code = p_course) then raise exception 'The student is not enrolled in this course'; end if;
  insert into exam_results(application_id, course_code, ca, exam_obj, exam_prac, graded_by) values (p_application, p_course, coalesce(p_ca,0), coalesce(p_obj,0), coalesce(p_prac,0), auth.uid())
  on conflict (application_id, course_code) do update set ca = excluded.ca, exam_obj = excluded.exam_obj, exam_prac = excluded.exam_prac, graded_by = auth.uid(), updated_at = now();
end $$;

create or replace function tutor_submissions(p_assignment uuid) returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not has_role('tutor') then raise exception 'Tutors only'; end if;
  if not exists (select 1 from assignments where id = p_assignment and lecturer_id in (select my_lecturer_ids())) then raise exception 'Not your assignment'; end if;
  return coalesce((select jsonb_agg(x order by x.submitted_at desc) from (
    select s.id, s.body, s.file_path, s.submitted_at, s.marks, s.feedback, s.graded_at, coalesce(nullif(trim(coalesce(ap.form_data->>'surname','') || ' ' || coalesce(ap.form_data->>'firstName','')), ''), pr.full_name) as student, ap.student_id
    from submissions s join applications ap on ap.id = s.application_id join profiles pr on pr.id = ap.user_id where s.assignment_id = p_assignment) x), '[]'::jsonb);
end $$;

create or replace function tutor_grade_submission(p_id uuid, p_marks int, p_feedback text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare mx int;
begin
  if not has_role('tutor') then raise exception 'Tutors only'; end if;
  select a.max_score into mx from submissions s join assignments a on a.id = s.assignment_id where s.id = p_id and a.lecturer_id in (select my_lecturer_ids());
  if not found then raise exception 'Not your assignment'; end if;
  if p_marks < 0 or (mx is not null and p_marks > mx) then raise exception 'Marks must be between 0 and %', coalesce(mx, 100); end if;
  update submissions set marks = p_marks, feedback = nullif(trim(p_feedback), ''), graded_at = now() where id = p_id;
end $$;

do $$ declare f text; begin foreach f in array array['portal_data()','submit_assignment(uuid,uuid,text,text)','rate_tutor(uuid,text,uuid,int,text)','request_course_addition(uuid,text)','claim_addition(uuid)','admin_review_addition(uuid,text,text)','tutor_roster()','tutor_save_result(uuid,text,int,int,int)','tutor_submissions(uuid)','tutor_grade_submission(uuid,int,text)','my_lecturer_ids()'] loop
  execute format('revoke all on function %s from public, anon', f); execute format('grant execute on function %s to authenticated', f); end loop; end $$;
