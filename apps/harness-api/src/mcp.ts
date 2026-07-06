import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import * as registry from "./registry.js";
import { fetchCountersMap } from "./social.js";

type PublishMarkdownInput = {
  name?: string;
  markdown: string;
};

export type PublishMarkdownHandler = (input: PublishMarkdownInput, authorization?: string) => Promise<unknown>;
export type PullHarnessHandler = (input: { owner: string; name: string; version?: string }, authorization?: string) => Promise<unknown>;

type BuildMcpServerOptions = {
  publishMarkdown: PublishMarkdownHandler;
  pullHarness: PullHarnessHandler;
};

let docsCache: { source: string; text: string; loadedAt: number } | undefined;

export function buildMcpServer(options: BuildMcpServerOptions): McpServer {
  const server = new McpServer({ name: "onlyharness", version: "0.2.0" });

  server.registerTool(
    "search_harnesses",
    {
      title: "Search harnesses",
      description: "Search the OnlyHarness registry by task, outcome, title, summary or tag.",
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
    async ({ owner, name }) => {
      const root = registry.resolveHarnessPath(owner, name);
      if (!root) return json({ error: `Harness ${owner}/${name} not found` });
      const { inspection, evalResult, security, contextCost, standard } = registry.registryDetailBasics(root);
      const counters = await fetchCountersMap();
      const item = registry.registryItemFromDir(owner, root, counters);
      return json({
        owner,
        name,
        social: item ? registry.socialFromItem(item) : undefined,
        manifest: inspection.manifest,
        valid: inspection.valid,
        issues: inspection.issues,
        risk: inspection.risk,
        security,
        contextCost,
        standard,
        evalResult,
        example: registry.readExample(root),
        files: registry.listHarnessFiles(root)
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
    async ({ owner, name }) => {
      const root = registry.resolveHarnessPath(owner, name);
      if (!root) return json({ error: `Harness ${owner}/${name} not found` });
      const { inspection } = registry.registryDetailBasics(root);
      const version = inspection.manifest?.version ?? "current";
      const pricing = inspection.manifest?.pricing;
      const contextCost = registry.estimateContextCost(root);
      return json({
        command: `npx onlyharness pull ${owner}/${name}`,
        localCommand: `node packages/harness-cli/dist/hh.mjs pull ${owner}/${name}`,
        archiveUrl: `https://onlyharness.com/api/repos/${owner}/${name}/archive?version=${encodeURIComponent(version)}`,
        contextCost,
        payment: pricing && pricing.model !== "free"
          ? { required: true, pricing, tokenEnv: "HH_TOKEN", paymentExitCode: 5 }
          : { required: false },
        next: [`hh run ${name} --json`, `hh eval ${name} --json`, `hh gate --dir ${name} --json`]
      });
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

  return server;
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

  docsCache = { source, text, loadedAt: now };
  return docsCache;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
