import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult
} from "@modelcontextprotocol/sdk/types.js";
import {
  activationDoctor,
  finishActivation,
  keepActivation,
  markActivation,
  removeActivationById,
  startActivation,
  verifyPinnedPackage
} from "../commands/activation.js";
import { parseClient } from "../commands/recommend.js";
import {
  assertSafePathUnder,
  inspectProjectState,
  readActivation,
  readActivationPlan,
  resolveProjectRoot,
  resolveProjectState
} from "../lib/activation-store.js";
import { readPinnedMarker, scanInventory } from "../lib/client-adapters.js";
import { computeArtifactDigest } from "../lib/artifact.js";
import {
  consumePendingSuperSkillHandoff,
  dismissPendingSuperSkillHandoff,
  readPendingSuperSkillHandoff
} from "../lib/superskill-handoff.js";
import { recommendCapability } from "../lib/superskill-client.js";
import type { ActivationPlan, ActivationRecord, SuperSkillClient } from "../lib/superskill-types.js";
import { SuperSkillCliError } from "../lib/superskill-types.js";

type RegistrySource = () => string;
type JsonObject = Record<string, unknown>;
type ResourceEntry = {
  uri: string;
  projectRoot: string;
  activationId: string;
  relativePath: string;
  purpose: ActivationPlan["files"][number]["purpose"];
  contentDigest: string;
};

const WORKSPACE_ROOT = {
  type: "string",
  minLength: 1,
  maxLength: 4096,
  description: "Explicit local-only absolute path or file:// URI fallback. It is never sent remotely or returned."
} as const;
const CLIENT = { type: "string", enum: ["codex", "claude-code"] } as const;
const ACTIVATION_ID = { type: "string", pattern: "^act_[A-Za-z0-9_-]{8,120}$" } as const;
const TOOL_NAMES = [
  "activation_doctor",
  "recommend",
  "activation_start",
  "activation_mark_loaded",
  "activation_mark_invoked",
  "activation_finish",
  "activation_keep",
  "activation_remove"
] as const;

const tools = [
  {
    name: "activation_doctor",
    description: "Inspect local SuperSkill inventory without creating state or claiming that a detected skill was loaded.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: objectSchema({ client: CLIENT, liveRecheck: { type: "boolean", default: false }, workspaceRoot: WORKSPACE_ROOT }, ["client"])
  },
  {
    name: "recommend",
    description: "Disclose or dismiss a pending exact handoff, or route one supplied privacy-safe summary after explicit consent.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: objectSchema({
      client: CLIENT,
      taskSummary: { type: "string", minLength: 3, maxLength: 500 },
      routingConsent: { const: true },
      pendingHandoffAction: { type: "string", enum: ["disclose", "dismiss"] },
      handoffDismissConsent: { const: true },
      workspaceRoot: WORKSPACE_ROOT
    }, ["client"])
  },
  {
    name: "activation_start",
    description: "Verify and cache one consented exact release. Native client skill roots are not written.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: objectSchema({
      client: CLIENT,
      capabilityId: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,62}$" },
      version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$" },
      artifactDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
      recommendationId: { type: "string", pattern: "^rec_[A-Za-z0-9_-]{8,120}$" },
      decisionDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
      recommendationExpiresAt: { type: "string", format: "date-time" },
      pinnedActivationId: ACTIVATION_ID,
      activationRequestId: { type: "string", pattern: "^req_[A-Za-z0-9_-]{8,120}$" },
      activationConsent: { const: true },
      workspaceRoot: WORKSPACE_ROOT
    }, ["client", "activationRequestId", "activationConsent"])
  },
  lifecycleTool("activation_mark_loaded", "Record ready -> loaded only; disk detection never implies loaded."),
  lifecycleTool("activation_mark_invoked", "Record loaded -> invoked immediately before applying the first verified stage."),
  {
    name: "activation_finish",
    description: "Record an honest outcome after invocation, or a coded load/invocation failure without inventing success.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: objectSchema({
      activationId: ACTIVATION_ID,
      outcome: { type: "string", enum: ["success", "failed", "unknown"] },
      evidence: { type: "string", enum: ["agent_reported", "user_confirmed", "unknown"] },
      failureReason: { type: "string", pattern: "^[A-Z][A-Z0-9_]{2,63}$" },
      workspaceRoot: WORKSPACE_ROOT
    }, ["activationId", "outcome", "evidence"])
  },
  {
    name: "activation_keep",
    description: "After a completed outcome, pin only exact managed files into the target-native skill root with separate consent.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: objectSchema({ activationId: ACTIVATION_ID, keepConsent: { const: true }, workspaceRoot: WORKSPACE_ROOT }, ["activationId", "keepConsent"])
  },
  {
    name: "activation_remove",
    description: "Remove digest-owned managed files by trusted activation record only, with separate consent; changed files are preserved.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: objectSchema({ activationId: ACTIVATION_ID, removeConsent: { const: true }, workspaceRoot: WORKSPACE_ROOT }, ["activationId", "removeConsent"])
  }
];

export function registerSuperSkillMcpCommand(program: Command, registry: RegistrySource): void {
  program.command("mcp")
    .description("run a bundled local MCP server")
    .argument("<server>", "superskill")
    .action(async (name: string) => {
      if (name !== "superskill") {
        throw new SuperSkillCliError("Unsupported local MCP server.", 3, "CLIENT_UNSUPPORTED", "Use onlyharness mcp superskill.");
      }
      await runSuperSkillMcpServer(registry());
    });
}

export async function runSuperSkillMcpServer(registry: string): Promise<void> {
  const resources = new Map<string, ResourceEntry>();
  const server = new Server(
    { name: "superskill-local", version: "0.2.15" },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: "Use explicit routing, activation, keep and remove consent. Read only returned superskill:// activation resources."
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [...resources.values()].map((entry) => ({ uri: entry.uri, name: `Verified ${entry.purpose}`, mimeType: "text/markdown" }))
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const entry = resources.get(request.params.uri);
    if (!entry) throw new Error("RESOURCE_NOT_FOUND");
    try {
      const text = readVerifiedResource(entry);
      return { contents: [{ uri: entry.uri, mimeType: "text/markdown", text }] };
    } catch (error) {
      const code = error instanceof SuperSkillCliError && error.reasonCode === "ACTIVATION_STATE_CORRUPT"
        ? "ACTIVATION_STATE_CORRUPT"
        : error instanceof Error && error.message === "RESOURCE_NOT_FOUND"
          ? "RESOURCE_NOT_FOUND"
          : "ACTIVATION_STATE_CORRUPT";
      throw new Error(code);
    }
  });
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const args = asObject(request.params.arguments);
      const root = await resolveWorkspaceRoot(server, args.workspaceRoot);
      assertSignalActive(extra.signal);
      const value = await callTool(registry, request.params.name, args, root, resources, extra.signal);
      return toolSuccess(value);
    } catch (error) {
      if (!(error instanceof SuperSkillCliError)) process.stderr.write("SUPERSKILL_MCP_INTERNAL_ERROR\n");
      return toolFailure(error);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function callTool(
  registry: string,
  name: string,
  args: JsonObject,
  projectRoot: string,
  resources: Map<string, ResourceEntry>,
  signal: AbortSignal
): Promise<JsonObject> {
  if (!TOOL_NAMES.includes(name as typeof TOOL_NAMES[number])) throw inputError("MCP_TOOL_NOT_FOUND");
  if (name === "activation_doctor") {
    exactKeys(args, ["client", "liveRecheck", "workspaceRoot"], ["client"]);
    const client = requiredClient(args.client);
    const result = await activationDoctor(registry, projectRoot, client, optionalBoolean(args.liveRecheck), signal);
    return {
      ok: true,
      status: result.status,
      code: result.status === "healthy" ? "ACTIVATION_DOCTOR_HEALTHY" : "ACTIVATION_DOCTOR_ATTENTION",
      client,
      plugin: { status: result.plugin.status, plugin: result.plugin.plugin, runtime: result.plugin.runtime },
      inventory: {
        managedSkills: result.inventory.managedSkills,
        unmanagedSkills: result.inventory.unmanagedSkills,
        approxTokens: result.inventory.approxTokens,
        conflicts: result.inventory.conflicts,
        permissionsKnown: result.inventory.permissionsKnown,
        installedManagedRefs: result.inventory.installedManagedRefs,
        duplicates: result.inventory.duplicates,
        legacyCodexHarnesses: result.inventory.legacyCodexHarnesses
      },
      managed: result.managed.map((item) => ({ activationId: item.activationId, capability: item.capability, status: item.status }))
    };
  }
  if (name === "recommend") {
    exactKeys(args, ["client", "taskSummary", "routingConsent", "pendingHandoffAction", "handoffDismissConsent", "workspaceRoot"], ["client"]);
    const client = requiredClient(args.client);
    if (pendingHandoff(projectRoot)) {
      const action = args.pendingHandoffAction === undefined ? "disclose" : enumString(args.pendingHandoffAction, ["disclose", "dismiss"] as const);
      if (action === "dismiss") {
        if (args.handoffDismissConsent !== true) throw consentError("Dismissing the pending exact handoff requires explicit consent.");
        const dismissed = dismissPendingSuperSkillHandoff(projectRoot);
        return { ok: true, status: "dismissed", code: "EXACT_HANDOFF_DISMISSED", capability: dismissed.capability };
      }
      if (args.routingConsent !== true) throw consentError("Online exact handoff recheck requires routing consent.");
      const handoff = await consumePendingSuperSkillHandoff({ registry, projectDir: projectRoot, client, signal });
      return { ok: true, status: "recommend", code: "EXACT_HANDOFF_READY", client, source: handoff.source, recommendation: handoff.recommendation };
    }
    if (args.pendingHandoffAction !== undefined) {
      throw new SuperSkillCliError("Pending exact handoff was not found.", 4, "HANDOFF_NOT_FOUND", "Continue with normal SuperSkill routing or install an exact link first.");
    }
    if (args.routingConsent !== true) throw consentError("Routing consent is required for this exact summary.");
    const taskSummary = requiredString(args.taskSummary);
    const response = await recommendCapability({ registry, task: taskSummary, client, inventory: scanInventory(client, projectRoot), signal });
    const code = response.decision === "recommend" ? "RECOMMENDATION_READY"
      : response.decision === "needs_clarification" ? "RECOMMENDATION_NEEDS_CLARIFICATION"
      : "NO_SAFE_MATCH";
    return { ok: true, status: response.decision, code, client, recommendation: response };
  }
  if (name === "activation_start") {
    exactKeys(args, ["client", "capabilityId", "version", "artifactDigest", "recommendationId", "decisionDigest", "recommendationExpiresAt", "pinnedActivationId", "activationRequestId", "activationConsent", "workspaceRoot"], ["client", "activationRequestId", "activationConsent"]);
    if (args.activationConsent !== true) throw consentError("Activation requires separate explicit consent.");
    const client = requiredClient(args.client);
    const common = {
      registry,
      projectDir: projectRoot,
      activationRequestId: requiredString(args.activationRequestId),
      client,
      mode: "temporary",
      consent: "explicit",
      signal
    };
    let result: { activationId?: unknown; executionState?: unknown; pinState?: unknown; mode?: unknown; client?: unknown; capability?: unknown };
    if (args.pinnedActivationId !== undefined) {
      for (const field of [args.capabilityId, args.version, args.artifactDigest, args.recommendationId, args.decisionDigest, args.recommendationExpiresAt]) {
        if (field !== undefined) throw inputError("MCP_INPUT_INVALID");
      }
      const source = readActivation(resolveProjectState(projectRoot), requiredActivationId(args.pinnedActivationId));
      const marker = source.pinned?.markerPath ?? source.sourceMarkerPath;
      if (source.client !== client || source.pinState !== "pinned" || !marker) throw inputError("ACTIVATION_NOT_FOUND");
      result = await startActivation({ ...common, fromPinned: marker });
    } else {
      result = await startActivation({
        ...common,
        capabilityId: requiredString(args.capabilityId),
        version: requiredString(args.version),
        digest: requiredString(args.artifactDigest),
        recommendationId: requiredString(args.recommendationId),
        decisionDigest: requiredString(args.decisionDigest),
        recommendationExpiresAt: requiredString(args.recommendationExpiresAt)
      });
    }
    const activationId = requiredString(result.activationId);
    const safePlan = exposeVerifiedPlan(projectRoot, activationId, resources);
    return {
      ok: true,
      status: result.executionState,
      code: "ACTIVATION_READY",
      activationId,
      executionState: result.executionState,
      pinState: result.pinState,
      mode: result.mode,
      client: result.client,
      capability: result.capability,
      plan: safePlan
    };
  }
  if (name === "activation_mark_loaded" || name === "activation_mark_invoked") {
    exactKeys(args, ["activationId", "workspaceRoot"], ["activationId"]);
    const activationId = requiredActivationId(args.activationId);
    const state = name === "activation_mark_loaded" ? "loaded" : "invoked";
    const result = await markActivation(registry, projectRoot, activationId, state);
    return { ok: true, status: state, code: state === "loaded" ? "ACTIVATION_LOADED" : "ACTIVATION_INVOKED", ...safeLifecycle(result) };
  }
  if (name === "activation_finish") {
    exactKeys(args, ["activationId", "outcome", "evidence", "failureReason", "workspaceRoot"], ["activationId", "outcome", "evidence"]);
    const activationId = requiredActivationId(args.activationId);
    const outcome = enumString(args.outcome, ["success", "failed", "unknown"]);
    const evidence = enumString(args.evidence, ["agent_reported", "user_confirmed", "unknown"]);
    const state = resolveProjectState(projectRoot);
    const record = readActivation(state, activationId);
    if (record.executionState !== "invoked" && !record.executionState.startsWith("outcome_")) {
      if (outcome === "success") throw inputError("ACTIVATION_INVALID_TRANSITION");
      const reason = requiredFailureReason(args.failureReason);
      const result = await markActivation(registry, projectRoot, activationId, "failed", reason);
      return { ok: true, status: "failed", code: "ACTIVATION_FAILURE_RECORDED", reasonCode: reason, ...safeLifecycle(result) };
    }
    const result = await finishActivation(registry, projectRoot, activationId, outcome, evidence);
    return { ok: true, status: result.executionState, code: "ACTIVATION_OUTCOME_RECORDED", ...safeLifecycle(result), outcome: result.outcome };
  }
  if (name === "activation_keep") {
    exactKeys(args, ["activationId", "keepConsent", "workspaceRoot"], ["activationId", "keepConsent"]);
    if (args.keepConsent !== true) throw consentError("Keeping managed files requires separate explicit consent.");
    const activationId = requiredActivationId(args.activationId);
    const result = await keepActivation(registry, projectRoot, activationId, true, signal);
    return { ok: true, status: "pinned", code: "ACTIVATION_PINNED", activationId, executionState: result.executionState, pinState: result.pinState, client: result.client, managedFileCount: result.managedFiles.length, detectedOnDisk: true, loaded: false };
  }
  exactKeys(args, ["activationId", "removeConsent", "workspaceRoot"], ["activationId", "removeConsent"]);
  if (args.removeConsent !== true) throw consentError("Removing managed files requires separate explicit consent.");
  const activationId = requiredActivationId(args.activationId);
  const result = await removeActivationById(projectRoot, activationId, true);
  return { ok: true, status: "removed", code: "ACTIVATION_REMOVED", activationId, pinState: result.pinState, removedFileCount: result.removedFiles.length, alreadyRemoved: result.alreadyRemoved };
}

function exposeVerifiedPlan(projectRoot: string, activationId: string, resources: Map<string, ResourceEntry>): JsonObject {
  const state = resolveProjectState(projectRoot);
  const record = readActivation(state, activationId);
  const plan = readActivationPlan(state, activationId);
  verifyPlanIntegrity(state.projectRoot, state.stateRoot, record, plan);
  const files = plan.files.map((file, index) => {
    const relativePath = safePlanRelative(file.path);
    const target = path.resolve(plan.root, relativePath);
    assertSafePathUnder(plan.root, target, "activation resource");
    if (!existsSync(target) || lstatSync(target).isSymbolicLink() || !statSync(target).isFile()) throw inputError("ACTIVATION_STATE_CORRUPT");
    const opaque = createHash("sha256").update(`${activationId}\0${index}\0${relativePath}`).digest("hex").slice(0, 32);
    const uri = `superskill://activation/${encodeURIComponent(activationId)}/resource/${opaque}`;
    const verified = readVerifiedUtf8(target);
    resources.set(uri, {
      uri,
      projectRoot: state.projectRoot,
      activationId,
      relativePath,
      purpose: file.purpose,
      contentDigest: verified.digest
    });
    return { path: relativePath, purpose: file.purpose, resourceUri: uri };
  });
  return {
    files,
    stages: plan.stages.map((stage) => ({ id: stage.id, agent: stage.agent, promptPath: safePlanRelative(stage.promptPath) }))
  };
}

function readVerifiedResource(entry: ResourceEntry): string {
  const state = inspectProjectState(entry.projectRoot);
  if (!state) throw new Error("ACTIVATION_STATE_CORRUPT");
  const record = readActivation(state, entry.activationId);
  const plan = readActivationPlan(state, entry.activationId);
  verifyPlanIntegrity(state.projectRoot, state.stateRoot, record, plan);
  if (!plan.files.some((file) => safePlanRelative(file.path) === entry.relativePath)) throw new Error("RESOURCE_NOT_FOUND");
  const target = path.resolve(plan.root, entry.relativePath);
  assertSafePathUnder(plan.root, target, "activation resource");
  if (!existsSync(target) || lstatSync(target).isSymbolicLink() || !statSync(target).isFile()) throw new Error("ACTIVATION_STATE_CORRUPT");
  const verified = readVerifiedUtf8(target);
  if (verified.digest !== entry.contentDigest) throw new Error("ACTIVATION_STATE_CORRUPT");
  return verified.text;
}

function readVerifiedUtf8(file: string): { text: string; digest: string } {
  let handle: number | undefined;
  try {
    handle = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = fstatSync(handle, { bigint: true });
    if (!before.isFile()) throw new Error("ACTIVATION_STATE_CORRUPT");
    const text = readFileSync(handle, "utf8");
    const after = fstatSync(handle, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) throw new Error("ACTIVATION_STATE_CORRUPT");
    return { text, digest: createHash("sha256").update(text, "utf8").digest("hex") };
  } catch {
    throw new Error("ACTIVATION_STATE_CORRUPT");
  } finally {
    if (handle !== undefined) {
      try { closeSync(handle); } catch { /* read-only verification cleanup */ }
    }
  }
}

function verifyPlanIntegrity(projectRoot: string, stateRoot: string, record: ActivationRecord, plan: ActivationPlan): void {
  if (record.mode === "temporary") {
    const expected = path.join(stateRoot, "cache", "sha256", record.capability.artifactDigest.slice("sha256:".length));
    if (path.resolve(plan.root) !== expected) throw inputError("ACTIVATION_STATE_CORRUPT");
    assertSafePathUnder(stateRoot, plan.root, "activation plan");
    verifyTemporaryCache(plan.root, record.capability.artifactDigest, plan);
    return;
  }
  assertSafePathUnder(projectRoot, plan.root, "pinned activation plan");
  const markerRelative = record.sourceMarkerPath ?? record.pinned?.markerPath;
  if (!markerRelative) throw inputError("ACTIVATION_STATE_CORRUPT");
  const markerFile = path.resolve(projectRoot, markerRelative);
  assertSafePathUnder(projectRoot, markerFile, "pinned activation marker");
  if (path.resolve(path.dirname(markerFile)) !== path.resolve(plan.root)) throw inputError("ACTIVATION_STATE_CORRUPT");
  const marker = readPinnedMarker(markerFile, false);
  if (!marker || marker.capabilityId !== record.capability.id || marker.version !== record.capability.version || marker.artifactDigest !== record.capability.artifactDigest) {
    throw inputError("ACTIVATION_STATE_CORRUPT");
  }
  verifyPinnedPackage(plan.root, marker);
}

function verifyTemporaryCache(cacheRoot: string, artifactDigest: string, plan: ActivationPlan): void {
  const markerFile = path.join(cacheRoot, ".superskill-cache.json");
  assertSafePathUnder(cacheRoot, markerFile, "managed cache marker");
  const markerText = readVerifiedUtf8(markerFile).text;
  let marker: { artifactDigest?: unknown; files?: unknown };
  try { marker = JSON.parse(markerText) as { artifactDigest?: unknown; files?: unknown }; } catch { throw inputError("ACTIVATION_STATE_CORRUPT"); }
  if (marker.artifactDigest !== artifactDigest || !Array.isArray(marker.files) || marker.files.some((file) => typeof file !== "string")) {
    throw inputError("ACTIVATION_STATE_CORRUPT");
  }
  const files = (marker.files as string[]).map(safePlanRelative);
  if (new Set(files).size !== files.length) throw inputError("ACTIVATION_STATE_CORRUPT");
  const listed = listCacheFiles(cacheRoot);
  const expected = [...files, ".superskill-cache.json"].sort();
  if (JSON.stringify(listed) !== JSON.stringify(expected)) throw inputError("ACTIVATION_STATE_CORRUPT");
  if (plan.files.some((file) => !files.includes(safePlanRelative(file.path)))) throw inputError("ACTIVATION_STATE_CORRUPT");
  const actual = files.map((relative) => {
    const target = path.resolve(cacheRoot, relative);
    assertSafePathUnder(cacheRoot, target, "managed cache file");
    return { path: relative, content: readVerifiedUtf8(target).text };
  });
  if (computeArtifactDigest(actual) !== artifactDigest) throw inputError("ACTIVATION_STATE_CORRUPT");
}

function listCacheFiles(root: string, current = root): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const target = path.join(current, entry.name);
    assertSafePathUnder(root, target, "managed cache entry");
    if (entry.isSymbolicLink()) throw inputError("ACTIVATION_STATE_CORRUPT");
    if (entry.isDirectory()) result.push(...listCacheFiles(root, target));
    else if (entry.isFile()) result.push(path.relative(root, target).split(path.sep).join("/"));
    else throw inputError("ACTIVATION_STATE_CORRUPT");
  }
  return result.sort();
}

async function resolveWorkspaceRoot(server: Server, explicit: unknown): Promise<string> {
  let roots: Array<{ uri: string }> = [];
  try {
    roots = (await server.listRoots({}, { timeout: 1_500 })).roots;
  } catch {
    roots = [];
  }
  const clientRoot = roots.length === 1 ? canonicalFileRoot(roots[0]?.uri) : undefined;
  const explicitRoot = explicit === undefined ? undefined : canonicalExplicitRoot(requiredString(explicit));
  if (clientRoot && explicitRoot && clientRoot !== explicitRoot) throw inputError("WORKSPACE_ROOT_MISMATCH");
  if (clientRoot) return clientRoot;
  if (explicitRoot) return explicitRoot;
  throw new SuperSkillCliError("Exactly one local workspace root is required.", 3, "WORKSPACE_ROOT_REQUIRED", "Expose one file:// MCP root or pass an explicit local-only workspaceRoot.");
}

function canonicalFileRoot(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:" || url.search || url.hash || url.username || url.password) return undefined;
    return canonicalDirectory(fileURLToPath(url));
  } catch {
    return undefined;
  }
}

function canonicalExplicitRoot(value: string): string {
  if (value.includes("\0")) throw inputError("WORKSPACE_ROOT_INVALID");
  if (value.startsWith("file:")) {
    const root = canonicalFileRoot(value);
    if (!root) throw inputError("WORKSPACE_ROOT_INVALID");
    return root;
  }
  if (!path.isAbsolute(value)) throw inputError("WORKSPACE_ROOT_INVALID");
  return canonicalDirectory(value);
}

function canonicalDirectory(value: string): string {
  if (!existsSync(value) || !statSync(value).isDirectory()) throw inputError("WORKSPACE_ROOT_INVALID");
  return resolveProjectRoot(realpathSync(value));
}

function toolSuccess(value: JsonObject): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function toolFailure(error: unknown): CallToolResult {
  const code = error instanceof SuperSkillCliError && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.reasonCode)
    ? error.reasonCode
    : "SUPERSKILL_MCP_INTERNAL_ERROR";
  const value = { ok: false, status: "error", code, next: safeNext(code) };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function safeNext(code: string): string {
  if (code === "WORKSPACE_ROOT_REQUIRED" || code === "WORKSPACE_ROOT_INVALID" || code === "WORKSPACE_ROOT_MISMATCH") return "Expose exactly one file:// root or pass one matching absolute local-only workspaceRoot.";
  if (code === "CONSENT_REQUIRED" || code === "CONSENT_STALE") return "Show the exact disclosure and obtain the separate required consent before retrying.";
  if (code === "SUPERSKILL_AUTH_REQUIRED" || code === "INTERNAL_ALPHA_DENIED") return "Provide the inherited managed credential outside tool arguments; never print or store it.";
  if (code === "MANAGED_FILE_CHANGED") return "No further files were changed. Review the managed pin manually.";
  if (code === "REQUEST_CANCELLED") return "No managed network result was accepted. Retry with fresh consent if the task is still wanted.";
  if (code === "REQUEST_TIMEOUT") return "No managed network result was accepted. Check service health and retry the same request ID.";
  if (code === "CAPABILITY_REVOKED" || code === "CAPABILITY_QUARANTINED" || code === "PERMISSION_BLOCKED") return "Do not activate this release; request a fresh approved recommendation.";
  if (code === "ACTIVATION_NOT_FOUND") return "Use an activation ID returned by this local managed lifecycle.";
  if (code === "ACTIVATION_INVALID_TRANSITION") return "Use ready -> loaded -> invoked -> outcome without skipping state.";
  if (code === "ARTIFACT_DIGEST_MISMATCH" || code === "ARTIFACT_NOT_IMMUTABLE") return "Do not use the artifact; request a fresh exact recommendation.";
  if (code === "MCP_INPUT_INVALID" || code === "MCP_TOOL_NOT_FOUND") return "Refresh tools/list and send only fields declared by the selected tool schema.";
  return "Retry only after checking the local SuperSkill lifecycle and managed service status.";
}

function pendingHandoff(projectRoot: string): boolean {
  try {
    readPendingSuperSkillHandoff(projectRoot);
    return true;
  } catch (error) {
    if (error instanceof SuperSkillCliError && error.reasonCode === "HANDOFF_NOT_FOUND") return false;
    throw error;
  }
}

function assertSignalActive(signal: AbortSignal): void {
  if (signal.aborted) throw new SuperSkillCliError("SuperSkill request was cancelled.", 3, "REQUEST_CANCELLED", "No local activation state was created.");
}

function lifecycleTool(name: string, description: string): JsonObject {
  return {
    name,
    description,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: objectSchema({ activationId: ACTIVATION_ID, workspaceRoot: WORKSPACE_ROOT }, ["activationId"])
  };
}

function objectSchema(properties: JsonObject, required: string[]): JsonObject {
  return { type: "object", properties, required, additionalProperties: false };
}

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw inputError("MCP_INPUT_INVALID");
  return value as JsonObject;
}

function exactKeys(value: JsonObject, allowed: string[], required: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !(key in value))) throw inputError("MCP_INPUT_INVALID");
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value) throw inputError("MCP_INPUT_INVALID");
  return value;
}

function requiredActivationId(value: unknown): string {
  const id = requiredString(value);
  if (!/^act_[A-Za-z0-9_-]{8,120}$/.test(id)) throw inputError("ACTIVATION_NOT_FOUND");
  return id;
}

function requiredClient(value: unknown): SuperSkillClient {
  return parseClient(requiredString(value));
}

function optionalBoolean(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw inputError("MCP_INPUT_INVALID");
  return value;
}

function enumString<T extends string>(value: unknown, allowed: readonly T[]): T {
  const text = requiredString(value);
  if (!allowed.includes(text as T)) throw inputError("MCP_INPUT_INVALID");
  return text as T;
}

function requiredFailureReason(value: unknown): string {
  const reason = requiredString(value);
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(reason)) throw inputError("MCP_INPUT_INVALID");
  return reason;
}

function safePlanRelative(value: string): string {
  if (!value || value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value) || value.normalize("NFC") !== value || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw inputError("ACTIVATION_STATE_CORRUPT");
  }
  return value;
}

function safeLifecycle(value: Record<string, unknown>): JsonObject {
  return {
    activationId: value.activationId,
    executionState: value.executionState,
    pinState: value.pinState,
    client: value.client,
    capability: value.capability
  };
}

function consentError(message: string): SuperSkillCliError {
  return new SuperSkillCliError(message, 3, "CONSENT_REQUIRED", "Obtain the separate explicit consent and retry the same exact decision.");
}

function inputError(code: string): SuperSkillCliError {
  return new SuperSkillCliError("Local MCP request is invalid.", 3, code, "Review tools/list and retry without additional fields.");
}
