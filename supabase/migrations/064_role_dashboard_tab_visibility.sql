-- Dashboard tab visibility narrows navigation only; module permissions, action
-- restrictions and protected server-side checks remain the authorization layer.
create table public.role_dashboard_hidden_tabs (
  role text not null references public.staff_roles(code) on delete cascade,
  tab text not null check (tab in (
    'admin.apps','admin.bulkImport','admin.payments','admin.enrolment','admin.deferments','admin.intakes',
    'admin.courses','admin.lecturers','admin.documents','admin.docTemplates','admin.media','admin.whatsapp',
    'admin.intelligence','admin.sync','admin.payset','admin.team','admin.perms','admin.site','admin.audit',
    'admin.health','admin.release','admin.archives','admin.recruitmentDeletion','admin.danger',
    'hr.vacancies','hr.applications','hr.activities','hr.email','hr.team','hr.roles','hr.invite','hr.audit','hr.health'
  )),
  primary key (role, tab)
);
alter table public.role_dashboard_hidden_tabs enable row level security;
revoke all on public.role_dashboard_hidden_tabs from public,anon,authenticated;
grant select on public.role_dashboard_hidden_tabs to authenticated;
create policy role_dashboard_hidden_tabs_read on public.role_dashboard_hidden_tabs
  for select to authenticated using (public.is_admin() or role=public.staff_role());

create or replace function public.admin_set_role_hidden_tabs(p_role text,p_hidden_tabs text[])
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare tab_name text; actor_name text;
 allowed constant text[] := array[
    'admin.apps','admin.bulkImport','admin.payments','admin.enrolment','admin.deferments','admin.intakes',
    'admin.courses','admin.lecturers','admin.documents','admin.docTemplates','admin.media','admin.whatsapp',
    'admin.intelligence','admin.sync','admin.payset','admin.team','admin.perms','admin.site','admin.audit',
    'admin.health','admin.release','admin.archives','admin.recruitmentDeletion','admin.danger',
    'hr.vacancies','hr.applications','hr.activities','hr.email','hr.team','hr.roles','hr.invite','hr.audit','hr.health'];
begin
 if not public.is_admin() then raise exception 'Super administrator access required'; end if;
 if p_role is null or p_role='administrator' then raise exception 'Administrator navigation cannot be restricted'; end if;
 if p_hidden_tabs is null then raise exception 'Dashboard tab settings are required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ahct_role_change:'||p_role,0));
 if not exists(select 1 from public.staff_roles where code=p_role) then raise exception 'Role not found'; end if;
 if exists(select 1 from unnest(p_hidden_tabs) t where t is null or not(t=any(allowed))) then raise exception 'Unknown dashboard tab'; end if;
 delete from public.role_dashboard_hidden_tabs where role=p_role;
 foreach tab_name in array p_hidden_tabs loop
   insert into public.role_dashboard_hidden_tabs(role,tab) values(p_role,tab_name) on conflict do nothing;
 end loop;
 select full_name into actor_name from public.staff where id=auth.uid();
 insert into public.audit_log(actor,actor_name,action,target,note)
 values(auth.uid(),coalesce(actor_name,'Administrator'),'role_dashboard_tabs_changed',p_role,'Dashboard tab visibility updated');
end $$;
revoke all on function public.admin_set_role_hidden_tabs(text,text[]) from public,anon;
grant execute on function public.admin_set_role_hidden_tabs(text,text[]) to authenticated;

-- A single transaction prevents a saved module grant from being left with
-- unintended navigation or task settings if any validation fails.
create or replace function public.admin_save_role_with_dashboard_tabs(
 p_code text,p_name text,p_description text,p_dashboard_modules text[],p_permissions jsonb,
 p_denied_actions text[],p_hidden_tabs text[]
) returns public.staff_roles language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.staff_roles%rowtype;
begin
 if not public.is_admin() then raise exception 'Super administrator access required'; end if;
 result:=public.admin_save_role_with_restrictions(p_code,p_name,p_description,p_dashboard_modules,p_permissions,p_denied_actions);
 perform public.admin_set_role_hidden_tabs(p_code,p_hidden_tabs);
 return result;
end $$;
revoke all on function public.admin_save_role_with_dashboard_tabs(text,text,text,text[],jsonb,text[],text[]) from public,anon;
grant execute on function public.admin_save_role_with_dashboard_tabs(text,text,text,text[],jsonb,text[],text[]) to authenticated;
