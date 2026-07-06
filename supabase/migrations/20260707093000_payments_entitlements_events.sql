create table if not exists public.harness_payments (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null,
  owner text not null,
  repo text not null,
  version text,
  provider text not null default 'manual',
  provider_reference text,
  amount_usd numeric(12, 2),
  currency text not null default 'USD' check (char_length(currency) = 3),
  status text not null check (status in ('pending', 'succeeded', 'failed', 'refunded', 'manual_granted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.harness_entitlements (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  owner text not null,
  repo text not null,
  version text,
  provider text not null default 'manual',
  provider_reference text,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  unique nulls not distinct (user_id, owner, repo, version)
);

create table if not exists public.events (
  id bigserial primary key,
  kind text not null check (kind in ('view', 'copy', 'install', 'pull', 'checkout', 'purchase', 'suggested', 'applied')),
  owner text,
  repo text,
  version text,
  subject text not null default 'anonymous',
  target text,
  client text,
  created_at timestamptz not null default now()
);

alter table public.harness_payments enable row level security;
alter table public.harness_entitlements enable row level security;
alter table public.events enable row level security;

drop policy if exists "Users read own payments" on public.harness_payments;
create policy "Users read own payments"
  on public.harness_payments for select
  using (auth.uid() = user_id);

drop policy if exists "Users read own entitlements" on public.harness_entitlements;
create policy "Users read own entitlements"
  on public.harness_entitlements for select
  using (auth.uid() = user_id);

create index if not exists harness_payments_user_repo_idx
  on public.harness_payments (user_id, owner, repo, version);

create index if not exists harness_entitlements_user_repo_idx
  on public.harness_entitlements (user_id, owner, repo, version);

create index if not exists events_repo_kind_created_idx
  on public.events (owner, repo, kind, created_at desc);
