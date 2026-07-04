create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_harness_actions (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  owner text not null,
  repo text not null,
  action text not null check (action in ('star', 'fork', 'run')),
  created_at timestamptz not null default now(),
  unique (user_id, owner, repo, action)
);

create table if not exists public.harness_thread_posts (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  repo text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('question', 'recipe', 'result', 'proposal', 'bug/risk')),
  body text not null check (char_length(body) between 2 and 2000),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.user_harness_actions enable row level security;
alter table public.harness_thread_posts enable row level security;

drop policy if exists "Profiles are readable by everyone" on public.profiles;
create policy "Profiles are readable by everyone"
  on public.profiles for select
  using (true);

drop policy if exists "Users insert own profile" on public.profiles;
create policy "Users insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Users read own harness actions" on public.user_harness_actions;
create policy "Users read own harness actions"
  on public.user_harness_actions for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own harness actions" on public.user_harness_actions;
create policy "Users insert own harness actions"
  on public.user_harness_actions for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own harness actions" on public.user_harness_actions;
create policy "Users delete own harness actions"
  on public.user_harness_actions for delete
  using (auth.uid() = user_id);

drop policy if exists "Thread posts are public" on public.harness_thread_posts;
create policy "Thread posts are public"
  on public.harness_thread_posts for select
  using (true);

drop policy if exists "Authenticated users create thread posts" on public.harness_thread_posts;
create policy "Authenticated users create thread posts"
  on public.harness_thread_posts for insert
  with check (auth.uid() = user_id);

drop function if exists public.handle_new_user() cascade;
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create index if not exists user_harness_actions_user_repo_idx
  on public.user_harness_actions (user_id, owner, repo);

create index if not exists harness_thread_posts_repo_created_idx
  on public.harness_thread_posts (owner, repo, created_at desc);
