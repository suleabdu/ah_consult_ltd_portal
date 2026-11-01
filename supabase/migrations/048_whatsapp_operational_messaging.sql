-- V18.9: governed WhatsApp communications.
-- Provider secrets stay encrypted and are only handled by server-side functions.

-- -----------------------------------------------------------------------------
-- 1. Canonical, consent-backed WhatsApp contact data
-- -----------------------------------------------------------------------------
create or replace function public.ahct_normalize_whatsapp_phone(p_value text)
returns text language plpgsql immutable strict set search_path=public,pg_temp as $$
declare digits text;
begin
  digits := regexp_replace(trim(p_value), '[^0-9]', '', 'g');
  if digits ~ '^0[789][01][0-9]{8}$' then
    return '+234' || right(digits, 10);
  end if;
  if digits ~ '^234[789][01][0-9]{8}$' then
    return '+' || digits;
  end if;
  return null;
end $$;
revoke all on function public.ahct_normalize_whatsapp_phone(text) from public,anon;
grant execute on function public.ahct_normalize_whatsapp_phone(text) to authenticated,service_role;

alter table public.profiles add column if not exists whatsapp_e164 text;
alter table public.profiles add column if not exists whatsapp_opt_in_at timestamptz;
alter table public.profiles add column if not exists whatsapp_opt_in_source text;
alter table public.staff add column if not exists whatsapp_e164 text;
alter table public.staff add column if not exists whatsapp_opt_in_at timestamptz;
alter table public.staff add column if not exists whatsapp_opt_in_source text;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='profiles_whatsapp_e164_check') then
    alter table public.profiles add constraint profiles_whatsapp_e164_check
      check (whatsapp_e164 is null or whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$');
  end if;
  if not exists(select 1 from pg_constraint where conname='staff_whatsapp_e164_check') then
    alter table public.staff add constraint staff_whatsapp_e164_check
      check (whatsapp_e164 is null or whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$');
  end if;
end $$;

-- Existing records receive a canonical candidate only; this never creates consent.
update public.profiles
set whatsapp_e164=public.ahct_normalize_whatsapp_phone(phone)
where whatsapp_e164 is null and public.ahct_normalize_whatsapp_phone(phone) is not null;
update public.staff
set whatsapp_e164=public.ahct_normalize_whatsapp_phone(phone)
where whatsapp_e164 is null and public.ahct_normalize_whatsapp_phone(phone) is not null;

-- -----------------------------------------------------------------------------
-- 2. Private provider, campaign, delivery and conversation registers
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_provider_settings (
  id boolean primary key default true check (id),
  provider_kind text not null default 'meta_cloud' check (provider_kind in ('meta_cloud','generic_webhook')),
  enabled boolean not null default false,
  graph_version text not null default 'v22.0' check (graph_version ~ '^v[0-9]+\.[0-9]+$'),
  phone_number_id text,
  business_account_id text,
  endpoint_url text,
  default_template_name text,
  default_template_language text not null default 'en_US',
  access_token_enc text,
  app_secret_enc text,
  verify_token_enc text,
  secret_hints jsonb not null default '{}'::jsonb,
  chatbot_enabled boolean not null default true,
  chatbot_handoff_text text not null default 'Thank you. A member of the AH Consult team will respond during office hours.',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
alter table public.whatsapp_provider_settings enable row level security;
revoke all on public.whatsapp_provider_settings from public,anon,authenticated;

create table if not exists public.whatsapp_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  subject text,
  template_name text not null,
  template_language text not null default 'en_US',
  message_preview text,
  status text not null default 'preparing' check (status in ('preparing','queued','cancelled','failed','completed')),
  recipient_count integer not null default 0 check (recipient_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  queued_at timestamptz,
  completed_at timestamptz
);
create index if not exists whatsapp_campaigns_created_idx on public.whatsapp_campaigns(created_at desc);
alter table public.whatsapp_campaigns enable row level security;
revoke all on public.whatsapp_campaigns from public,anon,authenticated;

create table if not exists public.whatsapp_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.whatsapp_campaigns(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  recipient_kind text not null check (recipient_kind in ('student','staff')),
  recipient_name text,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  communication_id bigint references public.communication_outbox(id) on delete set null,
  provider_message_id text,
  status text not null default 'queued' check (status in ('queued','accepted','delivered','read','failed','cancelled')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id,user_id,recipient_kind)
);
create index if not exists whatsapp_campaign_recipients_status_idx on public.whatsapp_campaign_recipients(campaign_id,status);
create index if not exists whatsapp_campaign_recipients_outbox_idx on public.whatsapp_campaign_recipients(communication_id);
alter table public.whatsapp_campaign_recipients enable row level security;
revoke all on public.whatsapp_campaign_recipients from public,anon,authenticated;

-- Campaigns describe dispatch progress while individual recipient rows retain
-- the provider delivery evidence. A campaign becomes complete once every
-- queued job has reached a terminal dispatch state; later delivery/read
-- receipts continue to update the recipient ledger independently.
create or replace function public.ahct_refresh_whatsapp_campaign_status(p_campaign uuid)
returns public.whatsapp_campaigns
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare c public.whatsapp_campaigns%rowtype;
  total_count integer:=0; queued_count integer:=0; accepted_count integer:=0;
  failed_count integer:=0; cancelled_count integer:=0; next_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Restricted service action';
  end if;
  select * into c from public.whatsapp_campaigns where id=p_campaign for update;
  if not found then raise exception 'WhatsApp campaign not found'; end if;
  if c.status='cancelled' then return c; end if;
  select count(*),
         count(*) filter(where status='queued'),
         count(*) filter(where status in ('accepted','delivered','read')),
         count(*) filter(where status='failed'),
         count(*) filter(where status='cancelled')
    into total_count,queued_count,accepted_count,failed_count,cancelled_count
    from public.whatsapp_campaign_recipients where campaign_id=p_campaign;
  if total_count=0 then
    next_status:='failed';
  elsif queued_count>0 then
    next_status:='queued';
  elsif accepted_count>0 then
    next_status:='completed';
  elsif cancelled_count=total_count then
    next_status:='cancelled';
  elsif failed_count+cancelled_count=total_count then
    next_status:='failed';
  else
    next_status:='queued';
  end if;
  update public.whatsapp_campaigns
     set status=next_status,
         completed_at=case when next_status in ('completed','failed','cancelled') then coalesce(completed_at,now()) else null end
   where id=p_campaign
   returning * into c;
  return c;
end $$;
revoke all on function public.ahct_refresh_whatsapp_campaign_status(uuid) from public,anon,authenticated;
grant execute on function public.ahct_refresh_whatsapp_campaign_status(uuid) to service_role;

create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  user_id uuid references auth.users(id) on delete set null,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  handoff_requested_at timestamptz,
  status text not null default 'bot' check (status in ('bot','handoff','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.whatsapp_conversations enable row level security;
revoke all on public.whatsapp_conversations from public,anon,authenticated;

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  communication_id bigint references public.communication_outbox(id) on delete set null,
  provider_message_id text unique,
  direction text not null check (direction in ('inbound','outbound')),
  message_type text not null default 'text',
  body text,
  status text not null default 'accepted' check (status in ('accepted','sent','delivered','read','failed','received')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  status_at timestamptz
);
create index if not exists whatsapp_messages_conversation_idx on public.whatsapp_messages(conversation_id,created_at desc);
alter table public.whatsapp_messages enable row level security;
revoke all on public.whatsapp_messages from public,anon,authenticated;

create table if not exists public.whatsapp_webhook_events (
  provider_event_id text primary key,
  event_kind text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);
alter table public.whatsapp_webhook_events enable row level security;
revoke all on public.whatsapp_webhook_events from public,anon,authenticated;

-- A provider retry must never produce a second automated reply to the same
-- inbound WhatsApp message, even if the first queue insert succeeded just
-- before a transient webhook failure.
create unique index if not exists communication_outbox_whatsapp_inbound_reply_uq
  on public.communication_outbox ((metadata->>'inbound_message_id'))
  where channel='whatsapp' and metadata ? 'inbound_message_id';

-- New application data records affirmative consent and normalizes the number
-- before any outbound channel can be enabled. Historical applications remain intact.
create or replace function public.save_application_form(p_app uuid, p_form jsonb, p_passport text)
returns public.applications language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.applications%rowtype; msg text; f jsonb; wa text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into a from public.applications where id=p_app and user_id=auth.uid() for update;
  if not found then raise exception 'Application not found'; end if;
  if a.status not in ('draft','pending_payment','paid') then raise exception 'Your details can no longer be changed'; end if;
  msg:=public.validate_form(p_form); if msg is not null then raise exception '%',msg; end if;
  wa:=public.ahct_normalize_whatsapp_phone(p_form->>'phone');
  if wa is null then raise exception 'Enter a valid Nigerian WhatsApp number.'; end if;
  if coalesce(
    lower(p_form->>'whatsappConsent')='true',
    lower(p_form->>'whatsapp_consent')='true',
    false
  ) is not true then
    raise exception 'Please confirm that AH Consult may use this WhatsApp number for application updates.';
  end if;
  f:=jsonb_build_object(
    'surname',trim(p_form->>'surname'),'firstName',trim(p_form->>'firstName'),'otherNames',trim(coalesce(p_form->>'otherNames','')),
    'phone',wa,'whatsapp_consent',true,'dob',p_form->>'dob','gender',p_form->>'gender','state',trim(p_form->>'state'),
    'address',trim(p_form->>'address'),'education',p_form->>'education','occupation',p_form->>'occupation',
    'skills',trim(p_form->>'skills'),'laptop',p_form->>'laptop',
    'battery',case when p_form->>'laptop'='No' then 'Not applicable' else p_form->>'battery' end
  );
  if p_passport is not null and p_passport not like auth.uid()::text || '/' || p_app::text || '/%' then raise exception 'Invalid passport file'; end if;
  if coalesce(p_passport,a.passport_path) is null then raise exception 'Upload your passport photograph.'; end if;
  update public.profiles
  set phone=wa,whatsapp_e164=wa,whatsapp_opt_in_at=coalesce(whatsapp_opt_in_at,now()),whatsapp_opt_in_source='application'
  where id=auth.uid();
  insert into public.communication_preferences(user_id,whatsapp_enabled,updated_at)
  values(auth.uid(),true,now())
  on conflict(user_id) do update set whatsapp_enabled=true,updated_at=excluded.updated_at;
  update public.applications set form_data=f,passport_path=coalesce(p_passport,passport_path)
  where id=p_app returning * into a;
  return a;
end $$;
revoke all on function public.save_application_form(uuid,jsonb,text) from public,anon;
grant execute on function public.save_application_form(uuid,jsonb,text) to authenticated;

create or replace function public.submit_application(p_app uuid)
returns public.applications language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.applications%rowtype; msg text; wa text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into a from public.applications where id=p_app and user_id=auth.uid() for update;
  if not found then raise exception 'Application not found'; end if;
  if a.student_id is not null and a.status in ('submitted','under_review','approved') then return a; end if;
  if a.status<>'paid' then raise exception 'Payment has not been confirmed yet'; end if;
  msg:=public.validate_form(coalesce(a.form_data,'{}'::jsonb)); if msg is not null then raise exception '%',msg; end if;
  if coalesce((a.form_data->>'whatsapp_consent')::boolean,false) is not true then
    raise exception 'A consented WhatsApp number is required before submission.';
  end if;
  wa:=public.ahct_normalize_whatsapp_phone(a.form_data->>'phone');
  if wa is null then raise exception 'A valid WhatsApp number is required before submission.'; end if;
  if a.passport_path is null then raise exception 'Upload your passport photograph.'; end if;
  update public.profiles
  set phone=wa,whatsapp_e164=wa,whatsapp_opt_in_at=coalesce(whatsapp_opt_in_at,now()),whatsapp_opt_in_source='application'
  where id=auth.uid();
  insert into public.communication_preferences(user_id,whatsapp_enabled,updated_at)
  values(auth.uid(),true,now())
  on conflict(user_id) do update set whatsapp_enabled=true,updated_at=excluded.updated_at;
  update public.applications set status='submitted',student_id=public.next_student_id(a.intake_id),submitted_at=now()
  where id=p_app returning * into a;
  return a;
end $$;
revoke all on function public.submit_application(uuid) from public,anon;
grant execute on function public.submit_application(uuid) to authenticated;

-- Prefer the consented canonical WhatsApp value for notification-triggered deliveries.
-- It queues only when a configured provider has an approved default template.
create or replace function public.enqueue_notification_communications(p_notification uuid)
returns int language plpgsql security definer set search_path=public,pg_temp as $$
declare n public.student_notifications%rowtype; p public.profiles%rowtype; pref public.communication_preferences%rowtype;
        wa public.whatsapp_provider_settings%rowtype; added int:=0;
begin
  select * into n from public.student_notifications where id=p_notification;
  if not found then return 0; end if;
  select * into p from public.profiles where id=n.user_id;
  if not found then return 0; end if;
  insert into public.communication_preferences(user_id) values(n.user_id) on conflict(user_id) do nothing;
  select * into pref from public.communication_preferences where user_id=n.user_id;
  select * into wa from public.whatsapp_provider_settings where id=true;
  if pref.email_enabled and nullif(trim(coalesce(p.email,'')),'') is not null then
    insert into public.communication_outbox(user_id,notification_id,channel,recipient,subject,message,metadata)
    values(n.user_id,n.id,'email',p.email,n.title,n.message,jsonb_build_object('action_url',n.action_url,'event_key',n.event_key))
    on conflict(notification_id,channel) where notification_id is not null do nothing;
    if found then added:=added+1; end if;
  end if;
  if pref.sms_enabled and nullif(trim(coalesce(p.phone,'')),'') is not null then
    insert into public.communication_outbox(user_id,notification_id,channel,recipient,subject,message,metadata)
    values(n.user_id,n.id,'sms',p.phone,null,n.message,jsonb_build_object('action_url',n.action_url,'event_key',n.event_key))
    on conflict(notification_id,channel) where notification_id is not null do nothing;
    if found then added:=added+1; end if;
  end if;
  if pref.whatsapp_enabled and coalesce(wa.enabled,false) and nullif(trim(coalesce(wa.default_template_name,'')),'') is not null
     and p.whatsapp_e164 is not null and p.whatsapp_opt_in_at is not null then
    insert into public.communication_outbox(user_id,notification_id,channel,recipient,subject,message,metadata)
    values(n.user_id,n.id,'whatsapp',p.whatsapp_e164,n.title,n.message,
      jsonb_build_object('action_url',n.action_url,'event_key',n.event_key,'message_mode','template',
                         'template_name',wa.default_template_name,'template_language',wa.default_template_language,'transactional',true))
    on conflict(notification_id,channel) where notification_id is not null do nothing;
    if found then added:=added+1; end if;
  end if;
  return added;
end $$;
revoke all on function public.enqueue_notification_communications(uuid) from public,anon,authenticated;

create or replace function public.queue_communication(p_notification uuid,p_channels text[] default array['email'])
returns int language plpgsql security definer set search_path=public,pg_temp as $$
declare n public.student_notifications%rowtype; p public.profiles%rowtype; pref public.communication_preferences%rowtype;
        wa public.whatsapp_provider_settings%rowtype; c text; recipient text; meta jsonb; count_added int:=0;
begin
  if not public.has_role('administrator','registrar','finance','academic','operations') then raise exception 'Communication queue access required'; end if;
  select * into n from public.student_notifications where id=p_notification;
  if not found then raise exception 'Notification not found'; end if;
  select * into p from public.profiles where id=n.user_id;
  insert into public.communication_preferences(user_id) values(n.user_id) on conflict(user_id) do nothing;
  select * into pref from public.communication_preferences where user_id=n.user_id;
  select * into wa from public.whatsapp_provider_settings where id=true;
  foreach c in array p_channels loop
    if c not in ('email','sms','whatsapp') then continue; end if;
    if c='email' and not coalesce(pref.email_enabled,true) then continue; end if;
    if c='sms' and not coalesce(pref.sms_enabled,false) then continue; end if;
    if c='whatsapp' and (not coalesce(pref.whatsapp_enabled,false) or not coalesce(wa.enabled,false)
       or nullif(trim(coalesce(wa.default_template_name,'')),'') is null
       or p.whatsapp_e164 is null or p.whatsapp_opt_in_at is null) then continue; end if;
    recipient:=case when c='email' then p.email when c='whatsapp' then p.whatsapp_e164 else p.phone end;
    if nullif(trim(coalesce(recipient,'')),'') is null then continue; end if;
    meta:=jsonb_build_object('action_url',n.action_url,'event_key',n.event_key);
    if c='whatsapp' then meta:=meta||jsonb_build_object('message_mode','template','template_name',wa.default_template_name,'template_language',wa.default_template_language,'transactional',true); end if;
    insert into public.communication_outbox(user_id,notification_id,channel,recipient,subject,message,metadata)
    values(n.user_id,n.id,c,recipient,n.title,n.message,meta)
    on conflict(notification_id,channel) where notification_id is not null do nothing;
    if found then count_added:=count_added+1; end if;
  end loop;
  return count_added;
end $$;
revoke all on function public.queue_communication(uuid,text[]) from public,anon;
grant execute on function public.queue_communication(uuid,text[]) to authenticated;

comment on table public.whatsapp_provider_settings is 'Singleton encrypted WhatsApp provider configuration. Browser roles never receive stored secret material.';
comment on table public.whatsapp_campaigns is 'Auditable WhatsApp template campaigns created only by an authenticated administrator Edge Function.';
comment on table public.whatsapp_messages is 'Private inbound and outbound WhatsApp delivery/conversation ledger. Do not expose to browser clients.';
