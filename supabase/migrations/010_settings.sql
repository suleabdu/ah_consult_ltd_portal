-- ===== 010: payment methods, website settings, staff access codes, editable role permissions =====

-- 1. Editable permission matrix (Administrator is always full access and is not stored here)
create table if not exists role_permissions(role text not null, module text not null check (module in ('applications','payments','intakes','courses','lecturers')),
  level text not null default 'none' check (level in ('none','read','write')), primary key (role, module));
alter table role_permissions enable row level security;
drop policy if exists perm_read on role_permissions; create policy perm_read on role_permissions for select using (staff_role() is not null);
insert into role_permissions(role, module, level)
select r.role, m.module, case r.role || ':' || m.module
  when 'registrar:applications' then 'write' when 'registrar:payments' then 'read' when 'registrar:intakes' then 'write' when 'registrar:courses' then 'read' when 'registrar:lecturers' then 'read'
  when 'finance:applications' then 'read' when 'finance:payments' then 'write' when 'finance:intakes' then 'read' when 'finance:courses' then 'read' when 'finance:lecturers' then 'read'
  when 'academic:applications' then 'read' when 'academic:intakes' then 'write' when 'academic:courses' then 'write' when 'academic:lecturers' then 'write'
  when 'operations:applications' then 'read' when 'operations:intakes' then 'read' when 'operations:courses' then 'read' when 'operations:lecturers' then 'read'
  when 'viewer:applications' then 'read' when 'viewer:intakes' then 'read' when 'viewer:courses' then 'read' when 'viewer:lecturers' then 'read'
  else 'none' end
from (values ('registrar'),('finance'),('academic'),('operations'),('viewer'),('tutor')) r(role)
cross join (values ('applications'),('payments'),('intakes'),('courses'),('lecturers')) m(module) on conflict do nothing;

create or replace function perm(m text) returns text language sql security definer stable set search_path = public, pg_temp as $$
  select case when staff_role() = 'administrator' then 'write' else coalesce((select level from role_permissions where role = staff_role() and module = m), 'none') end $$;
create or replace function can_read(m text) returns boolean language sql security definer stable set search_path = public, pg_temp as $$ select perm(m) in ('read','write') $$;
create or replace function can_write(m text) returns boolean language sql security definer stable set search_path = public, pg_temp as $$ select perm(m) = 'write' $$;
create or replace function admin_set_permission(p_role text, p_module text, p_level text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare who text;
begin
  if not is_admin() then raise exception 'Only administrators can change permissions'; end if;
  if p_role = 'administrator' then raise exception 'Administrator permissions cannot be changed'; end if;
  if p_level not in ('none','read','write') then raise exception 'Invalid level'; end if;
  select full_name into who from staff where id = auth.uid();
  insert into role_permissions(role, module, level) values (p_role, p_module, p_level) on conflict (role, module) do update set level = excluded.level;
  insert into audit_log(actor, actor_name, action, target, note) values (auth.uid(), who, 'permission_changed', p_role || ' / ' || p_module, p_level);
end $$;

-- 2. Apply the matrix to the security rules
do $$ declare t text; begin
  foreach t in array array['applications','application_courses','profiles'] loop
    execute format('drop policy if exists adm_read on %I', t); execute format('create policy adm_read on %I for select using (can_read(''applications''))', t); end loop;
  drop policy if exists adm_read on payments; create policy adm_read on payments for select using (can_read('payments'));
  foreach t in array array['lectures','assignments','student_feedback','exams','submissions'] loop
    execute format('drop policy if exists staff_read on %I', t); execute format('create policy staff_read on %I for select using (can_read(''lecturers''))', t); end loop;
  drop policy if exists staff_read on exam_results; create policy staff_read on exam_results for select using (can_read('applications'));
  drop policy if exists staff_read on course_additions; create policy staff_read on course_additions for select using (can_read('payments'));
end $$;
drop policy if exists staff_write on intakes;  create policy staff_write on intakes  for all using (can_write('intakes')) with check (can_write('intakes'));
drop policy if exists staff_write on courses;  create policy staff_write on courses  for all using (can_write('courses')) with check (can_write('courses'));
drop policy if exists staff_write on packages; create policy staff_write on packages for all using (can_write('courses')) with check (can_write('courses'));
drop policy if exists lect_read on lecturers;  create policy lect_read  on lecturers for select using (can_read('lecturers'));
drop policy if exists lect_write on lecturers; create policy lect_write on lecturers for all using (can_write('lecturers')) with check (can_write('lecturers'));
drop policy if exists lc_read on lecturer_courses;  create policy lc_read  on lecturer_courses for select using (can_read('lecturers'));
drop policy if exists lc_write on lecturer_courses; create policy lc_write on lecturer_courses for all using (can_write('lecturers')) with check (can_write('lecturers'));
drop policy if exists adm_pp on storage.objects; create policy adm_pp on storage.objects for select to authenticated using (bucket_id = 'passports' and can_read('applications'));

create or replace function admin_review_payment(p_app uuid, p_decision text, p_note text default null) returns applications
language plpgsql security definer set search_path = public, pg_temp as $$
declare a applications; who text;
begin
  if not can_write('payments') then raise exception 'Your role cannot review payments'; end if;
  select full_name into who from staff where id = auth.uid();
  select * into a from applications where id = p_app; if not found then raise exception 'Application not found'; end if;
  if a.status <> 'pending_payment' then raise exception 'This payment is already %', a.status; end if;
  if p_decision = 'approved' then
    insert into payments(application_id, reference, expected_ngn, paid_ngn, raw_event) values(a.id, 'MANUAL-' || a.pay_reference, a.total_ngn, a.total_ngn, jsonb_build_object('source','admin','by',who)) on conflict (reference) do nothing;
    update applications set status = 'paid', paid_at = now(), payment_review = 'approved', payment_note = p_note where id = p_app returning * into a;
  elsif p_decision = 'query' then update applications set payment_review = 'rejected', payment_note = p_note where id = p_app returning * into a;
  else raise exception 'Invalid decision'; end if;
  insert into audit_log(actor, actor_name, action, target, note) values(auth.uid(), who, 'payment_' || p_decision, a.pay_reference, p_note);
  return a;
end $$;
create or replace function admin_set_admission(p_app uuid, p_decision text, p_note text default null) returns applications
language plpgsql security definer set search_path = public, pg_temp as $$
declare a applications; who text;
begin
  if not can_write('applications') then raise exception 'Your role cannot decide admissions'; end if;
  if p_decision not in ('under_review','approved','rejected') then raise exception 'Invalid decision'; end if;
  select full_name into who from staff where id = auth.uid();
  select * into a from applications where id = p_app; if not found then raise exception 'Application not found'; end if;
  if a.status not in ('submitted','under_review','approved') then raise exception 'The application form has not been submitted yet'; end if;
  update applications set admission_decision = p_decision, admission_note = p_note, reviewed_by = auth.uid(), reviewed_at = now(),
    status = case p_decision when 'approved' then 'approved' when 'under_review' then 'under_review' else 'submitted' end where id = p_app returning * into a;
  insert into audit_log(actor, actor_name, action, target, note) values(auth.uid(), who, 'admission_' || p_decision, coalesce(a.student_id, a.pay_reference), p_note);
  return a;
end $$;
create or replace function admin_review_addition(p_id uuid, p_decision text, p_note text default null) returns course_additions
language plpgsql security definer set search_path = public, pg_temp as $$
declare r course_additions; who text; a applications;
begin
  if not can_write('payments') then raise exception 'Your role cannot review payments'; end if;
  select full_name into who from staff where id = auth.uid();
  select * into r from course_additions where id = p_id; if not found then raise exception 'Request not found'; end if;
  if r.status not in ('pending_payment','payment_claimed') then raise exception 'This request is already %', r.status; end if;
  select * into a from applications where id = r.application_id;
  if p_decision = 'approved' then
    insert into application_courses(application_id, course_code, fee_ngn) values (r.application_id, r.course_code, r.fee_ngn) on conflict do nothing;
    update applications set total_ngn = total_ngn + r.fee_ngn where id = r.application_id;
    insert into payments(application_id, reference, expected_ngn, paid_ngn, raw_event) values (r.application_id, 'ADD-' || r.id, r.fee_ngn, r.fee_ngn, jsonb_build_object('source','admin','by',who,'course',r.course_code)) on conflict (reference) do nothing;
    update course_additions set status = 'approved', note = p_note where id = p_id returning * into r;
  elsif p_decision = 'query' then update course_additions set status = 'pending_payment', note = p_note, claimed_at = null where id = p_id returning * into r;
  elsif p_decision = 'rejected' then update course_additions set status = 'rejected', note = p_note where id = p_id returning * into r;
  else raise exception 'Invalid decision'; end if;
  insert into audit_log(actor, actor_name, action, target, note) values (auth.uid(), who, 'addition_' || p_decision, coalesce(a.student_id, a.pay_reference) || ' ' || r.course_code, p_note);
  return r;
end $$;

-- 3. Payment methods. Secrets are encrypted by the admin-settings function; browsers can never read the encrypted column.
create table if not exists payment_providers(id uuid primary key default gen_random_uuid(), kind text not null check (kind in ('manual','monnify','upperlink')), label text not null,
  mode text not null default 'test' check (mode in ('test','live')), enabled boolean not null default true, is_default boolean not null default false,
  config jsonb not null default '{}', secrets_enc jsonb not null default '{}', secret_hints jsonb not null default '{}', updated_at timestamptz default now(), updated_by uuid);
create unique index if not exists one_default_provider on payment_providers(is_default) where is_default;
alter table payment_providers enable row level security;
drop policy if exists pp_read on payment_providers; create policy pp_read on payment_providers for select using (can_read('payments'));
revoke all on payment_providers from anon, authenticated;
grant select (id, kind, label, mode, enabled, is_default, config, secret_hints, updated_at) on payment_providers to authenticated;
alter table applications add column if not exists pay_provider text, add column if not exists pay_provider_id uuid, add column if not exists pay_mode text, add column if not exists pay_url text, add column if not exists pay_gateway_ref text;

-- 4. Website settings (public to read, Administrator to write). Never store secrets here.
create table if not exists site_settings(key text primary key, value jsonb not null default '{}', updated_at timestamptz default now(), updated_by uuid);
alter table site_settings enable row level security;
drop policy if exists ss_read on site_settings; create policy ss_read on site_settings for select using (true);
drop policy if exists ss_write on site_settings; create policy ss_write on site_settings for all using (is_admin()) with check (is_admin());
grant select on site_settings to anon, authenticated; grant insert, update, delete on site_settings to authenticated;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types) values ('site-assets', 'site-assets', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif','image/svg+xml','image/x-icon','image/vnd.microsoft.icon'])
  on conflict (id) do update set public = true;
drop policy if exists sa_write on storage.objects; create policy sa_write on storage.objects for insert to authenticated with check (bucket_id = 'site-assets' and is_admin());
drop policy if exists sa_update on storage.objects; create policy sa_update on storage.objects for update to authenticated using (bucket_id = 'site-assets' and is_admin());
drop policy if exists sa_delete on storage.objects; create policy sa_delete on storage.objects for delete to authenticated using (bucket_id = 'site-assets' and is_admin());
drop policy if exists sa_read on storage.objects; create policy sa_read on storage.objects for select using (bucket_id = 'site-assets');

-- 5. Staff access codes (only a hash is stored; the code itself is shown once when created)
create table if not exists access_codes(id uuid primary key default gen_random_uuid(), label text not null, code_hash text not null unique, hint text, allowed_roles text[],
  max_uses int, uses int not null default 0, expires_at timestamptz, active boolean not null default true, created_at timestamptz default now(), created_by uuid);
alter table access_codes enable row level security;
drop policy if exists ac_read on access_codes; create policy ac_read on access_codes for select using (is_admin());
revoke all on access_codes from anon; revoke insert, update, delete on access_codes from authenticated; grant select (id, label, hint, allowed_roles, max_uses, uses, expires_at, active, created_at) on access_codes to authenticated;
create or replace function redeem_access_code(p_hash text, p_role text, p_consume boolean default false) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare c access_codes;
begin
  select * into c from access_codes where code_hash = p_hash and active and (expires_at is null or expires_at > now()) and (max_uses is null or uses < max_uses) and (allowed_roles is null or p_role = any(allowed_roles));
  if not found then return false; end if;
  if p_consume then update access_codes set uses = uses + 1 where id = c.id; end if;
  return true;
end $$;
revoke all on function redeem_access_code(text,text,boolean) from public, anon, authenticated;
revoke all on function admin_set_permission(text,text,text), perm(text), can_read(text), can_write(text) from public, anon;
grant execute on function admin_set_permission(text,text,text), perm(text), can_read(text), can_write(text) to authenticated;
