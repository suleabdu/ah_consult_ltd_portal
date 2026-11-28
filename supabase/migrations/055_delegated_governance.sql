-- Explicit governance delegation. Presentation is never the authorization boundary.
alter table public.role_permissions drop constraint if exists role_permissions_module_check;
alter table public.role_permissions add constraint role_permissions_module_check check (module in (
  'applications','payments','intakes','courses','lecturers','media','recruitment','hr_activities',
  'governance_team','governance_roles','governance_user_invite','governance_audit','governance_health'
));

-- Preserve current operations/viewer health access while allowing an
-- administrator to remove it explicitly via the role editor later.
insert into public.role_permissions(role,module,level) values
 ('operations','governance_health','read'),('viewer','governance_health','read')
on conflict(role,module) do nothing;

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
$$;
revoke all on function public.governance_role_within_scope(text) from public,anon,authenticated;

-- Check the caller's actual JWT/role before an Edge Function creates an invitation.
create or replace function public.governance_can_assign_role(p_role text)
returns boolean language sql security definer stable set search_path=public,pg_temp as $$
  select case when public.is_admin() then exists(select 1 from public.staff_roles where code=p_role)
    else (public.can_write('governance_team') or public.can_write('governance_user_invite'))
      and public.governance_role_within_scope(p_role) end
$$;
revoke all on function public.governance_can_assign_role(text) from public,anon;
grant execute on function public.governance_can_assign_role(text) to authenticated;

drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff for select to authenticated
  using (id=auth.uid() or public.is_admin() or public.can_read('governance_team'));

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
 if not super_admin and (p_id=auth.uid() or not public.governance_role_within_scope(s.role) or not public.governance_can_assign_role(new_role)) then
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

create or replace function public.audit_center(p_action text default null,p_limit int default 100)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare r jsonb;
begin
 if not public.is_admin() and not public.can_read('governance_audit') then raise exception 'Audit access required'; end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into r
 from (select id,actor,actor_name,action,target,note,created_at from public.audit_log where p_action is null or action=p_action order by created_at desc limit greatest(1,least(coalesce(p_limit,100),500))) x;
 return r;
end $$;

create or replace function public.system_health_snapshot()
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare r jsonb;
begin
 if not public.can_read('governance_health') then raise exception 'System health access required'; end if;
 select jsonb_build_object(
  'generated_at',now(),'database','ok','applications',(select count(*) from public.applications),
  'notifications_24h',(select count(*) from public.student_notifications where created_at>=now()-interval '24 hours'),
  'communications_queued',(select count(*) from public.communication_outbox where status in ('queued','processing')),
  'communications_failed',(select count(*) from public.communication_outbox where status='failed' and created_at>=now()-interval '7 days'),
  'sheet_pending',(select count(*) from public.sheet_outbox where not done),
  'sheet_failed',(select count(*) from public.sheet_outbox where not done and attempts>=8),
  'documents_requested',(select count(*) from public.document_jobs where requested_at>=now()-interval '30 days'),
  'documents_issued',(select count(*) from public.document_jobs where status='issued' and issued_at>=now()-interval '30 days'),
  'audit_24h',(select count(*) from public.audit_log where created_at>=now()-interval '24 hours')) into r;
 return r;
end $$;

revoke all on function public.admin_save_role(text,text,text,text[],jsonb),public.admin_delete_role(text),
 public.admin_set_staff(uuid,text,text),public.audit_center(text,int),public.system_health_snapshot() from public,anon;
grant execute on function public.admin_save_role(text,text,text,text[],jsonb),public.admin_delete_role(text),
 public.admin_set_staff(uuid,text,text),public.audit_center(text,int),public.system_health_snapshot() to authenticated;
