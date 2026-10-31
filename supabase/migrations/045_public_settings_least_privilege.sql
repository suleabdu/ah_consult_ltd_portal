-- Public pages only need explicitly non-sensitive visual/contact settings.
-- Keep operational settings such as `official_website` readable by administrators
-- and trusted server-side code, never by the anonymous browser role.

drop policy if exists ss_read on public.site_settings;
drop policy if exists ss_public_read on public.site_settings;
drop policy if exists ss_authenticated_read on public.site_settings;
drop policy if exists ss_write on public.site_settings;

create policy ss_public_read on public.site_settings for select to anon
using (key = any (array['branding', 'theme', 'images', 'location', 'gallery']));

create policy ss_authenticated_read on public.site_settings for select to authenticated
using (
  key = any (array['branding', 'theme', 'images', 'location', 'gallery'])
  or public.is_admin()
);

-- The original write policy applied to PUBLIC even though only authenticated roles
-- had table write grants. Narrow the policy itself as well so anonymous queries never
-- need to evaluate the privileged is_admin() helper.
create policy ss_write on public.site_settings for all to authenticated
using (public.is_admin()) with check (public.is_admin());

comment on policy ss_public_read on public.site_settings is
  'Anonymous browser reads are allow-listed to public visual and location settings only.';
