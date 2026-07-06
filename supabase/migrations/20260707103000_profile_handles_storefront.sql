alter table public.profiles
  add column if not exists handle text,
  add column if not exists bio text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_handle_format'
  ) then
    alter table public.profiles
      add constraint profiles_handle_format
      check (handle is null or handle ~ '^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])$');
  end if;
end;
$$;

create unique index if not exists profiles_handle_unique_idx
  on public.profiles (lower(handle))
  where handle is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'referral_codes_code_format'
  ) then
    alter table public.referral_codes
      add constraint referral_codes_code_format
      check (code ~ '^[A-Za-z0-9_-]{3,64}$');
  end if;
end;
$$;

create table if not exists public.harness_creators (
  owner text not null,
  repo text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner, repo)
);

alter table public.harness_creators enable row level security;

drop policy if exists "Users read own harness creator refs" on public.harness_creators;
create policy "Users read own harness creator refs"
  on public.harness_creators for select
  using (auth.uid() = user_id);

drop policy if exists "Users create own harness creator refs" on public.harness_creators;
create policy "Users create own harness creator refs"
  on public.harness_creators for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own harness creator refs" on public.harness_creators;
create policy "Users update own harness creator refs"
  on public.harness_creators for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists harness_creators_user_updated_idx
  on public.harness_creators (user_id, updated_at desc);
