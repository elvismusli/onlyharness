-- Forward-only rollout authority for databases whose migration ledger already
-- contains the historical workspace subscription migration. Do not rely on
-- edits to an applied migration to repair existing environments.
alter table public.workspace_members
  add column if not exists expires_at timestamptz;

create index if not exists workspace_members_active_expiry_idx
  on public.workspace_members (workspace_id, expires_at)
  where status = 'active' and removed_at is null;

drop policy if exists "Workspace members read subscription events"
  on public.workspace_subscription_events;
create policy "Workspace members read subscription events"
  on public.workspace_subscription_events for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_subscription_events.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.removed_at is null
        and (wm.expires_at is null or wm.expires_at > now())
    )
  );

comment on column public.workspace_members.expires_at is
  'Optional fail-closed membership expiry used by workspace reads and subscription access windows.';
