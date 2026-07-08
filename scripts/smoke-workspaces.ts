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
            scopes: ["workspace:read", "resource:read", "resource:publish", "resource:archive", "collection:write", "member:write", "invite:write"],
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
    HARNESS_WORKSPACES_PATH: workspaceStore,
    HARNESS_WORKSPACE_AUDIT_PATH: workspaceAudit,
    WORKSPACES_ENABLED: "true",
    RESOURCE_IMPORTS_PATH: path.join(tempRoot, "public-imports.json"),
    RESOURCE_ARCHIVE_DIR: path.join(tempRoot, "public-archives"),
    WORKSPACE_RESOURCES_PATH: path.join(tempRoot, "workspace-resources"),
    WORKSPACE_COLLECTIONS_PATH: path.join(tempRoot, "workspace-collections"),
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
    "/workspaces/{slug}/workspace",
    "/workspaces/{slug}/members",
    "/workspaces/{slug}/invites",
    "/workspaces/{slug}/join",
    "/workspaces/{slug}/resources",
    "/workspaces/{slug}/resources/approve",
    "/workspaces/{slug}/resources/{id}",
    "/workspaces/{slug}/resources/{id}/archive",
    "/workspaces/{slug}/collections",
    "/workspaces/{slug}/collections/{collection}",
    "/workspaces/{slug}/collections/{collection}/items",
    "/workspaces/{slug}/imports/resource-package"
  ]) {
    if (!openapi.paths?.[route]) throw new Error(`OpenAPI missing ${route}`);
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
  if (!approved.resource.actions?.some((action) => action.id === "open_onlyharness" && action.url?.includes("/#/workspaces/acme/resources/deep-market-researcher"))) {
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

  const approvedArchive = await fetch(`${baseUrl}/workspaces/acme/resources/deep-market-researcher/archive`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (approvedArchive.status !== 409) throw new Error(`Approved public resource should not pretend to have workspace archive, got ${approvedArchive.status}`);

  const collection = await fetch(`${baseUrl}/workspaces/acme/collections/approved`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then((response) => response.json()) as { collection?: { slug?: string; items?: Array<{ sourceResourceId?: string; approvalState?: string }> } };
  if (collection.collection?.slug !== "approved" || !collection.collection.items?.some((item) => item.sourceResourceId === approvedSourceId && item.approvalState === "approved")) {
    throw new Error(`Workspace collection missing approved item: ${JSON.stringify(collection)}`);
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

  const workspace = await fetch(`${baseUrl}/workspaces/acme/workspace`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then((response) => response.json()) as { resources?: Array<{ id?: string }>; collections?: Array<{ slug?: string }>; audit?: unknown[]; permissions?: { totalResources?: number; hostedArchives?: number } };
  if (!workspace.resources?.some((item) => item.id === "@acme/agent-tool") || !workspace.resources?.some((item) => item.id === "@acme/deep-market-researcher") || !workspace.collections?.some((item) => item.slug === "approved") || workspace.permissions?.hostedArchives !== 1) {
    throw new Error(`Workspace overview missing published resource: ${JSON.stringify(workspace)}`);
  }
  const auditJson = JSON.stringify(workspace.audit ?? []);
  if (auditJson.includes(token) || auditJson.includes(invite.code ?? "")) throw new Error("Workspace audit leaked raw token or invite code");

} finally {
  api.kill();
  await new Promise((resolve) => api.once("exit", resolve));
  rmSync(tempRoot, { recursive: true, force: true });
}

if (stderr.includes(token)) throw new Error("API stderr leaked raw workspace token");
console.log("workspace smoke ok");
