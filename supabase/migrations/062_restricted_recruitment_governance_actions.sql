-- Action restrictions narrow existing module privileges; they never grant access.
-- No row means the existing module-level authorization continues unchanged.
create table public.role_action_restrictions (
  role text not null references public.staff_roles(code) on delete cascade,
  action text not null check (action in (
    'recruitment.vacancy.create','recruitment.vacancy.edit','recruitment.vacancy.delete','recruitment.vacancy.publish',
    'recruitment.question.create','recruitment.question.edit','recruitment.question.delete','recruitment.question.copy',
    'recruitment.application.request_deletion',
    'governance.team.approve','governance.team.reject','governance.team.suspend','governance.team.restore_pending','governance.team.assign_role',
    'governance.role.create','governance.role.edit','governance.role.delete'
  )),
  primary key(role,action)
);
alter table public.role_action_restrictions enable row level security;
revoke all on public.role_action_restrictions from public,anon,authenticated;
grant select on public.role_action_restrictions to authenticated;
create policy role_action_restrictions_admin_read on public.role_action_restrictions
  for select to authenticated using (public.is_admin());

create or replace function public.action_allowed(p_action text)
returns boolean language sql security definer stable set search_path=public,pg_temp as $$
 select case when public.is_admin() then true when public.staff_role() is null then false
  else not exists(select 1 from public.role_action_restrictions r where r.role=public.staff_role() and r.action=p_action) end
$$;
revoke all on function public.action_allowed(text) from public,anon;
grant execute on function public.action_allowed(text) to authenticated;

create or replace function public.admin_set_role_action_restrictions(p_role text,p_denied_actions text[])
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare act text; actor_name text;
 allowed constant text[] := array[
  'recruitment.vacancy.create','recruitment.vacancy.edit','recruitment.vacancy.delete','recruitment.vacancy.publish',
  'recruitment.question.create','recruitment.question.edit','recruitment.question.delete','recruitment.question.copy',
  'recruitment.application.request_deletion',
  'governance.team.approve','governance.team.reject','governance.team.suspend','governance.team.restore_pending','governance.team.assign_role',
  'governance.role.create','governance.role.edit','governance.role.delete'];
begin
 if not public.is_admin() then raise exception 'Super administrator access required'; end if;
 if p_role is null or p_role='administrator' then raise exception 'Administrator access cannot be restricted'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ahct_role_change:'||p_role,0));
 if not exists(select 1 from public.staff_roles where code=p_role) then raise exception 'Role not found'; end if;
 if exists(select 1 from unnest(coalesce(p_denied_actions,'{}'::text[])) x where x is null or not(x=any(allowed))) then raise exception 'Unknown action restriction'; end if;
 delete from public.role_action_restrictions where role=p_role;
 foreach act in array coalesce(p_denied_actions,'{}'::text[]) loop
  insert into public.role_action_restrictions(role,action) values(p_role,act) on conflict do nothing;
 end loop;
 select full_name into actor_name from public.staff where id=auth.uid();
 insert into public.audit_log(actor,actor_name,action,target,note)
 values(auth.uid(),coalesce(actor_name,'Administrator'),'role_action_restrictions_changed',p_role,'Restricted action settings updated');
end $$;
revoke all on function public.admin_set_role_action_restrictions(text,text[]) from public,anon;
grant execute on function public.admin_set_role_action_restrictions(text,text[]) to authenticated;

-- Each direct PostgREST write is constrained independently of the UI.
drop policy if exists recruitment_vacancies_insert on public.recruitment_vacancies;
create policy recruitment_vacancies_insert on public.recruitment_vacancies for insert to authenticated
 with check(public.can_write('recruitment') and public.action_allowed('recruitment.vacancy.create') and created_by=auth.uid());
drop policy if exists recruitment_vacancies_update on public.recruitment_vacancies;
create policy recruitment_vacancies_update on public.recruitment_vacancies for update to authenticated
 using(public.can_write('recruitment') and public.action_allowed('recruitment.vacancy.edit'))
 with check(public.can_write('recruitment') and public.action_allowed('recruitment.vacancy.edit'));
drop policy if exists recruitment_vacancies_delete on public.recruitment_vacancies;
create policy recruitment_vacancies_delete on public.recruitment_vacancies for delete to authenticated
 using(public.can_write('recruitment') and public.action_allowed('recruitment.vacancy.delete'));
drop policy if exists recruitment_questions_write on public.recruitment_questions;
create policy recruitment_questions_insert on public.recruitment_questions for insert to authenticated
 with check(public.can_write('recruitment') and public.action_allowed('recruitment.question.create'));
create policy recruitment_questions_update on public.recruitment_questions for update to authenticated
 using(public.can_write('recruitment') and public.action_allowed('recruitment.question.edit'))
 with check(public.can_write('recruitment') and public.action_allowed('recruitment.question.edit'));
create policy recruitment_questions_delete on public.recruitment_questions for delete to authenticated
 using(public.can_write('recruitment') and public.action_allowed('recruitment.question.delete'));

-- Moving a question removes it from one vacancy and adds it to another. Treat
-- it as both operations so edit-only access cannot bypass creation/deletion.
create or replace function public.recruitment_question_move_action_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.vacancy_id is distinct from old.vacancy_id and
    (not public.action_allowed('recruitment.question.create') or not public.action_allowed('recruitment.question.delete')) then
   raise exception 'You need permission to create and delete questions to move one';
 end if;
 return new;
end $$;
revoke all on function public.recruitment_question_move_action_guard() from public,anon,authenticated;
create trigger recruitment_question_move_action_guard before update on public.recruitment_questions
 for each row execute function public.recruitment_question_move_action_guard();

-- Request creation has no direct table privilege; enforce the task even when
-- the existing security-definer request RPC inserts on behalf of HR.
create or replace function public.recruitment_deletion_request_action_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.action_allowed('recruitment.application.request_deletion') then raise exception 'You do not have permission to request application deletion'; end if;
 return new;
end $$;
revoke all on function public.recruitment_deletion_request_action_guard() from public,anon,authenticated;
create trigger recruitment_deletion_request_action_guard before insert on public.recruitment_deletion_requests
 for each row execute function public.recruitment_deletion_request_action_guard();


create or replace function public.governance_role_within_scope(p_role text)
returns boolean language sql security definer stable set search_path=public,pg_temp as $$
  select auth.uid() is not null
    and exists(select 1 from public.staff_roles where code=p_role and not is_system)
    and p_role <> 'administrator' and p_role <> public.staff_role()
    and not exists (
      select 1 from public.role_permissions target
      where target.role=p_role and target.level<>'none' and (
        target.module like 'governance\_%' escape '\'
        or (case target.level when 'write' then 2 when 'read' then 1 else 0 end) >
           (case public.perm(target.module) when 'write' then 2 when 'read' then 1 else 0 end)
      )
    )
    and not exists (select 1 from public.role_action_restrictions mine
      where mine.role=public.staff_role() and not exists (select 1 from public.role_action_restrictions target
        where target.role=p_role and target.action=mine.action))
$$;

-- The invitation handler also consults this function before assigning a role;
-- denying role assignment must apply there as well as in admin_set_staff.
create or replace function public.governance_can_assign_role(p_role text)
returns boolean language sql security definer stable set search_path=public,pg_temp as $$
 select case when public.is_admin() then exists(select 1 from public.staff_roles where code=p_role)
  else public.action_allowed('governance.team.assign_role')
   and (public.can_write('governance_team') or public.can_write('governance_user_invite'))
   and public.governance_role_within_scope(p_role) end
$$;

create or replace function public.admin_save_role(
 p_code text,p_name text,p_description text,p_dashboard_modules text[],p_permissions jsonb
) returns public.staff_roles language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.staff_roles%rowtype; old_role public.staff_roles%rowtype; k text; v text; who text;
 allowed constant text[] := array['applications','payments','intakes','courses','lecturers','media','recruitment','hr_activities',
   'governance_team','governance_roles','governance_user_invite','governance_audit','governance_health'];
 super_admin boolean:=public.is_admin();
begin
 if not super_admin and not public.can_write('governance_roles') then raise exception 'Role management access required'; end if;
 if p_code is null or p_code !~ '^[a-z][a-z0-9_]{1,39}$' then raise exception 'Role code must contain 2–40 lowercase letters, numbers or underscores'; end if;
 if p_code='administrator' or (not super_admin and p_code=public.staff_role()) then raise exception 'This role cannot be changed'; end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 80 or length(coalesce(p_description,''))>500 then raise exception 'Enter a valid role name and description'; end if;
 if p_permissions is null or jsonb_typeof(p_permissions)<>'object' then raise exception 'Role permissions must be an object'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ahct_role_change:'||p_code,0));
 select * into old_role from public.staff_roles where code=p_code for update;
 if found then
   if not public.action_allowed('governance.role.edit') then raise exception 'You do not have permission to edit roles'; end if;
 else
   if not public.action_allowed('governance.role.create') then raise exception 'You do not have permission to create roles'; end if;
 end if;
 if not super_admin and found and (old_role.is_system or not public.governance_role_within_scope(p_code)) then raise exception 'This role requires an administrator to change it'; end if;
 for k,v in select key,value from jsonb_each_text(p_permissions) loop
   if not (k=any(allowed)) or v is null or v not in ('none','read','write') then raise exception 'Invalid permission for module %',k; end if;
   if k in ('governance_audit','governance_health') and v='write' then raise exception '% is read only',k; end if;
   if k='governance_user_invite' and v='read' then raise exception 'Staff invitations are either enabled or disabled'; end if;
   if not super_admin and v<>'none' and (k like 'governance\_%' escape '\' or
      (case v when 'write' then 2 when 'read' then 1 else 0 end) >
      (case public.perm(k) when 'write' then 2 when 'read' then 1 else 0 end)) then
     raise exception 'Cannot grant privileges outside your authorized scope';
   end if;
 end loop;
 if exists(select 1 from unnest(coalesce(p_dashboard_modules,'{}'::text[])) d where not (d=any(allowed)) or coalesce(p_permissions->>d,'none')='none') then
   raise exception 'Dashboard modules must have at least read permission';
 end if;
 insert into public.staff_roles(code,name,description,dashboard_modules)
 values(p_code,trim(p_name),trim(coalesce(p_description,'')),coalesce(p_dashboard_modules,'{}'))
 on conflict(code) do update set name=excluded.name,description=excluded.description,
 dashboard_modules=excluded.dashboard_modules,updated_at=now() returning * into r;
 -- A delegated editor cannot create a role that lacks any of their own restrictions.
 if not super_admin then
   insert into public.role_action_restrictions(role,action)
     select p_code,action from public.role_action_restrictions where role=public.staff_role()
     on conflict do nothing;
 end if;
 foreach k in array allowed loop
   insert into public.role_permissions(role,module,level) values(p_code,k,coalesce(p_permissions->>k,'none'))
   on conflict(role,module) do update set level=excluded.level;
 end loop;
 select full_name into who from public.staff where id=auth.uid();
 insert into public.audit_log(actor,actor_name,action,target,note)
 values(auth.uid(),who,'staff_role_saved',p_code,'Role settings and permissions updated');
 return r;
end $$;

create or replace function public.admin_delete_role(p_code text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.staff_roles%rowtype; who text;
begin
 if not public.is_admin() and not public.can_write('governance_roles') then raise exception 'Role management access required'; end if;
 if not public.action_allowed('governance.role.delete') then raise exception 'You do not have permission to delete roles'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ahct_role_change:'||coalesce(p_code,''),0));
 select * into r from public.staff_roles where code=p_code for update;
 if not found then raise exception 'Role not found'; end if;
 if r.is_system or (not public.is_admin() and not public.governance_role_within_scope(p_code)) then raise exception 'This role cannot be deleted'; end if;
 if exists(select 1 from public.staff where role=p_code) then raise exception 'Reassign staff before deleting this role'; end if;
 delete from public.role_permissions where role=p_code;
 delete from public.staff_roles where code=p_code;
 select full_name into who from public.staff where id=auth.uid();
 insert into public.audit_log(actor,actor_name,action,target,note) values(auth.uid(),who,'staff_role_deleted',p_code,r.name);
end $$;

create or replace function public.admin_set_staff(p_id uuid,p_status text,p_role text default null)
returns public.staff language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.staff%rowtype; who text; n int; new_role text; super_admin boolean:=public.is_admin();
begin
 if not super_admin and not public.can_write('governance_team') then raise exception 'Staff management access required'; end if;
 if p_status not in ('pending','approved','rejected','suspended') then raise exception 'Invalid status'; end if;
 perform pg_advisory_xact_lock(hashtext('ahct_staff_administrator_change'));
 select * into s from public.staff where id=p_id for update;
 if not found then raise exception 'Staff record not found'; end if;
 new_role:=coalesce(p_role,s.role);
 if not exists(select 1 from public.staff_roles where code=new_role) then raise exception 'Invalid role'; end if;
 if new_role is distinct from s.role and not public.action_allowed('governance.team.assign_role') then raise exception 'You do not have permission to assign roles'; end if;
 if p_status is distinct from s.status and not public.action_allowed(case p_status
   when 'approved' then 'governance.team.approve' when 'rejected' then 'governance.team.reject'
   when 'suspended' then 'governance.team.suspend' else 'governance.team.restore_pending' end) then
   raise exception 'You do not have permission to change this staff status';
 end if;
 if not super_admin and (p_id=auth.uid() or not public.governance_role_within_scope(s.role)
   or (new_role is distinct from s.role and not public.governance_can_assign_role(new_role))) then
   raise exception 'This staff account or role is outside your authorized scope';
 end if;
 if p_id=auth.uid() and (p_status<>'approved' or new_role<>'administrator') then raise exception 'You cannot demote, suspend or reject your own account'; end if;
 if s.role='administrator' and s.status='approved' and (p_status<>'approved' or new_role<>'administrator') then
   select count(*) into n from public.staff where role='administrator' and status='approved' and id<>p_id;
   if n=0 then raise exception 'At least one approved administrator must remain'; end if;
 end if;
 select full_name into who from public.staff where id=auth.uid();
 update public.staff set status=p_status,role=new_role where id=p_id returning * into s;
 insert into public.audit_log(actor,actor_name,action,target,note) values(auth.uid(),who,'staff_'||p_status,s.full_name,'role: '||s.role);
 return s;
end $$;

create or replace function public.recruitment_publish_vacancy(
 p_vacancy uuid,p_homepage boolean,p_studenthub boolean,p_recruitment boolean
) returns public.recruitment_vacancies
language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.recruitment_vacancies%rowtype; who text;
begin
 if not public.can_write('recruitment') or not public.action_allowed('recruitment.vacancy.publish') then raise exception 'Recruitment publishing access required'; end if;
 if not (coalesce(p_homepage,false) or coalesce(p_studenthub,false) or coalesce(p_recruitment,false)) then
  raise exception 'Select at least one destination before publishing';
 end if;
 select * into v from public.recruitment_vacancies where id=p_vacancy for update;
 if not found then raise exception 'Vacancy not found'; end if;
 if v.status<>'open' or v.opens_at is null or v.closes_at is null or v.closes_at<=v.opens_at then
  raise exception 'Set the vacancy to Open and provide valid opening and closing dates before publishing';
 end if;
 if v.closes_at<=now() then raise exception 'The closing date has passed; update it before publishing'; end if;
 perform set_config('ahct.recruitment_publishing','1',true);
 update public.recruitment_vacancies
    set published_at=now(),feature_homepage=coalesce(p_homepage,false),
        feature_studenthub=coalesce(p_studenthub,false),feature_recruitment=coalesce(p_recruitment,false),updated_at=now()
  where id=p_vacancy returning * into v;
 select full_name into who from public.staff where id=auth.uid();
 insert into public.audit_log(actor,actor_name,action,target,note)
 values(auth.uid(),who,'recruitment_vacancy_published',v.id::text,
   'Homepage='||v.feature_homepage::text||'; Student Hub='||v.feature_studenthub::text||'; Recruitment='||v.feature_recruitment::text);
 return v;
end $$;

create or replace function public.recruitment_copy_questions(
  p_source uuid,
  p_target uuid,
  p_questions uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_status text;
  selected_count integer;
  inserted_count integer;
  first_order integer;
  who text;
begin
  if auth.uid() is null or not public.can_write('recruitment') or not public.action_allowed('recruitment.question.create') or not public.action_allowed('recruitment.question.copy') then
    raise exception 'Recruitment management access is required';
  end if;
  if p_source is null or p_target is null or p_source = p_target then
    raise exception 'Choose two different vacancies';
  end if;
  if coalesce(cardinality(p_questions), 0) not between 1 and 100 then
    raise exception 'Select between one and 100 questions';
  end if;

  -- Submission locks the target vacancy as well. A copy therefore completes
  -- atomically before or after an application takes its question snapshot.
  select status into target_status from public.recruitment_vacancies
   where id = p_target for update;
  if not found then raise exception 'Destination vacancy not found'; end if;
  if target_status = 'closed' then raise exception 'Questions cannot be added to a closed vacancy'; end if;
  if not exists (select 1 from public.recruitment_vacancies where id = p_source) then
    raise exception 'Source vacancy not found';
  end if;
  select count(distinct q.id) into selected_count from public.recruitment_questions q
   where q.vacancy_id = p_source and q.id = any(p_questions);
  if selected_count <> cardinality(p_questions) then
    raise exception 'The selected questions no longer match the source vacancy; refresh and try again';
  end if;

  select coalesce(max(sort_order), 0) into first_order
    from public.recruitment_questions where vacancy_id = p_target;
  insert into public.recruitment_questions(vacancy_id, prompt, kind, required, options, sort_order)
  select p_target, q.prompt, q.kind, q.required, q.options,
         first_order + (row_number() over (order by q.sort_order, q.created_at, q.id))::integer
    from public.recruitment_questions q
   where q.vacancy_id = p_source and q.id = any(p_questions)
     and not exists (
       select 1 from public.recruitment_questions existing
        where existing.vacancy_id = p_target
          and lower(trim(existing.prompt)) = lower(trim(q.prompt))
          and existing.kind = q.kind
     );
  get diagnostics inserted_count = row_count;

  select full_name into who from public.staff where id = auth.uid();
  insert into public.audit_log(actor, actor_name, action, target, note)
  values(auth.uid(), coalesce(who, 'Staff'), 'recruitment_questions_copied', p_target::text,
    'Copied ' || inserted_count::text || ' of ' || selected_count::text || ' selected questions from ' || p_source::text);
  return jsonb_build_object('copied', inserted_count, 'skipped', selected_count - inserted_count);
end $$;


-- Save module permissions and task restrictions together or roll everything back.
create or replace function public.admin_save_role_with_restrictions(
 p_code text,p_name text,p_description text,p_dashboard_modules text[],p_permissions jsonb,p_denied_actions text[]
) returns public.staff_roles language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.staff_roles%rowtype;
begin
 if not public.is_admin() then raise exception 'Super administrator access required'; end if;
 result:=public.admin_save_role(p_code,p_name,p_description,p_dashboard_modules,p_permissions);
 perform public.admin_set_role_action_restrictions(p_code,p_denied_actions);
 return result;
end $$;
revoke all on function public.admin_save_role_with_restrictions(text,text,text,text[],jsonb,text[]) from public,anon;
grant execute on function public.admin_save_role_with_restrictions(text,text,text,text[],jsonb,text[]) to authenticated;
