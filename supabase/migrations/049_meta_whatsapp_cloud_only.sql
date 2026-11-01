-- V18.9.1: retire the unused generic-provider route without rewriting 048.
-- Retain endpoint_url for backwards schema compatibility, but never expose or use it.

update public.whatsapp_provider_settings
set enabled=false,
    provider_kind='meta_cloud'
where provider_kind <> 'meta_cloud';

update public.whatsapp_provider_settings
set endpoint_url=null
where endpoint_url is not null;

alter table public.whatsapp_provider_settings
  drop constraint if exists whatsapp_provider_settings_provider_kind_check;

alter table public.whatsapp_provider_settings
  add constraint whatsapp_provider_settings_provider_kind_check
  check (provider_kind = 'meta_cloud');

comment on table public.whatsapp_provider_settings is
  'Singleton encrypted Meta WhatsApp Cloud API configuration. Browser roles never receive stored secret material.';
