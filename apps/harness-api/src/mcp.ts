import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import * as registry from "./registry.js";
import * as resources from "./resources.js";
import { fetchCountersMap } from "./social.js";

type PublishMarkdownInput = {
  name?: string;
  markdown: string;
};

type PublishResourcePackageInput = {
  name?: string;
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

export type PublishMarkdownHandler = (input: PublishMarkdownInput, authorization?: string) => Promise<unknown>;
export type PublishResourcePackageHandler = (input: PublishResourcePackageInput, authorization?: string) => Promise<unknown>;
export type PullHarnessHandler = (input: { owner: string; name: string; version?: string }, authorization?: string) => Promise<unknown>;
export type HarnessDetailHandler = (input: { owner: string; name: string }, authorization?: string) => Promise<unknown>;
export type PullInstructionsHandler = (input: { owner: string; name: string }, authorization?: string) => Promise<unknown>;

type BuildMcpServerOptions = {
  publishMarkdown: PublishMarkdownHandler;
  publishResourcePackage: PublishResourcePackageHandler;
  pullHarness: PullHarnessHandler;
  harnessDetail: HarnessDetailHandler;
  pullInstructions: PullInstructionsHandler;
};

let docsCache: { source: string; text: string; loadedAt: number } | undefined;

export function buildMcpServer(options: BuildMcpServerOptions): McpServer {
  const server = new McpServer({ name: "onlyharness", version: "0.2.6" });

  server.registerTool(
    "search_harnesses",
    {
      title: "Search harnesses",
      description: "Search the OnlyHarness registry by task, job, title, summary or tag.",
      inputSchema: {
        query: z.string().default("").describe("Search terms such as market research, support triage or finance safety."),
        limit: z.number().int().min(1).max(20).default(10)
      }
    },
    async ({ query, limit }) => {
      const counters = await fetchCountersMap();
      const items = registry.searchRegistry({ q: query, sort: "trending" }, counters).slice(0, limit);
      return json({ items });
    }
  );

  server.registerTool(
    "harness_detail",
    {
      title: "Harness detail",
      description: "Return manifest, trust signals, example and file list for one harness.",
      inputSchema: {
        owner: z.string().default("harnesses"),
        name: z.string().describe("Harness slug, for example deep-market-researcher.")
      }
    },
    async ({ owner, name }, extra) => {
      const authorization = headerValue(extra.requestInfo?.headers.authorization);
      return json(await options.harnessDetail({ owner, name }, authorization));
    }
  );

  server.registerTool(
    "search_resources",
    {
      title: "Search agent resources",
      description: "Search mixed source-aware resources: harnesses, skills, plugins, workflows, MCP servers, configs, guides, runtimes and directories.",
      inputSchema: {
        query: z.string().default("").describe("Search terms such as superpowers, MCP browser, workflow or Claude skill."),
        q: z.string().optional().describe("Alias for query, matching the HTTP /resources?q= contract."),
        type: z.string().optional().describe("Optional resource type filter, for example skill, plugin, workflow, mcp_server or harness."),
        worksWith: z.string().optional().describe("Optional compatibility filter: claude-code, codex, cursor, mcp, cli or github."),
        limit: z.number().int().min(1).max(20).default(10)
      }
    },
    async ({ query, q, type, worksWith, limit }) => {
      const counters = await fetchCountersMap();
      const registryItems = registry.scanRegistry(counters);
      const result = resources.searchResources({ q: query || q || "", type, worksWith, limit }, registryItems);
      return json(result);
    }
  );

  server.registerTool(
    "resource_detail",
    {
      title: "Resource detail",
      description: "Return provenance, trust, popularity and actions for one mixed resource.",
      inputSchema: {
        id: z.string().describe("Resource id, for example github:obra/superpowers or onlyharness:harnesses/deep-market-researcher.")
      }
    },
    async ({ id }) => {
      const counters = await fetchCountersMap();
      const resource = resources.resourceDetail(id, registry.scanRegistry(counters));
      return json(resource ?? { error: "Resource not found", id });
    }
  );

  server.registerTool(
    "resource_use_instructions",
    {
      title: "Resource use instructions",
      description: "Return the best safe next action for a mixed resource. Hosted packages expose OnlyHarness archive URLs; upstream-only resources stay open-only.",
      inputSchema: {
        id: z.string().describe("Resource id, for example github:obra/superpowers.")
      }
    },
    async ({ id }) => {
      const counters = await fetchCountersMap();
      const resource = resources.resourceDetail(id, registry.scanRegistry(counters));
      if (!resource) return json({ error: "Resource not found", id });
      return json({
        id: resource.id,
        title: resource.title,
        resourceType: resource.resourceType,
        installability: resource.installability,
        licenseStatus: resource.licenseStatus,
        sourceCheckedAt: resource.sourceCheckedAt,
        verifiedInstall: resource.trust.installVerifiedAt ?? null,
        instructions: resourceInstructions(resource)
      });
    }
  );

  server.registerTool(
    "pull_instructions",
    {
      title: "Pull instructions",
      description: "Return CLI and HTTP commands for pulling a harness into a local workspace.",
      inputSchema: {
        owner: z.string().default("harnesses"),
        name: z.string()
      }
    },
    async ({ owner, name }, extra) => {
      const authorization = headerValue(extra.requestInfo?.headers.authorization);
      return json(await options.pullInstructions({ owner, name }, authorization));
    }
  );

  server.registerTool(
    "pull_harness",
    {
      title: "Pull harness",
      description: "Return archive files for a harness. Paid harnesses return payment requirements unless the Bearer token is entitled.",
      inputSchema: {
        owner: z.string().default("harnesses"),
        name: z.string(),
        version: z.string().optional()
      }
    },
    async ({ owner, name, version }, extra) => {
      const authorization = headerValue(extra.requestInfo?.headers.authorization);
      return json(await options.pullHarness({ owner, name, version }, authorization));
    }
  );

  server.registerTool(
    "search_docs",
    {
      title: "Search OnlyHarness docs",
      description: "Search /llms.txt and agent guidance for API, CLI, MCP and safety instructions.",
      inputSchema: {
        query: z.string().default("")
      }
    },
    async ({ query }) => {
      const docs = await loadDocs();
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const sections = docs.text.split(/\n(?=## )/g).map((section) => section.trim()).filter(Boolean);
      const matches = terms.length
        ? sections.filter((section) => {
          const haystack = section.toLowerCase();
          return terms.every((term) => haystack.includes(term));
        })
        : sections;
      return json({
        source: docs.source,
        matches: (matches.length ? matches : [docs.text]).slice(0, 5).map((section) => section.slice(0, 8000))
      });
    }
  );

  server.registerTool(
    "publish_markdown_to_harness",
    {
      title: "Publish markdown to harness",
      description: "Convert markdown into an unverified harness scaffold. Requires an OnlyHarness Bearer token.",
      inputSchema: {
        name: z.string().optional(),
        markdown: z.string().min(20)
      }
    },
    async ({ name, markdown }, extra) => {
      const authorization = headerValue(extra.requestInfo?.headers.authorization);
      if (!authorization) {
        return json({
          error: "Authorization required. Connect with a Bearer token from onlyharness.com. See https://onlyharness.com/.well-known/oauth-protected-resource."
        });
      }
      return json(await options.publishMarkdown({ name, markdown }, authorization));
    }
  );

  server.registerTool(
    "publish_resource_package",
    {
      title: "Publish agent resource package",
      description: "Publish a hosted OnlyHarness resource package for a skill, plugin, workflow, MCP server, command pack, scripts, docs or source bundle. Requires a Bearer token. Does not grant a Verified harness badge.",
      inputSchema: {
        name: z.string().optional(),
        title: z.string().optional(),
        summary: z.string().optional(),
        resourceType: z.string().optional().describe("skill, plugin, workflow, mcp_server, command_pack, config, guide, framework, agent_runtime, subagent_pack, agent_team, service_endpoint or harness."),
        sourceUrl: z.string().optional(),
        worksWith: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        files: z.array(z.object({
          path: z.string(),
          content: z.string(),
          truncated: z.boolean().optional()
        })).min(1).max(120)
      }
    },
    async (input, extra) => {
      const authorization = headerValue(extra.requestInfo?.headers.authorization);
      if (!authorization) {
        return json({
          error: "Authorization required. Connect with a Bearer token from onlyharness.com. See https://onlyharness.com/.well-known/oauth-protected-resource."
        });
      }
      return json(await options.publishResourcePackage(input, authorization));
    }
  );

  return server;
}

function resourceInstructions(resource: resources.Resource): string[] {
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
    lines.push(`Use in OnlyHarness: ${onlyHarness.url}`);
  } else if (mirror && "url" in mirror) {
    lines.push(`Use via OnlyHarness mirror: ${mirror.url}`);
  } else if (open && "url" in open) {
    lines.push(`Use upstream: ${open.url}`);
  }
  if (resource.installability === "open_only") {
    lines.push("This is an upstream resource listing in OnlyHarness. Use the OnlyHarness resource page first; upstream author/source remains authoritative.");
  }
  if (archive && "url" in archive) {
    lines.push(`Download hosted resource archive from OnlyHarness: ${archive.url}`);
  }
  if (open && "url" in open) {
    lines.push(`Upstream source: ${open.url}`);
  }
  if (resource.licenseStatus === "unknown") {
    lines.push("License is unknown; keep upstream attribution visible and do not sell, claim ownership, or present this as Verified install evidence.");
  }
  return lines;
}

function json(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
  };
}

async function loadDocs(): Promise<{ source: string; text: string }> {
  const now = Date.now();
  if (docsCache && now - docsCache.loadedAt < 5 * 60_000) return docsCache;

  const source = process.env.DOCS_URL ?? path.join(registry.workspaceRoot, "apps/registry-web/public/llms.txt");
  const publicSource = source.startsWith("http://") || source.startsWith("https://") ? source : "https://onlyharness.com/llms.txt";
  let text = "";
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const response = await fetch(source);
    text = response.ok ? await response.text() : "";
  } else {
    const localPath = source.startsWith("file://") ? new URL(source).pathname : source;
    text = existsSync(localPath) ? readFileSync(localPath, "utf8") : "";
  }

  if (!text) {
    text = "# OnlyHarness\n\nDocs are temporarily unavailable. Use `hh doctor`, `hh search`, and `/api/registry` as fallbacks.\n";
  }

  docsCache = { source: publicSource, text, loadedAt: now };
  return docsCache;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
