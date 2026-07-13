import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = readFileSync(
  path.resolve(import.meta.dirname, "../supabase/migrations/20260714100000_workspace_member_expiry_rls.sql"),
  "utf8"
);
const setupBundleMigration = readFileSync(
  path.resolve(import.meta.dirname, "../supabase/migrations/20260708183000_workspace_setup_bundles.sql"),
  "utf8"
);

test("forward workspace RLS uses a non-recursive expiry-aware helper", () => {
  assert.match(migration, /create schema if not exists superskill_private authorization postgres/);
  assert.match(migration, /alter schema superskill_private owner to postgres/);
  assert.match(migration, /security definer\s+set search_path = pg_catalog, public/);
  assert.match(migration, /membership\.status = 'active'/);
  assert.match(migration, /membership\.removed_at is null/);
  assert.match(migration, /membership\.expires_at is null or membership\.expires_at > statement_timestamp\(\)/);
  assert.match(migration, /revoke all on function superskill_private\.has_active_workspace_membership/);
  assert.match(migration, /grant execute on function superskill_private\.has_active_workspace_membership[\s\S]*to authenticated, service_role/);

  const membershipPolicy = migration.slice(
    migration.indexOf('create policy "Workspace members read membership"'),
    migration.indexOf('drop policy if exists "Workspace admins read token metadata"')
  );
  assert.match(membershipPolicy, /superskill_private\.has_active_workspace_membership\(workspace_id\)/);
  assert.doesNotMatch(membershipPolicy, /from public\.workspace_members/);
});

test("every membership-scoped workspace projection uses the shared helper", () => {
  const policies = [
    "Workspace members read their workspaces",
    "Workspace members read membership",
    "Workspace admins read token metadata",
    "Workspace members read resources",
    "Workspace members read audit",
    "Workspace members read collections",
    "Workspace members read collection items",
    "Workspace members read join policies",
    "Workspace members read subscription events"
  ];

  for (const policy of policies) {
    const start = migration.indexOf(`create policy "${policy}"`);
    assert.ok(start >= 0, `${policy} must be recreated`);
    const body = migration.slice(start, migration.indexOf(";", start) + 1);
    assert.match(body, /superskill_private\.has_active_workspace_membership/);
    assert.match(body, /to authenticated/);
  }
});

test("workspace setup bundles are forced behind service-role-only RLS", () => {
  for (const sql of [setupBundleMigration, migration]) {
    assert.match(sql, /alter table public\.workspace_setup_bundles enable row level security/);
    assert.match(sql, /alter table public\.workspace_setup_bundles force row level security/);
    assert.match(sql, /create policy "Service role manages workspace setup bundles"[\s\S]*to service_role[\s\S]*using \(true\)[\s\S]*with check \(true\)/);
    assert.match(sql, /revoke all on table public\.workspace_setup_bundles from anon, authenticated/);
    assert.match(sql, /grant select, insert, update, delete on table public\.workspace_setup_bundles to service_role/);
  }
  assert.doesNotMatch(migration, /create policy "Workspace members read setup bundles"/);
});
