create table if not exists public.resource_package_releases (
  id uuid primary key,
  resource_id text not null check (resource_id ~ '^onlyharness:packages/[a-z0-9][a-z0-9-]{1,80}$'),
  version text not null check (version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'),
  owner_subject text not null check (owner_subject ~ '^user:[a-f0-9]{64}$'),
  idempotency_key_hash text not null check (idempotency_key_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  artifact_digest text not null check (artifact_digest ~ '^[a-f0-9]{64}$'),
  archive_size bigint not null check (archive_size > 0),
  storage_key text not null check (storage_key ~ '^[A-Za-z0-9_-]+\.tar\.gz$'),
  status text not null check (status in ('pending', 'active', 'failed')),
  trust text not null default 'unreviewed' check (trust = 'unreviewed'),
  resource_payload jsonb not null,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  constraint resource_package_releases_exact_version_unique unique (resource_id, version),
  constraint resource_package_releases_owner_idempotency_unique unique (owner_subject, idempotency_key_hash),
  constraint resource_package_releases_storage_key_unique unique (storage_key),
  constraint resource_package_releases_state_times check (
    (status = 'pending' and activated_at is null and failed_at is null)
    or (status = 'active' and activated_at is not null and failed_at is null)
    or (status = 'failed' and failed_at is not null and activated_at is null)
  )
);

create index if not exists resource_package_releases_active_resource_idx
  on public.resource_package_releases (resource_id, created_at desc)
  where status = 'active';

create index if not exists resource_package_releases_pending_created_idx
  on public.resource_package_releases (created_at)
  where status = 'pending';

create table if not exists public.resource_package_owners (
  resource_id text primary key check (resource_id ~ '^onlyharness:packages/[a-z0-9][a-z0-9-]{1,80}$'),
  owner_subject text not null check (owner_subject ~ '^user:[a-f0-9]{64}$'),
  claimed_at timestamptz not null default now()
);

create or replace function public.claim_resource_package_release(p_release jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_resource_id text := p_release->>'resource_id';
  requested_owner_subject text := p_release->>'owner_subject';
  current_owner text;
begin
  if p_release->>'status' is distinct from 'pending'
    or p_release->>'trust' is distinct from 'unreviewed'
    or nullif(p_release->>'activated_at', '') is not null
    or nullif(p_release->>'failed_at', '') is not null
    or nullif(p_release->>'failure_code', '') is not null
    or p_release->'resource_payload'->>'id' is distinct from requested_resource_id
    or position('@' in coalesce(p_release->'resource_payload'->>'creatorName', '')) > 0
    or p_release->'resource_payload'->'trust'->>'securityScan' is distinct from 'not_scanned'
  then
    raise exception 'invalid pending resource release' using errcode = '22023';
  end if;
  insert into public.resource_package_owners (resource_id, owner_subject, claimed_at)
  values (requested_resource_id, requested_owner_subject, coalesce((p_release->>'created_at')::timestamptz, now()))
  on conflict (resource_id) do nothing;

  select owner_subject into current_owner
  from public.resource_package_owners
  where resource_id = requested_resource_id
  for update;

  if current_owner is distinct from requested_owner_subject then
    raise exception 'resource owner conflict' using errcode = '23505';
  end if;

  insert into public.resource_package_releases (
    id, resource_id, version, owner_subject, idempotency_key_hash,
    payload_digest, artifact_digest, archive_size, storage_key, status,
    trust, resource_payload, created_at, activated_at, failed_at, failure_code
  ) values (
    (p_release->>'id')::uuid,
    requested_resource_id,
    p_release->>'version',
    requested_owner_subject,
    p_release->>'idempotency_key_hash',
    p_release->>'payload_digest',
    p_release->>'artifact_digest',
    (p_release->>'archive_size')::bigint,
    p_release->>'storage_key',
    p_release->>'status',
    p_release->>'trust',
    p_release->'resource_payload',
    (p_release->>'created_at')::timestamptz,
    nullif(p_release->>'activated_at', '')::timestamptz,
    nullif(p_release->>'failed_at', '')::timestamptz,
    nullif(p_release->>'failure_code', '')
  );
end;
$$;

create or replace function public.enforce_resource_package_release_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id
    or new.resource_id is distinct from old.resource_id
    or new.version is distinct from old.version
    or new.owner_subject is distinct from old.owner_subject
    or new.idempotency_key_hash is distinct from old.idempotency_key_hash
    or new.payload_digest is distinct from old.payload_digest
    or new.artifact_digest is distinct from old.artifact_digest
    or new.archive_size is distinct from old.archive_size
    or new.storage_key is distinct from old.storage_key
    or new.trust is distinct from old.trust
    or new.resource_payload is distinct from old.resource_payload
    or new.created_at is distinct from old.created_at
  then
    raise exception 'resource release metadata is immutable' using errcode = '55000';
  end if;

  if old.status <> 'pending' or new.status not in ('active', 'failed') then
    raise exception 'invalid resource release state transition' using errcode = '55000';
  end if;
  if new.status = 'active' and (new.activated_at is null or new.failed_at is not null or new.failure_code is not null) then
    raise exception 'invalid active resource release' using errcode = '22023';
  end if;
  if new.status = 'failed' and (new.failed_at is null or new.activated_at is not null or new.failure_code is null) then
    raise exception 'invalid failed resource release' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function public.abort_resource_package_release(
  p_release_id uuid,
  p_owner_subject text,
  p_idempotency_key_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_resource_id text;
begin
  delete from public.resource_package_releases
  where id = p_release_id
    and owner_subject = p_owner_subject
    and idempotency_key_hash = p_idempotency_key_hash
    and status = 'pending'
  returning resource_id into deleted_resource_id;

  if deleted_resource_id is null then
    return false;
  end if;

  delete from public.resource_package_owners owner
  where owner.resource_id = deleted_resource_id
    and owner.owner_subject = p_owner_subject
    and not exists (
      select 1 from public.resource_package_releases release
      where release.resource_id = deleted_resource_id
    );
  return true;
end;
$$;

drop trigger if exists resource_package_release_transition_guard on public.resource_package_releases;
create trigger resource_package_release_transition_guard
before update on public.resource_package_releases
for each row execute function public.enforce_resource_package_release_transition();

alter table public.resource_package_releases enable row level security;
alter table public.resource_package_owners enable row level security;
revoke all on table public.resource_package_releases from anon, authenticated;
revoke all on table public.resource_package_owners from anon, authenticated;
revoke all on table public.resource_package_releases from service_role;
revoke all on table public.resource_package_owners from service_role;
grant select on table public.resource_package_releases to service_role;
grant select on table public.resource_package_owners to service_role;
grant update (status, activated_at, failed_at, failure_code) on table public.resource_package_releases to service_role;
revoke all on function public.claim_resource_package_release(jsonb) from public, anon, authenticated;
revoke all on function public.abort_resource_package_release(uuid, text, text) from public, anon, authenticated;
revoke all on function public.enforce_resource_package_release_transition() from public, anon, authenticated;
grant execute on function public.claim_resource_package_release(jsonb) to service_role;
grant execute on function public.abort_resource_package_release(uuid, text, text) to service_role;

comment on table public.resource_package_releases is
  'Server-only immutable metadata for unreviewed hosted public resource package releases. Public catalog projects active rows only.';
comment on column public.resource_package_releases.owner_subject is
  'Pseudonymous stable owner subject; never an email or bearer credential.';
comment on column public.resource_package_releases.idempotency_key_hash is
  'SHA-256 hash of the client idempotency key; raw keys are never persisted.';
comment on table public.resource_package_owners is
  'Immutable first-publisher ownership claim used to prevent cross-version slug takeover.';
