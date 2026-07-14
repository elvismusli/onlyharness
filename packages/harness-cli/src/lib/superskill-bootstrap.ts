import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  constants,
  existsSync,
  closeSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { UNIVERSAL_SUPERSKILL_ARTIFACT_DIGEST, UNIVERSAL_SUPERSKILL_FILES } from "../generated/superskill-plugin.js";
import type { SuperSkillClient } from "./superskill-types.js";
import { CAPABILITY_ID_RE, DIGEST_RE, SUPERSKILL_RUNTIME, SuperSkillCliError } from "./superskill-types.js";

export const SUPERSKILL_INSTALL_ORIGIN = "https://superskill.sh";
export const SUPERSKILL_INSTALL_PATH = "/api/superskill/install";
export const SUPERSKILL_PLUGIN_VERSION = "0.3.0";
export const SUPERSKILL_PUBLIC_MCP_URL = "https://superskill.sh/mcp";

export { UNIVERSAL_SUPERSKILL_FILES };

export type BootstrapCapability = {
  id: string;
  version: string;
  artifactDigest: string;
};

export type SuperSkillBootstrapManifest = {
  schemaVersion: "superskill.bootstrap.v1";
  canonicalUrl: string;
  installer: {
    package: "onlyharness";
    version: string;
    integrity: string;
    releaseStatus: "published";
  };
  universalSkill: {
    name: "superskill";
    version: string;
    artifactDigest: string;
  };
  clientAdapters: Record<SuperSkillClient, { path: string; contractDigest: string }>;
  capability: BootstrapCapability | null;
  activation: {
    performed: false;
    explicitConsentRequired: true;
  };
  manifestDigest: string;
};

export type ClientProbe = (client: SuperSkillClient) => boolean;
export type VerifiedBootstrapManifest = {
  manifest: SuperSkillBootstrapManifest;
  officialIntegrity: string;
  verified: true;
};
export type InstallBoundary =
  | "after-lock"
  | "after-target-rename-before-fsync"
  | "after-config-replace-before-fsync"
  | "after-handoff-link-before-fsync";

export function universalSkillArtifactDigest(files: readonly { path: string; content: string }[] = UNIVERSAL_SUPERSKILL_FILES): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(file.path, "utf8");
    hash.update("\0");
    hash.update(createHash("sha256").update(file.content, "utf8").digest("hex"), "utf8");
    hash.update("\n");
  }
  const digest = `sha256:${hash.digest("hex")}`;
  if (files === UNIVERSAL_SUPERSKILL_FILES && digest !== UNIVERSAL_SUPERSKILL_ARTIFACT_DIGEST) {
    throw integrityError("Generated SuperSkill artifact digest is stale.");
  }
  return digest;
}

export function bootstrapManifestDigest(manifest: Omit<SuperSkillBootstrapManifest, "manifestDigest">): string {
  return `sha256:${createHash("sha256").update(canonicalJson(manifest), "utf8").digest("hex")}`;
}

export function clientAdapterContractDigest(client: SuperSkillClient): string {
  const contract = client === "codex"
    ? {
      client,
      path: ".codex/config.toml",
      mcp_servers: {
        superskill: {
          url: SUPERSKILL_PUBLIC_MCP_URL,
          default_tools_approval_mode: "prompt"
        },
        superskill_local: {
          command: "npx",
          args: ["--yes", `${SUPERSKILL_RUNTIME.cliPackage}@${SUPERSKILL_RUNTIME.cliVersion}`, "mcp", "superskill"],
          default_tools_approval_mode: "prompt"
        }
      },
      tokenStored: false
    }
    : {
      client,
      path: ".mcp.json",
      mcpServers: {
        superskill: {
          type: "http",
          url: SUPERSKILL_PUBLIC_MCP_URL
        },
        superskill_local: {
          command: "npx",
          args: ["--yes", `${SUPERSKILL_RUNTIME.cliPackage}@${SUPERSKILL_RUNTIME.cliVersion}`, "mcp", "superskill"]
        }
      },
      credentialTransport: "os-keychain-browser-broker",
      tokenStored: false
    };
  return `sha256:${createHash("sha256").update(canonicalJson(contract), "utf8").digest("hex")}`;
}

export function canonicalInstallUrl(capability?: BootstrapCapability): string {
  if (!capability) return `${SUPERSKILL_INSTALL_ORIGIN}${SUPERSKILL_INSTALL_PATH}`;
  assertCapability(capability);
  return `${SUPERSKILL_INSTALL_ORIGIN}${SUPERSKILL_INSTALL_PATH}/${capability.id}/${capability.version}/${capability.artifactDigest.slice("sha256:".length)}`;
}

export async function fetchBootstrapManifest(inputUrl: string, options: {
  fetchImpl?: typeof fetch;
  trustedOrigins?: readonly string[];
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): Promise<SuperSkillBootstrapManifest> {
  const url = validateBootstrapUrl(inputUrl, options.trustedOrigins ?? [SUPERSKILL_INSTALL_ORIGIN]);
  return withNetworkDeadline(options.signal, options.timeoutMs, async (signal) => {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(url, { redirect: "error", signal });
    } catch {
      throw bootstrapError("SuperSkill bootstrap is unavailable.", "BOOTSTRAP_UNAVAILABLE", "Check network access and retry the same pinned URL.");
    }
    assertFinalResponseUrl(response, url, "SuperSkill bootstrap redirected or returned from an unexpected URL.");
    if (!response.ok) {
      const reason = response.status === 404 ? "BOOTSTRAP_NOT_FOUND" : "BOOTSTRAP_UNAVAILABLE";
      throw bootstrapError(`SuperSkill bootstrap returned HTTP ${response.status}.`, reason, "Re-open the exact capability trust page and copy its current install link.");
    }
    let value: unknown;
    try { value = await response.json(); } catch { throw integrityError("SuperSkill bootstrap response is not valid JSON."); }
    return validateBootstrapManifest(value, url);
  }, "BOOTSTRAP_UNAVAILABLE");
}

export async function verifyOfficialPackageIntegrity(manifest: SuperSkillBootstrapManifest, options: {
  fetchImpl?: typeof fetch;
  registryOrigin?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): Promise<VerifiedBootstrapManifest> {
  const registryOrigin = options.registryOrigin ?? "https://registry.npmjs.org";
  let registry: URL;
  try { registry = new URL(registryOrigin); } catch { throw integrityError("Official npm registry origin is invalid."); }
  if (registry.protocol !== "https:" || registry.username || registry.password || registry.search || registry.hash || registry.pathname !== "/") {
    throw integrityError("Official npm registry origin is invalid.");
  }
  const metadataUrl = new URL(`/${manifest.installer.package}/${manifest.installer.version}`, registry);
  return withNetworkDeadline(options.signal, options.timeoutMs, async (signal) => {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(metadataUrl, {
        redirect: "error",
        signal,
        // The abbreviated install-v1 document is supported for package roots,
        // but npm's exact-version endpoint returns 406 for that media type.
        // Request the canonical version document because its dist.integrity is
        // the value bound by the public bootstrap manifest.
        headers: { accept: "application/json" }
      });
    } catch {
      throw integrityError("Official npm package integrity could not be verified.");
    }
    assertFinalResponseUrl(response, metadataUrl, "Official npm metadata redirected or returned from an unexpected URL.");
    if (!response.ok) throw integrityError("Official npm package integrity could not be verified.");
    let metadata: unknown;
    try { metadata = await response.json(); } catch { throw integrityError("Official npm metadata is not valid JSON."); }
    const integrity = metadata && typeof metadata === "object" && "dist" in metadata
      ? (metadata as { dist?: { integrity?: unknown } }).dist?.integrity
      : undefined;
    if (typeof integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity) || integrity !== manifest.installer.integrity) {
      throw integrityError("Bootstrap integrity does not match official npm metadata.");
    }
    return { manifest, officialIntegrity: integrity, verified: true };
  }, "BOOTSTRAP_INTEGRITY_FAILED");
}

export function validateBootstrapManifest(value: unknown, requestedUrl: URL): SuperSkillBootstrapManifest {
  if (!value || typeof value !== "object") throw integrityError("SuperSkill bootstrap manifest is missing.");
  const manifest = value as Partial<SuperSkillBootstrapManifest>;
  if (
    manifest.schemaVersion !== "superskill.bootstrap.v1" ||
    manifest.canonicalUrl !== requestedUrl.toString() ||
    manifest.installer?.package !== "onlyharness" ||
    manifest.installer.version !== SUPERSKILL_RUNTIME.cliVersion ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(manifest.installer.integrity ?? "") ||
    manifest.installer.releaseStatus !== "published" ||
    manifest.universalSkill?.name !== "superskill" ||
    manifest.universalSkill.version !== SUPERSKILL_PLUGIN_VERSION ||
    manifest.universalSkill.artifactDigest !== universalSkillArtifactDigest() ||
    manifest.clientAdapters?.codex?.path !== ".codex/config.toml" ||
    manifest.clientAdapters.codex.contractDigest !== clientAdapterContractDigest("codex") ||
    manifest.clientAdapters?.["claude-code"]?.path !== ".mcp.json" ||
    manifest.clientAdapters["claude-code"].contractDigest !== clientAdapterContractDigest("claude-code") ||
    manifest.activation?.performed !== false ||
    manifest.activation.explicitConsentRequired !== true ||
    !DIGEST_RE.test(manifest.manifestDigest ?? "")
  ) throw integrityError("SuperSkill bootstrap contract does not match this pinned installer.");
  if (manifest.capability !== null) {
    if (!manifest.capability) throw integrityError("SuperSkill bootstrap capability field is missing.");
    assertCapability(manifest.capability);
  }
  const expectedUrl = canonicalInstallUrl(manifest.capability ?? undefined);
  if (manifest.canonicalUrl !== expectedUrl) throw integrityError("SuperSkill bootstrap URL does not match its exact capability tuple.");
  const { manifestDigest, ...body } = manifest as SuperSkillBootstrapManifest;
  if (bootstrapManifestDigest(body) !== manifestDigest) throw integrityError("SuperSkill bootstrap manifest digest does not match.");
  return manifest as SuperSkillBootstrapManifest;
}

export function resolveInstallClients(input: {
  auto?: boolean;
  target?: string;
  all?: boolean;
  env?: NodeJS.ProcessEnv;
  probe?: ClientProbe;
}): SuperSkillClient[] {
  const selectionCount = Number(Boolean(input.auto)) + Number(Boolean(input.target)) + Number(Boolean(input.all));
  if (selectionCount > 1) throw clientError("Choose exactly one of --auto, --target, or --all.", "CLIENT_SELECTION_CONFLICT");
  if (input.target) return [parseInstallClient(input.target)];
  if (input.all) return ["claude-code", "codex"];
  const env = input.env ?? process.env;
  const explicit = env.SUPERSKILL_CLIENT;
  if (explicit) return [parseInstallClient(explicit)];

  const runtime = new Set<SuperSkillClient>();
  if (env.CLAUDECODE === "1" || env.CLAUDE_CODE_ENTRYPOINT) runtime.add("claude-code");
  if (env.CODEX_THREAD_ID || env.CODEX_HOME || env.CODEX_CI === "1") runtime.add("codex");
  if (runtime.size === 1) return [...runtime];
  if (runtime.size > 1) throw ambiguousClient();

  const probe = input.probe ?? binaryClientProbe;
  const available = (["claude-code", "codex"] as const).filter((client) => {
    try { return probe(client); } catch { return false; }
  });
  if (available.length === 1) return available;
  if (available.length > 1) throw ambiguousClient();
  throw clientError("No supported client was detected.", "CLIENT_NOT_DETECTED");
}

type InstallResult = {
  status: "installed" | "unchanged" | "planned";
  clients: SuperSkillClient[];
  targets: string[];
  mcpConfigs: string[];
  handoff: BootstrapCapability | null;
  activationPerformed: false;
  explicitActivationConsentRequired: true;
};

export function installUniversalSkill(input: {
  verifiedBootstrap: VerifiedBootstrapManifest;
  clients: readonly SuperSkillClient[];
  projectDir?: string;
  dryRun?: boolean;
  onBoundary?: (boundary: InstallBoundary) => void;
}): InstallResult {
  try {
    return installUniversalSkillUnsafe(input);
  } catch (error) {
    if (error instanceof SuperSkillCliError) throw error;
    throw installFailure();
  }
}

function installUniversalSkillUnsafe(input: {
  verifiedBootstrap: VerifiedBootstrapManifest;
  clients: readonly SuperSkillClient[];
  projectDir?: string;
  dryRun?: boolean;
  onBoundary?: (boundary: InstallBoundary) => void;
}): InstallResult {
  if (!input.clients.length) throw clientError("No install target was selected.", "CLIENT_NOT_DETECTED");
  const manifest = input.verifiedBootstrap.manifest;
  if (!input.verifiedBootstrap.verified || input.verifiedBootstrap.officialIntegrity !== manifest.installer.integrity) {
    throw integrityError("Official npm package integrity was not verified.");
  }
  const projectRoot = safeProjectRoot(input.projectDir);
  const clients = [...new Set(input.clients)];
  const plans = clients.map((client) => preflightTarget(projectRoot, client));
  const configs = clients.map((client) => preflightMcpConfig(projectRoot, client));
  const handoff = preflightHandoff(projectRoot, manifest.capability);
  if (input.dryRun) return installResult("planned", clients, plans, configs, manifest.capability);
  if (plans.every((plan) => plan.state === "unchanged") && configs.every((plan) => plan.state === "unchanged") && handoff.state === "unchanged") {
    return installResult("unchanged", clients, plans, configs, manifest.capability);
  }

  const installedTargets: string[] = [];
  const installedConfigs: InstalledConfig[] = [];
  const createdParents: string[] = [];
  const staging: string[] = [];
  const lockPath = path.join(projectRoot, ".superskill-install.lock");
  let lockHandle: number | undefined;
  let installedHandoff = false;
  let committed = false;
  try {
    try {
      lockHandle = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(), 0o600);
      fsyncSync(lockHandle);
    } catch {
      throw new SuperSkillCliError("Another SuperSkill install is active or the install lock is unsafe.", 3, "INSTALL_BUSY", "Retry after the other install finishes; do not remove an unfamiliar lock without inspection.");
    }
    input.onBoundary?.("after-lock");
    const lockedPlans = clients.map((client) => preflightTarget(projectRoot, client));
    const lockedConfigs = clients.map((client) => preflightMcpConfig(projectRoot, client));
    const lockedHandoff = preflightHandoff(projectRoot, manifest.capability);
    for (const plan of lockedPlans) {
      if (plan.state === "unchanged") continue;
      ensureSafeParents(projectRoot, path.dirname(plan.absolute), createdParents);
      const stage = path.join(path.dirname(plan.absolute), `.superskill.tmp-${randomBytes(8).toString("hex")}`);
      staging.push(stage);
      mkdirSync(stage, { mode: 0o700 });
      for (const file of UNIVERSAL_SUPERSKILL_FILES) {
        const output = path.join(stage, file.path);
        mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
        writeFileSync(output, file.content, { encoding: "utf8", mode: 0o644, flag: "wx" });
        fsyncPath(output);
      }
      if (digestDirectory(stage) !== manifest.universalSkill.artifactDigest) throw integrityError("Staged universal skill digest does not match.");
      if (existsSync(plan.absolute)) throw targetCollision("Install target appeared after preflight.");
      renameSync(stage, plan.absolute);
      installedTargets.push(plan.absolute);
      staging.splice(staging.indexOf(stage), 1);
      input.onBoundary?.("after-target-rename-before-fsync");
      fsyncDirectory(path.dirname(plan.absolute));
    }
    for (const plan of lockedConfigs) {
      if (plan.state === "unchanged") continue;
      ensureSafeParents(projectRoot, path.dirname(plan.absolute), createdParents);
      const temporary = `${plan.absolute}.tmp-${randomBytes(8).toString("hex")}`;
      staging.push(temporary);
      writeFileSync(temporary, plan.content, { encoding: "utf8", mode: 0o600, flag: "wx" });
      fsyncPath(temporary);
      let backup: string | undefined;
      if (plan.original !== null) {
        backup = `${plan.absolute}.backup-${randomBytes(8).toString("hex")}`;
        linkSync(plan.absolute, backup);
        staging.push(backup);
        renameSync(temporary, plan.absolute);
      } else {
        linkSync(temporary, plan.absolute);
      }
      installedConfigs.push({ plan, backup });
      input.onBoundary?.("after-config-replace-before-fsync");
      fsyncDirectory(path.dirname(plan.absolute));
      safeUnlink(temporary);
      staging.splice(staging.indexOf(temporary), 1);
    }
    if (lockedHandoff.state === "write") {
      ensureSafeParents(projectRoot, path.dirname(lockedHandoff.absolute), createdParents);
      const temporary = `${lockedHandoff.absolute}.tmp-${randomBytes(8).toString("hex")}`;
      staging.push(temporary);
      writeFileSync(temporary, lockedHandoff.content, { encoding: "utf8", mode: 0o600, flag: "wx" });
      fsyncPath(temporary);
      linkSync(temporary, lockedHandoff.absolute);
      installedHandoff = true;
      input.onBoundary?.("after-handoff-link-before-fsync");
      fsyncDirectory(path.dirname(lockedHandoff.absolute));
      unlinkSync(temporary);
      staging.splice(staging.indexOf(temporary), 1);
    }
    committed = true;
    for (const installed of installedConfigs) {
      if (!installed.backup) continue;
      safeUnlink(installed.backup);
      staging.splice(staging.indexOf(installed.backup), 1);
      try { fsyncDirectory(path.dirname(installed.plan.absolute)); } catch { /* installed config is already durable */ }
    }
  } catch (error) {
    if (!committed) {
      if (installedHandoff) safeUnlink(handoff.absolute);
      for (const installed of installedConfigs.reverse()) rollbackConfig(installed);
      for (const target of installedTargets.reverse()) safeRemoveTree(target);
      for (const item of staging) safeRemoveTree(item);
      for (const directory of createdParents.reverse()) {
        try { rmdirSync(directory); } catch { /* parent is not empty or was not ours */ }
      }
    }
    throw error;
  } finally {
    if (lockHandle !== undefined) {
      try { closeSync(lockHandle); } catch { /* cleanup only */ }
      safeUnlink(lockPath);
      try { fsyncDirectory(projectRoot); } catch { /* cleanup durability cannot expose raw paths */ }
    }
  }
  return installResult("installed", clients, plans, configs, manifest.capability);
}

type McpConfigPlan = {
  client: SuperSkillClient;
  absolute: string;
  relative: string;
  state: "write" | "unchanged";
  original: string | null;
  content: string;
};

type InstalledConfig = { plan: McpConfigPlan; backup?: string };

const LOCAL_MCP_ARGS = ["--yes", `${SUPERSKILL_RUNTIME.cliPackage}@${SUPERSKILL_RUNTIME.cliVersion}`, "mcp", "superskill"] as const;
const CLAUDE_PUBLIC_MCP = { type: "http", url: SUPERSKILL_PUBLIC_MCP_URL } as const;
const CLAUDE_LOCAL_MCP = { command: "npx", args: [...LOCAL_MCP_ARGS] } as const;
const CODEX_PUBLIC_MCP = { url: SUPERSKILL_PUBLIC_MCP_URL, default_tools_approval_mode: "prompt" } as const;
const CODEX_LOCAL_MCP = {
  command: "npx",
  args: [...LOCAL_MCP_ARGS],
  default_tools_approval_mode: "prompt"
} as const;

function preflightMcpConfig(projectRoot: string, client: SuperSkillClient): McpConfigPlan {
  return client === "codex" ? preflightCodexMcpConfig(projectRoot) : preflightClaudeMcpConfig(projectRoot);
}

function preflightClaudeMcpConfig(projectRoot: string): McpConfigPlan {
  const relative = ".mcp.json";
  const absolute = path.join(projectRoot, relative);
  assertNoSymlinkPath(projectRoot, absolute);
  const original = readOptionalRegularFile(absolute, relative);
  let parsed: Record<string, unknown> = {};
  if (original !== null) {
    try {
      const value = JSON.parse(original);
      if (!isPlainRecord(value)) throw new Error("invalid");
      parsed = value;
    } catch {
      throw targetCollision("Existing Claude project MCP config is not valid JSON.");
    }
  }
  const currentServers = parsed.mcpServers;
  if (currentServers !== undefined && !isPlainRecord(currentServers)) throw targetCollision("Existing Claude project MCP servers config is invalid.");
  const servers = (currentServers ?? {}) as Record<string, unknown>;
  if (servers.superskill !== undefined && canonicalJson(servers.superskill) !== canonicalJson(CLAUDE_PUBLIC_MCP)) {
    throw targetCollision("Claude project already defines a different superskill MCP server.");
  }
  if (servers.superskill_local !== undefined && canonicalJson(servers.superskill_local) !== canonicalJson(CLAUDE_LOCAL_MCP)) {
    throw targetCollision("Claude project already defines a different superskill_local MCP server.");
  }
  if (servers.superskill !== undefined && servers.superskill_local !== undefined) {
    return { client: "claude-code", absolute, relative, state: "unchanged", original, content: original ?? "" };
  }
  const content = `${JSON.stringify({
    ...parsed,
    mcpServers: { ...servers, superskill: CLAUDE_PUBLIC_MCP, superskill_local: CLAUDE_LOCAL_MCP }
  }, null, 2)}\n`;
  return { client: "claude-code", absolute, relative, state: "write", original, content };
}

function preflightCodexMcpConfig(projectRoot: string): McpConfigPlan {
  const relative = ".codex/config.toml";
  const absolute = path.join(projectRoot, relative);
  assertNoSymlinkPath(projectRoot, absolute);
  const original = readOptionalRegularFile(absolute, relative);
  let parsed: Record<string, unknown> = {};
  if (original !== null) {
    try {
      const value = parseToml(original);
      if (!isPlainRecord(value)) throw new Error("invalid");
      parsed = value;
    } catch {
      throw targetCollision("Existing Codex project config is not valid TOML.");
    }
  }
  const mcpServers = parsed.mcp_servers;
  if (mcpServers !== undefined && !isPlainRecord(mcpServers)) throw targetCollision("Existing Codex MCP servers config is invalid.");
  const publicExisting = isPlainRecord(mcpServers) ? mcpServers.superskill : undefined;
  const localExisting = isPlainRecord(mcpServers) ? mcpServers.superskill_local : undefined;
  if (publicExisting !== undefined && canonicalJson(publicExisting) !== canonicalJson(CODEX_PUBLIC_MCP)) {
    throw targetCollision("Codex project already defines a different superskill MCP server.");
  }
  if (localExisting !== undefined && canonicalJson(localExisting) !== canonicalJson(CODEX_LOCAL_MCP)) {
    throw targetCollision("Codex project already defines a different superskill_local MCP server.");
  }
  if (publicExisting !== undefined && localExisting !== undefined) {
    return { client: "codex", absolute, relative, state: "unchanged", original, content: original ?? "" };
  }
  const blocks: string[] = [];
  if (publicExisting === undefined) {
    blocks.push([
      "[mcp_servers.superskill]",
      `url = ${JSON.stringify(SUPERSKILL_PUBLIC_MCP_URL)}`,
      'default_tools_approval_mode = "prompt"'
    ].join("\n"));
  }
  if (localExisting === undefined) {
    blocks.push([
      "[mcp_servers.superskill_local]",
      'command = "npx"',
      `args = [${LOCAL_MCP_ARGS.map((item) => JSON.stringify(item)).join(", ")}]`,
      'default_tools_approval_mode = "prompt"'
    ].join("\n"));
  }
  const addition = `${blocks.join("\n\n")}\n`;
  const content = original && original.trim() ? `${original.trimEnd()}\n\n${addition}` : addition;
  try { parseToml(content); } catch { throw targetCollision("Codex project MCP config could not be merged safely."); }
  return { client: "codex", absolute, relative, state: "write", original, content };
}

function readOptionalRegularFile(absolute: string, relative: string): string | null {
  if (!existsSync(absolute)) return null;
  if (!lstatSync(absolute).isFile()) throw targetCollision(`Client config is not a regular file: ${relative}`);
  return readFileNoFollow(absolute);
}

function rollbackConfig(installed: InstalledConfig): void {
  const { plan, backup } = installed;
  if (backup) {
    if (!existsSync(backup)) return;
    try {
      renameSync(backup, plan.absolute);
      fsyncDirectory(path.dirname(plan.absolute));
    } catch { /* atomic rename failure preserves the currently installed config */ }
  } else {
    safeUnlink(plan.absolute);
    try { fsyncDirectory(path.dirname(plan.absolute)); } catch { /* rollback durability only */ }
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function withNetworkDeadline<T>(
  externalSignal: AbortSignal | undefined,
  requestedTimeoutMs: number | undefined,
  work: (signal: AbortSignal) => Promise<T>,
  timeoutCode: "BOOTSTRAP_UNAVAILABLE" | "BOOTSTRAP_INTEGRITY_FAILED"
): Promise<T> {
  const timeoutMs = Number.isInteger(requestedTimeoutMs) && requestedTimeoutMs! >= 10 && requestedTimeoutMs! <= 15_000
    ? requestedTimeoutMs!
    : 15_000;
  const timeout = new AbortController();
  let timedOut = false;
  let rejectTimeout: ((error: SuperSkillCliError) => void) | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
  const timer = setTimeout(() => {
    timedOut = true;
    timeout.abort();
    rejectTimeout?.(timeoutCode === "BOOTSTRAP_UNAVAILABLE"
      ? bootstrapError("SuperSkill bootstrap request timed out.", timeoutCode, "Check network access and retry the same pinned URL.")
      : integrityError("Official npm integrity request timed out."));
  }, timeoutMs);
  const signal = externalSignal ? AbortSignal.any([externalSignal, timeout.signal]) : timeout.signal;
  try {
    return await Promise.race([work(signal), timeoutPromise]);
  } catch (error) {
    if (externalSignal?.aborted && !timedOut) {
      throw bootstrapError("SuperSkill bootstrap request was cancelled.", "REQUEST_CANCELLED", "Retry only if the install is still wanted.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function preflightTarget(projectRoot: string, client: SuperSkillClient): { client: SuperSkillClient; absolute: string; relative: string; state: "write" | "unchanged" } {
  const relative = client === "codex" ? ".agents/skills/superskill" : ".claude/skills/superskill";
  const absolute = path.join(projectRoot, relative);
  assertNoSymlinkPath(projectRoot, absolute);
  if (!existsSync(absolute)) return { client, absolute, relative, state: "write" };
  if (!lstatSync(absolute).isDirectory()) throw targetCollision(`Install target is not a directory: ${relative}`);
  const names = listRelativeFiles(absolute);
  const expected = UNIVERSAL_SUPERSKILL_FILES.map((file) => file.path).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected) || digestDirectory(absolute) !== universalSkillArtifactDigest()) {
    throw targetCollision(`Install target already contains different files: ${relative}`);
  }
  return { client, absolute, relative, state: "unchanged" };
}

function preflightHandoff(projectRoot: string, capability: BootstrapCapability | null): { absolute: string; state: "write" | "unchanged"; content: string } {
  const absolute = path.join(projectRoot, ".onlyharness", "superskill-handoff.json");
  const content = capability ? `${canonicalJson({
    schemaVersion: "superskill.handoff.v1",
    status: "pending_explicit_activation_consent",
    capability,
    canonicalUrl: canonicalInstallUrl(capability)
  })}\n` : "";
  assertNoSymlinkPath(projectRoot, absolute);
  if (!capability) return { absolute, state: "unchanged", content };
  if (!existsSync(absolute)) return { absolute, state: "write", content };
  if (!lstatSync(absolute).isFile()) throw targetCollision("Pending SuperSkill handoff is not a regular file.");
  const current = readFileNoFollow(absolute);
  if (current !== content) throw targetCollision("A different pending SuperSkill handoff already exists.");
  return { absolute, state: "unchanged", content };
}

function safeProjectRoot(projectDir?: string): string {
  const requested = path.resolve(projectDir ?? process.cwd());
  if (!existsSync(requested) || !statSync(requested).isDirectory() || lstatSync(requested).isSymbolicLink()) {
    throw targetCollision("Project directory must be an existing non-symlink directory.");
  }
  return realpathSync(requested);
}

function assertNoSymlinkPath(projectRoot: string, target: string): void {
  const relative = path.relative(projectRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw targetCollision("Install path escapes the project root.");
  let current = projectRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!existsSync(current)) continue;
    if (lstatSync(current).isSymbolicLink()) throw targetCollision("Install path contains a symbolic link.");
  }
}

function ensureSafeParents(projectRoot: string, directory: string, created: string[]): void {
  const relative = path.relative(projectRoot, directory);
  let current = projectRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (existsSync(current)) {
      const status = lstatSync(current);
      if (status.isSymbolicLink() || !status.isDirectory()) throw targetCollision("Install parent changed after preflight.");
      continue;
    }
    mkdirSync(current, { mode: 0o700 });
    created.push(current);
  }
}

function digestDirectory(root: string): string {
  return universalSkillArtifactDigest(UNIVERSAL_SUPERSKILL_FILES.map((file) => ({
    path: file.path,
    content: readFileNoFollow(path.join(root, file.path))
  })));
}

function listRelativeFiles(root: string, current = root): string[] {
  const files: string[] = [];
  for (const name of readdirSync(current).sort()) {
    const absolute = path.join(current, name);
    const status = lstatSync(absolute);
    if (status.isSymbolicLink()) throw targetCollision("Installed SuperSkill tree contains a symbolic link.");
    if (status.isDirectory()) files.push(...listRelativeFiles(root, absolute));
    else if (status.isFile()) files.push(path.relative(root, absolute).split(path.sep).join("/"));
    else throw targetCollision("Installed SuperSkill tree contains an unsupported file type.");
  }
  return files.sort();
}

function fsyncPath(file: string): void {
  const handle = openSync(file, constants.O_RDONLY | noFollowFlag());
  try { fsyncSync(handle); } finally { closeSync(handle); }
}

function fsyncDirectory(directory: string): void {
  const handle = openSync(directory, "r");
  try { fsyncSync(handle); } finally { closeSync(handle); }
}

function readFileNoFollow(file: string): string {
  const handle = openSync(file, constants.O_RDONLY | noFollowFlag());
  try {
    if (!fstatSync(handle).isFile()) throw targetCollision("Installed SuperSkill path is not a regular file.");
    return readFileSync(handle, "utf8");
  } finally {
    closeSync(handle);
  }
}

function noFollowFlag(): number {
  return typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
}

function safeRemoveTree(target: string): void {
  try { rmSync(target, { recursive: true, force: true }); } catch { /* cleanup only */ }
}

function safeUnlink(target: string): void {
  try { unlinkSync(target); } catch { /* cleanup only */ }
}

function installResult(status: "installed" | "unchanged" | "planned", clients: SuperSkillClient[], plans: Array<{ relative: string }>, configs: Array<{ relative: string }>, capability: BootstrapCapability | null) {
  return {
    status,
    clients,
    targets: plans.map((plan) => plan.relative),
    mcpConfigs: configs.map((plan) => plan.relative),
    handoff: capability,
    activationPerformed: false as const,
    explicitActivationConsentRequired: true as const
  };
}

function binaryClientProbe(client: SuperSkillClient): boolean {
  const binary = client === "claude-code" ? "claude" : "codex";
  try {
    const result = spawnSync(binary, ["--version"], { stdio: "ignore", timeout: 5_000 });
    return result.status === 0 && !result.error;
  } catch {
    return false;
  }
}

function parseInstallClient(value: string): SuperSkillClient {
  if (value === "claude" || value === "claude-code") return "claude-code";
  if (value === "codex") return "codex";
  throw clientError("Unsupported SuperSkill client.", "CLIENT_UNSUPPORTED");
}

function validateBootstrapUrl(input: string, trustedOrigins: readonly string[]): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw bootstrapError("Invalid SuperSkill install URL.", "BOOTSTRAP_URL_INVALID", "Copy the install URL from superskill.sh."); }
  const exactPath = new RegExp(`^${SUPERSKILL_INSTALL_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/[a-z0-9][a-z0-9-]{0,62}/\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?/[a-f0-9]{64})?$`);
  if (!trustedOrigins.includes(url.origin) || !exactPath.test(url.pathname) || url.username || url.password || url.search || url.hash) {
    throw bootstrapError("Untrusted SuperSkill install URL.", "BOOTSTRAP_URL_INVALID", "Use the canonical HTTPS install URL from superskill.sh without query parameters or credentials.");
  }
  return url;
}

function assertFinalResponseUrl(response: Response, requested: URL, message: string): void {
  let final: URL;
  try { final = new URL(response.url); } catch { throw integrityError(message); }
  if (response.redirected || final.toString() !== requested.toString()) throw integrityError(message);
}

function assertCapability(value: BootstrapCapability): void {
  if (!CAPABILITY_ID_RE.test(value.id) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version) || !DIGEST_RE.test(value.artifactDigest)) {
    throw integrityError("SuperSkill bootstrap contains an invalid exact capability tuple.");
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

function bootstrapError(message: string, reasonCode: string, next: string): SuperSkillCliError {
  return new SuperSkillCliError(message, reasonCode === "BOOTSTRAP_NOT_FOUND" ? 4 : 1, reasonCode, next);
}

function integrityError(message: string): SuperSkillCliError {
  return new SuperSkillCliError(message, 3, "BOOTSTRAP_INTEGRITY_FAILED", "Do not install it. Re-open superskill.sh and copy a fresh exact link.");
}

function targetCollision(message: string): SuperSkillCliError {
  return new SuperSkillCliError(message, 3, "TARGET_COLLISION", "No files were changed. Inspect the existing target and retry in a clean project.");
}

function installFailure(): SuperSkillCliError {
  return new SuperSkillCliError("SuperSkill install failed before it could complete safely.", 1, "INSTALL_FAILED", "No unverified state was retained. Inspect the project targets and retry.");
}

function clientError(message: string, reasonCode: string): SuperSkillCliError {
  const next = reasonCode === "CLIENT_NOT_DETECTED"
    ? "Start the command from Codex or Claude Code, or pass --target codex|claude-code."
    : "Pass --target codex|claude-code, or use --all to install both explicitly.";
  return new SuperSkillCliError(message, 3, reasonCode, next);
}

function ambiguousClient(): SuperSkillCliError {
  return clientError("Both Codex and Claude Code were detected; refusing to guess.", "CLIENT_AMBIGUOUS");
}
