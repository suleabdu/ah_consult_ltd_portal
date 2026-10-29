-- V18.6.4: tighter letterhead clearance requested for new documents.
-- Existing issued PDFs are immutable. The designer still permits larger safe areas
-- whenever a stationery image has a tall masthead or bottom artwork.
alter table public.institution_document_branding
  alter column top_safe_mm set default 10.0,
  alter column bottom_safe_mm set default 3.0;
alter table public.institution_document_branding
  drop constraint if exists document_branding_safe_margins;
alter table public.institution_document_branding
  add constraint document_branding_safe_margins check (
    top_safe_mm between 10 and 120 and bottom_safe_mm between 3 and 60
    and top_safe_mm + bottom_safe_mm < 240
  );
-- Only upgrade previous unmodified defaults; preserve any administrator-customized
-- safe area, whose uploaded masthead may occupy more than 10 mm.
update public.institution_document_branding
  set top_safe_mm = 10, bottom_safe_mm = 3
  where top_safe_mm = 85 and bottom_safe_mm = 20;
-- Verify the new arrangement against the uploaded letterhead on staging; increase
-- top/bottom clearance through Document Designer if branding artwork overlaps.

