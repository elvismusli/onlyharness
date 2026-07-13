-- Forward-only RLS repair for workspace membership expiry.
--
-- Do not query workspace_members from a workspace_members policy directly: that
-- recurses through RLS. The helper is deliberately outside the exposed public
-- schema, owned by postgres, has a fixed search_path, and answers only whether
-- the current JWT user has an active membership in the requested workspace.
create schema if not exists superskill_private authorization postgres;
alter schema superskill_private owner to postgres;

revoke all on schema superskill_private from public;
revoke all on schema superskill_private from anon, authenticated, service_role;
grant usage on schema superskill_private to authenticated, service_role;

create or replace function superskill_private.has_active_workspace_membership(
  target_workspace_id uuid,
  required_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.workspace_members as membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and membership.removed_at is null
      and (membership.expires_at is null or membership.expires_at > statement_timestamp())
      and (required_roles is null or membership.role = any(required_roles))
  );
$function$;

alter function superskill_private.has_active_workspace_membership(uuid, text[]) owner to postgres;
revoke all on function superskill_private.has_active_workspace_membership(uuid, text[])
  from public, anon, authenticated, service_role;
grant execute on function superskill_private.has_active_workspace_membership(uuid, text[])
  to authenticated, service_role;

-- Public projections and authenticated membership reads are separate policies.
-- This keeps anonymous public reads independent from the private helper grant.
drop policy if exists "Public workspaces are readable" on public.workspaces;
drop policy if exists "Workspace members read their workspaces" on public.workspaces;
create policy "Public workspaces are readable"
  on public.workspaces for select
  to anon, authenticated
  using (visibility in ('public', 'unlisted'));
create policy "Workspace members read their workspaces"
  on public.workspaces for select
  to authenticated
  using (superskill_private.has_active_workspace_membership(id));

drop policy if exists "Workspace members read membership" on public.workspace_members;
create policy "Workspace members read membership"
  on public.workspace_members for select
  to authenticated
  using (superskill_private.has_active_workspace_membership(workspace_id));

drop policy if exists "Workspace admins read token metadata" on public.workspace_tokens;
create policy "Workspace admins read token metadata"
  on public.workspace_tokens for select
  to authenticated
  using (
    superskill_private.has_active_workspace_membership(
      workspace_id,
      array['owner', 'admin']::text[]
    )
  );

drop policy if exists "Public workspace resources are readable" on public.workspace_resources;
drop policy if exists "Workspace members read resources" on public.workspace_resources;
create policy "Public workspace resources are readable"
  on public.workspace_resources for select
  to anon, authenticated
  using (visibility in ('public', 'unlisted'));
create policy "Workspace members read resources"
  on public.workspace_resources for select
  to authenticated
  using (superskill_private.has_active_workspace_membership(workspace_id));

drop policy if exists "Workspace members read audit" on public.workspace_audit;
create policy "Workspace members read audit"
  on public.workspace_audit for select
  to authenticated
  using (superskill_private.has_active_workspace_membership(workspace_id));

drop policy if exists "Public workspace collections are readable" on public.workspace_collections;
drop policy if exists "Workspace members read collections" on public.workspace_collections;
create policy "Public workspace collections are readable"
  on public.workspace_collections for select
  to anon, authenticated
  using (visibility in ('public', 'unlisted'));
create policy "Workspace members read collections"
  on public.workspace_collections for select
  to authenticated
  using (superskill_private.has_active_workspace_membership(workspace_id));

drop policy if exists "Workspace members read collection items" on public.workspace_collection_items;
create policy "Workspace members read collection items"
  on public.workspace_collection_items for select
  to authenticated
  using (superskill_private.has_active_workspace_membership(workspace_id));

drop policy if exists "Public workspace collection items are readable"
  on public.workspace_collection_items;
create policy "Public workspace collection items are readable"
  on public.workspace_collection_items for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.workspace_collections as collection
      where collection.id = workspace_collection_items.collection_id
        and collection.workspace_id = workspace_collection_items.workspace_id
        and collection.visibility in ('public', 'unlisted')
    )
  );

drop policy if exists "Workspace members read join policies" on public.workspace_join_policies;
create policy "Workspace members read join policies"
  on public.workspace_join_policies for select
  to authenticated
  using (superskill_private.has_active_workspace_membership(workspace_id));

drop policy if exists "Workspace members read subscription events"
  on public.workspace_subscription_events;
create policy "Workspace members read subscription events"
  on public.workspace_subscription_events for select
  to authenticated
  using (
    workspace_id is not null
    and superskill_private.has_active_workspace_membership(workspace_id)
  );

-- Setup bundles contain install/config instructions and are intentionally an
-- API/service-role-only object. Membership is checked by the API before its
-- service-role read; direct anon/authenticated access must remain impossible.
alter table public.workspace_setup_bundles enable row level security;
alter table public.workspace_setup_bundles force row level security;

drop policy if exists "Workspace members read setup bundles"
  on public.workspace_setup_bundles;
drop policy if exists "Service role manages workspace setup bundles"
  on public.workspace_setup_bundles;
create policy "Service role manages workspace setup bundles"
  on public.workspace_setup_bundles for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.workspace_setup_bundles from anon, authenticated;
grant select, insert, update, delete on table public.workspace_setup_bundles to service_role;

comment on function superskill_private.has_active_workspace_membership(uuid, text[]) is
  'RLS-safe current-user workspace membership check; expires and removed memberships fail closed.';
comment on table public.workspace_setup_bundles is
  'Service-role-only setup payloads; API authorization must precede every read or write.';
