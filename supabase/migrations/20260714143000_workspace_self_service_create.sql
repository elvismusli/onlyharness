-- Atomic, service-role-only workspace bootstrap for the confirmed web/API flow.
-- The API authenticates the user first; this function guarantees that the
-- workspace, owner membership, invite policy and default collection either all
-- exist together or none of them do.

create or replace function public.create_workspace_for_user(
  p_owner_user_id uuid,
  p_slug text,
  p_name text,
  p_type text default 'team',
  p_visibility text default 'invite_only',
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  existing_workspace public.workspaces%rowtype;
  created_workspace public.workspaces%rowtype;
  owner_member public.workspace_members%rowtype;
  replay boolean := false;
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.role(), '') <> 'service_role' then
    raise insufficient_privilege using message = 'service role required';
  end if;
  if p_owner_user_id is null or not exists (select 1 from auth.users where id = p_owner_user_id) then
    raise foreign_key_violation using message = 'owner user not found';
  end if;
  if p_slug is null or p_slug !~ '^[a-z][a-z0-9_-]{1,48}$' then
    raise check_violation using message = 'invalid workspace slug';
  end if;
  if p_name is null or length(btrim(p_name)) < 1 or length(btrim(p_name)) > 120 then
    raise check_violation using message = 'invalid workspace name';
  end if;
  if p_type not in ('company', 'community', 'team', 'course', 'agency', 'chat') then
    raise check_violation using message = 'invalid workspace type';
  end if;
  if p_visibility not in ('private', 'invite_only') then
    raise check_violation using message = 'invalid workspace visibility';
  end if;
  if p_description is not null and length(p_description) > 500 then
    raise check_violation using message = 'invalid workspace description';
  end if;

  -- Serialize only competing requests for this slug so an exact retry cannot
  -- race the first insert into a false conflict.
  perform pg_advisory_xact_lock(hashtextextended(p_slug, 0));

  select * into existing_workspace
  from public.workspaces
  where slug = p_slug and archived_at is null;

  if found then
    if existing_workspace.owner_user_id is distinct from p_owner_user_id then
      raise unique_violation using message = 'workspace slug already in use';
    end if;
    created_workspace := existing_workspace;
    replay := true;
    select * into owner_member
    from public.workspace_members
    where workspace_id = created_workspace.id
      and user_id = p_owner_user_id
      and role = 'owner'
      and status = 'active'
      and removed_at is null
      and (expires_at is null or expires_at > statement_timestamp());
    if not found then
      raise insufficient_privilege using message = 'workspace owner membership inactive';
    end if;
  else
    insert into public.workspaces (slug, name, type, visibility, owner_user_id, plan, description)
    values (p_slug, btrim(p_name), p_type, p_visibility, p_owner_user_id, 'free', nullif(btrim(p_description), ''))
    returning * into created_workspace;
    insert into public.workspace_members (workspace_id, user_id, role, status, source, joined_at, removed_at)
    values (created_workspace.id, p_owner_user_id, 'owner', 'active', 'direct', statement_timestamp(), null)
    returning * into owner_member;
  end if;

  if not replay then
    insert into public.workspace_collections (workspace_id, slug, title, summary, visibility, created_by)
    values (created_workspace.id, 'approved', 'Approved', 'Workspace-approved resources.', 'workspace', p_owner_user_id);

    insert into public.workspace_join_policies (workspace_id, kind, status, role, title, instructions, config)
    values (created_workspace.id, 'invite', 'active', 'member', 'Invite code', 'Join with a bounded workspace invite.', '{}'::jsonb);

    insert into public.workspace_audit (workspace_id, actor_user_id, action, target, metadata)
    values (created_workspace.id, p_owner_user_id, 'workspace_created', created_workspace.slug, jsonb_build_object('source', 'self_service'));
  end if;

  return jsonb_build_object(
    'workspace', to_jsonb(created_workspace),
    'member', to_jsonb(owner_member),
    'replay', replay
  );
end;
$function$;

alter function public.create_workspace_for_user(uuid, text, text, text, text, text) owner to postgres;
revoke all on function public.create_workspace_for_user(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_workspace_for_user(uuid, text, text, text, text, text)
  to service_role;

comment on function public.create_workspace_for_user(uuid, text, text, text, text, text) is
  'Atomically creates or replays an owner workspace bootstrap. Service role only; the API must authenticate and confirm the caller first.';

-- Consume a bounded invite and grant membership as one transaction. The row
-- lock prevents two recipients from spending the same final use.
create or replace function public.join_workspace_with_invite(
  p_user_id uuid,
  p_workspace_slug text,
  p_code_hash text,
  p_user_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  selected_workspace public.workspaces%rowtype;
  selected_policy public.workspace_join_policies%rowtype;
  selected_invite public.workspace_invites%rowtype;
  existing_member public.workspace_members%rowtype;
  granted_member public.workspace_members%rowtype;
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.role(), '') <> 'service_role' then
    raise insufficient_privilege using message = 'service role required';
  end if;
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED');
  end if;
  if p_workspace_slug is null or p_workspace_slug !~ '^[a-z][a-z0-9_-]{1,48}$'
     or p_code_hash is null or p_code_hash !~ '^sha256:[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INVITE');
  end if;

  select * into selected_workspace
  from public.workspaces
  where slug = p_workspace_slug and archived_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'WORKSPACE_NOT_FOUND');
  end if;

  select * into selected_policy
  from public.workspace_join_policies
  where workspace_id = selected_workspace.id and kind = 'invite' and status = 'active'
  for share;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'JOIN_POLICY_DENIED');
  end if;

  select * into selected_invite
  from public.workspace_invites
  where workspace_id = selected_workspace.id and code_hash = p_code_hash
  for update;
  if not found or selected_invite.revoked_at is not null then
    return jsonb_build_object('ok', false, 'code', 'INVITE_NOT_FOUND');
  end if;
  if selected_invite.role not in ('member', 'viewer') then
    return jsonb_build_object('ok', false, 'code', 'INVITE_ROLE_INVALID');
  end if;
  if selected_invite.email is not null
     and (p_user_email is null or lower(btrim(selected_invite.email)) <> lower(btrim(p_user_email))) then
    return jsonb_build_object('ok', false, 'code', 'INVITE_EMAIL_MISMATCH');
  end if;

  select * into existing_member
  from public.workspace_members
  where workspace_id = selected_workspace.id and user_id = p_user_id
  for update;
  if found and existing_member.status = 'active' and existing_member.removed_at is null
     and (existing_member.expires_at is null or existing_member.expires_at > statement_timestamp()) then
    return jsonb_build_object(
      'ok', true,
      'workspace', to_jsonb(selected_workspace),
      'invite', to_jsonb(selected_invite),
      'member', to_jsonb(existing_member),
      'replay', true
    );
  end if;
  if found and existing_member.status in ('suspended', 'removed') then
    return jsonb_build_object('ok', false, 'code', 'MEMBERSHIP_BLOCKED');
  end if;
  if selected_invite.expires_at is not null and selected_invite.expires_at <= statement_timestamp() then
    return jsonb_build_object('ok', false, 'code', 'INVITE_EXPIRED');
  end if;
  if selected_invite.max_uses is not null and selected_invite.uses_count >= selected_invite.max_uses then
    return jsonb_build_object('ok', false, 'code', 'INVITE_EXHAUSTED');
  end if;

  update public.workspace_invites
  set uses_count = uses_count + 1
  where id = selected_invite.id
  returning * into selected_invite;

  insert into public.workspace_members (workspace_id, user_id, role, status, source, joined_at, expires_at, removed_at)
  values (selected_workspace.id, p_user_id, selected_invite.role, 'active', 'invite', statement_timestamp(), null, null)
  on conflict (workspace_id, user_id) do update
    set role = case
        when public.workspace_members.role in ('owner', 'admin', 'moderator', 'publisher') then public.workspace_members.role
        when public.workspace_members.role = 'member' and excluded.role = 'viewer' then 'member'
        else excluded.role
      end,
      status = 'active',
      source = 'invite',
      joined_at = statement_timestamp(),
      expires_at = null,
      removed_at = null
  returning * into granted_member;

  return jsonb_build_object(
    'ok', true,
    'workspace', to_jsonb(selected_workspace),
    'invite', to_jsonb(selected_invite),
    'member', to_jsonb(granted_member),
    'replay', false
  );
end;
$function$;

alter function public.join_workspace_with_invite(uuid, text, text, text) owner to postgres;
revoke all on function public.join_workspace_with_invite(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.join_workspace_with_invite(uuid, text, text, text)
  to service_role;

comment on function public.join_workspace_with_invite(uuid, text, text, text) is
  'Atomically locks and consumes one bounded workspace invite use while granting membership. Service role only.';
