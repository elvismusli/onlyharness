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
    or coalesce(p_release->'resource_payload'->'trust'->>'securityScan', '') not in ('not_scanned', 'pass', 'warn')
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

revoke all on function public.claim_resource_package_release(jsonb) from public, anon, authenticated;
grant execute on function public.claim_resource_package_release(jsonb) to service_role;

comment on function public.claim_resource_package_release(jsonb) is
  'Atomically claims a public resource name and inserts one pending immutable release. Accepts only non-failing static scan verdicts; fail remains blocked before durable mutation.';
