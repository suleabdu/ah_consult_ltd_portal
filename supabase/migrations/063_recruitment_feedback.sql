-- Guest recruitment messages require an independently recorded WhatsApp opt-in.
alter table public.recruitment_applications
 add column if not exists whatsapp_e164 text,
 add column if not exists whatsapp_opt_in_at timestamptz;

-- Preserve the submission implementation and its transactional validation.
alter function public.recruitment_submit_guest_application(uuid,jsonb,uuid,uuid)
 rename to recruitment_submit_guest_application_v059;
revoke all on function public.recruitment_submit_guest_application_v059(uuid,jsonb,uuid,uuid) from public,anon,authenticated,service_role;
create function public.recruitment_submit_guest_application(p_vacancy uuid,p_application jsonb,p_upload_id uuid,p_submission_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; number text;
begin
 if p_application->'whatsapp_opt_in'='true'::jsonb then
  number:=regexp_replace(coalesce(p_application->>'phone',''),'[[:space:]().-]','','g');
  if number ~ '^0[789][01][0-9]{8}$' then number:='+234'||substring(number from 2);
  elsif number ~ '^234[789][01][0-9]{8}$' then number:='+'||number;
  elsif number !~ '^[+][1-9][0-9]{7,14}$' then raise exception 'Enter a valid WhatsApp number with country code'; end if;
 end if;
 result:=public.recruitment_submit_guest_application_v059(p_vacancy,p_application,p_upload_id,p_submission_id);
 if number is not null and coalesce((result->>'replayed')::boolean,false)=false then
  update public.recruitment_applications set whatsapp_e164=number,whatsapp_opt_in_at=now() where id=(result->>'id')::uuid;
 end if;
 return result;
end $$;
revoke all on function public.recruitment_submit_guest_application(uuid,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.recruitment_submit_guest_application(uuid,jsonb,uuid,uuid) to service_role;

-- Extend the finite action catalog; feedback can only narrow recruitment write.
alter table public.role_action_restrictions drop constraint if exists role_action_restrictions_action_check;
alter table public.role_action_restrictions add constraint role_action_restrictions_action_check check(action in (
 'recruitment.vacancy.create','recruitment.vacancy.edit','recruitment.vacancy.delete','recruitment.vacancy.publish',
 'recruitment.question.create','recruitment.question.edit','recruitment.question.delete','recruitment.question.copy',
 'recruitment.application.request_deletion','recruitment.feedback.email','recruitment.feedback.whatsapp',
 'governance.team.approve','governance.team.reject','governance.team.suspend','governance.team.restore_pending','governance.team.assign_role',
 'governance.role.create','governance.role.edit','governance.role.delete'));

create or replace function public.admin_set_role_action_restrictions(p_role text,p_denied_actions text[])
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare act text; actor_name text;
 allowed constant text[] := array[
 'recruitment.vacancy.create','recruitment.vacancy.edit','recruitment.vacancy.delete','recruitment.vacancy.publish',
 'recruitment.question.create','recruitment.question.edit','recruitment.question.delete','recruitment.question.copy',
 'recruitment.application.request_deletion','recruitment.feedback.email','recruitment.feedback.whatsapp',
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
 insert into public.audit_log(actor,actor_name,action,target,note) values(auth.uid(),coalesce(actor_name,'Administrator'),'role_action_restrictions_changed',p_role,'Restricted action settings updated');
end $$;

-- Idempotency prevents an uncertain browser response from sending a duplicate.
create unique index recruitment_feedback_dedupe_idx on public.communication_outbox ((metadata->>'feedback_id'))
 where metadata->>'source'='recruitment_feedback';

create or replace function public.recruitment_queue_feedback(p_application uuid,p_channel text,p_subject text,p_message text,p_signature text,p_cc text[],p_bcc text[],p_feedback_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare app public.recruitment_applications%rowtype; conv uuid; out_id bigint; sender text; item text; text_body text;
 cc text[]:=coalesce(p_cc,'{}'::text[]); bcc text[]:=coalesce(p_bcc,'{}'::text[]);
begin
 if auth.uid() is null or not public.can_write('recruitment') then raise exception 'Recruitment communication access required'; end if;
 if p_channel not in ('email','whatsapp') or p_feedback_id is null then raise exception 'Choose a valid communication channel'; end if;
 if not public.action_allowed('recruitment.feedback.'||p_channel) then raise exception 'You do not have permission for this communication channel'; end if;
 if length(trim(coalesce(p_subject,''))) not between 3 and 140 or length(trim(coalesce(p_message,''))) not between 5 and 3500 or length(coalesce(p_signature,''))>500 then raise exception 'Enter a valid subject, message and signature'; end if;
 if cardinality(cc)>10 or cardinality(bcc)>10 or cardinality(cc)+cardinality(bcc)>15 then raise exception 'Use no more than 15 copied recipients'; end if;
 foreach item in array cc||bcc loop
  if item is null or length(item)>254 or item !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Enter valid copied email addresses'; end if;
 end loop;
 if p_channel='whatsapp' and (cardinality(cc)>0 or cardinality(bcc)>0) then raise exception 'CC and BCC apply to email only'; end if;
 perform pg_advisory_xact_lock(hashtextextended('recruitment-feedback:'||auth.uid()::text,0));
 select id into out_id from public.communication_outbox where metadata->>'source'='recruitment_feedback' and metadata->>'feedback_id'=p_feedback_id::text and metadata->>'actor'=auth.uid()::text;
 if found then return jsonb_build_object('id',out_id,'status','queued','replayed',true); end if;
 if (select count(*) from public.communication_outbox where metadata->>'source'='recruitment_feedback' and metadata->>'actor'=auth.uid()::text and created_at>now()-interval '1 hour')>=30 then raise exception 'Please wait before sending more applicant feedback'; end if;
 select * into app from public.recruitment_applications where id=p_application for update;
 if not found then raise exception 'Application not found'; end if;
 if exists(select 1 from public.recruitment_deletion_requests where application_id=p_application and status='approved') then raise exception 'Feedback is unavailable while deletion is in progress'; end if;
 if p_channel='whatsapp' then
  if app.whatsapp_opt_in_at is null or app.whatsapp_e164 is null then raise exception 'This applicant has not opted in to WhatsApp updates'; end if;
  select id into conv from public.whatsapp_conversations where phone_e164=app.whatsapp_e164 and status in ('bot','handoff') and last_inbound_at>=now()-interval '24 hours' order by last_inbound_at desc limit 1;
  if conv is null then raise exception 'WhatsApp requires an incoming message from this applicant within the last 24 hours'; end if;
 end if;
 text_body:=trim(p_message)||case when nullif(trim(coalesce(p_signature,'')),'') is null then '' else E'\n\n'||trim(p_signature) end;
 if p_channel='whatsapp' then text_body:=trim(p_subject)||E'\n\n'||text_body; end if;
 if length(text_body)>4096 then raise exception 'The message and signature are too long'; end if;
 insert into public.communication_outbox(channel,recipient,subject,message,metadata)
 values(p_channel,case when p_channel='email' then app.email else app.whatsapp_e164 end,trim(p_subject),text_body,
   jsonb_build_object('source','recruitment_feedback','recipient_kind','recruitment','application_id',app.id,'actor',auth.uid(),'feedback_id',p_feedback_id,'cc',to_jsonb(cc),'bcc',to_jsonb(bcc),'message_mode','text','conversation_id',conv)) returning id into out_id;
 select full_name into sender from public.staff where id=auth.uid();
 insert into public.audit_log(actor,actor_name,action,target,note) values(auth.uid(),coalesce(sender,'Staff'),'recruitment_feedback_queued',app.id::text,p_channel||' feedback queued');
 return jsonb_build_object('id',out_id,'status','queued');
end $$;
revoke all on function public.recruitment_queue_feedback(uuid,text,text,text,text,text[],text[],uuid) from public,anon;
grant execute on function public.recruitment_queue_feedback(uuid,text,text,text,text,text[],text[],uuid) to authenticated;

create or replace function public.recruitment_feedback_history(p_application uuid)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
begin
 if not public.can_read('recruitment') then raise exception 'Recruitment access required'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'channel',channel,'subject',subject,'status',status,'created_at',created_at,'sent_at',sent_at) order by created_at desc),'[]'::jsonb)
 from (select id,channel,subject,status,created_at,sent_at from public.communication_outbox where metadata->>'source'='recruitment_feedback' and metadata->>'application_id'=p_application::text order by created_at desc limit 30) jobs);
end $$;
revoke all on function public.recruitment_feedback_history(uuid) from public,anon;
grant execute on function public.recruitment_feedback_history(uuid) to authenticated;

create or replace function public.recruitment_cancel_queued_feedback() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status='approved' and old.status is distinct from new.status then
  update public.communication_outbox set status='cancelled' where status='queued' and metadata->>'source'='recruitment_feedback' and metadata->>'application_id'=new.application_ref::text;
 end if;
 return new;
end $$;
revoke all on function public.recruitment_cancel_queued_feedback() from public,anon,authenticated;
create trigger recruitment_cancel_feedback_on_approval after update of status on public.recruitment_deletion_requests for each row execute function public.recruitment_cancel_queued_feedback();
