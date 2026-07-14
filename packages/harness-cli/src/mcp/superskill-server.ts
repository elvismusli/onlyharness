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
import { agentAuth, AGENT_AUTH_SCOPES, type AgentAuthClient, type AgentAuthScope } from "../lib/agent-auth.js";
import {
  consumePendingSuperSkillHandoff,
  dismissPendingSuperSkillHandoff,
  readPendingSuperSkillHandoff
} from "../lib/superskill-handoff.js";
import { recommendCapability, setSuperSkillAgentAccessToken } from "../lib/superskill-client.js";
import { installWorkspaceSetup } from "../lib/workspace-install.js";
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
type PendingProtectedInvocation = {
  name: string;
  args: JsonObject;
  projectRoot: string;
  scopes: AgentAuthScope[];
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
  "auth_status",
  "auth_start",
  "auth_wait",
  "auth_logout",
  "activation_doctor",
  "recommend",
  "activation_start",
  "activation_mark_loaded",
  "activation_mark_invoked",
  "activation_finish",
  "activation_keep",
  "activation_remove",
  "publish_markdown_to_harness",
  "publish_resource_package",
  "workspace_create",
  "workspace_get",
  "workspace_publish_resource",
  "workspace_install"
] as const;

const AUTH_SCOPES = { type: "array", minItems: 1, maxItems: 4, uniqueItems: true, items: { type: "string", enum: [...AGENT_AUTH_SCOPES] } } as const;
const IDEMPOTENCY_KEY = { type: "string", minLength: 16, maxLength: 200, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]+$" } as const;
const WORKSPACE_SLUG = { type: "string", pattern: "^[a-z][a-z0-9_-]{1,62}$" } as const;
const RESOURCE_FILES = {
  type: "array",
  minItems: 1,
  maxItems: 120,
  items: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1, maxLength: 500 },
      content: { type: "string", maxLength: 2_000_000 },
      truncated: { type: "boolean" }
    },
    required: ["path", "content"],
    additionalProperties: false
  }
} as const;

const tools = [
  {
    name: "auth_status",
    description: "Check the local renewable SuperSkill session without returning credentials.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: objectSchema({ client: CLIENT }, ["client"])
  },
  {
    name: "auth_start",
    description: "Open browser authorization for exact scopes. Device and browser proofs never enter the tool result.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: objectSchema({ client: CLIENT, scopes: AUTH_SCOPES }, ["client", "scopes"])
  },
  {
    name: "auth_wait",
    description: "Wait up to 45 seconds for browser authorization, then automatically replay the one pending protected operation exactly once with its original arguments and idempotency key.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: objectSchema({ client: CLIENT, maxWaitSeconds: { type: "integer", minimum: 1, maximum: 45, default: 45 } }, ["client"])
  },
  {
    name: "auth_logout",
    description: "Revoke the renewable SuperSkill session and clear its OS keychain entry.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: objectSchema({ client: CLIENT }, ["client"])
  },
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
  },
  {
    name: "publish_markdown_to_harness",
    description: "Publish markdown as an unverified public harness. Requires resources:publish and a stable idempotency key.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: objectSchema({
      client: CLIENT,
      name: { type: "string", minLength: 2, maxLength: 80 },
      markdown: { type: "string", minLength: 20, maxLength: 1_000_000 },
      idempotencyKey: IDEMPOTENCY_KEY
    }, ["client", "markdown", "idempotencyKey"])
  },
  {
    name: "publish_resource_package",
    description: "Publish one immutable public agent-resource release. Requires resources:publish; the original idempotency key is reused after browser authorization.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: objectSchema({
      client: CLIENT,
      name: { type: "string", minLength: 2, maxLength: 80 },
      version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$" },
      idempotencyKey: IDEMPOTENCY_KEY,
      title: { type: "string", maxLength: 160 },
      summary: { type: "string", maxLength: 1000 },
      resourceType: { type: "string", maxLength: 80 },
      sourceUrl: { type: "string", format: "uri" },
      worksWith: { type: "array", maxItems: 12, items: { type: "string", maxLength: 80 } },
      tags: { type: "array", maxItems: 20, items: { type: "string", maxLength: 80 } },
      files: RESOURCE_FILES
    }, ["client", "version", "idempotencyKey", "files"])
  },
  {
    name: "workspace_create",
    description: "Create or idempotently replay a private/invite-only workspace. Requires workspaces:write; scope never replaces current membership or role checks.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: objectSchema({
      client: CLIENT,
      slug: WORKSPACE_SLUG,
      name: { type: "string", minLength: 1, maxLength: 120 },
      type: { type: "string", enum: ["company", "community", "team", "course", "agency", "chat"] },
      visibility: { type: "string", enum: ["private", "invite_only"] },
      description: { type: "string", maxLength: 500 },
      idempotencyKey: IDEMPOTENCY_KEY
    }, ["client", "slug", "name", "idempotencyKey"])
  },
  {
    name: "workspace_get",
    description: "Read one workspace catalog. Requires workspaces:read plus current active membership.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: objectSchema({ client: CLIENT, workspace: WORKSPACE_SLUG, query: { type: "string", maxLength: 200 } }, ["client", "workspace"])
  },
  {
    name: "workspace_publish_resource",
    description: "Publish a private hosted resource package. Requires workspaces:write plus resources:publish, current membership and an authorized workspace role.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: objectSchema({
      client: CLIENT,
      workspace: WORKSPACE_SLUG,
      name: { type: "string", minLength: 2, maxLength: 80 },
      title: { type: "string", maxLength: 160 },
      summary: { type: "string", maxLength: 1000 },
      resourceType: { type: "string", maxLength: 80 },
      sourceUrl: { type: "string", format: "uri" },
      files: RESOURCE_FILES,
      idempotencyKey: IDEMPOTENCY_KEY
    }, ["client", "workspace", "name", "files", "idempotencyKey"])
  },
  {
    name: "workspace_install",
    description: "Atomically install a workspace setup bundle under the local project after explicit install consent.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: objectSchema({
      client: CLIENT,
      workspace: WORKSPACE_SLUG,
      target: { type: "string", enum: ["cli", "claude-code", "codex", "cursor", "mcp"] },
      installConsent: { const: true },
      workspaceRoot: WORKSPACE_ROOT
    }, ["client", "workspace", "target", "installConsent"])
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
  const pendingInvocations = new Map<AgentAuthClient, PendingProtectedInvocation>();
  const server = new Server(
    { name: "superskill-local", version: "0.3.1" },
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
    let args: JsonObject | undefined;
    let root = "";
    try {
      args = asObject(request.params.arguments);
      root = toolNeedsWorkspaceRoot(request.params.name)
        ? await resolveWorkspaceRoot(server, args.workspaceRoot)
        : "";
      assertSignalActive(extra.signal);
      const value = await callTool(registry, request.params.name, args, root, resources, pendingInvocations, extra.signal);
      return toolSuccess(value);
    } catch (error) {
      if (args && isAgentAuthorizationError(error)) {
        const scopes = protectedOperationScopes(request.params.name);
        if (scopes) {
          const client = requiredAgentClient(args.client);
          pendingInvocations.set(client, {
            name: request.params.name,
            args: JSON.parse(JSON.stringify(args)) as JsonObject,
            projectRoot: root,
            scopes
          });
        }
      }
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
  pendingInvocations: Map<AgentAuthClient, PendingProtectedInvocation>,
  signal: AbortSignal
): Promise<JsonObject> {
  if (!TOOL_NAMES.includes(name as typeof TOOL_NAMES[number])) throw inputError("MCP_TOOL_NOT_FOUND");
  if (name === "auth_status") {
    exactKeys(args, ["client"], ["client"]);
    const client = requiredAgentClient(args.client);
    const result = await agentAuth.status(
      { registry, client },
      { reloadCredential: pendingInvocations.has(client) }
    );
    const pending = pendingInvocations.get(client);
    const readyToResume = result.status !== "signed_out"
      && pending !== undefined
      && pending.scopes.every((scope) => result.scopes.includes(scope));
    return {
      ok: true,
      ...result,
      ...(readyToResume ? { next: "External authorization is available. Call auth_wait once; it will replay the exact pending operation." } : {})
    };
  }
  if (name === "auth_start") {
    exactKeys(args, ["client", "scopes"], ["client", "scopes"]);
    const client = requiredAgentClient(args.client);
    const scopes = requiredScopes(args.scopes);
    const pending = pendingInvocations.get(client);
    if (pending && JSON.stringify(scopes) !== JSON.stringify(pending.scopes)) {
      throw new SuperSkillCliError("Authorization scopes do not match the pending operation.", 3, "AUTH_SCOPE_MISMATCH", "Request only the exact scopes declared for the pending tool.");
    }
    const result = await agentAuth.start({
      registry,
      client,
      scopes,
      openBrowser: true
    });
    if (!result.browserOpened) {
      throw new SuperSkillCliError("The browser could not be opened.", 1, "AUTH_BROWSER_UNAVAILABLE", "Run hh auth login --no-browser in a trusted terminal. No credential was returned to the agent.");
    }
    const { manualUrl: _secretUrl, ...safe } = result;
    return { ok: true, ...safe, next: "Call auth_wait. It will automatically replay the pending protected operation exactly once." };
  }
  if (name === "auth_wait") {
    exactKeys(args, ["client", "maxWaitSeconds"], ["client"]);
    const client = requiredAgentClient(args.client);
    const seconds = optionalWaitSeconds(args.maxWaitSeconds);
    const result = await agentAuth.wait({ registry, client, maxWaitMs: seconds * 1_000 });
    if (result.status === "authorized") {
      const continuation = await continuePendingProtectedOperation(registry, client, result.scopes, resources, pendingInvocations, signal);
      if (continuation) {
        return {
          ok: true,
          ...result,
          continuation,
          next: "The original protected operation completed automatically. Do not submit it again."
        };
      }
      const token = await agentAuth.accessToken({ registry, client, scopes: result.scopes });
      setSuperSkillAgentAccessToken(token);
    }
    if (result.status === "denied" || result.status === "expired") pendingInvocations.delete(client);
    return {
      ok: result.status === "authorized" || result.status === "pending",
      ...result,
      next: result.status === "authorized"
        ? "Authorization completed. There was no pending operation to replay."
        : result.status === "pending"
          ? "Call auth_wait again; do not restart the agent task."
          : "Do not retry the protected action until the user starts a new authorization."
    };
  }
  if (name === "auth_logout") {
    exactKeys(args, ["client"], ["client"]);
    const client = requiredAgentClient(args.client);
    const result = await agentAuth.logout({ registry, client });
    pendingInvocations.delete(client);
    setSuperSkillAgentAccessToken(undefined);
    return { ok: true, ...result };
  }
  if (name === "activation_doctor") {
    exactKeys(args, ["client", "liveRecheck", "workspaceRoot"], ["client"]);
    const client = requiredClient(args.client);
    if (optionalBoolean(args.liveRecheck)) await authorizeTool(registry, client, ["superskill:managed"]);
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
      await authorizeTool(registry, client, ["superskill:managed"]);
      const handoff = await consumePendingSuperSkillHandoff({ registry, projectDir: projectRoot, client, signal });
      return { ok: true, status: "recommend", code: "EXACT_HANDOFF_READY", client, source: handoff.source, recommendation: handoff.recommendation };
    }
    if (args.pendingHandoffAction !== undefined) {
      throw new SuperSkillCliError("Pending exact handoff was not found.", 4, "HANDOFF_NOT_FOUND", "Continue with normal SuperSkill routing or install an exact link first.");
    }
    if (args.routingConsent !== true) throw consentError("Routing consent is required for this exact summary.");
    const taskSummary = requiredString(args.taskSummary);
    await authorizeTool(registry, client, ["superskill:managed"]);
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
    await authorizeTool(registry, client, ["superskill:managed"]);
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
    const source = readActivation(resolveProjectState(projectRoot), activationId);
    await authorizeTool(registry, source.client, ["superskill:managed"]);
    const result = await keepActivation(registry, projectRoot, activationId, true, signal);
    return { ok: true, status: "pinned", code: "ACTIVATION_PINNED", activationId, executionState: result.executionState, pinState: result.pinState, client: result.client, managedFileCount: result.managedFiles.length, detectedOnDisk: true, loaded: false };
  }
  if (name === "activation_remove") {
    exactKeys(args, ["activationId", "removeConsent", "workspaceRoot"], ["activationId", "removeConsent"]);
    if (args.removeConsent !== true) throw consentError("Removing managed files requires separate explicit consent.");
    const activationId = requiredActivationId(args.activationId);
    const result = await removeActivationById(projectRoot, activationId, true);
    return { ok: true, status: "removed", code: "ACTIVATION_REMOVED", activationId, pinState: result.pinState, removedFileCount: result.removedFiles.length, alreadyRemoved: result.alreadyRemoved };
  }
  return protectedAccountTool(registry, name, args, projectRoot, signal);
}

async function protectedAccountTool(registry: string, name: string, args: JsonObject, projectRoot: string, signal: AbortSignal): Promise<JsonObject> {
  if (name === "publish_markdown_to_harness") {
    exactKeys(args, ["client", "name", "markdown", "idempotencyKey"], ["client", "markdown", "idempotencyKey"]);
    const client = requiredAgentClient(args.client);
    const token = await authorizeTool(registry, client, ["resources:publish"]);
    const result = await authenticatedJson(registry, "/imports/markdown-to-harness", token, {
      method: "POST",
      body: { name: optionalString(args.name), markdown: requiredString(args.markdown) },
      idempotencyKey: requiredIdempotencyKey(args.idempotencyKey),
      signal
    });
    return { ok: true, status: "published", code: "MARKDOWN_PUBLISHED", result };
  }
  if (name === "publish_resource_package") {
    exactKeys(args, ["client", "name", "version", "idempotencyKey", "title", "summary", "resourceType", "sourceUrl", "worksWith", "tags", "files"], ["client", "version", "idempotencyKey", "files"]);
    const client = requiredAgentClient(args.client);
    const idempotencyKey = requiredIdempotencyKey(args.idempotencyKey);
    const token = await authorizeTool(registry, client, ["resources:publish"]);
    const result = await authenticatedJson(registry, "/imports/resource-package", token, {
      method: "POST",
      body: {
        name: optionalString(args.name),
        version: requiredString(args.version),
        idempotencyKey,
        title: optionalString(args.title),
        summary: optionalString(args.summary),
        resourceType: optionalString(args.resourceType),
        sourceUrl: optionalString(args.sourceUrl),
        worksWith: optionalStringArray(args.worksWith),
        tags: optionalStringArray(args.tags),
        files: requiredFiles(args.files)
      },
      idempotencyKey,
      signal
    });
    return { ok: true, status: "published", code: "RESOURCE_RELEASE_PUBLISHED", result };
  }
  if (name === "workspace_create") {
    exactKeys(args, ["client", "slug", "name", "type", "visibility", "description", "idempotencyKey"], ["client", "slug", "name", "idempotencyKey"]);
    const client = requiredAgentClient(args.client);
    const idempotencyKey = requiredIdempotencyKey(args.idempotencyKey);
    const token = await authorizeTool(registry, client, ["workspaces:write"]);
    const result = await authenticatedJson(registry, "/workspaces", token, {
      method: "POST",
      body: {
        slug: requiredWorkspaceSlug(args.slug),
        name: requiredString(args.name),
        type: optionalString(args.type),
        visibility: optionalString(args.visibility),
        description: optionalString(args.description)
      },
      idempotencyKey,
      signal
    });
    return { ok: true, status: "ready", code: "WORKSPACE_READY", result };
  }
  if (name === "workspace_get") {
    exactKeys(args, ["client", "workspace", "query"], ["client", "workspace"]);
    const client = requiredAgentClient(args.client);
    const token = await authorizeTool(registry, client, ["workspaces:read"]);
    const slug = requiredWorkspaceSlug(args.workspace);
    const query = optionalString(args.query);
    const route = `/workspaces/${encodeURIComponent(slug)}/workspace${query ? `?q=${encodeURIComponent(query)}` : ""}`;
    const result = await authenticatedJson(registry, route, token, { method: "GET", signal });
    return { ok: true, status: "ready", code: "WORKSPACE_READY", result };
  }
  if (name === "workspace_publish_resource") {
    exactKeys(args, ["client", "workspace", "name", "title", "summary", "resourceType", "sourceUrl", "files", "idempotencyKey"], ["client", "workspace", "name", "files", "idempotencyKey"]);
    const client = requiredAgentClient(args.client);
    const idempotencyKey = requiredIdempotencyKey(args.idempotencyKey);
    const token = await authorizeTool(registry, client, ["workspaces:write", "resources:publish"]);
    const slug = requiredWorkspaceSlug(args.workspace);
    const result = await authenticatedJson(registry, `/workspaces/${encodeURIComponent(slug)}/imports/resource-package`, token, {
      method: "POST",
      body: {
        name: requiredString(args.name),
        title: optionalString(args.title),
        summary: optionalString(args.summary),
        resourceType: optionalString(args.resourceType),
        sourceUrl: optionalString(args.sourceUrl),
        files: requiredFiles(args.files)
      },
      idempotencyKey,
      signal
    });
    return { ok: true, status: "published", code: "WORKSPACE_RESOURCE_PUBLISHED", result };
  }
  if (name === "workspace_install") {
    exactKeys(args, ["client", "workspace", "target", "installConsent", "workspaceRoot"], ["client", "workspace", "target", "installConsent"]);
    if (args.installConsent !== true) throw consentError("Workspace setup requires explicit install consent.");
    const client = requiredAgentClient(args.client);
    const token = await authorizeTool(registry, client, ["workspaces:read"]);
    const slug = requiredWorkspaceSlug(args.workspace);
    const target = enumString(args.target, ["cli", "claude-code", "codex", "cursor", "mcp"] as const);
    const result = await installWorkspaceSetup({ registry, workspace: slug, target, token, projectRoot, signal });
    return { ok: true, ...result };
  }
  throw inputError("MCP_TOOL_NOT_FOUND");
}

async function authorizeTool(registry: string, client: AgentAuthClient, scopes: readonly AgentAuthScope[]): Promise<string> {
  try {
    const token = await agentAuth.accessToken({ registry, client, scopes });
    setSuperSkillAgentAccessToken(token);
    return token;
  } catch (error) {
    // One transitional release accepts the old device bearer only when the
    // operator explicitly enables the hidden compatibility flag. New plugin
    // installs do not inherit this environment variable.
    if (
      error instanceof SuperSkillCliError
      && error.reasonCode === "SUPERSKILL_AUTH_REQUIRED"
      && process.env.SUPERSKILL_DEVICE_AUTH_ENABLED === "1"
      && process.env.HH_TOKEN
    ) {
      return process.env.HH_TOKEN;
    }
    throw error;
  }
}

async function continuePendingProtectedOperation(
  registry: string,
  client: AgentAuthClient,
  authorizedScopes: readonly AgentAuthScope[],
  resources: Map<string, ResourceEntry>,
  pendingInvocations: Map<AgentAuthClient, PendingProtectedInvocation>,
  signal: AbortSignal
): Promise<{ tool: string; result: JsonObject } | undefined> {
  const pending = pendingInvocations.get(client);
  if (!pending || !pending.scopes.every((scope) => authorizedScopes.includes(scope))) return undefined;
  const token = await agentAuth.accessToken({ registry, client, scopes: pending.scopes });
  setSuperSkillAgentAccessToken(token);
  // Delete before the replay so a mutation is attempted at most once. Its
  // original idempotency key remains byte-for-byte unchanged in pending.args.
  pendingInvocations.delete(client);
  const result = await callTool(registry, pending.name, pending.args, pending.projectRoot, resources, pendingInvocations, signal);
  return { tool: pending.name, result };
}

async function authenticatedJson(
  registryValue: string,
  route: string,
  token: string,
  input: { method: "GET" | "POST"; body?: JsonObject; idempotencyKey?: string; signal: AbortSignal }
): Promise<JsonObject> {
  const base = trustedRegistry(registryValue);
  const expected = new URL(`${base.pathname.replace(/\/$/, "")}${route}`, base.origin);
  const response = await fetch(expected, {
    method: input.method,
    redirect: "error",
    signal: input.signal,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      ...(input.body ? { "content-type": "application/json" } : {}),
      ...(input.idempotencyKey ? { "idempotency-key": input.idempotencyKey } : {})
    },
    ...(input.body ? { body: JSON.stringify(withoutUndefined(input.body)) } : {})
  }).catch((error) => {
    if (input.signal.aborted) throw new SuperSkillCliError("SuperSkill request was cancelled.", 3, "REQUEST_CANCELLED", "Retry the unchanged operation only if it is still wanted.");
    throw new SuperSkillCliError(`SuperSkill request failed: ${safeNetworkMessage(error)}.`, 1, "NETWORK_FAILED", "Check service health and retry the unchanged operation.");
  });
  if (response.redirected || (response.url && response.url !== expected.toString())) {
    throw new SuperSkillCliError("SuperSkill response changed origin or route.", 3, "REGISTRY_ORIGIN_UNTRUSTED", "Use only the canonical SuperSkill registry.");
  }
  let body: unknown;
  try { body = await response.json() as unknown; } catch { body = {}; }
  if (!response.ok) {
    const payload = body && typeof body === "object" && !Array.isArray(body) ? body as { error?: unknown; code?: unknown; reasonCode?: unknown; next?: unknown } : {};
    const code = typeof payload.reasonCode === "string" ? payload.reasonCode
      : typeof payload.code === "string" ? payload.code
        : response.status === 401 ? "SUPERSKILL_AUTH_REQUIRED"
          : response.status === 403 ? "FORBIDDEN"
            : response.status === 404 ? "RESOURCE_NOT_FOUND"
              : "SUPERSKILL_REQUEST_FAILED";
    throw new SuperSkillCliError(
      typeof payload.error === "string" ? payload.error.slice(0, 300) : `SuperSkill request failed (${response.status}).`,
      response.status === 401 || response.status === 403 ? 2 : response.status === 404 ? 4 : response.status >= 500 ? 1 : 3,
      /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : "SUPERSKILL_REQUEST_FAILED",
      typeof payload.next === "string" ? payload.next.slice(0, 300) : "Retry only after checking the exact authorization or request error."
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { value: body ?? null };
  return body as JsonObject;
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
  if (code === "SUPERSKILL_AUTH_REQUIRED" || code === "SUPERSKILL_AUTH_INVALID" || code === "AUTH_SCOPE_REQUIRED") return "Call auth_start with the exact operation scopes, then auth_wait; the broker will replay the pending operation once.";
  if (code === "AUTH_SCOPE_MISMATCH") return "Use the exact scope set declared for the pending protected tool; do not request broader access.";
  if (code === "AUTH_BROWSER_UNAVAILABLE") return "Run hh auth login --no-browser in a trusted terminal with the same client and exact pending scopes, then call auth_wait. The protected operation remains pending locally.";
  if (code === "INTERNAL_ALPHA_DENIED") return "Use a confirmed SuperSkill account with an active managed-access grant.";
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

function isAgentAuthorizationError(error: unknown): boolean {
  return error instanceof SuperSkillCliError
    && (error.reasonCode === "SUPERSKILL_AUTH_REQUIRED" || error.reasonCode === "SUPERSKILL_AUTH_INVALID" || error.reasonCode === "AUTH_SCOPE_REQUIRED");
}

function protectedOperationScopes(name: string): AgentAuthScope[] | undefined {
  if (name === "activation_doctor" || name === "recommend" || name === "activation_start" || name === "activation_keep") return ["superskill:managed"];
  if (name === "publish_markdown_to_harness" || name === "publish_resource_package") return ["resources:publish"];
  if (name === "workspace_create") return ["workspaces:write"];
  if (name === "workspace_get" || name === "workspace_install") return ["workspaces:read"];
  if (name === "workspace_publish_resource") return ["resources:publish", "workspaces:write"];
  return undefined;
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

function optionalWaitSeconds(value: unknown): number {
  if (value === undefined) return 45;
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1 || value > 45) throw inputError("AUTH_WAIT_INVALID");
  return value;
}

function requiredAgentClient(value: unknown): AgentAuthClient {
  return requiredClient(value);
}

function requiredScopes(value: unknown): AgentAuthScope[] {
  if (!Array.isArray(value) || !value.length || value.length > AGENT_AUTH_SCOPES.length) throw inputError("AUTH_SCOPE_INVALID");
  const scopes = [...new Set(value.map(requiredString))].sort();
  if (scopes.length !== value.length || scopes.some((scope) => !(AGENT_AUTH_SCOPES as readonly string[]).includes(scope))) throw inputError("AUTH_SCOPE_INVALID");
  return scopes as AgentAuthScope[];
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value);
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw inputError("MCP_INPUT_INVALID");
  return value.map(requiredString);
}

function requiredFiles(value: unknown): Array<{ path: string; content: string; truncated?: boolean }> {
  if (!Array.isArray(value) || !value.length || value.length > 120) throw inputError("MCP_INPUT_INVALID");
  return value.map((entry) => {
    const file = asObject(entry);
    exactKeys(file, ["path", "content", "truncated"], ["path", "content"]);
    const truncated = file.truncated;
    if (truncated !== undefined && typeof truncated !== "boolean") throw inputError("MCP_INPUT_INVALID");
    return { path: requiredString(file.path), content: requiredString(file.content), ...(truncated === undefined ? {} : { truncated }) };
  });
}

function requiredIdempotencyKey(value: unknown): string {
  const key = requiredString(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/.test(key)) throw inputError("MCP_INPUT_INVALID");
  return key;
}

function requiredWorkspaceSlug(value: unknown): string {
  const slug = requiredString(value);
  if (!/^[a-z][a-z0-9_-]{1,62}$/.test(slug)) throw inputError("MCP_INPUT_INVALID");
  return slug;
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

function toolNeedsWorkspaceRoot(name: string): boolean {
  return name === "activation_doctor"
    || name === "recommend"
    || name === "activation_start"
    || name === "activation_mark_loaded"
    || name === "activation_mark_invoked"
    || name === "activation_finish"
    || name === "activation_keep"
    || name === "activation_remove"
    || name === "workspace_install";
}

function trustedRegistry(value: string): URL {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw inputError("REGISTRY_ORIGIN_UNTRUSTED"); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw inputError("REGISTRY_ORIGIN_UNTRUSTED");
  const pathName = parsed.pathname.replace(/\/$/, "") || "/";
  const canonical = parsed.protocol === "https:"
    && (parsed.hostname === "superskill.sh" || parsed.hostname === "onlyharness.com")
    && !parsed.port
    && (pathName === "/api" || pathName === "/");
  const local = process.env.NODE_ENV !== "production"
    && process.env.HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY === "1"
    && parsed.protocol === "http:"
    && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]")
    && Boolean(parsed.port)
    && (pathName === "/api" || pathName === "/");
  if (!canonical && !local) throw inputError("REGISTRY_ORIGIN_UNTRUSTED");
  parsed.pathname = pathName === "/" ? "" : pathName;
  return parsed;
}

function withoutUndefined(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function safeNetworkMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "network error")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/oh(?:at|rt|dp|bp)_[A-Za-z0-9_-]+/g, "[redacted]")
    .slice(0, 200);
}
