-- AHCT V18.6.6: protect the first 59.6 mm of A4 for official stationery.
-- Historical migrations are immutable. Do not alter existing issued PDF bytes.
-- 297 / 5 is mathematically 59.4 mm; the requested 59.6 mm is used as
-- a slightly more conservative top-safe clearance across all document types.
-- Preserve the existing bottom-safe value, footer, and image revisions.

alter table public.institution_document_branding
  alter column top_safe_mm set default 59.6;

update public.institution_document_branding
  set top_safe_mm = 59.6
  where top_safe_mm is distinct from 59.6;

alter table public.institution_document_branding
  drop constraint if exists document_branding_safe_margins;

alter table public.institution_document_branding
  add constraint document_branding_safe_margins check (
    top_safe_mm between 59.6 and 120
    and bottom_safe_mm between 3 and 60
    and top_safe_mm + bottom_safe_mm < 240
  );
