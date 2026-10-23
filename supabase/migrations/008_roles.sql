-- ===== 008: roles & permissions, staff management, sheet-sync status =====
-- 1. Staff statuses and roles
alter table staff drop constraint if exists staff_status_check;
alter table staff add constraint staff_status_check check (status in ('pending','approved','rejected','suspended'));
update staff set role = case
  when position = 'Administrator' then 'administrator'
  when position like 'Registrar%'  then 'registrar'
  when position like 'Finance%'    then 'finance'
  when position like 'Academic%'   then 'academic'
  when position = 'Operations'     then 'operations'
  when position like 'Tutor%'      then 'tutor'
  when position = 'Other'          then 'viewer'
  else 'administrator' end              -- rows created by hand (no position) stay full administrators so nobody is locked out
where role = 'admin';
alter table staff drop constraint if exists staff_role_check;
alter table staff add constraint staff_role_check check (role in ('administrator','registrar','finance','academic','operations','tutor','viewer'));
alter table staff alter column role set default 'viewer';

-- 2. Permission helpers
create or replace function staff_role() returns text language sql security definer stable set search_path = public, pg_temp as $$
  select role from staff where id = auth.uid() and status = 'approved' $$;
create or replace function has_role(variadic r text[]) returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select coalesce(staff_role() = any(r), false) $$;
create or replace function is_admin() returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select coalesce(staff_role() = 'administrator', false) $$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- 3. Row-level security by role
drop policy if exists staff_read on staff;
create policy staff_read on staff for select using (id = auth.uid() or is_admin());
do $$ declare t text; begin
  foreach t in array array['applications','application_courses','payments','profiles'] loop
    execute format('drop policy if exists adm_read on %I', t);
    execute format('create policy adm_read on %I for select using (has_role(''administrator'',''registrar'',''finance'',''academic'',''operations'',''viewer''))', t);
  end loop;
  foreach t in array array['lectures','assignments','student_feedback'] loop
    execute format('drop policy if exists adm_all on %I', t);
    execute format('drop policy if exists staff_read on %I', t);
    execute format('create policy staff_read on %I for select using (has_role(''administrator'',''registrar'',''finance'',''academic'',''operations'',''viewer''))', t);
  end loop;
end $$;
drop policy if exists adm_all on intakes;   create policy staff_write on intakes  for all using (has_role('administrator','registrar','academic')) with check (has_role('administrator','registrar','academic'));
drop policy if exists adm_all on courses;   create policy staff_write on courses  for all using (has_role('administrator','academic')) with check (has_role('administrator','academic'));
drop policy if exists adm_all on packages;  create policy staff_write on packages for all using (has_role('administrator','academic')) with check (has_role('administrator','academic'));
drop policy if exists adm_all on lecturers; drop policy if exists lect_read on lecturers; drop policy if exists lect_write on lecturers;
create policy lect_read  on lecturers for select using (has_role('administrator','registrar','finance','academic','operations','viewer'));
create policy lect_write on lecturers for all using (has_role('administrator','academic')) with check (has_role('administrator','academic'));
drop policy if exists adm_all on lecturer_courses; drop policy if exists lc_read on lecturer_courses; drop policy if exists lc_write on lecturer_courses;
create policy lc_read  on lecturer_courses for select using (has_role('administrator','registrar','finance','academic','operations','viewer'));
create policy lc_write on lecturer_courses for all using (has_role('administrator','academic')) with check (has_role('administrator','academic'));
drop policy if exists adm_all on audit_log; drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log for select using (is_admin());
drop policy if exists adm_pp on storage.objects;
create policy adm_pp on storage.objects for select to authenticated using (bucket_id = 'passports' and has_role('administrator','registrar','academic','operations'));

-- 4. Payment / admission actions limited to the right roles
create or replace function admin_review_payment(p_app uuid, p_decision text, p_note text default null) returns applications
language plpgsql security definer set search_path = public, pg_temp as $$
declare a applications; who text;
begin
  if not has_role('administrator','finance') then raise exception 'Only Finance or an Administrator can review payments'; end if;
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
  if not has_role('administrator','registrar') then raise exception 'Only the Registrar or an Administrator can decide admissions'; end if;
  if p_decision not in ('under_review','approved','rejected') then raise exception 'Invalid decision'; end if;
  select full_name into who from staff where id = auth.uid();
  select * into a from applications where id = p_app; if not found then raise exception 'Application not found'; end if;
  if a.status not in ('submitted','under_review','approved') then raise exception 'The application form has not been submitted yet'; end if;
  update applications set admission_decision = p_decision, admission_note = p_note, reviewed_by = auth.uid(), reviewed_at = now(),
    status = case p_decision when 'approved' then 'approved' when 'under_review' then 'under_review' else 'submitted' end where id = p_app returning * into a;
  insert into audit_log(actor, actor_name, action, target, note) values(auth.uid(), who, 'admission_' || p_decision, coalesce(a.student_id, a.pay_reference), p_note);
  return a;
end $$;

-- 5. Staff management (Administrator only)
create or replace function admin_set_staff(p_id uuid, p_status text, p_role text default null) returns staff
language plpgsql security definer set search_path = public, pg_temp as $$
declare s staff; who text; n int; new_role text;
begin
  if not is_admin() then raise exception 'Only administrators can manage staff accounts'; end if;
  if p_status not in ('pending','approved','rejected','suspended') then raise exception 'Invalid status'; end if;
  if p_role is not null and p_role not in ('administrator','registrar','finance','academic','operations','tutor','viewer') then raise exception 'Invalid role'; end if;
  select full_name into who from staff where id = auth.uid();
  select * into s from staff where id = p_id; if not found then raise exception 'Staff record not found'; end if;
  new_role := coalesce(p_role, s.role);
  if p_id = auth.uid() and (p_status <> 'approved' or new_role <> 'administrator') then raise exception 'You cannot demote, suspend or reject your own account'; end if;
  if s.role = 'administrator' and s.status = 'approved' and (p_status <> 'approved' or new_role <> 'administrator') then
    select count(*) into n from staff where role = 'administrator' and status = 'approved' and id <> p_id;
    if n = 0 then raise exception 'At least one approved administrator must remain'; end if;
  end if;
  update staff set status = p_status, role = new_role where id = p_id returning * into s;
  insert into audit_log(actor, actor_name, action, target, note) values(auth.uid(), who, 'staff_' || p_status, s.full_name, 'role: ' || s.role);
  return s;
end $$;
drop trigger if exists staff_to_sheet on staff;
create trigger staff_to_sheet after insert or update of status, role on staff for each row execute function queue_staff_sheet();

-- 6. Sheet sync visibility (Administrator only)
create or replace function admin_sync_status() returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then raise exception 'Not authorised'; end if;
  return jsonb_build_object('pending', (select count(*) from sheet_outbox where not done),
    'stuck', (select count(*) from sheet_outbox where not done and attempts >= 5),
    'errors', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select kind, left(last_error, 220) as error, created_at from sheet_outbox where not done and last_error is not null order by id desc limit 3) e));
end $$;
create or replace function admin_resync_sheet() returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare a int; b int;
begin
  if not is_admin() then raise exception 'Not authorised'; end if;
  update sheet_outbox set attempts = 0, last_error = null where not done;
  insert into sheet_outbox(application_id, kind) select id, 'staff' from staff; get diagnostics a = row_count;
  insert into sheet_outbox(application_id, kind) select id, 'application' from applications where payment_claimed_at is not null or status not in ('pending_payment','expired'); get diagnostics b = row_count;
  return a + b;
end $$;
revoke all on function admin_set_staff(uuid,text,text), admin_sync_status(), admin_resync_sheet() from public, anon;
grant execute on function admin_set_staff(uuid,text,text), admin_sync_status(), admin_resync_sheet() to authenticated;
revoke all on function staff_role(), has_role(text[]) from public, anon;
grant execute on function staff_role(), has_role(text[]) to authenticated;

-- 7. Push every existing staff member to the sheet once the new sync function is deployed
insert into sheet_outbox(application_id, kind) select id, 'staff' from staff;
