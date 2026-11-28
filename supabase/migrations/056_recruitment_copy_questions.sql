-- Copy independently editable questions between vacancies without changing
-- previously submitted answers or their stored question snapshots.
create or replace function public.recruitment_copy_questions(
  p_source uuid,
  p_target uuid,
  p_questions uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_status text;
  selected_count integer;
  inserted_count integer;
  first_order integer;
  who text;
begin
  if auth.uid() is null or not public.can_write('recruitment') then
    raise exception 'Recruitment management access is required';
  end if;
  if p_source is null or p_target is null or p_source = p_target then
    raise exception 'Choose two different vacancies';
  end if;
  if coalesce(cardinality(p_questions), 0) not between 1 and 100 then
    raise exception 'Select between one and 100 questions';
  end if;

  -- Submission locks the target vacancy as well. A copy therefore completes
  -- atomically before or after an application takes its question snapshot.
  select status into target_status from public.recruitment_vacancies
   where id = p_target for update;
  if not found then raise exception 'Destination vacancy not found'; end if;
  if target_status = 'closed' then raise exception 'Questions cannot be added to a closed vacancy'; end if;
  if not exists (select 1 from public.recruitment_vacancies where id = p_source) then
    raise exception 'Source vacancy not found';
  end if;
  select count(distinct q.id) into selected_count from public.recruitment_questions q
   where q.vacancy_id = p_source and q.id = any(p_questions);
  if selected_count <> cardinality(p_questions) then
    raise exception 'The selected questions no longer match the source vacancy; refresh and try again';
  end if;

  select coalesce(max(sort_order), 0) into first_order
    from public.recruitment_questions where vacancy_id = p_target;
  insert into public.recruitment_questions(vacancy_id, prompt, kind, required, options, sort_order)
  select p_target, q.prompt, q.kind, q.required, q.options,
         first_order + (row_number() over (order by q.sort_order, q.created_at, q.id))::integer
    from public.recruitment_questions q
   where q.vacancy_id = p_source and q.id = any(p_questions)
     and not exists (
       select 1 from public.recruitment_questions existing
        where existing.vacancy_id = p_target
          and lower(trim(existing.prompt)) = lower(trim(q.prompt))
          and existing.kind = q.kind
     );
  get diagnostics inserted_count = row_count;

  select full_name into who from public.staff where id = auth.uid();
  insert into public.audit_log(actor, actor_name, action, target, note)
  values(auth.uid(), coalesce(who, 'Staff'), 'recruitment_questions_copied', p_target::text,
    'Copied ' || inserted_count::text || ' of ' || selected_count::text || ' selected questions from ' || p_source::text);
  return jsonb_build_object('copied', inserted_count, 'skipped', selected_count - inserted_count);
end $$;

revoke all on function public.recruitment_copy_questions(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.recruitment_copy_questions(uuid, uuid, uuid[]) to authenticated;
