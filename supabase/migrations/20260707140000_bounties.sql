create table if not exists public.bounties (
  id text primary key,
  title text not null,
  spec text not null,
  budget_usd numeric(12, 2) not null check (budget_usd > 0),
  currency text not null default 'USD' check (char_length(currency) = 3),
  status text not null default 'open'
    check (status in ('open', 'claimed', 'delivered', 'paid')),
  customer_user_id text not null,
  claimant_user_id text,
  delivered_harness text,
  delivered_version text,
  delivery_receipt_hash text
    check (delivery_receipt_hash is null or delivery_receipt_hash ~ '^[0-9a-f]{64}$'),
  accepted_receipt_hash text
    check (accepted_receipt_hash is null or accepted_receipt_hash ~ '^[0-9a-f]{64}$'),
  payment_purchase_id text,
  escrow_provider_ref text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bounties enable row level security;

drop policy if exists "Bounties are readable by everyone" on public.bounties;
create policy "Bounties are readable by everyone"
  on public.bounties for select
  using (true);

drop policy if exists "Customers create own bounties" on public.bounties;
create policy "Customers create own bounties"
  on public.bounties for insert
  with check (auth.uid()::text = customer_user_id);

drop policy if exists "Participants update own bounties" on public.bounties;
-- No direct authenticated UPDATE policy: lifecycle transitions are money-adjacent
-- and must go through the API/service-role path.

create index if not exists bounties_status_created_idx
  on public.bounties (status, created_at desc);

create index if not exists bounties_customer_idx
  on public.bounties (customer_user_id, created_at desc);

create index if not exists bounties_claimant_idx
  on public.bounties (claimant_user_id, created_at desc);

create unique index if not exists bounties_payment_purchase_unique_idx
  on public.bounties (payment_purchase_id)
  where payment_purchase_id is not null;

create unique index if not exists bounties_escrow_provider_ref_unique_idx
  on public.bounties (escrow_provider_ref)
  where escrow_provider_ref is not null;
