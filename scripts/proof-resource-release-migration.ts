import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const migrationsRoot = path.join(root, "supabase/migrations");
const migrations = readdirSync(migrationsRoot).filter((name) => name.endsWith(".sql")).sort();
const productionAppliedCutoff = "20260707160000";
const forwardRepairMigration = "20260713130000_workspace_member_expiry_policy_repair.sql";
const finalWorkspaceRlsMigration = "20260714100000_workspace_member_expiry_rls.sql";
const productionAppliedMigrations = migrations.filter((migration) => migrationVersion(migration) <= productionAppliedCutoff);
const productionPendingMigrations = migrations.filter((migration) => migrationVersion(migration) > productionAppliedCutoff);
const container = `onlyharness-release-proof-${process.pid}-${randomUUID().slice(0, 8)}`;
const password = "local-proof-password";
const env = { ...process.env, PGPASSWORD: password };

try {
  command("docker", ["run", "-d", "--rm", "--name", container, "-e", `POSTGRES_PASSWORD=${password}`, "-p", "127.0.0.1::5432", "postgres:16-alpine"]);
  const port = await waitForPublishedPostgres();
  const baseArgs = postgresArgs(port, "postgres");
  bootstrapDatabase(baseArgs, true);
  const freshApplied = applyPendingMigrations(migrations, baseArgs);
  assertEqual(String(freshApplied.length), String(migrations.length), "fresh migration ledger did not apply the full chain");

  await proveReleaseStore(baseArgs);
  proveManagedAccessStore(baseArgs);

  sql("create database onlyharness_upgrade_proof;", baseArgs);
  const upgradeArgs = postgresArgs(port, "onlyharness_upgrade_proof");
  bootstrapDatabase(upgradeArgs, false);
  assertEqual(String(productionAppliedMigrations.length), "17", "production baseline migration count changed; update the explicit rollout cutoff");
  assertEqual(String(productionPendingMigrations.length), "11", "production pending migration count changed; review the rollout proof before shipping");
  const seededLedger = applyPendingMigrations(productionAppliedMigrations, upgradeArgs);
  assertEqual(seededLedger.join(","), productionAppliedMigrations.join(","), "existing-ledger setup did not stop at the production cutoff");
  seedProductionLikeData(upgradeArgs);
  const productionSnapshot = captureProductionSnapshot(upgradeArgs);
  const upgradeApplied = applyPendingMigrations(migrations, upgradeArgs);
  assertEqual(upgradeApplied.join(","), productionPendingMigrations.join(","), "forward upgrade did not apply the exact production-pending chain");
  proveProductionDataPreserved(upgradeArgs, productionSnapshot);
  proveFinalWorkspaceRls(upgradeArgs);
  await proveReleaseStore(upgradeArgs);
  proveManagedAccessStore(upgradeArgs);

  console.log(JSON.stringify({
    ok: true,
    code: "FULL_MIGRATION_CHAIN_AND_RELEASE_ACCESS_PROOF_PASSED",
    migrations: migrations.length,
    freshChain: true,
    existingLedgerUpgrade: true,
    productionAppliedCutoff,
    productionApplied: productionAppliedMigrations.length,
    pendingApplied: upgradeApplied,
    registrationsPreserved: true,
    eventsPreserved: true,
    finalWorkspaceRls: true,
    releaseRpc: true,
    grants: true,
    rls: true,
    ownershipRace: true,
    immutableTransition: true,
    managedAccessRpc: true,
    revocationAndExpiry: true,
    publishedPortReady: true
  }));
} finally {
  spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
}

function postgresArgs(port: string, database: string): string[] {
  return ["-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-At"];
}

function bootstrapDatabase(baseArgs: string[], createRoles: boolean): void {
  sql(`
    ${createRoles ? `create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;` : ""}
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations (
      version text primary key,
      name text not null,
      inserted_at timestamptz not null default now()
    );
  `, baseArgs);
}

function applyPendingMigrations(candidates: string[], baseArgs: string[]): string[] {
  const applied = new Set(sql("select version from supabase_migrations.schema_migrations order by version;", baseArgs).split("\n").filter(Boolean));
  const pending = candidates.filter((migration) => !applied.has(migrationVersion(migration)));
  for (const migration of pending) {
    applyMigration(path.join(migrationsRoot, migration), baseArgs);
    sql(`insert into supabase_migrations.schema_migrations(version, name) values ('${migrationVersion(migration)}', '${migration.replaceAll("'", "''")}');`, baseArgs);
  }
  return pending;
}

function migrationVersion(migration: string): string {
  const version = migration.match(/^(\d+)_/)?.[1];
  if (!version) throw new Error(`Migration filename has no ledger version: ${migration}`);
  return version;
}

function seedProductionLikeData(baseArgs: string[]): void {
  sql(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('70000000-0000-4000-8000-000000000001', 'active@example.test', '{"display_name":"Active"}'::jsonb),
      ('70000000-0000-4000-8000-000000000002', 'expired@example.test', '{"display_name":"Expired"}'::jsonb),
      ('70000000-0000-4000-8000-000000000003', 'removed@example.test', '{"display_name":"Removed"}'::jsonb);
    insert into public.events (kind, owner, repo, subject, target, client) values
      ('view', 'harnesses', 'deep-market-researcher', 'anonymous', null, 'web'),
      ('pull', 'harnesses', 'deep-market-researcher', 'user:fixture', 'codex', 'cli'),
      ('accepted', 'harnesses', 'deep-market-researcher', 'user:fixture', 'codex', 'cli');
  `, baseArgs);
}

type ProductionSnapshot = {
  authUsers: string;
  profiles: string;
  events: string;
};

function captureProductionSnapshot(baseArgs: string[]): ProductionSnapshot {
  return {
    authUsers: sql("select count(*) || ':' || md5(coalesce(string_agg(id::text, ',' order by id), '')) from auth.users;", baseArgs),
    profiles: sql("select count(*) || ':' || md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.profiles;", baseArgs),
    events: sql("select count(*) || ':' || md5(coalesce(string_agg(id::text || ':' || kind, ',' order by id), '')) from public.events;", baseArgs)
  };
}

function proveProductionDataPreserved(baseArgs: string[], before: ProductionSnapshot): void {
  const after = captureProductionSnapshot(baseArgs);
  assertEqual(after.authUsers, before.authUsers, "production upgrade changed existing auth users");
  assertEqual(after.profiles, before.profiles, "production upgrade changed existing profiles");
  assertEqual(after.events, before.events, "production upgrade changed existing events");
  assertEqual(sql("select count(*) from public.events where kind in ('view','pull','accepted');", baseArgs), "3", "legacy event kinds did not survive the broadened constraint");
  sql("insert into public.events (kind, subject) values ('recommended', 'user:managed-proof');", baseArgs);
  assertEqual(sql("select count(*) from public.events where kind='recommended' and subject='user:managed-proof';", baseArgs), "1", "managed event kind was not admitted after upgrade");
}

function proveFinalWorkspaceRls(baseArgs: string[]): void {
  assertEqual(sql("select count(*) from information_schema.columns where table_schema='public' and table_name='workspace_members' and column_name='expires_at';", baseArgs), "1", "forward repair did not add workspace_members.expires_at");
  assertEqual(sql("select count(*) from pg_indexes where schemaname='public' and indexname='workspace_members_active_expiry_idx';", baseArgs), "1", "forward repair did not add the active expiry index");
  const policy = sql("select pg_get_expr(polqual, polrelid) from pg_policy where polrelid='public.workspace_subscription_events'::regclass and polname='Workspace members read subscription events';", baseArgs);
  if (!policy.includes("superskill_private.has_active_workspace_membership(workspace_id)")) {
    throw new Error(`final workspace subscription policy does not use the non-recursive expiry helper: ${policy}`);
  }
  assertEqual(sql(`select count(*) from supabase_migrations.schema_migrations where version='${migrationVersion(forwardRepairMigration)}';`, baseArgs), "1", "forward repair was not recorded in the migration ledger");
  assertEqual(sql(`select count(*) from supabase_migrations.schema_migrations where version='${migrationVersion(finalWorkspaceRlsMigration)}';`, baseArgs), "1", "final workspace RLS migration was not recorded in the migration ledger");
  assertEqual(sql("select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and p.polname in ('Workspace members read their workspaces','Workspace members read membership','Workspace admins read token metadata','Workspace members read resources','Workspace members read audit','Workspace members read collections','Workspace members read collection items','Workspace members read join policies','Workspace members read subscription events') and pg_get_expr(p.polqual, p.polrelid) like '%superskill_private.has_active_workspace_membership%';", baseArgs), "9", "not every membership-scoped policy uses the final helper");
  assertEqual(sql("select prosecdef::text || ':' || pg_get_userbyid(proowner) from pg_proc where oid='superskill_private.has_active_workspace_membership(uuid,text[])'::regprocedure;", baseArgs), "true:postgres", "workspace membership helper is not postgres-owned security definer");

  sql(`
    insert into public.workspaces (id, slug, name, type, visibility, owner_user_id) values
      ('71000000-0000-4000-8000-000000000001', 'private-proof', 'Private proof', 'team', 'private', '70000000-0000-4000-8000-000000000001'),
      ('71000000-0000-4000-8000-000000000002', 'public-proof', 'Public proof', 'community', 'public', null);
    insert into public.workspace_members (id, workspace_id, user_id, role, status, removed_at, expires_at) values
      ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'owner', 'active', null, now() + interval '1 hour'),
      ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', 'member', 'active', null, now() - interval '1 hour'),
      ('72000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000003', 'member', 'removed', now(), null);
    grant select on public.workspaces, public.workspace_members to anon, authenticated;
  `, baseArgs);
  assertEqual(sql("set role authenticated; set request.jwt.claim.sub='70000000-0000-4000-8000-000000000001'; select (select count(*) from public.workspaces where id='71000000-0000-4000-8000-000000000001') || ':' || (select count(*) from public.workspace_members where workspace_id='71000000-0000-4000-8000-000000000001');", baseArgs), "1:3", "active owner could not read the private workspace without recursive RLS");
  for (const userId of ["70000000-0000-4000-8000-000000000002", "70000000-0000-4000-8000-000000000003"]) {
    assertEqual(sql(`set role authenticated; set request.jwt.claim.sub='${userId}'; select (select count(*) from public.workspaces where id='71000000-0000-4000-8000-000000000001') || ':' || (select count(*) from public.workspace_members where workspace_id='71000000-0000-4000-8000-000000000001');`, baseArgs), "0:0", "expired or removed member retained private workspace access");
  }
  assertEqual(sql("set role anon; select count(*) from public.workspaces where id='71000000-0000-4000-8000-000000000002';", baseArgs), "1", "public workspace projection is not readable by anon");
}

async function proveReleaseStore(baseArgs: string[]): Promise<void> {
  expectSqlFailure("set role service_role; insert into public.resource_package_owners(resource_id, owner_subject) values ('onlyharness:packages/direct-owner', 'user:' || repeat('a', 64));", baseArgs, /permission denied/);
  expectSqlFailure("set role service_role; delete from public.resource_package_releases;", baseArgs, /permission denied/);
  expectSqlFailure("set role anon; select * from public.resource_package_releases;", baseArgs, /permission denied/);

  const first = releaseRow("10000000-0000-4000-8000-000000000001", "onlyharness:packages/sql-proof", "1.0.0", subject("a"), "1", "a");
  sql(`set role service_role; select public.claim_resource_package_release(${literalJson(first)}::jsonb);`, baseArgs);
  assertEqual(sql("select count(*) from public.resource_package_releases where resource_id='onlyharness:packages/sql-proof' and status='pending';", baseArgs), "1", "claim RPC did not create one pending row");
  sql("set role service_role; update public.resource_package_releases set status='active', activated_at=now() where id='10000000-0000-4000-8000-000000000001';", baseArgs);
  assertEqual(sql("select status from public.resource_package_releases where id='10000000-0000-4000-8000-000000000001';", baseArgs), "active", "pending -> active transition failed");
  expectSqlFailure("set role service_role; update public.resource_package_releases set version='9.9.9' where id='10000000-0000-4000-8000-000000000001';", baseArgs, /permission denied|immutable/);
  expectSqlFailure("set role service_role; update public.resource_package_releases set status='failed', activated_at=null, failed_at=now(), failure_code='LATE' where id='10000000-0000-4000-8000-000000000001';", baseArgs, /invalid resource release state transition/);

  const abortable = releaseRow("10000000-0000-4000-8000-000000000002", "onlyharness:packages/sql-abort", "1.0.0", subject("b"), "2", "b");
  sql(`set role service_role; select public.claim_resource_package_release(${literalJson(abortable)}::jsonb);`, baseArgs);
  assertEqual(sql(`set role service_role; select public.abort_resource_package_release('${abortable.id}', '${abortable.owner_subject}', '${abortable.idempotency_key_hash}');`, baseArgs), "t", "abort RPC did not remove exact pending row");
  assertEqual(sql("select count(*) from public.resource_package_owners where resource_id='onlyharness:packages/sql-abort';", baseArgs), "0", "abort RPC left an owner claim without releases");

  const raceA = releaseRow("20000000-0000-4000-8000-000000000001", "onlyharness:packages/sql-race", "1.0.0", subject("c"), "3", "c");
  const raceB = releaseRow("20000000-0000-4000-8000-000000000002", "onlyharness:packages/sql-race", "2.0.0", subject("d"), "4", "d");
  const raceResults = await Promise.all([
    sqlAsync(`set role service_role; select public.claim_resource_package_release(${literalJson(raceA)}::jsonb);`, baseArgs),
    sqlAsync(`set role service_role; select public.claim_resource_package_release(${literalJson(raceB)}::jsonb);`, baseArgs)
  ]);
  if (raceResults.filter((result) => result.code === 0).length !== 1) throw new Error(`Ownership race expected one winner, got ${raceResults.map((result) => result.code).join(",")}`);
  assertEqual(sql("select count(distinct owner_subject) || ':' || count(*) from public.resource_package_releases where resource_id='onlyharness:packages/sql-race';", baseArgs), "1:1", "ownership race persisted multiple owners/releases");

  const sharedKeyOwner = subject("e");
  const keyA = releaseRow("30000000-0000-4000-8000-000000000001", "onlyharness:packages/sql-key-a", "1.0.0", sharedKeyOwner, "5", "e");
  const keyB = releaseRow("30000000-0000-4000-8000-000000000002", "onlyharness:packages/sql-key-b", "1.0.0", sharedKeyOwner, "5", "f");
  sql(`set role service_role; select public.claim_resource_package_release(${literalJson(keyA)}::jsonb);`, baseArgs);
  expectSqlFailure(`set role service_role; select public.claim_resource_package_release(${literalJson(keyB)}::jsonb);`, baseArgs, /duplicate key value/);
  assertEqual(sql("select count(*) from information_schema.role_table_grants where grantee='service_role' and table_name in ('resource_package_releases','resource_package_owners') and privilege_type in ('INSERT','DELETE');", baseArgs), "0", "service role retained direct release insert/delete grants");
}

function proveManagedAccessStore(baseArgs: string[]): void {
  const userId = "60000000-0000-4000-8000-000000000001";
  const expiredUserId = "60000000-0000-4000-8000-000000000002";
  sql(`insert into auth.users(id, email) values ('${userId}', 'grant@example.test'), ('${expiredUserId}', 'expired@example.test');`, baseArgs);
  expectSqlFailure(`set role service_role; insert into public.superskill_access_grants(subject,user_id,scope,cohort,expires_at,created_by,updated_by) values ('${subject("f")}','${userId}','superskill:managed','alpha',now()+interval '1 hour','operator:test','operator:test');`, baseArgs, /permission denied/);
  expectSqlFailure("set role service_role; update public.superskill_access_grants set cohort='wrong';", baseArgs, /permission denied/);
  expectSqlFailure("set role service_role; delete from public.superskill_access_grants;", baseArgs, /permission denied/);
  expectSqlFailure(`set role service_role; insert into public.superskill_access_grant_audit(subject,user_id,scope,action,cohort,status,expires_at,actor) values ('${subject("f")}','${userId}','superskill:managed','created','alpha','active',now()+interval '1 hour','operator:test');`, baseArgs, /permission denied/);
  expectSqlFailure("set role anon; select * from public.superskill_access_grants;", baseArgs, /permission denied/);
  expectSqlFailure("set role authenticated; select * from public.superskill_access_grant_audit;", baseArgs, /permission denied/);
  expectSqlFailure(`set role service_role; select (public.upsert_superskill_access_grant('user:not-canonical','${userId}','superskill:managed','alpha',now()+interval '1 hour','operator:test')).subject;`, baseArgs, /superskill_access_grants_subject_check|violates check constraint/);
  expectSqlFailure(`set role service_role; select (public.upsert_superskill_access_grant('${subject("f")}','${userId}','superskill:managed','alpha',now()-interval '1 second','operator:test')).subject;`, baseArgs, /expiry must be in the future/);

  assertEqual(sql(`set role service_role; select (public.upsert_superskill_access_grant('${subject("f")}','${userId}','superskill:managed','internal-alpha',now()+interval '1 hour','operator:test')).status;`, baseArgs), "active", "operator upsert RPC did not activate the grant");
  assertEqual(sql(`select count(*) from public.superskill_access_grants where subject='${subject("f")}' and user_id='${userId}' and status='active' and expires_at > now() and revoked_at is null;`, baseArgs), "1", "canonical active grant was not persisted");
  assertEqual(sql(`select count(*) from public.superskill_access_grant_audit where subject='${subject("f")}' and action='created';`, baseArgs), "1", "grant creation audit missing");

  sql(`insert into public.superskill_access_grants(subject,user_id,scope,cohort,status,expires_at,created_at,created_by,updated_by) values ('${subject("9")}','${expiredUserId}','superskill:managed','internal-alpha','active',now()-interval '1 hour',now()-interval '2 hours','operator:test','operator:test');`, baseArgs);
  assertEqual(sql(`set role service_role; select count(*) from public.superskill_access_grants where subject='${subject("9")}' and status='active' and expires_at > now() and revoked_at is null;`, baseArgs), "0", "expired grant passed the live eligibility predicate");

  assertEqual(sql(`set role service_role; select (public.revoke_superskill_access_grant('${subject("f")}','superskill:managed','operator:revoke','review complete')).status;`, baseArgs), "revoked", "operator revoke RPC did not revoke the grant");
  assertEqual(sql(`set role service_role; select count(*) from public.superskill_access_grants where subject='${subject("f")}' and status='active' and expires_at > now() and revoked_at is null;`, baseArgs), "0", "revoked grant remained eligible");
  assertEqual(sql(`select string_agg(action, ',' order by id) from public.superskill_access_grant_audit where subject='${subject("f")}';`, baseArgs), "created,revoked", "grant revocation audit is incomplete");
  expectSqlFailure(`set role service_role; select (public.upsert_superskill_access_grant('${subject("f")}','${userId}','superskill:managed','internal-alpha',now()+interval '2 hours','operator:test')).status;`, baseArgs, /Revoked SuperSkill grants are immutable/);

  assertEqual(sql("select count(*) from information_schema.role_table_grants where grantee='service_role' and table_name in ('superskill_access_grants','superskill_access_grant_audit') and privilege_type in ('INSERT','UPDATE','DELETE');", baseArgs), "0", "service role retained direct managed access write grants");
  assertEqual(sql("select relrowsecurity::text from pg_class where oid='public.superskill_access_grants'::regclass;", baseArgs), "true", "managed grant RLS is disabled");
  assertEqual(sql("select has_function_privilege('service_role','public.upsert_superskill_access_grant(text,uuid,text,text,timestamptz,text)','EXECUTE')::text || ':' || has_function_privilege('anon','public.upsert_superskill_access_grant(text,uuid,text,text,timestamptz,text)','EXECUTE')::text;", baseArgs), "true:false", "operator RPC grants are not fail-closed");
}

function releaseRow(id: string, resourceId: string, version: string, owner: string, keySeed: string, digestSeed: string) {
  return {
    id,
    resource_id: resourceId,
    version,
    owner_subject: owner,
    idempotency_key_hash: `sha256:${keySeed.repeat(64).slice(0, 64)}`,
    payload_digest: digestSeed.repeat(64).slice(0, 64),
    artifact_digest: digestSeed.repeat(64).slice(0, 64),
    archive_size: 123,
    storage_key: `${Buffer.from(`${resourceId}@${version}`).toString("base64url")}.tar.gz`,
    status: "pending",
    trust: "unreviewed",
    resource_payload: { id: resourceId, creatorName: "OnlyHarness publisher", trust: { securityScan: "not_scanned" } },
    created_at: "2026-07-13T00:00:00.000Z",
    activated_at: null,
    failed_at: null,
    failure_code: null
  };
}

function subject(seed: string): string {
  return `user:${seed.repeat(64).slice(0, 64)}`;
}

function literalJson(value: unknown): string {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'`;
}

function sql(statement: string, baseArgs: string[]): string {
  return command("psql", [...baseArgs, "-c", statement], env).stdout.trim();
}

function applyMigration(migration: string, baseArgs: string[]): void {
  const result = spawnSync("psql", [...baseArgs, "--single-transaction", "-f", migration], { cwd: root, env, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Migration ${path.basename(migration)} failed: ${`${result.stdout}\n${result.stderr}`.trim().slice(-1200)}`);
  }
}

function expectSqlFailure(statement: string, baseArgs: string[], pattern: RegExp): void {
  const result = spawnSync("psql", [...baseArgs, "-c", statement], { cwd: root, env, encoding: "utf8" });
  if (result.status === 0 || !pattern.test(`${result.stdout}\n${result.stderr}`)) {
    throw new Error(`Expected PostgreSQL security invariant failure did not occur: ${`${result.stdout}\n${result.stderr}`.trim().slice(-500)}`);
  }
}

function sqlAsync(statement: string, baseArgs: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("psql", [...baseArgs, "-c", statement], { cwd: root, env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

function command(commandName: string, args: string[], commandEnv: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(commandName, args, { cwd: root, env: commandEnv, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${commandName} failed (${result.status}): ${result.stderr.trim().slice(0, 500)}`);
  return result;
}

async function waitForPublishedPostgres(): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const published = spawnSync("docker", ["port", container, "5432/tcp"], { encoding: "utf8" });
    const port = published.status === 0 ? published.stdout.trim().match(/:(\d+)$/)?.[1] : undefined;
    if (port) {
      const ready = spawnSync("pg_isready", ["-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", "postgres"], { env, stdio: "ignore" });
      if (ready.status === 0) {
        const query = spawnSync("psql", ["-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", "postgres", "-At", "-c", "select 1"], { env, encoding: "utf8" });
        if (query.status === 0 && query.stdout.trim() === "1") return port;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for PostgreSQL through the published host port");
}

function assertEqual(actual: string, expected: string, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}
