-- Global-review media hardening foundation.
--
-- Existing `site-assets` remains deliberately untouched: published pages currently use
-- public object URLs from that bucket. Changing it in place would make live public
-- pages fail. This private bucket is an additive staging area for media that has not
-- yet been approved and promoted to a public derivative.
--
-- Future clients must upload a draft beneath `<authenticated-user-id>/...`, review it
-- through an authenticated signed URL, then publish a reviewed derivative to the
-- existing public delivery bucket through an authorised server-side workflow. Do not
-- point public pages at this bucket and do not store applicant or learner documents here.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media-drafts',
  'media-drafts',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Only staff explicitly delegated media write access can create or alter their own
-- drafts. Their identity-prefixed path prevents one editor overwriting another's draft.
drop policy if exists media_draft_insert on storage.objects;
create policy media_draft_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'media-drafts'
  and public.can_write('media')
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists media_draft_update on storage.objects;
create policy media_draft_update on storage.objects for update to authenticated
using (
  bucket_id = 'media-drafts'
  and public.can_write('media')
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'media-drafts'
  and public.can_write('media')
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Editors may inspect/delete only their own drafts. Administrators retain the minimum
-- moderation ability needed to inspect or remove any draft; no anonymous read policy
-- exists, so public URLs cannot expose pre-publication imagery.
drop policy if exists media_draft_select on storage.objects;
create policy media_draft_select on storage.objects for select to authenticated
using (
  bucket_id = 'media-drafts'
  and (
    (public.can_write('media') and (storage.foldername(name))[1] = auth.uid()::text)
    or public.is_admin()
  )
);

drop policy if exists media_draft_delete on storage.objects;
create policy media_draft_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'media-drafts'
  and (
    (public.can_write('media') and (storage.foldername(name))[1] = auth.uid()::text)
    or public.is_admin()
  )
);

comment on policy media_draft_insert on storage.objects is
  'Private media drafts: media editor, own identity-prefixed folder only.';
comment on policy media_draft_select on storage.objects is
  'Private media drafts: creator or administrator only; publish via approved server workflow.';
