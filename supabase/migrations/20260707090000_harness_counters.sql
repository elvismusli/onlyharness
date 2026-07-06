create table if not exists public.harness_counters (
  owner text not null,
  repo text not null,
  stars integer not null default 0,
  forks integer not null default 0,
  runs integer not null default 0,
  threads integer not null default 0,
  primary key (owner, repo)
);

alter table public.harness_counters enable row level security;

drop policy if exists "Counters are readable by everyone" on public.harness_counters;
create policy "Counters are readable by everyone"
  on public.harness_counters for select
  using (true);

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
    forks = greatest(0, forks + case when act = 'fork' then delta else 0 end),
    runs = greatest(0, runs + case when act = 'run' then delta else 0 end)
  where owner = own and repo = rep;

  return coalesce(new, old);
end;
$$;

drop trigger if exists on_harness_action_change on public.user_harness_actions;
create trigger on_harness_action_change
after insert or delete on public.user_harness_actions
for each row execute procedure public.bump_harness_counter();

create or replace function public.bump_thread_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.harness_counters (owner, repo)
  values (new.owner, new.repo)
  on conflict (owner, repo) do nothing;

  update public.harness_counters
  set threads = threads + 1
  where owner = new.owner and repo = new.repo;

  return new;
end;
$$;

drop trigger if exists on_thread_post_created on public.harness_thread_posts;
create trigger on_thread_post_created
after insert on public.harness_thread_posts
for each row execute procedure public.bump_thread_counter();

insert into public.harness_counters (owner, repo, stars, forks, runs)
select
  owner,
  repo,
  count(*) filter (where action = 'star')::integer,
  count(*) filter (where action = 'fork')::integer,
  count(*) filter (where action = 'run')::integer
from public.user_harness_actions
group by owner, repo
on conflict (owner, repo) do update
  set stars = excluded.stars,
      forks = excluded.forks,
      runs = excluded.runs;

update public.harness_counters counters
set threads = posts.cnt
from (
  select owner, repo, count(*)::integer as cnt
  from public.harness_thread_posts
  group by owner, repo
) posts
where counters.owner = posts.owner and counters.repo = posts.repo;
