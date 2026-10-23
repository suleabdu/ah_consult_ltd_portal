-- ===== ADMIN SYSTEM: staff approval, admin-wide access, lecturers, review workflow, audit trail =====
alter table profiles add column if not exists email text;
update profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin insert into public.profiles(id, full_name, phone, email) values(new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'phone', new.email) on conflict (id) do nothing; return new; end $$;

create table if not exists staff(id uuid primary key references auth.users on delete cascade, full_name text not null, email text not null, phone text, position text,
  role text not null default 'admin', status text not null default 'pending' check(status in('pending','approved','rejected')), created_at timestamptz default now());
create or replace function is_admin() returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists(select 1 from staff where id = auth.uid() and status = 'approved') $$;
alter table staff enable row level security;
drop policy if exists staff_read on staff; create policy staff_read on staff for select using(id = auth.uid() or is_admin());

alter table sheet_outbox add column if not exists kind text not null default 'application';
create or replace function queue_staff_sheet() returns trigger language plpgsql as $$ begin insert into sheet_outbox(application_id, kind) values(new.id, 'staff'); return new; end $$;
drop trigger if exists staff_to_sheet on staff;
create trigger staff_to_sheet after insert or update of status on staff for each row execute function queue_staff_sheet();

alter table applications add column if not exists payment_note text, add column if not exists admission_note text, add column if not exists reviewed_by uuid, add column if not exists reviewed_at timestamptz,
  add column if not exists admission_decision text not null default 'pending' check(admission_decision in('pending','under_review','approved','rejected'));

create table if not exists lecturers(id uuid primary key default gen_random_uuid(), full_name text not null, email text unique, phone text, is_active bool default true, created_at timestamptz default now());
create table if not exists lecturer_courses(lecturer_id uuid references lecturers on delete cascade, course_code text references courses on delete cascade, primary key(lecturer_id, course_code));
create table if not exists lectures(id uuid primary key default gen_random_uuid(), lecturer_id uuid references lecturers on delete cascade, course_code text, title text, held_at timestamptz default now());
create table if not exists assignments(id uuid primary key default gen_random_uuid(), lecturer_id uuid references lecturers on delete cascade, course_code text, title text, issued_at timestamptz default now());
create table if not exists student_feedback(id uuid primary key default gen_random_uuid(), lecturer_id uuid references lecturers on delete cascade, rating int check(rating between 1 and 5), comment text, created_at timestamptz default now());
create table if not exists audit_log(id bigserial primary key, actor uuid, actor_name text, action text, target text, note text, created_at timestamptz default now());

do $$ declare t text; begin
  foreach t in array array['lecturers','lecturer_courses','lectures','assignments','student_feedback','audit_log','intakes','courses','packages'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists adm_all on %I', t);
    execute format('create policy adm_all on %I for all using(is_admin()) with check(is_admin())', t);
  end loop;
  foreach t in array array['applications','application_courses','payments','profiles'] loop
    execute format('drop policy if exists adm_read on %I', t);
    execute format('create policy adm_read on %I for select using(is_admin())', t);
  end loop;
end $$;
drop policy if exists adm_pp on storage.objects;
create policy adm_pp on storage.objects for select to authenticated using(bucket_id = 'passports' and is_admin());

create or replace function admin_review_payment(p_app uuid, p_decision text, p_note text default null) returns applications
language plpgsql security definer set search_path = public, pg_temp as $$
declare a applications; who text;
begin
  if not is_admin() then raise exception 'Not authorised'; end if;
  select full_name into who from staff where id = auth.uid();
  select * into a from applications where id = p_app; if not found then raise exception 'Application not found'; end if;
  if a.status <> 'pending_payment' then raise exception 'This payment is already %', a.status; end if;
  if p_decision = 'approved' then
    insert into payments(application_id, reference, expected_ngn, paid_ngn, raw_event) values(a.id, 'MANUAL-' || a.pay_reference, a.total_ngn, a.total_ngn, jsonb_build_object('source','admin','by',who)) on conflict (reference) do nothing;
    update applications set status = 'paid', paid_at = now(), payment_review = 'approved', payment_note = p_note where id = p_app returning * into a;
  elsif p_decision = 'query' then
    update applications set payment_review = 'rejected', payment_note = p_note where id = p_app returning * into a;
  else raise exception 'Invalid decision'; end if;
  insert into audit_log(actor, actor_name, action, target, note) values(auth.uid(), who, 'payment_' || p_decision, a.pay_reference, p_note);
  return a;
end $$;

create or replace function admin_set_admission(p_app uuid, p_decision text, p_note text default null) returns applications
language plpgsql security definer set search_path = public, pg_temp as $$
declare a applications; who text;
begin
  if not is_admin() then raise exception 'Not authorised'; end if;
  if p_decision not in ('under_review','approved','rejected') then raise exception 'Invalid decision'; end if;
  select full_name into who from staff where id = auth.uid();
  select * into a from applications where id = p_app; if not found then raise exception 'Application not found'; end if;
  if a.status not in ('submitted','under_review','approved') then raise exception 'The application form has not been submitted yet'; end if;
  update applications set admission_decision = p_decision, admission_note = p_note, reviewed_by = auth.uid(), reviewed_at = now(),
    status = case p_decision when 'approved' then 'approved' when 'under_review' then 'under_review' else 'submitted' end where id = p_app returning * into a;
  insert into audit_log(actor, actor_name, action, target, note) values(auth.uid(), who, 'admission_' || p_decision, coalesce(a.student_id, a.pay_reference), p_note);
  return a;
end $$;
revoke all on function admin_review_payment(uuid,text,text), admin_set_admission(uuid,text,text) from public, anon;
grant execute on function admin_review_payment(uuid,text,text), admin_set_admission(uuid,text,text) to authenticated;
