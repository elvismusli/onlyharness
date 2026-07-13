#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="$ROOT_DIR/supabase/migrations/20260714100000_workspace_member_expiry_rls.sql"
SETUP_BUNDLE_MIGRATION="$ROOT_DIR/supabase/migrations/20260708183000_workspace_setup_bundles.sql"
CONTAINER="superskill-workspace-rls-smoke-$$"
ACTIVE_USER="00000000-0000-0000-0000-000000000001"
EXPIRED_USER="00000000-0000-0000-0000-000000000002"
REMOVED_USER="00000000-0000-0000-0000-000000000003"
WORKSPACE="10000000-0000-0000-0000-000000000001"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm --detach --name "$CONTAINER" \
  --env POSTGRES_PASSWORD=postgres \
  postgres:17-alpine >/dev/null

ready_streak=0
for _ in $(seq 1 120); do
  ready_log_count="$(docker logs "$CONTAINER" 2>&1 | grep -c 'database system is ready to accept connections' || true)"
  if [[ "$ready_log_count" -ge 2 ]] && [[ "$(docker exec "$CONTAINER" psql -Atq -U postgres -c 'select 1' 2>/dev/null || true)" == "1" ]]; then
    ready_streak=$((ready_streak + 1))
    if [[ "$ready_streak" -ge 3 ]]; then
      break
    fi
  else
    ready_streak=0
  fi
  sleep 0.5
done
if [[ "$ready_streak" -lt 3 ]]; then
  echo "PostgreSQL did not reach stable readiness" >&2
  exit 1
fi

docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table public.workspaces (
  id uuid primary key,
  visibility text not null
);
create table public.workspace_members (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  user_id uuid not null,
  role text not null,
  status text not null,
  removed_at timestamptz,
  expires_at timestamptz
);
create table public.workspace_tokens (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id)
);
create table public.workspace_resources (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  visibility text not null,
  name text not null default 'fixture'
);
create table public.workspace_audit (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id)
);
create table public.workspace_collections (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  visibility text not null
);
create table public.workspace_collection_items (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  collection_id uuid not null references public.workspace_collections(id)
);
create table public.workspace_join_policies (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id)
);
create table public.workspace_subscription_events (
  id uuid primary key,
  workspace_id uuid references public.workspaces(id)
);
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_tokens enable row level security;
alter table public.workspace_resources enable row level security;
alter table public.workspace_audit enable row level security;
alter table public.workspace_collections enable row level security;
alter table public.workspace_collection_items enable row level security;
alter table public.workspace_join_policies enable row level security;
alter table public.workspace_subscription_events enable row level security;

grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
SQL

# The create migration must be safe on its own; the later repair is defense in
# depth, not the first point at which setup bundles become protected.
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres < "$SETUP_BUNDLE_MIGRATION"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres <<'SQL'
select 1 / (case when c.relrowsecurity and c.relforcerowsecurity then 1 else 0 end)
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'workspace_setup_bundles';
select 1 / (case when not has_table_privilege('anon', 'public.workspace_setup_bundles', 'select') then 1 else 0 end);
select 1 / (case when not has_table_privilege('authenticated', 'public.workspace_setup_bundles', 'select') then 1 else 0 end);
select 1 / (case when has_table_privilege('service_role', 'public.workspace_setup_bundles', 'select,insert,update,delete') then 1 else 0 end);
SQL

docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres < "$MIGRATION"

docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres <<SQL
insert into public.workspaces (id, visibility)
values ('$WORKSPACE', 'private'), ('10000000-0000-0000-0000-000000000002', 'public');
insert into public.workspace_members (id, workspace_id, user_id, role, status, removed_at, expires_at)
values
  ('20000000-0000-0000-0000-000000000001', '$WORKSPACE', '$ACTIVE_USER', 'owner', 'active', null, now() + interval '1 hour'),
  ('20000000-0000-0000-0000-000000000002', '$WORKSPACE', '$EXPIRED_USER', 'member', 'active', null, now() - interval '1 hour'),
  ('20000000-0000-0000-0000-000000000003', '$WORKSPACE', '$REMOVED_USER', 'member', 'removed', now(), null);
insert into public.workspace_tokens values ('30000000-0000-0000-0000-000000000001', '$WORKSPACE');
insert into public.workspace_resources (id, workspace_id, visibility) values
  ('40000000-0000-0000-0000-000000000001', '$WORKSPACE', 'private'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'public');
insert into public.workspace_audit values ('50000000-0000-0000-0000-000000000001', '$WORKSPACE');
insert into public.workspace_collections values
  ('60000000-0000-0000-0000-000000000001', '$WORKSPACE', 'workspace'),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'public');
insert into public.workspace_collection_items values
  ('70000000-0000-0000-0000-000000000001', '$WORKSPACE', '60000000-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002');
insert into public.workspace_join_policies values ('80000000-0000-0000-0000-000000000001', '$WORKSPACE');
insert into public.workspace_subscription_events values ('90000000-0000-0000-0000-000000000001', '$WORKSPACE');
insert into public.workspace_setup_bundles values ('$WORKSPACE', 'fixture', '{"safe":true}');
SQL

# Active owner sees every membership-scoped private projection. Reading the
# membership table itself proves the helper avoids recursive RLS evaluation.
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres <<SQL
set role authenticated;
set request.jwt.claim.sub = '$ACTIVE_USER';
select 1 / (case when count(*) = 1 then 1 else 0 end) from public.workspaces where id = '$WORKSPACE';
select 1 / (case when count(*) = 3 then 1 else 0 end) from public.workspace_members where workspace_id = '$WORKSPACE';
select 1 / (case when count(*) = 1 then 1 else 0 end) from public.workspace_tokens where workspace_id = '$WORKSPACE';
select 1 / (case when count(*) = 1 then 1 else 0 end) from public.workspace_resources where workspace_id = '$WORKSPACE';
select 1 / (case when count(*) = 1 then 1 else 0 end) from public.workspace_audit where workspace_id = '$WORKSPACE';
select 1 / (case when count(*) = 1 then 1 else 0 end) from public.workspace_collections where workspace_id = '$WORKSPACE';
select 1 / (case when count(*) = 1 then 1 else 0 end) from public.workspace_collection_items where workspace_id = '$WORKSPACE';
select 1 / (case when count(*) = 1 then 1 else 0 end) from public.workspace_join_policies where workspace_id = '$WORKSPACE';
select 1 / (case when count(*) = 1 then 1 else 0 end) from public.workspace_subscription_events where workspace_id = '$WORKSPACE';
SQL

for user in "$EXPIRED_USER" "$REMOVED_USER"; do
  docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres <<SQL
set role authenticated;
set request.jwt.claim.sub = '$user';
select 1 / (case when count(*) = 0 then 1 else 0 end) from public.workspaces where id = '$WORKSPACE';
select 1 / (case when count(*) = 0 then 1 else 0 end) from public.workspace_members where workspace_id = '$WORKSPACE';
select 1 / (case when count(*) = 0 then 1 else 0 end) from public.workspace_tokens where workspace_id = '$WORKSPACE';
select 1 / (case when count(*) = 0 then 1 else 0 end) from public.workspace_resources where workspace_id = '$WORKSPACE';
select 1 / (case when count(*) = 0 then 1 else 0 end) from public.workspace_audit where workspace_id = '$WORKSPACE';
select 1 / (case when count(*) = 0 then 1 else 0 end) from public.workspace_collections where workspace_id = '$WORKSPACE';
select 1 / (case when count(*) = 0 then 1 else 0 end) from public.workspace_collection_items where workspace_id = '$WORKSPACE';
select 1 / (case when count(*) = 0 then 1 else 0 end) from public.workspace_join_policies where workspace_id = '$WORKSPACE';
select 1 / (case when count(*) = 0 then 1 else 0 end) from public.workspace_subscription_events where workspace_id = '$WORKSPACE';
SQL
done

# Public/unlisted projections remain visible without the private helper grant.
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres <<SQL
set role anon;
select 1 / (case when count(*) = 1 then 1 else 0 end) from public.workspaces where visibility = 'public';
select 1 / (case when count(*) = 1 then 1 else 0 end) from public.workspace_resources where visibility = 'public';
select 1 / (case when count(*) = 1 then 1 else 0 end) from public.workspace_collections where visibility = 'public';
select 1 / (case when count(*) = 1 then 1 else 0 end) from public.workspace_collection_items where workspace_id = '10000000-0000-0000-0000-000000000002';
SQL

# Setup bundles are denied directly for both browser roles, even for an active
# member, while service_role retains the API's required read/write access.
if docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres \
  -c "set role anon; select * from public.workspace_setup_bundles" >/dev/null 2>&1; then
  echo "anon unexpectedly read workspace_setup_bundles" >&2
  exit 1
fi
if docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres \
  -c "set role authenticated; set request.jwt.claim.sub = '$ACTIVE_USER'; select * from public.workspace_setup_bundles" >/dev/null 2>&1; then
  echo "authenticated unexpectedly read workspace_setup_bundles" >&2
  exit 1
fi

# Direct writes remain denied for anonymous and expired-member sessions.
if docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres \
  -c "set role anon; insert into public.workspace_resources (id, workspace_id, visibility) values (gen_random_uuid(), '$WORKSPACE', 'public')" >/dev/null 2>&1; then
  echo "anon unexpectedly inserted a workspace resource" >&2
  exit 1
fi
if docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres \
  -c "set role authenticated; set request.jwt.claim.sub = '$EXPIRED_USER'; insert into public.workspace_resources (id, workspace_id, visibility) values (gen_random_uuid(), '$WORKSPACE', 'private')" >/dev/null 2>&1; then
  echo "expired member unexpectedly inserted a workspace resource" >&2
  exit 1
fi

# PostgreSQL RLS intentionally reports UPDATE of an invisible row as UPDATE 0,
# rather than an authorization error. Assert both zero changed rows and the
# stored value so the denial cannot be mistaken for a successful write.
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres <<SQL
set role authenticated;
set request.jwt.claim.sub = '$EXPIRED_USER';
with changed as (
  update public.workspace_resources
  set name = 'tampered'
  where id = '40000000-0000-0000-0000-000000000001'
  returning 1
)
select 1 / (case when count(*) = 0 then 1 else 0 end) from changed;
reset role;
select 1 / (case when name = 'fixture' then 1 else 0 end)
from public.workspace_resources
where id = '40000000-0000-0000-0000-000000000001';
SQL

docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres <<SQL
set role service_role;
select 1 / (case when count(*) = 1 then 1 else 0 end) from public.workspace_setup_bundles where workspace_id = '$WORKSPACE';
update public.workspace_setup_bundles set version = 'service-role-ok' where workspace_id = '$WORKSPACE';
SQL

echo "workspace expiry RLS smoke passed"
