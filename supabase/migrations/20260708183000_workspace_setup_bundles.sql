create table if not exists public.workspace_setup_bundles (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  version text not null default 'manual-config',
  bundle jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_setup_bundles_updated_idx
  on public.workspace_setup_bundles(updated_at desc);
