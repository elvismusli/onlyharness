create table if not exists public.superskill_access_grants (
  subject text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null,
  cohort text not null,
  status text not null default 'active',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by text not null,
  updated_at timestamptz not null default now(),
  updated_by text not null,
  revoked_at timestamptz,
  revoked_by text,
  revocation_reason text,
  primary key (subject, scope),
  unique (user_id, scope),
  constraint superskill_access_grants_subject_check
    check (subject ~ '^user:[a-f0-9]{64}$'),
  constraint superskill_access_grants_scope_check
    check (scope = 'superskill:managed'),
  constraint superskill_access_grants_cohort_check
    check (cohort ~ '^[a-z0-9][a-z0-9._-]{1,63}$'),
  constraint superskill_access_grants_status_check
    check (status in ('active', 'suspended', 'revoked')),
  constraint superskill_access_grants_expiry_check
    check (isfinite(expires_at) and expires_at > created_at),
  constraint superskill_access_grants_actor_check
    check (
      created_by ~ '^[a-zA-Z0-9][a-zA-Z0-9:._@-]{1,127}$'
      and updated_by ~ '^[a-zA-Z0-9][a-zA-Z0-9:._@-]{1,127}$'
    ),
  constraint superskill_access_grants_revocation_check
    check (
      (status = 'revoked' and revoked_at is not null and revoked_at >= created_at and revoked_by is not null)
      or (status <> 'revoked' and revoked_at is null and revoked_by is null and revocation_reason is null)
    ),
  constraint superskill_access_grants_revoked_actor_check
    check (revoked_by is null or revoked_by ~ '^[a-zA-Z0-9][a-zA-Z0-9:._@-]{1,127}$'),
  constraint superskill_access_grants_reason_check
    check (revocation_reason is null or char_length(revocation_reason) between 2 and 500)
);

create index if not exists superskill_access_grants_user_scope_idx
  on public.superskill_access_grants (user_id, scope);
create index if not exists superskill_access_grants_active_expiry_idx
  on public.superskill_access_grants (scope, expires_at)
  where status = 'active' and revoked_at is null;

create table if not exists public.superskill_access_grant_audit (
  id bigint generated always as identity primary key,
  subject text not null,
  user_id uuid not null,
  scope text not null,
  action text not null check (action in ('created', 'updated', 'revoked')),
  cohort text not null,
  status text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  actor text not null,
  recorded_at timestamptz not null default now()
);

create index if not exists superskill_access_grant_audit_subject_idx
  on public.superskill_access_grant_audit (subject, recorded_at desc);

create or replace function public.guard_superskill_access_grant_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.subject <> old.subject
    or new.user_id <> old.user_id
    or new.scope <> old.scope
    or new.created_at <> old.created_at
    or new.created_by <> old.created_by then
    raise exception 'SuperSkill grant identity and creation audit fields are immutable';
  end if;
  if old.status = 'revoked' then
    raise exception 'Revoked SuperSkill grants are immutable';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists superskill_access_grants_update_guard on public.superskill_access_grants;
create trigger superskill_access_grants_update_guard
before update on public.superskill_access_grants
for each row execute procedure public.guard_superskill_access_grant_update();

create or replace function public.audit_superskill_access_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  audit_action text;
  audit_actor text;
begin
  if tg_op = 'INSERT' then
    audit_action := 'created';
    audit_actor := new.created_by;
  elsif old.status <> 'revoked' and new.status = 'revoked' then
    audit_action := 'revoked';
    audit_actor := new.revoked_by;
  else
    audit_action := 'updated';
    audit_actor := new.updated_by;
  end if;

  insert into public.superskill_access_grant_audit (
    subject, user_id, scope, action, cohort, status, expires_at, revoked_at, actor
  ) values (
    new.subject, new.user_id, new.scope, audit_action, new.cohort, new.status,
    new.expires_at, new.revoked_at, audit_actor
  );
  return new;
end;
$$;

drop trigger if exists superskill_access_grants_audit on public.superskill_access_grants;
create trigger superskill_access_grants_audit
after insert or update on public.superskill_access_grants
for each row execute procedure public.audit_superskill_access_grant();

create or replace function public.upsert_superskill_access_grant(
  p_subject text,
  p_user_id uuid,
  p_scope text,
  p_cohort text,
  p_expires_at timestamptz,
  p_actor text
)
returns public.superskill_access_grants
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.superskill_access_grants;
begin
  if p_expires_at <= now() then
    raise exception 'SuperSkill grant expiry must be in the future';
  end if;
  insert into public.superskill_access_grants (
    subject, user_id, scope, cohort, status, expires_at,
    created_by, updated_by
  ) values (
    p_subject, p_user_id, p_scope, p_cohort, 'active', p_expires_at,
    p_actor, p_actor
  )
  on conflict (user_id, scope) do update set
    cohort = excluded.cohort,
    status = 'active',
    expires_at = excluded.expires_at,
    updated_by = p_actor
  where superskill_access_grants.subject = excluded.subject
  returning * into result;
  if result.subject is null then
    raise exception 'SuperSkill grant subject does not match the existing user grant';
  end if;
  return result;
end;
$$;

create or replace function public.revoke_superskill_access_grant(
  p_subject text,
  p_scope text,
  p_actor text,
  p_reason text
)
returns public.superskill_access_grants
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.superskill_access_grants;
begin
  update public.superskill_access_grants set
    status = 'revoked',
    revoked_at = now(),
    revoked_by = p_actor,
    revocation_reason = p_reason,
    updated_by = p_actor
  where subject = p_subject
    and scope = p_scope
    and status <> 'revoked'
  returning * into result;
  if result.subject is null then
    raise exception 'Active SuperSkill grant not found';
  end if;
  return result;
end;
$$;

alter table public.superskill_access_grants enable row level security;
alter table public.superskill_access_grant_audit enable row level security;

revoke all on public.superskill_access_grants from anon, authenticated;
revoke all on public.superskill_access_grant_audit from anon, authenticated;
revoke insert, update, delete on public.superskill_access_grants from service_role;
revoke insert, update, delete on public.superskill_access_grant_audit from service_role;
grant select on public.superskill_access_grants to service_role;
grant select on public.superskill_access_grant_audit to service_role;

revoke all on function public.upsert_superskill_access_grant(text, uuid, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.revoke_superskill_access_grant(text, text, text, text) from public, anon, authenticated;
grant execute on function public.upsert_superskill_access_grant(text, uuid, text, text, timestamptz, text) to service_role;
grant execute on function public.revoke_superskill_access_grant(text, text, text, text) to service_role;

comment on table public.superskill_access_grants is
  'Operator-controlled, default-deny SuperSkill managed access. Application Bearer requests may only read grants through the service-role backend.';
comment on column public.superskill_access_grants.subject is
  'Pseudonymous HMAC subject. Raw provider user IDs and email must never be exposed in managed events or responses.';
