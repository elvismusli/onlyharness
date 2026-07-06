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
    'accepted',
    'applied',
    'eval',
    'gate',
    'escrow_reserved',
    'escrow_captured',
    'escrow_refunded'
  ));
