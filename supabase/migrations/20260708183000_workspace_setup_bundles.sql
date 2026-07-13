create table if not exists public.workspace_setup_bundles (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  version text not null default 'manual-config',
  bundle jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_setup_bundles_updated_idx
  on public.workspace_setup_bundles(updated_at desc);

-- Setup bundles can contain install/config instructions. They are read and
-- written only by the API after its workspace authorization checks, never
-- directly through an anon/authenticated Supabase session.
alter table public.workspace_setup_bundles enable row level security;
alter table public.workspace_setup_bundles force row level security;

drop policy if exists "Service role manages workspace setup bundles"
  on public.workspace_setup_bundles;
create policy "Service role manages workspace setup bundles"
  on public.workspace_setup_bundles for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.workspace_setup_bundles from anon, authenticated;
grant select, insert, update, delete on table public.workspace_setup_bundles to service_role;
