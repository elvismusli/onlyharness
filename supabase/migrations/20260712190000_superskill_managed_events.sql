alter table public.events add column if not exists event_id text;
alter table public.events add column if not exists recommendation_id text;
alter table public.events add column if not exists activation_id text;
alter table public.events add column if not exists mode text;
alter table public.events add column if not exists evidence text;
alter table public.events add column if not exists outcome text;
alter table public.events add column if not exists reason_code text;

alter table public.events drop constraint if exists events_kind_check;
alter table public.events add constraint events_kind_check check (kind in (
  'view', 'copy', 'install', 'pull', 'checkout', 'purchase', 'suggested', 'accepted',
  'applied', 'eval', 'gate', 'escrow_reserved', 'escrow_captured', 'escrow_refunded',
  'recommended', 'recommendation_accepted', 'activation_started', 'activation_ready',
  'activation_loaded', 'activation_invoked', 'outcome_reported', 'activation_pinned',
  'activation_removed', 'activation_failed'
));

create unique index if not exists events_event_id_unique
  on public.events (event_id)
  where event_id is not null;
create index if not exists events_recommendation_created_idx
  on public.events (recommendation_id, created_at)
  where recommendation_id is not null;
create index if not exists events_activation_created_idx
  on public.events (activation_id, created_at)
  where activation_id is not null;
create index if not exists events_subject_kind_created_idx
  on public.events (subject, kind, created_at);
