alter table public.purchases
  add column if not exists pricing_model text not null default 'one_time';

alter table public.purchases
  drop constraint if exists purchases_pricing_model_check;

alter table public.purchases
  add constraint purchases_pricing_model_check
  check (pricing_model in ('free', 'one_time', 'subscription', 'per_call', 'gate_escrow'));

alter table public.purchases
  add column if not exists escrow_expires_at timestamptz,
  add column if not exists receipt_hash text,
  add column if not exists captured_at timestamptz,
  add column if not exists refunded_at timestamptz;

create index if not exists purchases_escrow_expiry_idx
  on public.purchases (status, escrow_expires_at)
  where pricing_model = 'gate_escrow';

alter table public.events
  drop constraint if exists events_kind_check;

alter table public.events
  add constraint events_kind_check
  check (kind in (
    'view',
    'copy',
    'install',
    'pull',
    'checkout',
    'purchase',
    'suggested',
    'applied',
    'eval',
    'gate',
    'escrow_reserved',
    'escrow_captured',
    'escrow_refunded'
  ));
