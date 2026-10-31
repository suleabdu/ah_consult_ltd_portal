-- AHCT V18.7.3: governed course creation, category suffix codes, Full Package eligibility,
-- and delegated gallery permissions. Never rename existing course codes: they are FK keys.

alter table public.courses
  add column if not exists short_code text,
  add column if not exists workflow_status text,
  add column if not exists in_full_package boolean not null default false,
  add column if not exists package_requested boolean not null default false,
  add column if not exists created_by uuid,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists published_by uuid,
  add column if not exists published_at timestamptz;

-- Legacy rows were already offered publicly: preserve their current visibility and package
-- treatment without rewriting IDs, prices, enrolments or historical receipts.
update public.courses set workflow_status = case when is_active then 'published' else 'retired' end
 where workflow_status is null;
update public.courses set in_full_package = true
  where workflow_status = 'published' and short_code is null;
-- Existing approved offerings keep their package entitlement. New drafts can only REQUEST it.
update public.courses set package_requested = in_full_package
 where workflow_status = 'published' and short_code is null;
alter table public.courses alter column workflow_status set default 'draft';
alter table public.courses alter column workflow_status set not null;
alter table public.courses drop constraint if exists courses_workflow_status_check;
alter table public.courses add constraint courses_workflow_status_check
 check (workflow_status in ('draft','approved','published','rejected','retired'));
alter table public.courses drop constraint if exists courses_short_code_check;
alter table public.courses add constraint courses_short_code_check
 check (short_code is null or short_code ~ '^[A-Z]{1,4}$');
alter table public.courses drop constraint if exists courses_managed_code_matches_category_check;
alter table public.courses add constraint courses_managed_code_matches_category_check
 check (short_code is null or code = short_code || case category
  when 'Beginner' then '1' when 'Intermediate' then '2' when 'Professional' then '3' else '!' end);
create index if not exists courses_public_catalog_idx on public.courses(category,name)
 where workflow_status = 'published' and is_active;

-- Retire previous catch-all write rules, even from administrators: changes must use audited RPCs.
drop policy if exists adm_all on public.courses;
drop policy if exists staff_write on public.courses;
drop policy if exists read_courses on public.courses;
create policy read_courses on public.courses for select to anon, authenticated
 using ((workflow_status = 'published' and is_active) or public.can_read('courses'));

-- Gallery access is an explicitly delegated permission (no implicit rights for all staff).
alter table public.role_permissions drop constraint if exists role_permissions_module_check;
alter table public.role_permissions add constraint role_permissions_module_check
 check (module in ('applications','payments','intakes','courses','lecturers','media'));
insert into public.role_permissions(role,module,level)
select role, 'media', 'none' from (values ('academic'),('registrar'),('finance'),('operations'),('viewer'),('tutor')) as r(role)
on conflict (role,module) do nothing;

drop policy if exists gi_admin_all on public.gallery_items;
create policy gi_editor_select on public.gallery_items for select to authenticated
 using (public.can_read('media'));
create policy gi_editor_insert on public.gallery_items for insert to authenticated
 with check (public.can_write('media'));
create policy gi_editor_update on public.gallery_items for update to authenticated
 using (public.can_write('media')) with check (public.can_write('media'));
create policy gi_editor_delete on public.gallery_items for delete to authenticated
 using (public.can_write('media'));
-- Editors can upload only photos in the gallery folder, not replace website logos/theme.
drop policy if exists sa_gallery_insert on storage.objects;
create policy sa_gallery_insert on storage.objects for insert to authenticated
 with check (bucket_id = 'site-assets' and (storage.foldername(name))[1] = 'gallery' and public.can_write('media'));
drop policy if exists sa_gallery_update on storage.objects;
create policy sa_gallery_update on storage.objects for update to authenticated
 using (bucket_id = 'site-assets' and (storage.foldername(name))[1] = 'gallery' and public.can_write('media'))
 with check (bucket_id = 'site-assets' and (storage.foldername(name))[1] = 'gallery' and public.can_write('media'));
drop policy if exists sa_gallery_delete on storage.objects;
create policy sa_gallery_delete on storage.objects for delete to authenticated
 using (bucket_id = 'site-assets' and (storage.foldername(name))[1] = 'gallery' and public.can_write('media'));

create or replace function public.ahct_course_create(
 p_name text, p_letters text, p_category text, p_all_categories boolean,
 p_fees jsonb, p_full_package boolean default false
) returns text[] language plpgsql security definer set search_path=public,pg_temp as $$
declare v_name text := btrim(coalesce(p_name,'')); v_short text := upper(btrim(coalesce(p_letters,'')));
 v_category text; v_code text; v_fee integer; v_codes text[] := '{}'; v_actor uuid := auth.uid();
begin
 if not public.can_write('courses') or not exists(select 1 from public.staff where id=v_actor and status='approved') then
  raise exception 'You do not have permission to register courses'; end if;
 if char_length(v_name) < 3 or char_length(v_name) > 120 then raise exception 'Course name must be 3–120 characters'; end if;
 if v_short !~ '^[A-Z]{1,4}$' then raise exception 'Use one to four letters (A–Z) for the course code'; end if;
 if not coalesce(p_all_categories,false) and p_category not in ('Beginner','Intermediate','Professional') then
  raise exception 'Select a valid category'; end if;
 for v_category in select c from unnest(array['Beginner','Intermediate','Professional']) as c
  where p_all_categories or c=p_category loop
  v_fee := case when (p_fees->>v_category) ~ '^[0-9]{1,8}$' then (p_fees->>v_category)::integer else null end;
  if v_fee is null or v_fee < 1 then raise exception 'Enter a positive fee for %',v_category; end if;
  v_code := v_short || case v_category when 'Beginner' then '1' when 'Intermediate' then '2' else '3' end;
  if exists(select 1 from public.courses where code=v_code) then raise exception 'Code % already exists; choose different letters',v_code; end if;
  insert into public.courses(code,name,category,fee_ngn,is_active,short_code,workflow_status,in_full_package,package_requested,created_by)
   values(v_code,v_name,v_category,v_fee,false,v_short,'draft',false,coalesce(p_full_package,false),v_actor);
  v_codes := array_append(v_codes,v_code);
  insert into public.audit_log(actor,action,target,note)
   values(v_actor,'course.draft_created',v_code,v_name||' / '||v_category);
 end loop;
 return v_codes;
end $$;

-- A course code is immutable once allocated, but the creator may correct name, fee or
-- package request before approval. Rejected drafts may be revised and resubmitted.
create or replace function public.ahct_course_update_draft(
 p_code text, p_name text, p_fee integer, p_full_package boolean
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_course public.courses%rowtype; v_actor uuid:=auth.uid();
begin
 if not public.can_write('courses') then raise exception 'Course editing requires course-manager permission'; end if;
 select * into v_course from public.courses where code=p_code for update;
 if not found or v_course.workflow_status not in ('draft','rejected') then
  raise exception 'Only drafts or rejected courses can be edited'; end if;
 if v_course.created_by is distinct from v_actor then raise exception 'Only the original course author may revise this draft'; end if;
 if char_length(btrim(coalesce(p_name,''))) not between 3 and 120 then raise exception 'Invalid course name'; end if;
 if p_fee is null or p_fee not between 1 and 99999999 then raise exception 'Invalid course fee'; end if;
 update public.courses set name=btrim(p_name),fee_ngn=p_fee,
  package_requested=coalesce(p_full_package,false),workflow_status='draft',approved_by=null,approved_at=null
  where code=p_code;
 insert into public.audit_log(actor,action,target,note)
 values(v_actor,'course.draft_updated',p_code,'Draft revised for review');
end $$;

create or replace function public.ahct_course_review(p_codes text[],p_approve boolean,p_note text default null)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_code text; v_course public.courses%rowtype; v_count integer:=0; v_actor uuid:=auth.uid();
begin
 if public.staff_role() <> 'administrator' or not exists(select 1 from public.staff where id=v_actor and status='approved')
 then raise exception 'Only an approved administrator can review courses'; end if;
 if p_codes is null or cardinality(p_codes)=0 or cardinality(p_codes)>50 then raise exception 'Select courses to review'; end if;
 foreach v_code in array p_codes loop
  select * into v_course from public.courses where code=v_code for update;
  if not found or v_course.workflow_status <> 'draft' then raise exception 'Course % is not awaiting review',v_code; end if;
  if v_course.created_by = v_actor then raise exception 'A different administrator must approve course %',v_code; end if;
  if not p_approve and length(btrim(coalesce(p_note,''))) < 8 then raise exception 'Give a rejection reason (8+ characters)'; end if;
  update public.courses set workflow_status=case when p_approve then 'approved' else 'rejected' end,
   approved_by=v_actor,approved_at=now() where code=v_code;
  insert into public.audit_log(actor,action,target,note)
   values(v_actor,case when p_approve then 'course.approved' else 'course.rejected' end,v_code,p_note);
  v_count:=v_count+1;
 end loop;
 return v_count;
end $$;

create or replace function public.ahct_course_publish(p_codes text[])
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_code text; v_count integer:=0; v_actor uuid:=auth.uid();
begin
 if public.staff_role()<>'administrator' or not exists(select 1 from public.staff where id=v_actor and status='approved')
 then raise exception 'Only an approved administrator can publish courses'; end if;
 if p_codes is null or cardinality(p_codes)=0 or cardinality(p_codes)>50 then raise exception 'Select approved courses'; end if;
 foreach v_code in array p_codes loop
  update public.courses set workflow_status='published',is_active=true,published_by=v_actor,published_at=now()
  where code=v_code and workflow_status='approved';
  if not found then raise exception 'Course % must be approved before publishing',v_code; end if;
  insert into public.audit_log(actor,action,target) values(v_actor,'course.published',v_code);
  v_count:=v_count+1;
 end loop;
 return v_count;
end $$;

create or replace function public.ahct_course_package(p_code text,p_include boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if public.staff_role()<>'administrator' or not exists(select 1 from public.staff where id=auth.uid() and status='approved')
 then raise exception 'Only an approved administrator can configure Full Package eligibility'; end if;
 update public.courses set in_full_package=p_include,package_requested=p_include where code=p_code and workflow_status='published' and is_active;
 if not found then raise exception 'Select an active, published course'; end if;
 insert into public.audit_log(actor,action,target,note) values(auth.uid(),'course.full_package',p_code,case when p_include then 'included' else 'excluded' end);
end $$;

create or replace function public.ahct_course_retire(p_code text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if public.staff_role()<>'administrator' or not exists(select 1 from public.staff where id=auth.uid() and status='approved')
 then raise exception 'Only an approved administrator can retire courses'; end if;
 update public.courses set workflow_status='retired',is_active=false,in_full_package=false
  where code=p_code and workflow_status='published';
 if not found then raise exception 'Only published courses may be retired'; end if;
 insert into public.audit_log(actor,action,target) values(auth.uid(),'course.retired',p_code);
end $$;

revoke all on function public.ahct_course_create(text,text,text,boolean,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.ahct_course_update_draft(text,text,integer,boolean) from public,anon,authenticated;
revoke all on function public.ahct_course_review(text[],boolean,text) from public,anon,authenticated;
revoke all on function public.ahct_course_publish(text[]) from public,anon,authenticated;
revoke all on function public.ahct_course_package(text,boolean) from public,anon,authenticated;
revoke all on function public.ahct_course_retire(text) from public,anon,authenticated;
grant execute on function public.ahct_course_create(text,text,text,boolean,jsonb,boolean),
 public.ahct_course_update_draft(text,text,integer,boolean),
 public.ahct_course_review(text[],boolean,text),public.ahct_course_publish(text[]),
 public.ahct_course_package(text,boolean),public.ahct_course_retire(text) to authenticated;
