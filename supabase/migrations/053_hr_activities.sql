-- HR activities and learning resources; email dispatch remains in the existing outbox.
create table public.hr_activities (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 2 and 200),
  kind text not null check (kind in ('activity','refresher')),
  description text not null default '' check (length(description)<=12000),
  resource_url text check (resource_url is null or (length(resource_url)<=2000 and resource_url ~ '^https://')),
  youtube_url text check (youtube_url is null or (length(youtube_url)<=2000 and youtube_url ~ '^https://(www\.)?(youtube\.com/watch\?v=|youtu\.be/)[A-Za-z0-9_-]{11}([&?][A-Za-z0-9_=&-]*)?$')),
  starts_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.hr_activities enable row level security;
revoke all on public.hr_activities from public,anon,authenticated;
grant select,insert,update,delete on public.hr_activities to authenticated;
create policy hr_activities_read on public.hr_activities for select to authenticated using (public.staff_role() is not null);
create policy hr_activities_insert on public.hr_activities for insert to authenticated with check (public.can_write('hr_activities') and created_by=auth.uid());
create policy hr_activities_update on public.hr_activities for update to authenticated using (public.can_write('hr_activities')) with check (public.can_write('hr_activities'));
create policy hr_activities_delete on public.hr_activities for delete to authenticated using (public.can_write('hr_activities'));

create or replace function public.hr_email_team(p_subject text,p_message text) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare total integer; who text;
begin
  if not public.can_write('hr_activities') then raise exception 'HR communication access required'; end if;
  if length(trim(coalesce(p_subject,''))) not between 3 and 140 or length(trim(coalesce(p_message,''))) not between 5 and 4000 then
    raise exception 'Enter a subject and message within the permitted length';
  end if;
  -- Serialize team notices by actor so simultaneous requests cannot bypass the limit.
  perform pg_advisory_xact_lock(hashtextextended('hr_team_email:'||auth.uid()::text,0));
  if exists(select 1 from public.audit_log where actor=auth.uid() and action='hr_team_email_queued'
      and created_at>now()-interval '5 minutes') then
    raise exception 'Please wait five minutes between team emails';
  end if;
  insert into public.communication_outbox(user_id,channel,recipient,subject,message,metadata)
  select s.id,'email',s.email,trim(p_subject),trim(p_message),jsonb_build_object('source','hr_team_notice','actor',auth.uid())
    from public.staff s where s.status='approved' and nullif(trim(s.email),'') is not null;
  get diagnostics total=row_count;
  select full_name into who from public.staff where id=auth.uid();
  insert into public.audit_log(actor,actor_name,action,target,note)
  values(auth.uid(),who,'hr_team_email_queued','staff',total::text||' recipients');
  return total;
end $$;
revoke all on function public.hr_email_team(text,text) from public,anon;
grant execute on function public.hr_email_team(text,text) to authenticated;
