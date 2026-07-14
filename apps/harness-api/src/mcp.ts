import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import * as registry from "./registry.js";
import * as resources from "./resources.js";
import { fetchCountersMap } from "./social.js";

export const MCP_SERVER_VERSION = "0.3.0";
export const MCP_TOOL_NAMES = [
  "search_harnesses",
  "harness_detail",
  "search_resources",
  "resource_detail",
  "resource_use_instructions",
  "pull_instructions",
  "pull_harness",
  "search_docs",
  "publish_markdown_to_harness",
  "publish_resource_package"
] as const;

export type McpErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "FORBIDDEN"
  | "TOOL_NOT_FOUND"
  | "RESOURCE_NOT_FOUND"
  | "ARCHIVE_STORAGE_UNAVAILABLE"
  | "PUBLISH_CONFLICT"
  | "VALIDATION_FAILED"
  | "PUBLISH_DISABLED"
  | "PAYMENT_REQUIRED"
  | "DIRECTORY_LINK_ONLY"
  | "RESOURCE_ARCHIVE_NOT_HOSTED"
  | "HOSTED_EXECUTION_NOT_AVAILABLE"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

const readOnlyToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
} as const;

const publishToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true
} as const;

const idempotentPublishToolAnnotations = {
  ...publishToolAnnotations,
  idempotentHint: true
} as const;

const searchHarnessesInputSchema = z.object({
  query: z.string().default("").describe("Search terms such as market research, support triage or finance safety."),
  limit: z.number().int().min(1).max(20).default(10)
});
const harnessDetailInputSchema = z.object({
  owner: z.string().default("harnesses"),
  name: z.string().describe("Harness slug, for example deep-market-researcher.")
});
const searchResourcesInputSchema = z.object({
  query: z.string().default("").describe("Search terms such as superpowers, MCP browser, workflow or Claude skill."),
  q: z.string().optional().describe("Alias for query, matching the HTTP /resources?q= contract."),
  type: z.string().optional().describe("Optional resource type filter, for example skill, plugin, workflow, mcp_server or harness."),
  worksWith: z.string().optional().describe("Optional compatibility filter: claude-code, codex, cursor, mcp, cli or github."),
  limit: z.number().int().min(1).max(20).default(10)
});
const resourceIdInputSchema = z.object({
  id: z.string().describe("Exact mixed resource identifier."),
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/).optional().describe("Optional immutable hosted release version. When supplied, latest is never used.")
});
const pullInstructionsInputSchema = z.object({
  owner: z.string().default("harnesses"),
  name: z.string()
});
const pullHarnessInputSchema = z.object({
  owner: z.string().default("harnesses"),
  name: z.string(),
  version: z.string().optional()
});
const searchDocsInputSchema = z.object({
  query: z.string().default("")
});

type PublishMarkdownInput = {
  name?: string;
  markdown: string;
};

type PublishResourcePackageInput = {
  name?: string;
  version: string;
  idempotencyKey: string;
  title?: string;
  summary?: string;
  resourceType?: string;
  sourceUrl?: string;
  worksWith?: string[];
  tags?: string[];
  files: Array<{
    path: string;
    content: string;
    truncated?: boolean;
  }>;
};

const publishMarkdownInputSchema = z.object({
  name: z.string().optional(),
  markdown: z.string().min(20)
});

const publishResourcePackageInputSchema = z.object({
  name: z.string().optional(),
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/),
  idempotencyKey: z.string().min(16).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/),
  title: z.string().optional(),
  summary: z.string().optional(),
  resourceType: z.string().optional(),
  sourceUrl: z.string().optional(),
  worksWith: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  files: z.array(z.object({
    path: z.string(),
    content: z.string(),
    truncated: z.boolean().optional()
  })).min(1).max(120)
});

const mcpToolInputSchemas = {
  search_harnesses: searchHarnessesInputSchema,
  harness_detail: harnessDetailInputSchema,
  search_resources: searchResourcesInputSchema,
  resource_detail: resourceIdInputSchema,
  resource_use_instructions: resourceIdInputSchema,
  pull_instructions: pullInstructionsInputSchema,
  pull_harness: pullHarnessInputSchema,
  search_docs: searchDocsInputSchema,
  publish_markdown_to_harness: publishMarkdownInputSchema,
  publish_resource_package: publishResourcePackageInputSchema
} as const;

export type PublishMarkdownHandler = (input: PublishMarkdownInput, authorization?: string) => Promise<unknown>;
export type PublishResourcePackageHandler = (input: PublishResourcePackageInput, authorization?: string) => Promise<unknown>;
export type PullHarnessHandler = (input: { owner: string; name: string; version?: string }, authorization?: string) => Promise<unknown>;
export type HarnessDetailHandler = (input: { owner: string; name: string }, authorization?: string) => Promise<unknown>;
export type PullInstructionsHandler = (input: { owner: string; name: string }, authorization?: string) => Promise<unknown>;
export type ResourceReleaseMetadata = {
  version: string;
  artifactDigest: string;
  archiveSize: number;
  trust: "unreviewed";
};

type BuildMcpServerOptions = {
  publishMarkdown: PublishMarkdownHandler;
  publishResourcePackage: PublishResourcePackageHandler;
  pullHarness: PullHarnessHandler;
  harnessDetail: HarnessDetailHandler;
  pullInstructions: PullInstructionsHandler;
  resourceRelease: (resourceId: string, version?: string) => { resource: resources.Resource; release: ResourceReleaseMetadata } | undefined;
  resourceReleaseMetadata: (resourceId: string, version?: string) => ResourceReleaseMetadata | undefined;
};

let docsCache: { source: string; text: string; loadedAt: number } | undefined;

export function buildMcpServer(options: BuildMcpServerOptions): McpServer {
  const server = new McpServer({ name: "superskill", version: MCP_SERVER_VERSION });

  server.registerTool(
    "search_harnesses",
    {
      title: "Search harnesses",
      description: "Search the SuperSkill registry by task, job, title, summary or tag.",
      annotations: readOnlyToolAnnotations,
      inputSchema: searchHarnessesInputSchema.shape
    },
    async ({ query, limit }) => mcpCall(async () => {
      const counters = await fetchCountersMap();
      const items = registry.searchRegistry({ q: query, sort: "trending" }, counters).slice(0, limit);
      return { items };
    })
  );

  server.registerTool(
    "harness_detail",
    {
      title: "Harness detail",
      description: "Return manifest, trust signals, example and file list for one harness.",
      annotations: readOnlyToolAnnotations,
      inputSchema: harnessDetailInputSchema.shape
    },
    async ({ owner, name }, extra) => {
      const authorization = headerValue(extra.requestInfo?.headers.authorization);
      return mcpCall(() => options.harnessDetail({ owner, name }, authorization), Boolean(authorization));
    }
  );

  server.registerTool(
    "search_resources",
    {
      title: "Search agent resources",
      description: "Search mixed source-aware resources: harnesses, skills, plugins, workflows, MCP servers, configs, guides, runtimes and directories.",
      annotations: readOnlyToolAnnotations,
      inputSchema: searchResourcesInputSchema.shape
    },
    async ({ query, q, type, worksWith, limit }) => mcpCall(async () => {
      const counters = await fetchCountersMap();
      const registryItems = registry.scanRegistry(counters);
      return resources.searchResources({ q: query || q || "", type, worksWith, limit }, registryItems);
    })
  );

  server.registerTool(
    "resource_detail",
    {
      title: "Resource detail",
      description: "Return provenance, trust, popularity and actions for one mixed resource. Pass version to bind a hosted immutable release; latest is never substituted for an explicit version.",
      annotations: readOnlyToolAnnotations,
      inputSchema: resourceIdInputSchema.shape
    },
    async ({ id, version }) => mcpCall(async () => {
      const counters = await fetchCountersMap();
      const catalogResource = resources.resourceDetail(id, registry.scanRegistry(counters));
      if (!catalogResource) return { error: "Resource not found", status: 404, code: "RESOURCE_NOT_FOUND", id };
      const metadata = options.resourceReleaseMetadata(catalogResource.id, version);
      if (version && !metadata) return { error: "Resource release not found", status: 404, code: "RESOURCE_NOT_FOUND", id, version };
      if (!metadata) return catalogResource;
      const exact = options.resourceRelease(catalogResource.id, metadata.version);
      if (!exact) return { error: "Hosted resource archive storage unavailable", status: 503, code: "ARCHIVE_STORAGE_UNAVAILABLE", id, version: metadata.version };
      return { ...exact.resource, release: exact.release };
    })
  );

  server.registerTool(
    "resource_use_instructions",
    {
      title: "Resource use instructions",
      description: "Return the best safe next action for a mixed resource. Pass version to bind an immutable hosted release. Hosted skills expose explicit-consent exact native client install commands; upstream-only resources stay open-only.",
      annotations: readOnlyToolAnnotations,
      inputSchema: resourceIdInputSchema.shape
    },
    async ({ id, version }) => mcpCall(async () => {
      const counters = await fetchCountersMap();
      const catalogResource = resources.resourceDetail(id, registry.scanRegistry(counters));
      if (!catalogResource) return { error: "Resource not found", status: 404, code: "RESOURCE_NOT_FOUND", id };
      const metadata = options.resourceReleaseMetadata(catalogResource.id, version);
      if (version && !metadata) return { error: "Resource release not found", status: 404, code: "RESOURCE_NOT_FOUND", id, version };
      const exact = metadata ? options.resourceRelease(catalogResource.id, metadata.version) : undefined;
      if (metadata && !exact) return { error: "Hosted resource archive storage unavailable", status: 503, code: "ARCHIVE_STORAGE_UNAVAILABLE", id, version: metadata.version };
      const resource = exact?.resource ?? catalogResource;
      const release = exact?.release;
      return {
        id: resource.id,
        title: resource.title,
        resourceType: resource.resourceType,
        installability: resource.installability,
        licenseStatus: resource.licenseStatus,
        sourceCheckedAt: resource.sourceCheckedAt,
        verifiedInstall: resource.trust.installVerifiedAt ?? null,
        release: release ?? null,
        instructions: resourceInstructions(resource, release)
      };
    })
  );

  server.registerTool(
    "pull_instructions",
    {
      title: "Pull instructions",
      description: "Return CLI and HTTP commands for pulling a harness into a local workspace.",
      annotations: readOnlyToolAnnotations,
      inputSchema: pullInstructionsInputSchema.shape
    },
    async ({ owner, name }, extra) => {
      const authorization = headerValue(extra.requestInfo?.headers.authorization);
      return mcpCall(() => options.pullInstructions({ owner, name }, authorization), Boolean(authorization));
    }
  );

  server.registerTool(
    "pull_harness",
    {
      title: "Pull harness",
      description: "Return archive files for a harness. Paid harnesses return payment requirements unless the Bearer token is entitled.",
      annotations: readOnlyToolAnnotations,
      inputSchema: pullHarnessInputSchema.shape
    },
    async ({ owner, name, version }, extra) => {
      const authorization = headerValue(extra.requestInfo?.headers.authorization);
      return mcpCall(() => options.pullHarness({ owner, name, version }, authorization), Boolean(authorization));
    }
  );

  server.registerTool(
    "search_docs",
    {
      title: "Search SuperSkill docs",
      description: "Search /llms.txt and agent guidance for API, CLI, MCP and safety instructions.",
      annotations: readOnlyToolAnnotations,
      inputSchema: searchDocsInputSchema.shape
    },
    async ({ query }) => mcpCall(async () => {
      const docs = await loadDocs();
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const sections = docs.text.split(/\n(?=## )/g).map((section) => section.trim()).filter(Boolean);
      const matches = terms.length
        ? sections.filter((section) => {
          const haystack = section.toLowerCase();
          return terms.every((term) => haystack.includes(term));
        })
        : sections;
      return {
        source: docs.source,
        matches: (matches.length ? matches : [docs.text]).slice(0, 5).map((section) => section.slice(0, 8000))
      };
    })
  );

  server.registerTool(
    "publish_markdown_to_harness",
    {
      title: "Publish markdown to harness",
      description: "Convert markdown into an unverified harness scaffold. Requires a SuperSkill Bearer token.",
      annotations: publishToolAnnotations,
      inputSchema: publishMarkdownInputSchema.shape
    },
    async ({ name, markdown }, extra) => {
      const authorization = headerValue(extra.requestInfo?.headers.authorization);
      if (!authorization) {
        return mcpError({
          code: "AUTH_REQUIRED",
          status: 401,
          details: { resource_metadata: "https://superskill.sh/.well-known/oauth-protected-resource" }
        });
      }
      return mcpCall(() => options.publishMarkdown({ name, markdown }, authorization), true);
    }
  );

  server.registerTool(
    "publish_resource_package",
    {
      title: "Publish agent resource package",
      description: "Publish an immutable canonical hosted package release. Requires a confirmed-user Bearer with active superskill:managed scope, semantic version and idempotency key. Returns unreviewed trust; never grants a Verified badge.",
      annotations: idempotentPublishToolAnnotations,
      inputSchema: publishResourcePackageInputSchema.shape
    },
    async (input, extra) => {
      const authorization = headerValue(extra.requestInfo?.headers.authorization);
      if (!authorization) {
        return mcpError({
          code: "AUTH_REQUIRED",
          status: 401,
          details: { resource_metadata: "https://superskill.sh/.well-known/oauth-protected-resource" }
        });
      }
      return mcpCall(() => options.publishResourcePackage(input, authorization), true);
    }
  );

  return server;
}

export function resourceInstructions(resource: resources.Resource, release?: ResourceReleaseMetadata): string[] {
  const lines: string[] = [];
  const install = resource.actions.find((action) => action.id === "install");
  const onlyHarness = resource.actions.find((action) => action.id === "open_onlyharness");
  const archive = resource.actions.find((action) => action.id === "download_archive");
  const mirror = resource.actions.find((action) => action.id === "open_mirror");
  const open = resource.actions.find((action) => action.id === "open_upstream");
  const mcp = resource.actions.find((action) => action.id === "copy_mcp_config");
  if (install && "command" in install) {
    lines.push(`Install with: ${install.command}`);
  } else if (mcp && "command" in mcp && mcp.command) {
    lines.push(`Copy MCP config or command: ${mcp.command}`);
  } else if (onlyHarness && "url" in onlyHarness) {
    lines.push(`Use in SuperSkill: ${onlyHarness.url}`);
  } else if (mirror && "url" in mirror) {
    lines.push(`Use via SuperSkill mirror: ${mirror.url}`);
  } else if (open && "url" in open) {
    lines.push(`Use upstream: ${open.url}`);
  }
  if (resource.installability === "open_only") {
    lines.push("This is an upstream resource listing in SuperSkill. Use the SuperSkill resource page first; upstream author/source remains authoritative.");
  }
  if (archive && resource.trust.securityScan === "fail") {
    lines.push("Download and installation are blocked because this exact release failed the static security scan.");
  } else if (archive && "url" in archive) {
    lines.push(`Download hosted resource archive from SuperSkill: ${archive.url}`);
    if (resource.resourceType === "skill" && /^onlyharness:packages\/[a-z0-9][a-z0-9-]{1,80}$/.test(resource.id)) {
      const actionVersion = hostedResourceArchiveVersion(resource.id, archive.url);
      const exactVersion = release?.version ?? actionVersion;
      if (!exactVersion || (release && actionVersion !== release.version)) {
      lines.push("Installation is blocked because the hosted archive action is not bound to an exact semantic version.");
      } else {
        const consentFlag = resource.trust.securityScan === "pass" ? "" : " --allow-unreviewed";
        lines.push("This hosted skill is a browse-catalog install, not a managed approval or activation.");
        if (resource.trust.securityScan !== "pass") lines.push("Show the unreviewed/not-scanned trust state and ask explicit install consent before using --allow-unreviewed.");
        lines.push(`Install for Codex after consent: npx --yes onlyharness@${MCP_SERVER_VERSION} resources install ${resource.id} --version ${exactVersion} --target codex${consentFlag} --json`);
        lines.push(`Install for Claude Code after consent: npx --yes onlyharness@${MCP_SERVER_VERSION} resources install ${resource.id} --version ${exactVersion} --target claude-code${consentFlag} --json`);
      }
    }
  }
  if (open && "url" in open) {
    lines.push(`Upstream source: ${open.url}`);
  }
  if (resource.licenseStatus === "unknown") {
    lines.push("License is unknown; keep upstream attribution visible and do not sell, claim ownership, or present this as Verified install evidence.");
  }
  return lines;
}

function hostedResourceArchiveVersion(resourceId: string, value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.origin !== "https://superskill.sh" || url.search || url.hash) return undefined;
    const prefix = `/api/resources/${encodeURIComponent(resourceId)}/releases/`;
    if (!url.pathname.startsWith(prefix) || !url.pathname.endsWith("/archive")) return undefined;
    const encoded = url.pathname.slice(prefix.length, -"/archive".length);
    const version = decodeURIComponent(encoded);
    return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version) && encodeURIComponent(version) === encoded ? version : undefined;
  } catch {
    return undefined;
  }
}

export function mcpOk(value: unknown, status = 200) {
  // Success payloads can contain exact archive file contents. Redaction here would
  // silently corrupt pulled packages, so sanitization is deliberately error-only.
  const structured = isRecord(value)
    ? { ...value, ok: true, code: "OK", status }
    : { data: value, ok: true, code: "OK", status };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured
  };
}

export function mcpError(input: {
  code: McpErrorCode;
  status: number;
  next?: string | string[];
  details?: unknown;
}) {
  const structured = {
    ...sanitizeFailureDetails(input.details),
    ok: false,
    error: publicMessage(input.code),
    code: input.code,
    status: input.status,
    next: sanitizeValue(input.next ?? defaultNext(input.code))
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
    isError: true
  };
}

export async function mcpCall(operation: () => unknown | Promise<unknown>, authorizationProvided = false) {
  try {
    return mcpResult(await operation(), authorizationProvided);
  } catch {
    return mcpError({ code: "INTERNAL_ERROR", status: 500 });
  }
}

export function mcpResult(value: unknown, authorizationProvided = false) {
  if (!isRecord(value)) return mcpOk(value);
  const status = typeof value.status === "number" ? value.status : undefined;
  const failed = typeof value.error === "string" || value.ok === false || (status !== undefined && status >= 400);
  if (!failed) return mcpOk(value, status && status >= 200 && status < 400 ? status : 200);

  const code = errorCode(value.code, status, authorizationProvided);
  return mcpError({
    code,
    status: status && status >= 400 ? status : statusForCode(code),
    next: typeof value.next === "string" || Array.isArray(value.next) ? value.next as string | string[] : undefined,
    details: value
  });
}

export function mcpToolCallPreflight(name: unknown, args: unknown) {
  if (typeof name !== "string" || !MCP_TOOL_NAMES.includes(name as typeof MCP_TOOL_NAMES[number])) {
    return mcpError({ code: "TOOL_NOT_FOUND", status: 404 });
  }
  const schema = mcpToolInputSchemas[name as keyof typeof mcpToolInputSchemas];
  if (schema.safeParse(args ?? {}).success) return undefined;
  return mcpError({
    code: "VALIDATION_FAILED",
    status: 422,
    next: "Correct the tool arguments using the published input schema and retry."
  });
}

const allowedCodes = new Set<McpErrorCode>([
  "AUTH_REQUIRED", "AUTH_INVALID", "FORBIDDEN", "TOOL_NOT_FOUND", "RESOURCE_NOT_FOUND",
  "ARCHIVE_STORAGE_UNAVAILABLE", "PUBLISH_CONFLICT", "VALIDATION_FAILED",
  "PUBLISH_DISABLED", "PAYMENT_REQUIRED", "DIRECTORY_LINK_ONLY",
  "RESOURCE_ARCHIVE_NOT_HOSTED", "HOSTED_EXECUTION_NOT_AVAILABLE",
  "SERVICE_UNAVAILABLE", "INTERNAL_ERROR"
]);

function errorCode(candidate: unknown, status: number | undefined, authorizationProvided: boolean): McpErrorCode {
  if (typeof candidate === "string" && allowedCodes.has(candidate as McpErrorCode)) return candidate as McpErrorCode;
  if (status === 400 || status === 422) return "VALIDATION_FAILED";
  if (status === 401) return authorizationProvided ? "AUTH_INVALID" : "AUTH_REQUIRED";
  if (status === 402) return "PAYMENT_REQUIRED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "RESOURCE_NOT_FOUND";
  if (status === 409) return "PUBLISH_CONFLICT";
  if (status === 503) return "SERVICE_UNAVAILABLE";
  return "INTERNAL_ERROR";
}

function statusForCode(code: McpErrorCode): number {
  if (code === "AUTH_REQUIRED" || code === "AUTH_INVALID") return 401;
  if (code === "PAYMENT_REQUIRED") return 402;
  if (code === "FORBIDDEN") return 403;
  if (code === "TOOL_NOT_FOUND" || code === "RESOURCE_NOT_FOUND") return 404;
  if (["PUBLISH_CONFLICT", "DIRECTORY_LINK_ONLY", "RESOURCE_ARCHIVE_NOT_HOSTED", "HOSTED_EXECUTION_NOT_AVAILABLE"].includes(code)) return 409;
  if (code === "VALIDATION_FAILED") return 422;
  if (["PUBLISH_DISABLED", "ARCHIVE_STORAGE_UNAVAILABLE", "SERVICE_UNAVAILABLE"].includes(code)) return 503;
  return 500;
}

function publicMessage(code: McpErrorCode): string {
  const messages: Record<McpErrorCode, string> = {
    AUTH_REQUIRED: "Authorization is required.",
    AUTH_INVALID: "The authorization credential is invalid or expired.",
    FORBIDDEN: "The authenticated principal is not allowed to perform this operation.",
    TOOL_NOT_FOUND: "The requested MCP tool was not found.",
    RESOURCE_NOT_FOUND: "The requested resource was not found.",
    ARCHIVE_STORAGE_UNAVAILABLE: "Archive storage is temporarily unavailable.",
    PUBLISH_CONFLICT: "The publish request conflicts with an existing immutable resource release.",
    VALIDATION_FAILED: "The request did not pass validation.",
    PUBLISH_DISABLED: "Hosted resource publishing is temporarily disabled.",
    PAYMENT_REQUIRED: "Payment or entitlement is required for this resource.",
    DIRECTORY_LINK_ONLY: "This directory resource is link-only and has no downloadable archive.",
    RESOURCE_ARCHIVE_NOT_HOSTED: "This resource is listed but its archive is not hosted by SuperSkill.",
    HOSTED_EXECUTION_NOT_AVAILABLE: "Hosted execution is not available.",
    SERVICE_UNAVAILABLE: "The required service is temporarily unavailable.",
    INTERNAL_ERROR: "The tool could not complete because of an internal error."
  };
  return messages[code];
}

function defaultNext(code: McpErrorCode): string {
  if (code === "AUTH_REQUIRED" || code === "AUTH_INVALID") return "Connect a valid MCP credential through the client and retry.";
  if (code === "PAYMENT_REQUIRED") return "Complete checkout or use an entitled credential, then retry the exact release.";
  if (code === "RESOURCE_NOT_FOUND") return "Search the registry and retry with an exact resource identifier.";
  if (code === "TOOL_NOT_FOUND") return "Refresh tools/list and call one of the advertised exact tool names.";
  if (code === "VALIDATION_FAILED") return "Correct the tool arguments and retry.";
  if (code === "PUBLISH_DISABLED" || code === "ARCHIVE_STORAGE_UNAVAILABLE" || code === "SERVICE_UNAVAILABLE") return "Retry later; do not assume the write succeeded.";
  if (code === "PUBLISH_CONFLICT") return "Use a new immutable version or repeat the exact idempotent request.";
  return "Retry only after checking the resource state; report the stable error code if the failure persists.";
}

function sanitizeFailureDetails(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const details: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (["ok", "error", "code", "status", "next"].includes(key) || blockedFailureKey.test(key)) continue;
    details[key] = sanitizeValue(item);
  }
  return details;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !blockedFailureKey.test(key))
        .map(([key, item]) => [key, sanitizeValue(item)])
    );
  }
  return value;
}

const blockedFailureKey = /(?:authorization|token|secret|password|cookie|stack|stderr|stdout|provider|local.*path|archive.*path|temp.*path)/i;

function scrubString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(?:\/var\/lib|\/app|\/Users|\/home|\/tmp)\/[A-Za-z0-9._~+/@%=-]+(?:\/[A-Za-z0-9._~+/@%=-]+)*/g, "[redacted-path]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function loadDocs(): Promise<{ source: string; text: string }> {
  const now = Date.now();
  if (docsCache && now - docsCache.loadedAt < 5 * 60_000) return docsCache;

  const source = process.env.DOCS_URL ?? path.join(registry.workspaceRoot, "apps/registry-web/public/llms.txt");
  const publicSource = source.startsWith("http://") || source.startsWith("https://") ? source : "https://superskill.sh/llms.txt";
  let text = "";
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const response = await fetch(source);
    text = response.ok ? await response.text() : "";
  } else {
    const localPath = source.startsWith("file://") ? new URL(source).pathname : source;
    text = existsSync(localPath) ? readFileSync(localPath, "utf8") : "";
  }

  if (!text) {
    text = "# SuperSkill\n\nDocs are temporarily unavailable. Use `hh doctor`, `hh search`, and `/api/registry` as fallbacks.\n";
  }

  docsCache = { source: publicSource, text, loadedAt: now };
  return docsCache;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
