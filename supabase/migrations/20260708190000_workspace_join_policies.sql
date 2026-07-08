create table if not exists public.workspace_join_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('invite', 'email_domain', 'telegram', 'discord', 'entitlement', 'paid_subscription', 'manual_approval')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  role text not null default 'member' check (role in ('member', 'viewer')),
  title text,
  instructions text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_join_policies_workspace_idx
  on public.workspace_join_policies(workspace_id, status, kind);

alter table public.workspace_join_policies enable row level security;

drop policy if exists "Workspace members read join policies" on public.workspace_join_policies;
create policy "Workspace members read join policies"
  on public.workspace_join_policies for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_join_policies.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.removed_at is null
    )
  );

alter table public.workspace_tokens drop constraint if exists workspace_tokens_scopes_check;
alter table public.workspace_tokens
  add constraint workspace_tokens_scopes_check check (scopes <@ array[
    'workspace:*',
    'workspace:admin',
    'workspace:read',
    'workspace:setup',
    'resource:read',
    'resource:publish',
    'resource:archive',
    'collection:write',
    'member:write',
    'invite:write',
    'gate:verify',
    'gate:write',
    'audit:read',
    'read',
    'setup',
    'publish',
    'entitlements:read'
  ]::text[]);
