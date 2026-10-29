-- V18.6.5: move newly generated document content 30 mm below the top edge.
-- Only the top safe area is changed; keep the saved bottom clearance and every
-- other branding choice unchanged. Applied migrations 001-037 remain immutable.
-- Archived/issued PDFs are immutable; changes affect previews and future issuance.
alter table public.institution_document_branding
  alter column top_safe_mm set default 30.0;

update public.institution_document_branding
  set top_safe_mm = 30.0
  where top_safe_mm is distinct from 30.0;
