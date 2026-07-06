import { spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const apiUrl = "http://127.0.0.1:8798";

const api = spawn("npm", ["run", "start", "-w", "@harnesshub/api"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    HARNESS_API_PORT: "8798",
    HARNESS_API_HOST: "127.0.0.1",
    HARNESS_WORKSPACE_ROOT: root,
    DOCS_URL: path.join(root, "apps/registry-web/public/llms.txt")
  }
});

try {
  await waitForApi(`${apiUrl}/healthz`);

  const initialize = await rpc(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "onlyharness-smoke", version: "0" }
  });
  if (initialize.result?.serverInfo?.name !== "onlyharness") {
    throw new Error(`MCP initialize failed: ${JSON.stringify(initialize)}`);
  }

  const tools = await rpc(2, "tools/list", {});
  const names = tools.result?.tools?.map((tool: { name: string }) => tool.name) ?? [];
  for (const expected of ["search_harnesses", "harness_detail", "pull_instructions", "search_docs", "publish_markdown_to_harness"]) {
    if (!names.includes(expected)) throw new Error(`MCP tool missing: ${expected}`);
  }

  const search = await rpc(3, "tools/call", {
    name: "search_harnesses",
    arguments: { query: "research", limit: 2 }
  });
  const searchText = search.result?.content?.[0]?.text ?? "";
  if (!searchText.includes("deep-market-researcher")) {
    throw new Error(`MCP search_harnesses returned wrong content: ${JSON.stringify(search)}`);
  }

  const publish = await rpc(4, "tools/call", {
    name: "publish_markdown_to_harness",
    arguments: {
      name: "no-auth",
      markdown: "# No Auth\n\nThis should return an authorization error instead of publishing."
    }
  });
  const publishText = publish.result?.content?.[0]?.text ?? "";
  if (!publishText.includes("Authorization required") || !publishText.includes("oauth-protected-resource")) {
    throw new Error(`MCP publish auth guard failed: ${JSON.stringify(publish)}`);
  }

  const getResponse = await fetch(`${apiUrl}/mcp`);
  if (getResponse.status !== 405) throw new Error(`Expected GET /mcp 405, got ${getResponse.status}`);

  console.log("MCP smoke passed: initialize, tools/list, search_harnesses, publish auth guard, GET 405");
} finally {
  api.kill("SIGTERM");
}

async function rpc(id: number, method: string, params: unknown) {
  const response = await fetch(`${apiUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP ${method} HTTP ${response.status}: ${text}`);
  return parseMcpBody(text);
}

function parseMcpBody(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const data = trimmed
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, ""))
    .join("\n");
  if (!data) throw new Error(`No MCP data frame found: ${text}`);
  return JSON.parse(data);
}

async function waitForApi(url: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(`API did not become ready: ${url}`);
}
