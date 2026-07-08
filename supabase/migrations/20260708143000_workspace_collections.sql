alter table public.workspace_tokens drop constraint if exists workspace_tokens_scopes_check;
alter table public.workspace_tokens
  add constraint workspace_tokens_scopes_check check (scopes <@ array[
    'workspace:*',
    'workspace:read',
    'workspace:setup',
    'resource:read',
    'resource:publish',
    'resource:archive',
    'collection:write',
    'audit:read',
    'read',
    'setup',
    'publish',
    'entitlements:read'
  ]::text[]);

create table if not exists public.workspace_collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9._-]{0,80}$'),
  title text not null,
  summary text,
  visibility text not null default 'workspace' check (visibility in ('workspace', 'public', 'unlisted')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, slug)
);

create table if not exists public.workspace_collection_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  collection_id uuid not null references public.workspace_collections(id) on delete cascade,
  item_ref text not null,
  item_source text not null check (item_source in ('public_resource', 'workspace_resource', 'native_harness', 'external_url')),
  source_resource_id text,
  pinned_version text,
  pinned_archive_hash text,
  approval_state text not null default 'pending_review' check (approval_state in ('pending_review', 'approved', 'approved_with_warning', 'blocked', 'blocked_by_scan', 'deprecated')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  note text,
  risk_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (collection_id, item_ref)
);

alter table public.workspace_collections enable row level security;
alter table public.workspace_collection_items enable row level security;

drop policy if exists "Workspace members read collections" on public.workspace_collections;
create policy "Workspace members read collections"
  on public.workspace_collections for select
  using (
    visibility in ('public', 'unlisted')
    or exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_collections.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.removed_at is null
    )
  );

drop policy if exists "Workspace members read collection items" on public.workspace_collection_items;
create policy "Workspace members read collection items"
  on public.workspace_collection_items for select
  using (
    exists (
      select 1 from public.workspace_collections wc
      left join public.workspace_members wm on wm.workspace_id = wc.workspace_id
      where wc.id = workspace_collection_items.collection_id
        and (
          wc.visibility in ('public', 'unlisted')
          or (
            wm.user_id = auth.uid()
            and wm.status = 'active'
            and wm.removed_at is null
          )
        )
    )
  );

create index if not exists workspace_collections_workspace_slug_idx on public.workspace_collections (workspace_id, slug) where archived_at is null;
create index if not exists workspace_collections_visibility_idx on public.workspace_collections (visibility) where archived_at is null;
create index if not exists workspace_collection_items_collection_idx on public.workspace_collection_items (collection_id, created_at desc);
create index if not exists workspace_collection_items_workspace_ref_idx on public.workspace_collection_items (workspace_id, item_ref);
create index if not exists workspace_collection_items_source_ref_idx on public.workspace_collection_items (workspace_id, source_resource_id);
