-- Full Package: one fee, pick courses from any level (Beginner to Professional).
create table if not exists packages(code text primary key, name text not null, fee_ngn int not null,
  max_courses int,            -- NULL = no limit on number of courses; set e.g. 5 to cap it
  is_active bool default true);
alter table packages enable row level security;
drop policy if exists read_packages on packages;
create policy read_packages on packages for select using(true);
alter table applications add column if not exists package_code text references packages(code);
insert into packages(code,name,fee_ngn,max_courses) values('FULL','Full Package',100000,null) on conflict(code) do update set fee_ngn=excluded.fee_ngn;
-- Levels come from courses.category (Beginner, Intermediate, Advanced, Professional). Make sure your courses use these names.
