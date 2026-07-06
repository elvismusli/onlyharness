create table if not exists public.payout_runs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'paid', 'void')),
  currency text not null default 'USD' check (currency = 'USD'),
  purchases integer not null default 0 check (purchases >= 0),
  gross_usd numeric(12, 2) not null default 0 check (gross_usd >= 0),
  payout_usd numeric(12, 2) not null default 0 check (payout_usd >= 0),
  platform_usd numeric(12, 2) not null default 0 check (platform_usd >= 0),
  missing_payout_accounts integer not null default 0 check (missing_payout_accounts >= 0),
  generated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payout_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payout_runs(id) on delete cascade,
  idempotency_key text not null unique,
  recipient text not null,
  method text not null,
  address text,
  status text not null
    check (status in ('ready_manual_payout', 'blocked', 'paid', 'void')),
  blocked_reason text
    check (blocked_reason is null or blocked_reason in ('MISSING_CREATOR_ID', 'MISSING_PAYOUT_ACCOUNT')),
  purchase_ids text[] not null default '{}',
  purchases integer not null default 0 check (purchases >= 0),
  gross_usd numeric(12, 2) not null default 0 check (gross_usd >= 0),
  payout_usd numeric(12, 2) not null default 0 check (payout_usd >= 0),
  platform_usd numeric(12, 2) not null default 0 check (platform_usd >= 0),
  anchor_purchases integer not null default 0 check (anchor_purchases >= 0),
  referral_purchases integer not null default 0 check (referral_purchases >= 0),
  catalog_purchases integer not null default 0 check (catalog_purchases >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payout_runs enable row level security;
alter table public.payout_items enable row level security;

create index if not exists payout_runs_month_status_idx
  on public.payout_runs (month, status, created_at desc);

create index if not exists payout_items_run_status_idx
  on public.payout_items (run_id, status);

create index if not exists payout_items_recipient_idx
  on public.payout_items (recipient);
