import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const cliBin = path.join(root, "packages/harness-cli/dist/hh.mjs");
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "hh-workspaces-smoke-"));
const apiPort = "8802";
const token = "smoke-workspace-token";

function run(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string; allowFailure?: boolean } = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: "utf8"
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

async function waitForApi(url: string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function createWorkspaceStore(target: string) {
  writeFileSync(target, JSON.stringify({
    workspaces: [
      {
        slug: "acme",
        name: "Acme Community",
        type: "community",
        visibility: "private",
        plan: "team",
        tokens: [
          {
            name: "smoke",
            hash: `sha256:${createHash("sha256").update(token).digest("hex")}`,
            scopes: ["workspace:read", "workspace:setup", "resource:read", "resource:publish", "resource:archive", "collection:write", "member:write", "invite:write", "gate:verify", "gate:write"],
            expires_at: null
          }
        ]
      }
    ]
  }, null, 2));
}

run("npm", ["run", "build", "-w", "onlyharness"]);

const workspaceStore = path.join(tempRoot, "workspaces.json");
const workspaceAudit = path.join(tempRoot, "workspace-audit.jsonl");
createWorkspaceStore(workspaceStore);

const api = spawn("npm", ["run", "start", "-w", "@harnesshub/api"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    HARNESS_API_PORT: apiPort,
    HARNESS_API_HOST: "127.0.0.1",
    HARNESS_WORKSPACE_ROOT: root,
    HARNESS_STATE_PATH: path.join(tempRoot, "state.json"),
    SUPABASE_URL: "",
    SUPABASE_ANON_KEY: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    SUPERSKILL_SUBJECT_SALT: "workspace-smoke-subject-salt-at-least-32-bytes",
    HARNESS_WORKSPACES_PATH: workspaceStore,
    HARNESS_WORKSPACE_AUDIT_PATH: workspaceAudit,
    WORKSPACES_ENABLED: "true",
    RESOURCE_IMPORTS_PATH: path.join(tempRoot, "public-imports.json"),
    RESOURCE_ARCHIVE_DIR: path.join(tempRoot, "public-archives"),
    RESOURCE_IMPORT_ARCHIVE_DIR: path.join(tempRoot, "public-import-archives"),
    RESOURCE_RELEASES_PATH: path.join(tempRoot, "public-resource-releases.json"),
    HOSTED_RESOURCE_PUBLISH_ENABLED: "true",
    WORKSPACE_RESOURCES_PATH: path.join(tempRoot, "workspace-resources"),
    WORKSPACE_COLLECTIONS_PATH: path.join(tempRoot, "workspace-collections"),
    WORKSPACE_SETUP_BUNDLES_PATH: path.join(tempRoot, "workspace-setup-bundles"),
    WORKSPACE_JOIN_POLICIES_PATH: path.join(tempRoot, "workspace-join-policies"),
    WORKSPACE_SUBSCRIPTIONS_ENABLED: "true",
    WORKSPACE_SUBSCRIPTIONS_PATH: path.join(tempRoot, "workspace-subscriptions.json"),
    WORKSPACE_JOIN_SECRET: "workspace-join-secret-for-smoke-only",
    HARNESS_WEBHOOK_TOKEN: "smoke-webhook-token",
    WORKSPACE_RESOURCE_ARCHIVE_DIR: path.join(tempRoot, "workspace-archives")
  }
});

let stderr = "";
api.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});

try {
  const baseUrl = `http://127.0.0.1:${apiPort}`;
  await waitForApi(`${baseUrl}/healthz`);

  const openapi = await fetch(`${baseUrl}/openapi.json`).then((response) => response.json()) as { paths?: Record<string, unknown> };
  for (const route of [
    "/workspaces",
    "/workspaces/{slug}/workspace",
    "/workspaces/{slug}/setup-bundle",
    "/workspaces/{slug}/members",
    "/workspaces/{slug}/invites",
    "/workspaces/{slug}/join-policies",
    "/workspaces/{slug}/subscriptions/checkout",
    "/workspaces/{slug}/subscriptions/me",
    "/workspaces/{slug}/subscriptions/sweep",
    "/workspaces/{slug}/join-code",
    "/workspaces/{slug}/join-code/verify",
    "/workspaces/{slug}/join-grants",
    "/workspaces/{slug}/join",
    "/workspaces/{slug}/resources",
    "/workspaces/{slug}/resources/approve",
    "/workspaces/{slug}/resources/{id}",
    "/workspaces/{slug}/resources/{id}/archive",
    "/workspaces/{slug}/collections",
    "/workspaces/{slug}/collections/{collection}",
    "/workspaces/{slug}/collections/{collection}/items",
    "/workspaces/{slug}/collections/{collection}/items/{itemId}",
    "/workspaces/{slug}/imports/resource-package"
  ]) {
    if (!openapi.paths?.[route]) throw new Error(`OpenAPI missing ${route}`);
  }
  if (!openapi.paths?.["/webhooks/workspace-subscriptions"]) throw new Error("OpenAPI missing /webhooks/workspace-subscriptions");

  const createdWorkspaceResponse = await fetch(`${baseUrl}/workspaces`, {
    method: "POST",
    headers: { Authorization: "Bearer local:creator-1", "content-type": "application/json" },
    body: JSON.stringify({ slug: "tomorrow-team", name: "Tomorrow Team", type: "team", visibility: "invite_only" })
  });
  const createdWorkspace = await createdWorkspaceResponse.json() as { workspace?: { slug?: string }; member?: { user_id?: string; role?: string }; replay?: boolean };
  if (createdWorkspaceResponse.status !== 201 || createdWorkspace.workspace?.slug !== "tomorrow-team" || createdWorkspace.member?.user_id !== "creator-1" || createdWorkspace.member.role !== "owner" || createdWorkspace.replay !== false) {
    throw new Error(`Workspace create returned wrong payload: ${createdWorkspaceResponse.status} ${JSON.stringify(createdWorkspace)}`);
  }
  const replayWorkspaceResponse = await fetch(`${baseUrl}/workspaces`, {
    method: "POST",
    headers: { Authorization: "Bearer local:creator-1", "content-type": "application/json" },
    body: JSON.stringify({ slug: "tomorrow-team", name: "Tomorrow Team" })
  });
  const replayWorkspace = await replayWorkspaceResponse.json() as { replay?: boolean };
  if (replayWorkspaceResponse.status !== 200 || replayWorkspace.replay !== true) throw new Error(`Workspace create replay failed: ${replayWorkspaceResponse.status} ${JSON.stringify(replayWorkspace)}`);
  const createdWorkspaceRead = await fetch(`${baseUrl}/workspaces/tomorrow-team/workspace`, { headers: { Authorization: "Bearer local:creator-1" } });
  if (createdWorkspaceRead.status !== 200) throw new Error(`Workspace owner could not read created workspace: ${createdWorkspaceRead.status}`);
  const ownerAssignment = await fetch(`${baseUrl}/workspaces/tomorrow-team/members`, {
    method: "POST",
    headers: { Authorization: "Bearer local:creator-1", "content-type": "application/json" },
    body: JSON.stringify({ userId: "attacker", role: "owner", source: "direct" })
  });
  const ownerAssignmentBody = await ownerAssignment.json() as { code?: string };
  if (ownerAssignment.status !== 409 || ownerAssignmentBody.code !== "OWNER_MUTATION_FORBIDDEN") {
    throw new Error(`Generic member endpoint assigned workspace ownership: ${ownerAssignment.status} ${JSON.stringify(ownerAssignmentBody)}`);
  }
  const ownerDowngrade = await fetch(`${baseUrl}/workspaces/tomorrow-team/members`, {
    method: "POST",
    headers: { Authorization: "Bearer local:creator-1", "content-type": "application/json" },
    body: JSON.stringify({ userId: "creator-1", role: "admin", source: "direct" })
  });
  const ownerDowngradeBody = await ownerDowngrade.json() as { code?: string };
  if (ownerDowngrade.status !== 409 || ownerDowngradeBody.code !== "OWNER_MUTATION_FORBIDDEN") {
    throw new Error(`Generic member endpoint mutated current owner: ${ownerDowngrade.status} ${JSON.stringify(ownerDowngradeBody)}`);
  }
  const ownerRemoval = await fetch(`${baseUrl}/workspaces/tomorrow-team/members/creator-1`, {
    method: "DELETE",
    headers: { Authorization: "Bearer local:creator-1" }
  });
  const ownerRemovalBody = await ownerRemoval.json() as { code?: string };
  if (ownerRemoval.status !== 409 || ownerRemovalBody.code !== "OWNER_MUTATION_FORBIDDEN") {
    throw new Error(`Generic member endpoint removed current owner: ${ownerRemoval.status} ${JSON.stringify(ownerRemovalBody)}`);
  }

  const noToken = await fetch(`${baseUrl}/workspaces/acme/workspace`);
  if (noToken.status !== 401) throw new Error(`Workspace without token should be 401, got ${noToken.status}`);

  const outsider = await fetch(`${baseUrl}/workspaces/acme/workspace`, {
    headers: { Authorization: "Bearer local:outsider" }
  });
  if (outsider.status !== 403) throw new Error(`Non-member workspace read should be 403, got ${outsider.status}`);

  const memberAdd = await fetch(`${baseUrl}/workspaces/acme/members`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ userId: "member-1", role: "member", source: "direct" })
  }).then((response) => response.json()) as { member?: { user_id?: string; role?: string; status?: string } };
  if (memberAdd.member?.user_id !== "member-1" || memberAdd.member.role !== "member" || memberAdd.member.status !== "active") {
    throw new Error(`Workspace member add returned wrong payload: ${JSON.stringify(memberAdd)}`);
  }

  const members = await fetch(`${baseUrl}/workspaces/acme/members`, {
    headers: { Authorization: "Bearer local:member-1" }
  }).then((response) => response.json()) as { members?: Array<{ user_id?: string; role?: string }> };
  if (!members.members?.some((member) => member.user_id === "member-1" && member.role === "member")) {
    throw new Error(`Workspace member list missing joined member: ${JSON.stringify(members)}`);
  }

  const invalidExpiry = await fetch(`${baseUrl}/workspaces/acme/members`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ userId: "bad-expiry", role: "member", source: "paid_entitlement", expiresAt: "not-a-date" })
  });
  if (invalidExpiry.status !== 400) throw new Error(`Invalid member expiry should be 400, got ${invalidExpiry.status}`);

  const expiredMember = await fetch(`${baseUrl}/workspaces/acme/members`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ userId: "expired-member", role: "member", source: "paid_entitlement", expiresAt: "2000-01-01T00:00:00.000Z" })
  }).then((response) => response.json()) as { member?: { user_id?: string; expires_at?: string | null } };
  if (expiredMember.member?.user_id !== "expired-member" || !expiredMember.member.expires_at?.startsWith("2000-01-01T00:00:00")) {
    throw new Error(`Expired member payload wrong: ${JSON.stringify(expiredMember)}`);
  }
  const expiredWorkspaceRead = await fetch(`${baseUrl}/workspaces/acme/workspace`, {
    headers: { Authorization: "Bearer local:expired-member" }
  });
  if (expiredWorkspaceRead.status !== 403) throw new Error(`Expired member workspace read should be 403, got ${expiredWorkspaceRead.status}`);
  const membersAfterExpiry = await fetch(`${baseUrl}/workspaces/acme/members`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then((response) => response.json()) as { members?: Array<{ user_id?: string }> };
  if (membersAfterExpiry.members?.some((member) => member.user_id === "expired-member")) {
    throw new Error(`Expired member should be hidden from active member list: ${JSON.stringify(membersAfterExpiry)}`);
  }

  const packageDir = path.join(tempRoot, "agent-tool");
  mkdirSync(path.join(packageDir, "scripts"), { recursive: true });
  writeFileSync(path.join(packageDir, "README.md"), "# Agent Tool\n\nPrivate workspace command pack.\n");
  writeFileSync(path.join(packageDir, "scripts/run.sh"), "#!/usr/bin/env bash\necho workspace smoke\n");
  writeFileSync(path.join(packageDir, ".env"), "SHOULD_NOT_UPLOAD=1\n");

  const cliEnv = {
    ...process.env,
    HH_REGISTRY_URL: baseUrl,
    HH_WORKSPACE_TOKEN: token,
    HOME: path.join(tempRoot, "home"),
    npm_config_cache: path.join(tempRoot, "npm-cache")
  };
  const publish = run("node", [cliBin, "publish-resource", packageDir, "--workspace", "acme", "--name", "agent-tool", "--type", "command_pack", "--json"], { env: cliEnv });
  const published = JSON.parse(publish.stdout) as { id?: string; archiveUrl?: string; hosted?: boolean; verified?: boolean; workspace?: string };
  if (published.id !== "@acme/agent-tool" || published.workspace !== "acme" || published.hosted !== true || published.verified !== false) {
    throw new Error(`Workspace publish returned wrong payload: ${publish.stdout}`);
  }
  if (publish.stdout.includes(token)) throw new Error("Workspace publish leaked raw token in stdout");

  const publicReleaseResponse = await fetch(`${baseUrl}/imports/resource-package`, {
    method: "POST",
    headers: { Authorization: "Bearer local:public-publisher", "content-type": "application/json" },
    body: JSON.stringify({
      name: "workspace-pin-proof",
      version: "1.2.3",
      idempotencyKey: "workspace-pin-proof-0001",
      resourceType: "skill",
      title: "Workspace pin proof",
      summary: "Benign exact public release used by workspace pin smoke.",
      files: [{ path: "SKILL.md", content: "---\nname: workspace-pin-proof\ndescription: \"Benign exact public release used by workspace pin smoke\"\n---\n\n# Workspace pin proof\n\nReview the supplied input and return a concise result.\n" }]
    })
  });
  const publicRelease = await publicReleaseResponse.json() as { resourceId?: string; version?: string; artifactDigest?: string; code?: string; error?: string };
  if (publicReleaseResponse.status !== 201 || publicRelease.resourceId !== "onlyharness:packages/workspace-pin-proof" || publicRelease.version !== "1.2.3" || !/^[a-f0-9]{64}$/.test(publicRelease.artifactDigest ?? "")) {
    throw new Error(`Public exact release fixture failed: ${publicReleaseResponse.status} ${JSON.stringify(publicRelease)}`);
  }

  const incompletePin = await fetch(`${baseUrl}/workspaces/acme/resources/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ resourceId: publicRelease.resourceId, resourceVersion: publicRelease.version })
  });
  const incompletePinBody = await incompletePin.json() as { code?: string };
  if (incompletePin.status !== 400 || incompletePinBody.code !== "RESOURCE_RELEASE_PIN_INCOMPLETE") {
    throw new Error(`Incomplete exact workspace pin should fail closed: ${incompletePin.status} ${JSON.stringify(incompletePinBody)}`);
  }

  const missingPin = await fetch(`${baseUrl}/workspaces/acme/resources/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ resourceId: publicRelease.resourceId, resourceVersion: "9.9.9", artifactDigest: publicRelease.artifactDigest })
  });
  const missingPinBody = await missingPin.json() as { code?: string };
  if (missingPin.status !== 404 || missingPinBody.code !== "RESOURCE_RELEASE_NOT_FOUND") {
    throw new Error(`Missing exact workspace release should fail closed: ${missingPin.status} ${JSON.stringify(missingPinBody)}`);
  }

  const mismatchDigest = `${publicRelease.artifactDigest?.startsWith("0") ? "1" : "0"}${publicRelease.artifactDigest?.slice(1)}`;
  const mismatchPin = await fetch(`${baseUrl}/workspaces/acme/resources/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ resourceId: publicRelease.resourceId, resourceVersion: publicRelease.version, artifactDigest: mismatchDigest })
  });
  const mismatchPinBody = await mismatchPin.json() as { code?: string };
  if (mismatchPin.status !== 409 || mismatchPinBody.code !== "RESOURCE_RELEASE_DIGEST_MISMATCH") {
    throw new Error(`Mismatched exact workspace digest should fail closed: ${mismatchPin.status} ${JSON.stringify(mismatchPinBody)}`);
  }

  const exactPin = await fetch(`${baseUrl}/workspaces/acme/resources/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      resourceId: publicRelease.resourceId,
      collection: "approved",
      resourceVersion: publicRelease.version,
      artifactDigest: publicRelease.artifactDigest
    })
  });
  const exactPinBody = await exactPin.json() as { item?: { sourceResourceId?: string; pinnedVersion?: string | null; pinnedArchiveHash?: string | null }; code?: string };
  if (exactPin.status !== 201 || exactPinBody.item?.sourceResourceId !== publicRelease.resourceId || exactPinBody.item.pinnedVersion !== publicRelease.version || exactPinBody.item.pinnedArchiveHash !== publicRelease.artifactDigest) {
    throw new Error(`Exact workspace approval did not persist release tuple: ${exactPin.status} ${JSON.stringify(exactPinBody)}`);
  }

  const exactCollectionPin = await fetch(`${baseUrl}/workspaces/acme/collections/pinned/items`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ resourceId: publicRelease.resourceId, resourceVersion: publicRelease.version, artifactDigest: publicRelease.artifactDigest })
  });
  const exactCollectionPinBody = await exactCollectionPin.json() as { item?: { pinnedVersion?: string | null; pinnedArchiveHash?: string | null }; code?: string };
  if (exactCollectionPin.status !== 201 || exactCollectionPinBody.item?.pinnedVersion !== publicRelease.version || exactCollectionPinBody.item.pinnedArchiveHash !== publicRelease.artifactDigest) {
    throw new Error(`Exact collection shortcut did not persist release tuple: ${exactCollectionPin.status} ${JSON.stringify(exactCollectionPinBody)}`);
  }

  const unscannedApprove = run("node", [cliBin, "resources", "approve", "github:obra/superpowers", "--workspace", "acme", "--collection", "approved", "--json"], { env: cliEnv, allowFailure: true });
  if (unscannedApprove.status === 0 || !unscannedApprove.stderr.includes("has not been security scanned")) {
    throw new Error(`Unscanned resource approval should fail closed: ${unscannedApprove.stdout}\n${unscannedApprove.stderr}`);
  }
  if (unscannedApprove.stdout.includes(token) || unscannedApprove.stderr.includes(token)) throw new Error("Rejected workspace approve leaked raw token");

  const approvedSourceId = "onlyharness:harnesses/deep-market-researcher";
  const approve = run("node", [cliBin, "resources", "approve", approvedSourceId, "--workspace", "acme", "--collection", "approved", "--json"], { env: cliEnv });
  const approved = JSON.parse(approve.stdout) as { resource?: { id?: string; workspaceApproval?: { sourceResourceId?: string; approvalState?: string }; actions?: Array<{ id?: string; url?: string }> }; collection?: { slug?: string; items?: Array<{ sourceResourceId?: string }> }; verified?: boolean; approvalState?: string };
  if (approved.resource?.id !== "@acme/deep-market-researcher" || approved.resource.workspaceApproval?.sourceResourceId !== approvedSourceId || approved.approvalState !== "approved" || approved.verified !== false) {
    throw new Error(`Workspace approval returned wrong payload: ${approve.stdout}`);
  }
  if (!approved.resource.actions?.some((action) => action.id === "open_onlyharness" && action.url?.includes("/#/superskill/workspaces?workspace=acme&resource=deep-market-researcher"))) {
    throw new Error(`Workspace approval missing workspace OnlyHarness action: ${approve.stdout}`);
  }
  if (approved.resource.actions?.some((action) => action.id === "download_archive" && action.url?.includes("/api/workspaces/acme/resources/deep-market-researcher/archive"))) {
    throw new Error(`Workspace approval must not invent a workspace archive action: ${approve.stdout}`);
  }
  if (approve.stdout.includes(token)) throw new Error("Workspace approve leaked raw token in stdout");

  const search = run("node", [cliBin, "resources", "search", "agent", "--workspace", "acme", "--json"], { env: cliEnv });
  const searchBody = JSON.parse(search.stdout) as { resources?: Array<{ id?: string }> };
  if (!searchBody.resources?.some((item) => item.id === "@acme/agent-tool")) throw new Error(`Workspace search missing package: ${search.stdout}`);

  const approvedSearch = run("node", [cliBin, "resources", "search", "deep market", "--workspace", "acme", "--json"], { env: cliEnv });
  const approvedSearchBody = JSON.parse(approvedSearch.stdout) as { resources?: Array<{ id?: string; workspaceApproval?: { sourceResourceId?: string } }> };
  if (!approvedSearchBody.resources?.some((item) => item.id === "@acme/deep-market-researcher" && item.workspaceApproval?.sourceResourceId === approvedSourceId)) {
    throw new Error(`Workspace search missing approved resource: ${approvedSearch.stdout}`);
  }

  const detail = run("node", [cliBin, "resources", "detail", "@acme/agent-tool", "--json"], { env: cliEnv });
  const detailBody = JSON.parse(detail.stdout) as { id?: string; resourceType?: string; actions?: Array<{ id?: string; url?: string }> };
  if (detailBody.id !== "@acme/agent-tool" || detailBody.resourceType !== "command_pack" || !detailBody.actions?.some((action) => action.id === "download_archive")) {
    throw new Error(`Workspace detail wrong: ${detail.stdout}`);
  }

  const approvedDetail = run("node", [cliBin, "resources", "detail", "@acme/deep-market-researcher", "--json"], { env: cliEnv });
  const approvedDetailBody = JSON.parse(approvedDetail.stdout) as { id?: string; workspaceApproval?: { approvalState?: string; sourceResourceId?: string }; trust?: { securityScan?: string } };
  if (approvedDetailBody.id !== "@acme/deep-market-researcher" || approvedDetailBody.workspaceApproval?.sourceResourceId !== approvedSourceId || approvedDetailBody.workspaceApproval?.approvalState !== "approved" || approvedDetailBody.trust?.securityScan !== "pass") {
    throw new Error(`Workspace approved detail wrong: ${approvedDetail.stdout}`);
  }

  const archiveResponse = await fetch(`${baseUrl}/workspaces/acme/resources/agent-tool/archive`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!archiveResponse.ok) throw new Error(`Workspace archive download failed: ${archiveResponse.status}`);
  const archivePath = path.join(tempRoot, "agent-tool.tar.gz");
  writeFileSync(archivePath, Buffer.from(await archiveResponse.arrayBuffer()));
  const tar = run("tar", ["-tzf", archivePath]);
  if (!tar.stdout.includes("README.md") || !tar.stdout.includes("scripts/run.sh") || tar.stdout.includes(".env")) {
    throw new Error(`Workspace archive contents are wrong:\n${tar.stdout}`);
  }

  const memberArchive = await fetch(`${baseUrl}/workspaces/acme/resources/agent-tool/archive`, {
    headers: { Authorization: "Bearer local:member-1" }
  });
  if (!memberArchive.ok) throw new Error(`Workspace member archive download failed: ${memberArchive.status}`);

  const expiredArchive = await fetch(`${baseUrl}/workspaces/acme/resources/agent-tool/archive`, {
    headers: { Authorization: "Bearer local:expired-member" }
  });
  if (expiredArchive.status !== 403) throw new Error(`Expired member archive access should be 403, got ${expiredArchive.status}`);

  const memberRemove = await fetch(`${baseUrl}/workspaces/acme/members/member-1`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  }).then((response) => response.json()) as { member?: { user_id?: string; status?: string; removed_at?: string | null } };
  if (memberRemove.member?.user_id !== "member-1" || memberRemove.member.status !== "removed" || !memberRemove.member.removed_at) {
    throw new Error(`Workspace member remove returned wrong payload: ${JSON.stringify(memberRemove)}`);
  }
  const removedMemberArchive = await fetch(`${baseUrl}/workspaces/acme/resources/agent-tool/archive`, {
    headers: { Authorization: "Bearer local:member-1" }
  });
  if (removedMemberArchive.status !== 403) throw new Error(`Removed member archive access should be 403, got ${removedMemberArchive.status}`);

  const approvedArchive = await fetch(`${baseUrl}/workspaces/acme/resources/deep-market-researcher/archive`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (approvedArchive.status !== 409) throw new Error(`Approved public resource should not pretend to have workspace archive, got ${approvedArchive.status}`);

  const setupBundle = await fetch(`${baseUrl}/workspaces/acme/setup-bundle?target=claude-code`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then((response) => response.json()) as { bundle?: { target?: string; resources?: Array<{ id?: string; hostedArchive?: boolean; source?: string; sourceResourceId?: string; pinnedVersion?: string; pinnedArchiveHash?: string; exactResourceUrl?: string; installCommand?: string }>; configs?: Array<{ path?: string; content?: string }> }; next?: string };
  const exactSetupResource = setupBundle.bundle?.resources?.find((item) => item.id === "@acme/workspace-pin-proof");
  const setupConfigContent = setupBundle.bundle?.configs?.map((item) => item.content ?? "").join("\n") ?? "";
  if (setupBundle.bundle?.target !== "claude-code" || !setupBundle.bundle.resources?.some((item) => item.id === "@acme/agent-tool" && item.hostedArchive === true) || !setupBundle.bundle.resources?.some((item) => item.id === "@acme/deep-market-researcher" && item.hostedArchive === false && item.source === "workspace_approved")) {
    throw new Error(`Workspace setup bundle missing expected resources: ${JSON.stringify(setupBundle)}`);
  }
  if (exactSetupResource?.sourceResourceId !== publicRelease.resourceId
    || exactSetupResource.pinnedVersion !== publicRelease.version
    || exactSetupResource.pinnedArchiveHash !== publicRelease.artifactDigest
    || !exactSetupResource.exactResourceUrl?.includes(`/releases/${publicRelease.version}`)
    || !exactSetupResource.installCommand?.includes(`onlyharness@0.3.1 resources install ${publicRelease.resourceId} --version ${publicRelease.version} --digest sha256:${publicRelease.artifactDigest} --target claude-code`)
    || !setupConfigContent.includes(publicRelease.version ?? "missing-version")
    || !setupConfigContent.includes(publicRelease.artifactDigest ?? "missing-digest")
    || !setupConfigContent.includes(exactSetupResource.exactResourceUrl ?? "missing-url")
    || !setupConfigContent.includes(exactSetupResource.installCommand ?? "missing-install")) {
    throw new Error(`Workspace setup bundle lost exact approved release instructions: ${JSON.stringify(exactSetupResource)}`);
  }
  if (!setupBundle.next?.includes("workspace setup acme") || JSON.stringify(setupBundle).includes(token)) {
    throw new Error(`Workspace setup bundle next step wrong or leaked token: ${JSON.stringify(setupBundle)}`);
  }

  const setupUpdate = await fetch(`${baseUrl}/workspaces/acme/setup-bundle`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ target: "claude-code", configs: [{ path: ".onlyharness/workspaces/acme-extra.md", content: "# Extra\n\nWorkspace-local setup note.\n" }] })
  }).then((response) => response.json()) as { bundle?: { configs?: Array<{ path?: string; content?: string }> } };
  if (!setupUpdate.bundle?.configs?.some((item) => item.path === ".onlyharness/workspaces/acme-extra.md" && item.content?.includes("Workspace-local setup note"))) {
    throw new Error(`Workspace setup PUT did not preserve config snippet: ${JSON.stringify(setupUpdate)}`);
  }
  if (JSON.stringify(setupUpdate).includes(token)) throw new Error("Workspace setup PUT leaked raw token");

  const setupOut = path.join(tempRoot, "setup-out");
  const setupCli = run("node", [cliBin, "workspace", "setup", "acme", "--target", "claude-code", "--out", setupOut, "--json"], { env: cliEnv });
  const setupCliBody = JSON.parse(setupCli.stdout) as { workspace?: { slug?: string }; resources?: Array<{ id?: string; hostedArchive?: boolean; files?: number; skippedReason?: string }>; configs?: Array<{ path?: string }> };
  if (setupCliBody.workspace?.slug !== "acme" || !setupCliBody.resources?.some((item) => item.id === "@acme/agent-tool" && item.hostedArchive === true && (item.files ?? 0) >= 2) || !setupCliBody.resources?.some((item) => item.id === "@acme/deep-market-researcher" && item.hostedArchive === false && item.skippedReason === "workspace archive not hosted")) {
    throw new Error(`Workspace setup CLI returned wrong payload: ${setupCli.stdout}`);
  }
  if (setupCli.stdout.includes(token)) throw new Error("Workspace setup CLI leaked raw token");
  const setupTarList = run("find", [setupOut, "-type", "f"]);
  if (!setupTarList.stdout.includes("resources/agent-tool/README.md") || !setupTarList.stdout.includes("resources/agent-tool/scripts/run.sh") || setupTarList.stdout.includes(".env")) {
    throw new Error(`Workspace setup output files are wrong:\n${setupTarList.stdout}`);
  }
  if (!setupTarList.stdout.includes(".onlyharness/workspaces/acme-extra.md") || !setupTarList.stdout.includes(".harnesshub/setup.json")) {
    throw new Error(`Workspace setup config files missing:\n${setupTarList.stdout}`);
  }
  const setupCliAgain = run("node", [cliBin, "workspace", "setup", "acme", "--target", "claude-code", "--out", setupOut, "--json"], { env: cliEnv });
  if (setupCliAgain.status !== 0 || setupCliAgain.stdout.includes(token)) throw new Error(`Workspace setup idempotent retry failed: ${setupCliAgain.stdout}\n${setupCliAgain.stderr}`);

  const collection = await fetch(`${baseUrl}/workspaces/acme/collections/approved`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then((response) => response.json()) as { collection?: { slug?: string; items?: Array<{ sourceResourceId?: string; approvalState?: string }> } };
  if (collection.collection?.slug !== "approved" || !collection.collection.items?.some((item) => item.sourceResourceId === approvedSourceId && item.approvalState === "approved")) {
    throw new Error(`Workspace collection missing approved item: ${JSON.stringify(collection)}`);
  }

  const removableSourceId = "onlyharness:harnesses/launch-readiness-reviewer";
  const approveRemovable = run("node", [cliBin, "resources", "approve", removableSourceId, "--workspace", "acme", "--collection", "approved", "--name", "launch-review", "--json"], { env: cliEnv });
  const removableApproval = JSON.parse(approveRemovable.stdout) as { resource?: { id?: string }; item?: { id?: string; sourceResourceId?: string }; approvalState?: string };
  if (removableApproval.resource?.id !== "@acme/launch-review" || removableApproval.item?.sourceResourceId !== removableSourceId || removableApproval.approvalState !== "approved") {
    throw new Error(`Workspace removable approval returned wrong payload: ${approveRemovable.stdout}`);
  }
  const removeApproval = run("node", [cliBin, "resources", "unapprove", "@acme/launch-review", "--workspace", "acme", "--collection", "approved", "--json"], { env: cliEnv });
  const removedApproval = JSON.parse(removeApproval.stdout) as { item?: { itemRef?: string }; removedResourceId?: string };
  if (removedApproval.item?.itemRef !== "@acme/launch-review" || removedApproval.removedResourceId !== "@acme/launch-review") {
    throw new Error(`Workspace unapprove returned wrong payload: ${removeApproval.stdout}`);
  }
  const removedSearch = run("node", [cliBin, "resources", "search", "launch readiness", "--workspace", "acme", "--json"], { env: cliEnv });
  const removedSearchBody = JSON.parse(removedSearch.stdout) as { resources?: Array<{ id?: string }> };
  if (removedSearchBody.resources?.some((item) => item.id === "@acme/launch-review")) {
    throw new Error(`Workspace search still includes removed approval: ${removedSearch.stdout}`);
  }
  const collectionAfterRemove = await fetch(`${baseUrl}/workspaces/acme/collections/approved`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then((response) => response.json()) as { collection?: { items?: Array<{ sourceResourceId?: string; itemRef?: string }> } };
  if (collectionAfterRemove.collection?.items?.some((item) => item.sourceResourceId === removableSourceId || item.itemRef === "@acme/launch-review")) {
    throw new Error(`Workspace collection still includes removed approval: ${JSON.stringify(collectionAfterRemove)}`);
  }

  for (const forbiddenRole of ["owner", "admin"]) {
    const privilegedInvite = await fetch(`${baseUrl}/workspaces/acme/invites`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ role: forbiddenRole, maxUses: 1, expiresInSeconds: 3600 })
    });
    const privilegedInviteBody = await privilegedInvite.json() as { code?: string; error?: string };
    if (privilegedInvite.status !== 400 || privilegedInviteBody.code !== "INVALID_INVITE_ROLE" || JSON.stringify(privilegedInviteBody).includes("ohwi_")) {
      throw new Error(`Privileged workspace invite was not rejected: ${forbiddenRole} ${privilegedInvite.status} ${JSON.stringify(privilegedInviteBody)}`);
    }
  }

  const invite = await fetch(`${baseUrl}/workspaces/acme/invites`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ role: "viewer", maxUses: 1, expiresInSeconds: 3600 })
  }).then((response) => response.json()) as { code?: string; invite?: { role?: string; usesCount?: number; code_hash?: string } };
  if (!invite.code?.startsWith("ohwi_") || invite.invite?.role !== "viewer" || invite.invite.usesCount !== 0 || JSON.stringify(invite).includes("code_hash")) {
    throw new Error(`Workspace invite returned unsafe payload: ${JSON.stringify(invite)}`);
  }

  const join = await fetch(`${baseUrl}/workspaces/acme/join`, {
    method: "POST",
    headers: { Authorization: "Bearer local:invite-user", "content-type": "application/json" },
    body: JSON.stringify({ code: invite.code })
  }).then((response) => response.json()) as { member?: { user_id?: string; role?: string; source?: string } };
  if (join.member?.user_id !== "invite-user" || join.member.role !== "viewer" || join.member.source !== "invite") {
    throw new Error(`Workspace invite join failed: ${JSON.stringify(join)}`);
  }

  const viewerArchive = await fetch(`${baseUrl}/workspaces/acme/resources/agent-tool/archive`, {
    headers: { Authorization: "Bearer local:invite-user" }
  });
  if (viewerArchive.status !== 403) throw new Error(`Viewer archive access should be 403, got ${viewerArchive.status}`);

  const policyUpdate = await fetch(`${baseUrl}/workspaces/acme/join-policies`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      policies: [
        { id: "invite", kind: "invite", status: "active", role: "member", title: "Invite code" },
        { id: "telegram-main", kind: "telegram", status: "active", role: "member", title: "Telegram members", config: { provider: "telegram", chatId: "onlyharness-smoke" } },
        { id: "paid-main", kind: "paid_subscription", status: "active", role: "member", title: "Paid members", config: { subscriptionProduct: "acme-pro", periodDays: 30, graceDays: 2 } }
      ]
    })
  }).then((response) => response.json()) as { policies?: Array<{ id?: string; kind?: string; status?: string; role?: string; config?: Record<string, unknown> }> };
  if (!policyUpdate.policies?.some((policy) => policy.id === "telegram-main" && policy.kind === "telegram" && policy.status === "active" && policy.role === "member")
    || !policyUpdate.policies?.some((policy) => policy.id === "paid-main" && policy.kind === "paid_subscription" && policy.status === "active" && policy.role === "member" && policy.config?.subscriptionProduct === "acme-pro")) {
    throw new Error(`Workspace join policy update failed: ${JSON.stringify(policyUpdate)}`);
  }
  if (JSON.stringify(policyUpdate).includes(token)) throw new Error("Workspace join policy update leaked raw token");

  const listedPolicies = await fetch(`${baseUrl}/workspaces/acme/join-policies`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then((response) => response.json()) as { policies?: Array<{ id?: string; kind?: string }> };
  if (!listedPolicies.policies?.some((policy) => policy.id === "telegram-main" && policy.kind === "telegram")) {
    throw new Error(`Workspace join policy list missing telegram policy: ${JSON.stringify(listedPolicies)}`);
  }

  const beforePaidCheckoutArchive = await fetch(`${baseUrl}/workspaces/acme/resources/agent-tool/archive`, {
    headers: { Authorization: "Bearer local:paid-user" }
  });
  if (beforePaidCheckoutArchive.status !== 403) throw new Error(`Paid user archive before subscription should be 403, got ${beforePaidCheckoutArchive.status}`);

  const subscriptionCheckout = await fetch(`${baseUrl}/workspaces/acme/subscriptions/checkout`, {
    method: "POST",
    headers: { Authorization: "Bearer local:paid-user", "content-type": "application/json" },
    body: JSON.stringify({ policyId: "paid-main", provider: "manual" })
  }).then((response) => response.json()) as { subscription?: { providerSubscriptionRef?: string; status?: string; checkoutUrl?: string | null; accessUntil?: string | null }; checkout_url?: string; next?: string };
  const subscriptionRef = subscriptionCheckout.subscription?.providerSubscriptionRef;
  if (!subscriptionRef?.startsWith("manual_sub_") || subscriptionCheckout.subscription?.status !== "incomplete" || !subscriptionCheckout.checkout_url?.includes("subscription_ref=") || subscriptionCheckout.subscription.accessUntil !== null || !subscriptionCheckout.next?.includes("webhook")) {
    throw new Error(`Workspace subscription checkout returned wrong payload: ${JSON.stringify(subscriptionCheckout)}`);
  }

  const afterPaidCheckoutArchive = await fetch(`${baseUrl}/workspaces/acme/resources/agent-tool/archive`, {
    headers: { Authorization: "Bearer local:paid-user" }
  });
  if (afterPaidCheckoutArchive.status !== 403) throw new Error(`Subscription checkout must not grant archive access, got ${afterPaidCheckoutArchive.status}`);

  const subscriptionReceipt = await fetch(`${baseUrl}/workspaces/acme/subscriptions/me`, {
    headers: { Authorization: "Bearer local:paid-user" }
  }).then((response) => response.json()) as { subscriptions?: Array<{ providerSubscriptionRef?: string; status?: string; portalUrl?: string | null }> };
  if (!subscriptionReceipt.subscriptions?.some((subscription) => subscription.providerSubscriptionRef === subscriptionRef && subscription.status === "incomplete" && subscription.portalUrl?.includes("subscription_ref="))) {
    throw new Error(`Workspace subscription receipt missing checkout: ${JSON.stringify(subscriptionReceipt)}`);
  }

  const activePeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const subscriptionActive = await fetch(`${baseUrl}/webhooks/workspace-subscriptions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-harness-token": "smoke-webhook-token" },
    body: JSON.stringify({ provider: "manual", provider_subscription_ref: subscriptionRef, provider_event_ref: "evt-paid-active", event_type: "invoice.paid", status: "active", current_period_end: activePeriodEnd })
  }).then((response) => response.json()) as { status?: string; member?: { user_id?: string; source?: string; expires_at?: string | null }; subscription?: { status?: string; accessUntil?: string | null } };
  if (subscriptionActive.status !== "activated" || subscriptionActive.member?.user_id !== "paid-user" || subscriptionActive.member.source !== "paid_entitlement" || subscriptionActive.subscription?.status !== "active" || !subscriptionActive.subscription.accessUntil?.startsWith(activePeriodEnd.slice(0, 10))) {
    throw new Error(`Workspace subscription activation failed: ${JSON.stringify(subscriptionActive)}`);
  }

  const afterPaidActiveArchive = await fetch(`${baseUrl}/workspaces/acme/resources/agent-tool/archive`, {
    headers: { Authorization: "Bearer local:paid-user" }
  });
  if (!afterPaidActiveArchive.ok) throw new Error(`Active paid subscription should grant archive access, got ${afterPaidActiveArchive.status}`);

  const duplicateSubscriptionWebhook = await fetch(`${baseUrl}/webhooks/workspace-subscriptions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-harness-token": "smoke-webhook-token" },
    body: JSON.stringify({ provider: "manual", provider_subscription_ref: subscriptionRef, provider_event_ref: "evt-paid-active", event_type: "invoice.paid", status: "active", current_period_end: activePeriodEnd })
  }).then((response) => response.json()) as { status?: string; member?: unknown };
  if (duplicateSubscriptionWebhook.status !== "already_processed" || duplicateSubscriptionWebhook.member) {
    throw new Error(`Duplicate subscription webhook should be idempotent and non-mutating: ${JSON.stringify(duplicateSubscriptionWebhook)}`);
  }

  const renewedPeriodEnd = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
  const removedCheckout = await fetch(`${baseUrl}/workspaces/acme/subscriptions/checkout`, {
    method: "POST",
    headers: { Authorization: "Bearer local:removed-user", "content-type": "application/json" },
    body: JSON.stringify({ policyId: "paid-main" })
  }).then((response) => response.json()) as { subscription?: { providerSubscriptionRef?: string } };
  const removedRef = removedCheckout.subscription?.providerSubscriptionRef;
  if (!removedRef) throw new Error(`Removed-member subscription checkout failed: ${JSON.stringify(removedCheckout)}`);
  const removedActive = await fetch(`${baseUrl}/webhooks/workspace-subscriptions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-harness-token": "smoke-webhook-token" },
    body: JSON.stringify({ provider_subscription_ref: removedRef, provider_event_ref: "evt-removed-active", event_type: "invoice.paid", status: "active", current_period_end: activePeriodEnd })
  }).then((response) => response.json()) as { member?: { user_id?: string } };
  if (removedActive.member?.user_id !== "removed-user") {
    throw new Error(`Removed-member active subscription should initially grant access: ${JSON.stringify(removedActive)}`);
  }
  const removedMember = await fetch(`${baseUrl}/workspaces/acme/members/removed-user`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  }).then((response) => response.json()) as { member?: { status?: string; removed_at?: string | null } };
  if (removedMember.member?.status !== "removed" || !removedMember.member.removed_at) {
    throw new Error(`Workspace member removal failed before subscription renewal: ${JSON.stringify(removedMember)}`);
  }
  const removedRenewal = await fetch(`${baseUrl}/webhooks/workspace-subscriptions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-harness-token": "smoke-webhook-token" },
    body: JSON.stringify({ provider_subscription_ref: removedRef, provider_event_ref: "evt-removed-renewed", event_type: "subscription.renewed", status: "active", current_period_end: renewedPeriodEnd })
  }).then((response) => response.json()) as { status?: string; member?: unknown; next?: string };
  if (removedRenewal.status !== "renewed" || removedRenewal.member || !removedRenewal.next?.includes("not restored")) {
    throw new Error(`Subscription webhook must not restore a removed member: ${JSON.stringify(removedRenewal)}`);
  }
  const removedArchive = await fetch(`${baseUrl}/workspaces/acme/resources/agent-tool/archive`, {
    headers: { Authorization: "Bearer local:removed-user" }
  });
  if (removedArchive.status !== 403) throw new Error(`Removed paid member should stay denied after renewal webhook, got ${removedArchive.status}`);

  const subscriptionRenewed = await fetch(`${baseUrl}/webhooks/workspace-subscriptions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-harness-token": "smoke-webhook-token" },
    body: JSON.stringify({ provider_subscription_ref: subscriptionRef, provider_event_ref: "evt-paid-renewed", event_type: "subscription.renewed", status: "active", current_period_end: renewedPeriodEnd })
  }).then((response) => response.json()) as { status?: string; subscription?: { accessUntil?: string | null } };
  if (subscriptionRenewed.status !== "renewed" || !subscriptionRenewed.subscription?.accessUntil?.startsWith(renewedPeriodEnd.slice(0, 10))) {
    throw new Error(`Workspace subscription renewal failed: ${JSON.stringify(subscriptionRenewed)}`);
  }

  const graceUntil = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const subscriptionPastDue = await fetch(`${baseUrl}/webhooks/workspace-subscriptions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-harness-token": "smoke-webhook-token" },
    body: JSON.stringify({ provider_subscription_ref: subscriptionRef, provider_event_ref: "evt-paid-past-due", event_type: "invoice.payment_failed", status: "past_due", current_period_end: new Date(Date.now() - 1000).toISOString(), grace_until: graceUntil })
  }).then((response) => response.json()) as { status?: string; subscription?: { status?: string; accessUntil?: string | null } };
  if (subscriptionPastDue.status !== "past_due" || subscriptionPastDue.subscription?.status !== "past_due" || !subscriptionPastDue.subscription.accessUntil?.startsWith(graceUntil.slice(0, 10))) {
    throw new Error(`Workspace subscription grace period failed: ${JSON.stringify(subscriptionPastDue)}`);
  }
  const graceArchive = await fetch(`${baseUrl}/workspaces/acme/resources/agent-tool/archive`, {
    headers: { Authorization: "Bearer local:paid-user" }
  });
  if (!graceArchive.ok) throw new Error(`Past-due grace subscription should still allow archive access, got ${graceArchive.status}`);

  const subscriptionCanceled = await fetch(`${baseUrl}/webhooks/workspace-subscriptions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-harness-token": "smoke-webhook-token" },
    body: JSON.stringify({ provider_subscription_ref: subscriptionRef, provider_event_ref: "evt-paid-canceled", event_type: "subscription.canceled", status: "canceled" })
  }).then((response) => response.json()) as { status?: string; subscription?: { status?: string; accessUntil?: string | null } };
  if (subscriptionCanceled.status !== "canceled" || subscriptionCanceled.subscription?.status !== "canceled") {
    throw new Error(`Workspace subscription cancellation failed: ${JSON.stringify(subscriptionCanceled)}`);
  }
  const canceledArchive = await fetch(`${baseUrl}/workspaces/acme/resources/agent-tool/archive`, {
    headers: { Authorization: "Bearer local:paid-user" }
  });
  if (canceledArchive.status !== 403) throw new Error(`Canceled paid subscription should remove archive access, got ${canceledArchive.status}`);

  const sweepCheckout = await fetch(`${baseUrl}/workspaces/acme/subscriptions/checkout`, {
    method: "POST",
    headers: { Authorization: "Bearer local:sweep-user", "content-type": "application/json" },
    body: JSON.stringify({ policyId: "paid-main" })
  }).then((response) => response.json()) as { subscription?: { providerSubscriptionRef?: string } };
  const sweepRef = sweepCheckout.subscription?.providerSubscriptionRef;
  if (!sweepRef) throw new Error(`Sweep subscription checkout failed: ${JSON.stringify(sweepCheckout)}`);
  await fetch(`${baseUrl}/webhooks/workspace-subscriptions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-harness-token": "smoke-webhook-token" },
    body: JSON.stringify({ provider_subscription_ref: sweepRef, provider_event_ref: "evt-sweep-active-past", event_type: "invoice.paid", status: "active", current_period_end: "2000-01-01T00:00:00.000Z" })
  });
  const sweep = await fetch(`${baseUrl}/workspaces/acme/subscriptions/sweep`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  }).then((response) => response.json()) as { checked?: number; expired?: Array<{ providerSubscriptionRef?: string; status?: string }> };
  if (!sweep.expired?.some((subscription) => subscription.providerSubscriptionRef === sweepRef && subscription.status === "expired")) {
    throw new Error(`Workspace subscription sweep did not expire past access: ${JSON.stringify(sweep)}`);
  }
  const sweepArchive = await fetch(`${baseUrl}/workspaces/acme/resources/agent-tool/archive`, {
    headers: { Authorization: "Bearer local:sweep-user" }
  });
  if (sweepArchive.status !== 403) throw new Error(`Swept expired subscription should deny archive access, got ${sweepArchive.status}`);

  const gateCode = await fetch(`${baseUrl}/workspaces/acme/join-code`, {
    method: "POST",
    headers: { Authorization: "Bearer local:telegram-user", "content-type": "application/json" },
    body: JSON.stringify({ source: "telegram", policyId: "telegram-main", ttl_seconds: 600 })
  }).then((response) => response.json()) as { code?: string; source?: string; subject_id?: string; policy?: { id?: string } };
  if (!gateCode.code?.startsWith("ohwj_") || gateCode.source !== "telegram" || gateCode.subject_id !== "telegram-user" || gateCode.policy?.id !== "telegram-main") {
    throw new Error(`Workspace join code returned wrong payload: ${JSON.stringify(gateCode)}`);
  }

  const gateVerify = await fetch(`${baseUrl}/workspaces/acme/join-code/verify`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ code: gateCode.code })
  }).then((response) => response.json()) as { allowed?: boolean; subject_id?: string; source?: string; policy?: { id?: string }; next?: string };
  if (gateVerify.allowed !== true || gateVerify.subject_id !== "telegram-user" || gateVerify.source !== "telegram" || gateVerify.policy?.id !== "telegram-main" || !gateVerify.next?.includes("read-only")) {
    throw new Error(`Workspace join code verify failed: ${JSON.stringify(gateVerify)}`);
  }

  const beforeGateGrantArchive = await fetch(`${baseUrl}/workspaces/acme/resources/agent-tool/archive`, {
    headers: { Authorization: "Bearer local:telegram-user" }
  });
  if (beforeGateGrantArchive.status !== 403) throw new Error(`Gate verification must not grant archive access, got ${beforeGateGrantArchive.status}`);

  const gateGrant = await fetch(`${baseUrl}/workspaces/acme/join-grants`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ code: gateCode.code, source: "telegram", externalSubject: "telegram:12345" })
  }).then((response) => response.json()) as { member?: { user_id?: string; role?: string; source?: string }; policy?: { id?: string } };
  if (gateGrant.member?.user_id !== "telegram-user" || gateGrant.member.role !== "member" || gateGrant.member.source !== "telegram" || gateGrant.policy?.id !== "telegram-main") {
    throw new Error(`Workspace join grant failed: ${JSON.stringify(gateGrant)}`);
  }

  const afterGateGrantArchive = await fetch(`${baseUrl}/workspaces/acme/resources/agent-tool/archive`, {
    headers: { Authorization: "Bearer local:telegram-user" }
  });
  if (!afterGateGrantArchive.ok) throw new Error(`Gate-granted member archive access failed: ${afterGateGrantArchive.status}`);

  const workspace = await fetch(`${baseUrl}/workspaces/acme/workspace`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then((response) => response.json()) as { resources?: Array<{ id?: string }>; collections?: Array<{ slug?: string }>; joinPolicies?: Array<{ id?: string; kind?: string }>; audit?: unknown[]; permissions?: { totalResources?: number; hostedArchives?: number } };
  if (!workspace.resources?.some((item) => item.id === "@acme/agent-tool") || !workspace.resources?.some((item) => item.id === "@acme/deep-market-researcher") || !workspace.collections?.some((item) => item.slug === "approved") || !workspace.joinPolicies?.some((item) => item.id === "telegram-main" && item.kind === "telegram") || workspace.permissions?.hostedArchives !== 1) {
    throw new Error(`Workspace overview missing published resource: ${JSON.stringify(workspace)}`);
  }
  const auditJson = JSON.stringify(workspace.audit ?? []);
  if (auditJson.includes(token) || auditJson.includes(invite.code ?? "") || auditJson.includes(gateCode.code ?? "")) throw new Error("Workspace audit leaked raw token, invite code or gate code");

} finally {
  api.kill();
  await new Promise((resolve) => api.once("exit", resolve));
  rmSync(tempRoot, { recursive: true, force: true });
}

if (stderr.includes(token)) throw new Error("API stderr leaked raw workspace token");
console.log("workspace smoke ok");
