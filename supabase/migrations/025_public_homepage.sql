-- 025_public_homepage.sql
-- Public homepage backend. Safe to re-run (idempotent).
--  1. gallery_items : admin-managed photographs with publish / unpublish / archive, categories, featuring and ordering.
--                     Anonymous visitors can read ONLY rows whose status = 'published'.
--  2. public_impact_stats() : the only door through which the public homepage reads learner figures. It returns
--                     four aggregate numbers, never rows, names, registration numbers or results.
--
-- WHY a table instead of the old site_settings 'gallery' JSON: site_settings is world-readable by design, so a draft,
-- unpublished or archived photograph stored there would be publicly retrievable. A table with row-level security can
-- keep unpublished photographs private.

-- 1. Gallery ------------------------------------------------------------------------------------
create table if not exists public.gallery_items (
  id           uuid primary key default gen_random_uuid(),
  image_url    text not null check (image_url ~ '^https://'),
  caption      text not null default '' check (length(caption) <= 240),
  alt_text     text not null default '' check (length(alt_text) <= 240),
  category     text not null default 'other' check (category in ('training', 'projects', 'graduation', 'events', 'other')),
  status       text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  featured     boolean not null default false,
  sort_order   integer not null default 0,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists gallery_items_public_idx on public.gallery_items (sort_order, created_at) where status = 'published';
alter table public.gallery_items enable row level security;

drop policy if exists gi_public_read on public.gallery_items;
create policy gi_public_read on public.gallery_items for select to anon, authenticated using (status = 'published');
drop policy if exists gi_admin_all on public.gallery_items;
create policy gi_admin_all on public.gallery_items for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.gallery_items from public, anon, authenticated;
grant select on public.gallery_items to anon;
grant select, insert, update, delete on public.gallery_items to authenticated;   -- row access is still limited by the policies above

create or replace function public.gallery_items_touch()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then new.published_at := now(); end if;
  if new.status <> 'published' then new.published_at := null; end if;
  return new;
end $$;
revoke all on function public.gallery_items_touch() from public, anon, authenticated;
drop trigger if exists gallery_items_touch on public.gallery_items;
create trigger gallery_items_touch before insert or update on public.gallery_items for each row execute function public.gallery_items_touch();

-- every administrative change is written to the immutable audit log
create or replace function public.gallery_items_audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.gallery_items; who text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  select full_name into who from public.staff where id = auth.uid();
  insert into public.audit_log (actor, actor_name, action, target, note)
  values (auth.uid(), who, 'gallery.' || lower(tg_op), r.id::text,
          left(coalesce(nullif(r.caption, ''), 'photo') || ' [' || r.category || ', ' || r.status || ']', 240));
  return r;
end $$;
revoke all on function public.gallery_items_audit() from public, anon, authenticated;
drop trigger if exists gallery_items_audit on public.gallery_items;
create trigger gallery_items_audit after insert or update or delete on public.gallery_items for each row execute function public.gallery_items_audit();

-- Move the photographs that already exist onto the new table (only once, only if the table is empty).
-- Source 1: whatever an administrator saved through the old gallery panel. Source 2: the ten graduation photographs that were
-- hard-coded in the old homepage. Both are the company's own existing, already-public photographs.
do $$
begin
  if not exists (select 1 from public.gallery_items) then
    if exists (select 1 from public.site_settings where key = 'gallery' and jsonb_typeof(value) = 'array' and jsonb_array_length(value) > 0) then
      insert into public.gallery_items (image_url, caption, category, status, featured, sort_order)
      select g ->> 'url', left(coalesce(g ->> 'caption', ''), 240), 'graduation', 'published', ord <= 3, (ord * 10)::int
      from public.site_settings s, jsonb_array_elements(s.value) with ordinality as t(g, ord)
      where s.key = 'gallery' and (g ->> 'url') ~ '^https://';
    else
      insert into public.gallery_items (image_url, caption, category, status, featured, sort_order)
      select 'https://lh3.googleusercontent.com/d/' || id, '', 'graduation', 'published', ord <= 3, (ord * 10)::int
      from unnest(array['1M7_T2x68zw0RHkBMUBcyQKmsvGz73fTv', '1Q60DwRTeGg8pa9oXyhYVLcyHpjU_LfAz', '1MqVnUZpzbEnGklIeg7-NEa0y6DMj9nGy',
                        '1w3aqa91HKyJh4gWAqblHK-LH7tnRic1Z', '17AqaKzAxmpXFgOdOKCOGixEg6s7ln91_', '1m2vB25PmVcVgino6xYoqrBK0DamlUviA',
                        '1D5whHoDXS693T5A6UBLyyJ8ToqB54soi', '1bWuCbfWPTmiU2bg4qcf1GxLpNIlhJHjY', '19EqTXeb7s3Os_zQNLPE9Y9aOx8y0YikH',
                        '15r_qW2sbUfbrGDAU4BFKIAFP75guoJvC']) with ordinality as t(id, ord);
    end if;
  end if;
end $$;

-- Live updates for the homepage (the page also polls, so this is an accelerator, not a dependency).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gallery_items') then
    alter publication supabase_realtime add table public.gallery_items;
  end if;
end $$;

-- 2. Public learning-impact figures ------------------------------------------------------------------
-- COUNTING RULES (also shown in docs/HOMEPAGE.md):
--  learners_enrolled : distinct STUDENTS (not applications) whose admission was APPROVED and whose payment was CONFIRMED.
--                      Drafts, unpaid, submitted-only, under-review, rejected and expired applications are never counted.
--                      (student_id is allocated at submission, so it is NOT used: it would count mere applicants.)
--  graduates         : distinct students with at least one ISSUED Certificate of Completion (document_jobs.status = 'issued').
--                      Returned as NULL until the first certificate is issued; earlier cohorts finished before certificates
--                      were tracked in the system, so a "0" would be misleading rather than accurate.
--  programmes        : distinct names among ACTIVE courses.
--  active_intakes    : intakes that are active and not yet closed.
-- A figure of NULL means "cannot be stated reliably yet" and the homepage omits it.
create or replace function public.public_impact_stats()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'learners_enrolled', nullif((select count(distinct a.user_id) from public.applications a
        where a.admission_decision = 'approved' and a.paid_at is not null
          and a.status in ('paid', 'submitted', 'under_review', 'approved')), 0),
    'graduates', nullif((select count(distinct j.user_id) from public.document_jobs j
        where j.document_key = 'certificate' and j.status = 'issued'), 0),
    'programmes', nullif((select count(distinct c.name) from public.courses c where c.is_active), 0),
    'active_intakes', nullif((select count(*) from public.intakes i
        where i.is_active and (i.closes_at is null or i.closes_at >= now())), 0),
    'as_of', now()
  );
$$;
revoke all on function public.public_impact_stats() from public;
grant execute on function public.public_impact_stats() to anon, authenticated;
comment on function public.public_impact_stats() is 'Public aggregate figures only. Never returns rows or personal data.';
