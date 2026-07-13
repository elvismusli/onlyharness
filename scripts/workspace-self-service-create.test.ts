import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = readFileSync(
  path.resolve(import.meta.dirname, "../supabase/migrations/20260714143000_workspace_self_service_create.sql"),
  "utf8"
);

test("workspace self-service bootstrap is atomic and service-role only", () => {
  assert.match(migration, /create or replace function public\.create_workspace_for_user/);
  assert.match(migration, /security definer\s+set search_path = pg_catalog, public/);
  assert.match(migration, /current_setting\('request\.jwt\.claim\.role', true\).*service_role/s);
  assert.match(migration, /insert into public\.workspaces/);
  assert.match(migration, /insert into public\.workspace_members/);
  assert.match(migration, /insert into public\.workspace_collections/);
  assert.match(migration, /insert into public\.workspace_join_policies/);
  assert.match(migration, /revoke all on function public\.create_workspace_for_user[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.create_workspace_for_user[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to authenticated/);
});

test("workspace self-service replay cannot take over another owner's slug", () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(p_slug, 0\)\)/);
  assert.match(migration, /existing_workspace\.owner_user_id is distinct from p_owner_user_id/);
  assert.match(migration, /raise unique_violation using message = 'workspace slug already in use'/);
  assert.match(migration, /workspace owner membership inactive/);
  assert.doesNotMatch(migration, /on conflict \(workspace_id, user_id\) do update[\s\S]*role = 'owner'/);
  assert.match(migration, /if not replay then\s+insert into public\.workspace_collections[\s\S]*insert into public\.workspace_join_policies/);
  assert.doesNotMatch(migration, /update public\.workspace_join_policies[\s\S]*status = 'active'/);
});

test("workspace invite redemption is one service-role-only transaction", () => {
  assert.match(migration, /create or replace function public\.join_workspace_with_invite/);
  assert.match(migration, /from public\.workspace_invites[\s\S]*for update/);
  assert.match(migration, /uses_count = uses_count \+ 1[\s\S]*insert into public\.workspace_members/);
  assert.match(migration, /existing_member\.status in \('suspended', 'removed'\)[\s\S]*MEMBERSHIP_BLOCKED/);
  assert.match(migration, /INVITE_EMAIL_MISMATCH/);
  assert.match(migration, /selected_invite\.role not in \('member', 'viewer'\)[\s\S]*INVITE_ROLE_INVALID/);
  assert.match(migration, /kind = 'invite' and status = 'active'[\s\S]*for share[\s\S]*JOIN_POLICY_DENIED/);
  assert.match(migration, /revoke all on function public\.join_workspace_with_invite[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.join_workspace_with_invite[\s\S]*to service_role/);
});
