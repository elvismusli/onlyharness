create table if not exists public.agent_auth_requests (
  id text primary key check (id ~ '^ohrq_[A-Za-z0-9_-]{43}$'),
  client text not null check (client in ('codex', 'claude-code', 'cli')),
  scopes text[] not null check (
    cardinality(scopes) between 1 and 4
    and scopes <@ array['superskill:managed', 'resources:publish', 'workspaces:read', 'workspaces:write']::text[]
  ),
  device_hash text not null unique check (device_hash ~ '^[a-f0-9]{64}$'),
  browser_hash text not null unique check (browser_hash ~ '^[a-f0-9]{64}$'),
  binding_hash text unique check (binding_hash is null or binding_hash ~ '^[a-f0-9]{64}$'),
  state text not null default 'pending' check (state in ('pending', 'approved', 'denied', 'expired', 'consumed')),
  user_id uuid references auth.users(id) on delete cascade,
  subject text check (subject is null or subject ~ '^user:[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_at timestamptz,
  consumed_at timestamptz,
  constraint agent_auth_request_expiry check (isfinite(expires_at) and expires_at > created_at),
  constraint agent_auth_request_identity check ((user_id is null) = (subject is null))
);

create index if not exists agent_auth_requests_expiry_idx on public.agent_auth_requests (expires_at);

create table if not exists public.agent_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (subject ~ '^user:[a-f0-9]{64}$'),
  client text not null check (client in ('codex', 'claude-code', 'cli')),
  scopes text[] not null check (
    cardinality(scopes) between 1 and 4
    and scopes <@ array['superskill:managed', 'resources:publish', 'workspaces:read', 'workspaces:write']::text[]
  ),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint agent_auth_session_expiry check (isfinite(expires_at) and expires_at > created_at),
  constraint agent_auth_session_revocation check ((status = 'revoked') = (revoked_at is not null))
);

create index if not exists agent_auth_sessions_user_idx on public.agent_auth_sessions (user_id, created_at desc);
create index if not exists agent_auth_sessions_expiry_idx on public.agent_auth_sessions (expires_at) where status = 'active';

create table if not exists public.agent_access_tokens (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  session_id uuid not null references public.agent_auth_sessions(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists agent_access_tokens_session_idx on public.agent_access_tokens (session_id);
create index if not exists agent_access_tokens_expiry_idx on public.agent_access_tokens (expires_at) where revoked_at is null;

create table if not exists public.agent_refresh_tokens (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  session_id uuid not null references public.agent_auth_sessions(id) on delete cascade,
  generation integer not null default 0 check (generation >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  replaced_by_hash text check (replaced_by_hash is null or replaced_by_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists agent_refresh_tokens_session_idx on public.agent_refresh_tokens (session_id, generation desc);

create table if not exists public.agent_auth_consents (
  user_id uuid not null references auth.users(id) on delete cascade,
  client text not null check (client in ('codex', 'claude-code', 'cli')),
  scopes text[] not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, client)
);

create table if not exists public.agent_mutation_idempotency (
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  route text not null check (route ~ '^/[A-Za-z0-9_/:.-]{1,255}$'),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  state text not null default 'pending' check (state in ('pending', 'completed')),
  response_status integer check (response_status is null or response_status between 200 and 599),
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (key_hash, user_id, route),
  constraint agent_mutation_completion_check check (
    (state = 'pending' and response_status is null and response_body is null and completed_at is null)
    or (state = 'completed' and response_status is not null and response_body is not null and completed_at is not null)
  )
);

alter table public.agent_auth_requests enable row level security;
alter table public.agent_auth_sessions enable row level security;
alter table public.agent_access_tokens enable row level security;
alter table public.agent_refresh_tokens enable row level security;
alter table public.agent_auth_consents enable row level security;
alter table public.agent_mutation_idempotency enable row level security;

revoke all on public.agent_auth_requests, public.agent_auth_sessions, public.agent_access_tokens, public.agent_refresh_tokens, public.agent_auth_consents from public, anon, authenticated, service_role;
revoke all on public.agent_mutation_idempotency from public, anon, authenticated, service_role;

create or replace function public.agent_auth_sweep(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.agent_auth_requests set state = 'expired'
  where state = 'pending' and expires_at <= p_now;
  delete from public.agent_auth_requests where expires_at <= p_now - interval '1 day';
  delete from public.agent_auth_sessions
  where (status = 'active' and expires_at <= p_now - interval '1 day')
     or (status = 'revoked' and revoked_at <= p_now - interval '1 day');
  delete from public.agent_auth_consents where revoked_at <= p_now - interval '30 days';
  delete from public.agent_mutation_idempotency
  where state = 'completed' and completed_at <= p_now - interval '30 days';
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.agent_auth_create_request(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.agent_auth_requests (id, client, scopes, device_hash, browser_hash, created_at, expires_at)
  values (
    p_request->>'id', p_request->>'client',
    array(select jsonb_array_elements_text(p_request->'scopes')),
    p_request->>'device_hash', p_request->>'browser_hash',
    (p_request->>'created_at')::timestamptz, (p_request->>'expires_at')::timestamptz
  );
  return jsonb_build_object('ok', true);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'conflict');
when others then
  return jsonb_build_object('ok', false, 'code', 'invalid');
end;
$$;

create or replace function public.agent_auth_bind_browser(
  p_request_id text, p_browser_hash text, p_consumed_browser_hash text, p_binding_hash text, p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.agent_auth_requests;
begin
  select * into r from public.agent_auth_requests where id = p_request_id for update;
  if not found or r.browser_hash <> p_browser_hash then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  if r.expires_at <= p_now then
    update public.agent_auth_requests set state = 'expired' where id = r.id and state = 'pending';
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;
  if r.state <> 'pending' or r.binding_hash is not null then return jsonb_build_object('ok', false, 'code', 'used'); end if;
  update public.agent_auth_requests set browser_hash = p_consumed_browser_hash, binding_hash = p_binding_hash where id = r.id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.agent_auth_read_context(
  p_request_id text, p_binding_hash text, p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.agent_auth_requests;
begin
  select * into r from public.agent_auth_requests where id = p_request_id;
  if not found or r.binding_hash is null or r.binding_hash <> p_binding_hash then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  if r.expires_at <= p_now and r.state = 'pending' then
    update public.agent_auth_requests set state = 'expired' where id = r.id and state = 'pending';
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;
  if r.state = 'expired' then return jsonb_build_object('ok', false, 'code', 'expired'); end if;
  return jsonb_build_object('ok', true, 'request', jsonb_build_object(
    'id', r.id, 'client', r.client, 'scopes', to_jsonb(r.scopes), 'state', r.state, 'expires_at', r.expires_at
  ));
end;
$$;

create or replace function public.agent_auth_decide(
  p_request_id text, p_binding_hash text, p_decision text, p_user_id uuid, p_subject text, p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.agent_auth_requests;
declare cumulative_scopes text[];
begin
  select * into r from public.agent_auth_requests where id = p_request_id for update;
  if not found or r.binding_hash is null or r.binding_hash <> p_binding_hash or p_decision not in ('approve', 'deny') then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if r.expires_at <= p_now then
    update public.agent_auth_requests set state = 'expired' where id = r.id and state = 'pending';
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;
  if r.state <> 'pending' then return jsonb_build_object('ok', false, 'code', 'used'); end if;
  if p_decision = 'approve' and (p_user_id is null or p_subject is null) then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if p_decision = 'approve' then
    select array(
      select distinct scope from unnest(
        coalesce((select scopes from public.agent_auth_consents where user_id = p_user_id and client = r.client and revoked_at is null), array[]::text[])
        || r.scopes
      ) as scope order by scope
    ) into cumulative_scopes;
  else
    cumulative_scopes := r.scopes;
  end if;
  update public.agent_auth_requests set
    state = case when p_decision = 'approve' then 'approved' else 'denied' end,
    user_id = p_user_id, subject = p_subject, scopes = cumulative_scopes, approved_at = p_now
  where id = r.id;
  if p_decision = 'approve' then
    insert into public.agent_auth_consents (user_id, client, scopes, granted_at, revoked_at)
    values (p_user_id, r.client, cumulative_scopes, p_now, null)
    on conflict (user_id, client) do update set scopes = excluded.scopes, granted_at = excluded.granted_at, revoked_at = null;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.agent_auth_exchange(
  p_request_id text, p_device_hash text, p_access_hash text, p_refresh_hash text,
  p_access_expires_at timestamptz, p_session_expires_at timestamptz, p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.agent_auth_requests;
declare s public.agent_auth_sessions;
begin
  select * into r from public.agent_auth_requests where id = p_request_id for update;
  if not found or r.device_hash <> p_device_hash then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  if r.expires_at <= p_now then
    update public.agent_auth_requests set state = 'expired' where id = r.id and state in ('pending', 'approved');
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;
  if r.state = 'pending' then return jsonb_build_object('ok', false, 'code', 'pending'); end if;
  if r.state = 'denied' then return jsonb_build_object('ok', false, 'code', 'denied'); end if;
  if r.state <> 'approved' or r.user_id is null or r.subject is null then return jsonb_build_object('ok', false, 'code', 'used'); end if;
  insert into public.agent_auth_sessions (user_id, subject, client, scopes, status, created_at, expires_at)
  values (r.user_id, r.subject, r.client, r.scopes, 'active', p_now, p_session_expires_at)
  returning * into s;
  insert into public.agent_access_tokens (token_hash, session_id, expires_at, created_at)
  values (p_access_hash, s.id, p_access_expires_at, p_now);
  insert into public.agent_refresh_tokens (token_hash, session_id, generation, expires_at, created_at)
  values (p_refresh_hash, s.id, 0, s.expires_at, p_now);
  update public.agent_auth_requests set state = 'consumed', device_hash = p_access_hash, consumed_at = p_now where id = r.id;
  return jsonb_build_object('ok', true, 'session', to_jsonb(s));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'used');
end;
$$;

create or replace function public.agent_auth_rotate_refresh(
  p_refresh_hash text, p_next_access_hash text, p_next_refresh_hash text,
  p_access_expires_at timestamptz, p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare t public.agent_refresh_tokens;
declare s public.agent_auth_sessions;
begin
  select * into t from public.agent_refresh_tokens where token_hash = p_refresh_hash for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  select * into s from public.agent_auth_sessions where id = t.session_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  if t.consumed_at is not null then
    update public.agent_auth_sessions set status = 'revoked', revoked_at = coalesce(revoked_at, p_now) where id = s.id;
    update public.agent_access_tokens set revoked_at = coalesce(revoked_at, p_now) where session_id = s.id;
    return jsonb_build_object('ok', false, 'code', 'reused');
  end if;
  if t.expires_at <= p_now or s.expires_at <= p_now or s.status <> 'active' or not exists (
    select 1 from public.agent_auth_consents c
    where c.user_id = s.user_id and c.client = s.client and c.revoked_at is null and s.scopes <@ c.scopes
  ) then return jsonb_build_object('ok', false, 'code', 'expired'); end if;
  if not exists (
    select 1 from auth.users u where u.id = s.user_id
      and u.email_confirmed_at is not null and u.email_confirmed_at <= p_now
      and (u.banned_until is null or u.banned_until <= p_now)
  ) then
    update public.agent_auth_sessions set status = 'revoked', revoked_at = coalesce(revoked_at, p_now) where id = s.id;
    update public.agent_access_tokens set revoked_at = coalesce(revoked_at, p_now) where session_id = s.id;
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  update public.agent_refresh_tokens set consumed_at = p_now, replaced_by_hash = p_next_refresh_hash where token_hash = t.token_hash;
  insert into public.agent_access_tokens (token_hash, session_id, expires_at, created_at)
  values (p_next_access_hash, s.id, least(p_access_expires_at, s.expires_at), p_now);
  insert into public.agent_refresh_tokens (token_hash, session_id, generation, expires_at, created_at)
  values (p_next_refresh_hash, s.id, t.generation + 1, s.expires_at, p_now);
  return jsonb_build_object('ok', true, 'session', to_jsonb(s));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'invalid');
end;
$$;

create or replace function public.agent_auth_revoke(
  p_access_hash text, p_refresh_hash text, p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare access_sid uuid;
declare refresh_sid uuid;
declare principal record;
begin
  if p_access_hash is not null then select session_id into access_sid from public.agent_access_tokens where token_hash = p_access_hash; end if;
  if p_refresh_hash is not null then select session_id into refresh_sid from public.agent_refresh_tokens where token_hash = p_refresh_hash; end if;
  if access_sid is null and refresh_sid is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  for principal in
    select distinct s.user_id, s.client from public.agent_auth_sessions s
    where s.id = access_sid or s.id = refresh_sid
  loop
    update public.agent_auth_sessions set status = 'revoked', revoked_at = coalesce(revoked_at, p_now)
    where user_id = principal.user_id and client = principal.client;
    update public.agent_access_tokens a set revoked_at = coalesce(a.revoked_at, p_now)
    from public.agent_auth_sessions s
    where a.session_id = s.id and s.user_id = principal.user_id and s.client = principal.client;
    update public.agent_auth_consents set revoked_at = coalesce(revoked_at, p_now)
    where user_id = principal.user_id and client = principal.client;
  end loop;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.agent_auth_resolve_access(p_access_hash text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public.agent_access_tokens;
declare s public.agent_auth_sessions;
begin
  select * into a from public.agent_access_tokens where token_hash = p_access_hash;
  if not found or a.revoked_at is not null or a.expires_at <= p_now then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  select * into s from public.agent_auth_sessions where id = a.session_id;
  if not found or s.status <> 'active' or s.expires_at <= p_now or not exists (
    select 1 from public.agent_auth_consents c
    where c.user_id = s.user_id and c.client = s.client and c.revoked_at is null and s.scopes <@ c.scopes
  ) then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  if not exists (
    select 1 from auth.users u where u.id = s.user_id
      and u.email_confirmed_at is not null and u.email_confirmed_at <= p_now
      and (u.banned_until is null or u.banned_until <= p_now)
  ) then
    update public.agent_auth_sessions set status = 'revoked', revoked_at = coalesce(revoked_at, p_now) where id = s.id;
    update public.agent_access_tokens set revoked_at = coalesce(revoked_at, p_now) where session_id = s.id;
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  return jsonb_build_object('ok', true, 'principal', to_jsonb(s) || jsonb_build_object('access_expires_at', a.expires_at));
end;
$$;

create or replace function public.agent_mutation_claim(
  p_key_hash text, p_user_id uuid, p_route text, p_payload_hash text, p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.agent_mutation_idempotency;
declare inserted_count integer;
begin
  insert into public.agent_mutation_idempotency (key_hash, user_id, route, payload_hash, created_at)
  values (p_key_hash, p_user_id, p_route, p_payload_hash, p_now)
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 1 then return jsonb_build_object('kind', 'claimed'); end if;
  select * into r from public.agent_mutation_idempotency
  where key_hash = p_key_hash and user_id = p_user_id and route = p_route for update;
  if not found then return jsonb_build_object('kind', 'unavailable'); end if;
  if r.payload_hash <> p_payload_hash then return jsonb_build_object('kind', 'conflict'); end if;
  if r.state = 'completed' then
    return jsonb_build_object('kind', 'replay', 'status', r.response_status, 'body', r.response_body);
  end if;
  return jsonb_build_object('kind', 'in_progress');
end;
$$;

create or replace function public.agent_mutation_complete(
  p_key_hash text, p_user_id uuid, p_route text, p_payload_hash text,
  p_status integer, p_body jsonb, p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare changed integer;
declare r public.agent_mutation_idempotency;
begin
  update public.agent_mutation_idempotency set
    state = 'completed', response_status = p_status, response_body = p_body, completed_at = p_now
  where key_hash = p_key_hash and user_id = p_user_id and route = p_route
    and payload_hash = p_payload_hash and state = 'pending';
  get diagnostics changed = row_count;
  if changed = 1 then return jsonb_build_object('ok', true); end if;
  select * into r from public.agent_mutation_idempotency
  where key_hash = p_key_hash and user_id = p_user_id and route = p_route for update;
  return jsonb_build_object('ok', found and r.state = 'completed'
    and r.payload_hash = p_payload_hash and r.response_status = p_status and r.response_body = p_body);
end;
$$;

revoke all on function public.agent_auth_create_request(jsonb) from public, anon, authenticated;
revoke all on function public.agent_auth_sweep(timestamptz) from public, anon, authenticated;
revoke all on function public.agent_auth_bind_browser(text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.agent_auth_read_context(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.agent_auth_decide(text, text, text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.agent_auth_exchange(text, text, text, text, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.agent_auth_rotate_refresh(text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.agent_auth_revoke(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.agent_auth_resolve_access(text, timestamptz) from public, anon, authenticated;
revoke all on function public.agent_mutation_claim(text, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.agent_mutation_complete(text, uuid, text, text, integer, jsonb, timestamptz) from public, anon, authenticated;

grant execute on function public.agent_auth_create_request(jsonb) to service_role;
grant execute on function public.agent_auth_sweep(timestamptz) to service_role;
grant execute on function public.agent_auth_bind_browser(text, text, text, text, timestamptz) to service_role;
grant execute on function public.agent_auth_read_context(text, text, timestamptz) to service_role;
grant execute on function public.agent_auth_decide(text, text, text, uuid, text, timestamptz) to service_role;
grant execute on function public.agent_auth_exchange(text, text, text, text, timestamptz, timestamptz, timestamptz) to service_role;
grant execute on function public.agent_auth_rotate_refresh(text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.agent_auth_revoke(text, text, timestamptz) to service_role;
grant execute on function public.agent_auth_resolve_access(text, timestamptz) to service_role;
grant execute on function public.agent_mutation_claim(text, uuid, text, text, timestamptz) to service_role;
grant execute on function public.agent_mutation_complete(text, uuid, text, text, integer, jsonb, timestamptz) to service_role;

comment on table public.agent_auth_requests is 'Durable one-time SuperSkill browser authorization requests. Only HMAC hashes of browser and device proofs are stored.';
comment on table public.agent_refresh_tokens is 'Rotating SuperSkill agent refresh credentials. Reuse revokes the whole session family.';
