create table if not exists public.workspace_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  workspace_slug text not null,
  user_id text not null,
  policy_id text not null,
  provider text not null default 'manual' check (provider in ('manual')),
  provider_subscription_ref text not null,
  provider_customer_ref text,
  status text not null default 'incomplete' check (status in ('incomplete', 'active', 'past_due', 'canceled', 'expired')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_until timestamptz,
  access_until timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  checkout_url text,
  portal_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_ref)
);

create table if not exists public.workspace_subscription_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  workspace_slug text not null,
  subscription_id uuid references public.workspace_subscriptions(id) on delete cascade,
  provider text not null default 'manual' check (provider in ('manual')),
  provider_event_ref text not null,
  event_type text not null,
  status text not null check (status in ('incomplete', 'active', 'past_due', 'canceled', 'expired')),
  user_id text not null,
  policy_id text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_until timestamptz,
  access_until timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_ref)
);

alter table public.workspace_subscriptions enable row level security;
alter table public.workspace_subscription_events enable row level security;

drop policy if exists "Users read own workspace subscriptions" on public.workspace_subscriptions;
create policy "Users read own workspace subscriptions"
  on public.workspace_subscriptions for select
  using (auth.uid()::text = user_id);

drop policy if exists "Workspace members read subscription events" on public.workspace_subscription_events;
create policy "Workspace members read subscription events"
  on public.workspace_subscription_events for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_subscription_events.workspace_id
        and wm.user_id = auth.uid()::text
        and wm.status = 'active'
        and wm.removed_at is null
        and (wm.expires_at is null or wm.expires_at > now())
    )
  );

create index if not exists workspace_subscriptions_workspace_idx
  on public.workspace_subscriptions (workspace_id, status, access_until);

create index if not exists workspace_subscriptions_user_idx
  on public.workspace_subscriptions (workspace_id, user_id, created_at desc);

create index if not exists workspace_subscription_events_subscription_idx
  on public.workspace_subscription_events (subscription_id, created_at desc);
