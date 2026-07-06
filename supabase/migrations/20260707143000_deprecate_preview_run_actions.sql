-- Browser previews are not runtime evidence. Keep the counters.runs column reserved
-- for future verified runtime telemetry, but do not let social actions feed it.

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
    stars = greatest(0, stars + case when act = 'star' then delta else 0 end),
    forks = greatest(0, forks + case when act = 'fork' then delta else 0 end)
  where owner = own and repo = rep;

  return coalesce(new, old);
end;
$$;

create or replace function public.reject_user_harness_run_action()
returns trigger
language plpgsql
as $$
begin
  if new.action = 'run' then
    raise exception 'user_harness_actions.run is deprecated; record verified runtime telemetry instead'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_user_harness_run_action on public.user_harness_actions;
create trigger reject_user_harness_run_action
before insert or update of action on public.user_harness_actions
for each row execute procedure public.reject_user_harness_run_action();

update public.harness_counters
set runs = 0
where runs <> 0;
