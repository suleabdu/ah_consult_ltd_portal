-- Administrator-managed role catalogue. Dashboard settings are presentation
-- preferences only: RLS and role-checked RPCs remain the authority.
create table if not exists public.staff_roles (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text not null check (length(trim(name)) between 2 and 80),
  description text not null default '' check (length(description) <= 500),
  dashboard_modules text[] not null default '{}',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.staff_roles(code,name,is_system) values
 ('administrator','Administrator',true),('registrar','Registrar',true),
 ('finance','Finance',true),('academic','Academic',true),
 ('operations','Operations',true),('tutor','Tutor',true),
 ('viewer','Viewer',true),('hr','Human Resources',true)
on conflict(code) do nothing;

-- Preserve existing installations even if a prior release had extra permission rows.
insert into public.staff_roles(code,name)
select distinct role,initcap(replace(role,'_',' ')) from public.role_permissions
where role ~ '^[a-z][a-z0-9_]{1,39}$'
on conflict(code) do nothing;

alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_catalog_fk
 foreign key (role) references public.staff_roles(code) on update restrict on delete restrict;
alter table public.role_permissions drop constraint if exists role_permissions_module_check;
alter table public.role_permissions add constraint role_permissions_module_check
 check (module in ('applications','payments','intakes','courses','lecturers','media','recruitment','hr_activities'));
insert into public.role_permissions(role,module,level) values
 ('hr','recruitment','write'),('hr','hr_activities','write')
on conflict(role,module) do nothing;
update public.staff_roles set dashboard_modules=array['recruitment','hr_activities'] where code='hr';

alter table public.staff_roles enable row level security;
revoke all on public.staff_roles from public,anon,authenticated;
grant select on public.staff_roles to authenticated;
create policy staff_roles_read on public.staff_roles for select to authenticated
 using (public.staff_role() is not null);

create or replace function public.admin_save_role(
 p_code text,p_name text,p_description text,p_dashboard_modules text[],p_permissions jsonb
) returns public.staff_roles language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.staff_roles%rowtype; k text; v text; who text;
 allowed constant text[] := array['applications','payments','intakes','courses','lecturers','media','recruitment','hr_activities'];
begin
 if not public.is_admin() then raise exception 'Only administrators can manage roles'; end if;
 if p_code is null or p_code !~ '^[a-z][a-z0-9_]{1,39}$' then raise exception 'Role code must contain 2–40 lowercase letters, numbers or underscores'; end if;
 if p_code='administrator' then raise exception 'Administrator permissions cannot be edited'; end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 80 or length(coalesce(p_description,''))>500 then raise exception 'Enter a valid role name and description'; end if;
 if p_permissions is null or jsonb_typeof(p_permissions)<>'object' then raise exception 'Role permissions must be an object'; end if;
 for k,v in select key,value from jsonb_each_text(p_permissions) loop
   if not (k=any(allowed)) or v not in ('none','read','write') then raise exception 'Invalid permission for module %',k; end if;
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
 if not public.is_admin() then raise exception 'Only administrators can delete roles'; end if;
 select * into r from public.staff_roles where code=p_code for update;
 if not found then raise exception 'Role not found'; end if;
 if r.is_system then raise exception 'Built-in roles cannot be deleted'; end if;
 if exists(select 1 from public.staff where role=p_code) then raise exception 'Reassign staff before deleting this role'; end if;
 delete from public.role_permissions where role=p_code;
 delete from public.staff_roles where code=p_code;
 select full_name into who from public.staff where id=auth.uid();
 insert into public.audit_log(actor,actor_name,action,target,note) values(auth.uid(),who,'staff_role_deleted',p_code,r.name);
end $$;

create or replace function public.admin_set_staff(p_id uuid,p_status text,p_role text default null)
returns public.staff language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.staff%rowtype; who text; n int; new_role text;
begin
 if not public.is_admin() then raise exception 'Only administrators can manage staff accounts'; end if;
 if p_status not in ('pending','approved','rejected','suspended') then raise exception 'Invalid status'; end if;
 perform pg_advisory_xact_lock(hashtext('ahct_staff_administrator_change'));
 select * into s from public.staff where id=p_id for update;
 if not found then raise exception 'Staff record not found'; end if;
 new_role:=coalesce(p_role,s.role);
 if not exists(select 1 from public.staff_roles where code=new_role) then raise exception 'Invalid role'; end if;
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

revoke all on function public.admin_save_role(text,text,text,text[],jsonb), public.admin_delete_role(text) from public,anon;
grant execute on function public.admin_save_role(text,text,text,text[],jsonb), public.admin_delete_role(text) to authenticated;
