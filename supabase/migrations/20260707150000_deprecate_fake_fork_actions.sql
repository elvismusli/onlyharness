-- Fork/remix clicks are currently local recipes, not server-side ownership
-- records. Keep forks reserved for a future real fork/remix table.

create or replace function public.bump_harness_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  delta integer := case when tg_op = 'INSERT' then 1 else -1 end;
  act text := coalesce(new.action, old.action);
  own text := coalesce(new.owner, old.owner);
  rep text := coalesce(new.repo, old.repo);
begin
  insert into public.harness_counters (owner, repo)
  values (own, rep)
  on conflict (owner, repo) do nothing;

  update public.harness_counters set
    stars = greatest(0, stars + case when act = 'star' then delta else 0 end)
  where owner = own and repo = rep;

  return coalesce(new, old);
end;
$$;

create or replace function public.reject_user_harness_derived_action()
returns trigger
language plpgsql
as $$
begin
  if new.action = 'run' then
    raise exception 'user_harness_actions.run is deprecated; record verified runtime telemetry instead'
      using errcode = 'check_violation';
  end if;
  if new.action = 'fork' then
    raise exception 'user_harness_actions.fork is deprecated; use the future server-side fork/remix flow'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_user_harness_run_action on public.user_harness_actions;
drop function if exists public.reject_user_harness_run_action();

drop trigger if exists reject_user_harness_derived_action on public.user_harness_actions;
create trigger reject_user_harness_derived_action
before insert or update of action on public.user_harness_actions
for each row execute procedure public.reject_user_harness_derived_action();

update public.harness_counters
set forks = 0
where forks <> 0;
