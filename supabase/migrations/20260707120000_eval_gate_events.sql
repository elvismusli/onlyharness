alter table public.events
  drop constraint if exists events_kind_check;

alter table public.events
  add constraint events_kind_check
  check (kind in ('view', 'copy', 'install', 'pull', 'checkout', 'purchase', 'suggested', 'applied', 'eval', 'gate'));

create index if not exists events_verification_idx
  on public.events (owner, repo, target, created_at desc)
  where kind in ('eval', 'gate');
