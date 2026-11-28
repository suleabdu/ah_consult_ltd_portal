-- Choose the public pages where each gallery photograph may appear.
-- Existing categories and publication policies remain in force.
alter table public.gallery_items add column if not exists display_locations text[];

-- Preserve the previous placement of every existing photograph. Only fill rows
-- which have not yet been migrated, so rerunning this migration is safe.
update public.gallery_items
set display_locations = case
  when category = 'projects' then array['homepage']::text[]
  when category in ('training', 'graduation', 'events') then array['student_hub']::text[]
  else array[]::text[]
end
where display_locations is null;

alter table public.gallery_items alter column display_locations set default array[]::text[];
alter table public.gallery_items alter column display_locations set not null;
alter table public.gallery_items drop constraint if exists gallery_items_display_locations_check;
alter table public.gallery_items add constraint gallery_items_display_locations_check
  check (array_position(display_locations, null) is null
    and display_locations <@ array['homepage', 'student_hub', 'recruitment', 'services']::text[]);
create index if not exists gallery_items_display_locations_idx
  on public.gallery_items using gin (display_locations) where status = 'published';

-- The existing public published-only and authenticated media-editor policies
-- continue to govern reads and writes to all columns, including placements.
