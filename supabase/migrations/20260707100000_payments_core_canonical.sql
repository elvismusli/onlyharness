create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('user', 'wallet', 'org')),
  subject_id text not null,
  owner text not null,
  repo text not null,
  version text,
  amount_usd numeric(10, 2) not null,
  currency text not null default 'USD' check (char_length(currency) = 3),
  provider text not null check (provider in ('fintech', 'paddle', 'x402', 'manual')),
  provider_ref text,
  referral_code text,
  creator_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'reserved', 'captured', 'refunded', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('user', 'wallet', 'org')),
  subject_id text not null,
  owner text not null,
  repo text not null,
  version text,
  kind text not null check (kind in ('one_time', 'subscription', 'escrow_reserved')),
  expires_at timestamptz,
  purchase_id uuid references public.purchases(id) on delete set null,
  created_at timestamptz not null default now(),
  unique nulls not distinct (subject_type, subject_id, owner, repo, version, kind)
);

create table if not exists public.payout_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  method text not null check (method in ('usdc_wallet', 'fiat_manual')),
  address text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.referral_codes (
  code text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.purchases enable row level security;
alter table public.entitlements enable row level security;
alter table public.payout_accounts enable row level security;
alter table public.referral_codes enable row level security;

drop policy if exists "Users read own purchases" on public.purchases;
create policy "Users read own purchases"
  on public.purchases for select
  using (auth.uid()::text = subject_id and subject_type = 'user');

drop policy if exists "Users read own entitlements" on public.entitlements;
create policy "Users read own entitlements"
  on public.entitlements for select
  using (auth.uid()::text = subject_id and subject_type = 'user');

drop policy if exists "Users read own payout account" on public.payout_accounts;
create policy "Users read own payout account"
  on public.payout_accounts for select
  using (auth.uid() = user_id);

drop policy if exists "Users upsert own payout account" on public.payout_accounts;
create policy "Users upsert own payout account"
  on public.payout_accounts for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own payout account" on public.payout_accounts;
create policy "Users update own payout account"
  on public.payout_accounts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own payout account" on public.payout_accounts;
create policy "Users delete own payout account"
  on public.payout_accounts for delete
  using (auth.uid() = user_id);

drop policy if exists "Users read own referral codes" on public.referral_codes;
create policy "Users read own referral codes"
  on public.referral_codes for select
  using (auth.uid() = user_id);

drop policy if exists "Users create own referral codes" on public.referral_codes;
create policy "Users create own referral codes"
  on public.referral_codes for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own referral codes" on public.referral_codes;
create policy "Users delete own referral codes"
  on public.referral_codes for delete
  using (auth.uid() = user_id);

create index if not exists purchases_subject_created_idx
  on public.purchases (subject_type, subject_id, created_at desc);

create unique index if not exists purchases_provider_ref_unique_idx
  on public.purchases (provider, provider_ref)
  where provider_ref is not null;

create index if not exists purchases_repo_status_created_idx
  on public.purchases (owner, repo, status, created_at desc);

create index if not exists purchases_creator_status_created_idx
  on public.purchases (creator_user_id, status, created_at desc);

create index if not exists entitlements_subject_repo_idx
  on public.entitlements (subject_type, subject_id, owner, repo, version);

insert into public.purchases (
  subject_type,
  subject_id,
  owner,
  repo,
  version,
  amount_usd,
  currency,
  provider,
  provider_ref,
  status,
  created_at,
  updated_at
)
select
  'user',
  hp.user_id::text,
  hp.owner,
  hp.repo,
  hp.version,
  coalesce(hp.amount_usd, 0),
  hp.currency,
  case when hp.provider in ('fintech', 'paddle', 'x402', 'manual') then hp.provider else 'manual' end,
  hp.provider_reference,
  case
    when hp.status in ('succeeded', 'manual_granted') then 'paid'
    when hp.status = 'refunded' then 'refunded'
    when hp.status = 'failed' then 'failed'
    else 'pending'
  end,
  hp.created_at,
  hp.updated_at
from public.harness_payments hp
where hp.user_id is not null
  and not exists (
    select 1
    from public.purchases p
    where p.provider = hp.provider
      and p.provider_ref is not distinct from hp.provider_reference
      and p.subject_type = 'user'
      and p.subject_id = hp.user_id::text
      and p.owner = hp.owner
      and p.repo = hp.repo
      and p.version is not distinct from hp.version
  );

insert into public.entitlements (
  subject_type,
  subject_id,
  owner,
  repo,
  version,
  kind,
  expires_at,
  created_at
)
select
  'user',
  he.user_id::text,
  he.owner,
  he.repo,
  he.version,
  'one_time',
  he.expires_at,
  he.granted_at
from public.harness_entitlements he
on conflict (subject_type, subject_id, owner, repo, version, kind) do nothing;
