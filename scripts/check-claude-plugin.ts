import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type MarketplaceManifest = {
  name?: string;
  metadata?: { description?: string };
  owner?: { name?: string };
  plugins?: Array<{ name?: string; source?: string; description?: string }>;
};

type PluginManifest = {
  name?: string;
  description?: string;
  version?: string;
  author?: { name?: string; url?: string };
};

type McpConfig = {
  mcpServers?: Record<string, { type?: string; url?: string; headers?: unknown }>;
};

const root = path.resolve(import.meta.dirname, "..");
const marketplacePath = path.join(root, ".claude-plugin/marketplace.json");
const pluginRoot = path.join(root, "plugins/onlyharness");
const pluginManifestPath = path.join(pluginRoot, ".claude-plugin/plugin.json");
const pluginMcpPath = path.join(pluginRoot, ".mcp.json");
const skillPath = path.join(pluginRoot, "skills/onlyharness/SKILL.md");
const readmePath = path.join(root, "README.md");
const llmsPath = path.join(root, "apps/registry-web/public/llms.txt");
const agentsPath = path.join(root, "AGENTS.md");
const publicAgentsPath = path.join(root, "apps/registry-web/public/AGENTS.md");

for (const file of [marketplacePath, pluginManifestPath, pluginMcpPath, skillPath, readmePath, llmsPath, agentsPath, publicAgentsPath]) {
  check(existsSync(file), `Missing required plugin/discovery file: ${path.relative(root, file)}`);
}

const marketplace = readJson<MarketplaceManifest>(marketplacePath);
const manifest = readJson<PluginManifest>(pluginManifestPath);
const mcp = readJson<McpConfig>(pluginMcpPath);
const skill = readFileSync(skillPath, "utf8");
const readme = readFileSync(readmePath, "utf8");
const llms = readFileSync(llmsPath, "utf8");
const agents = readFileSync(agentsPath, "utf8");
const publicAgents = readFileSync(publicAgentsPath, "utf8");

check(marketplace.name === "onlyharness", "Marketplace name must be onlyharness");
check(marketplace.owner?.name === "OnlyHarness", "Marketplace owner must be OnlyHarness");
check(Boolean(marketplace.metadata?.description?.includes("OnlyHarness")), "Marketplace description must name OnlyHarness");
check(Array.isArray(marketplace.plugins) && marketplace.plugins.length === 1, "Marketplace must expose exactly one plugin");
const pluginEntry = marketplace.plugins?.[0];
check(pluginEntry?.name === "onlyharness", "Marketplace plugin entry must be onlyharness");
check(pluginEntry.source === "./plugins/onlyharness", "Marketplace plugin source must point at ./plugins/onlyharness");
check(Boolean(pluginEntry.description?.includes("onlyharness.com")), "Marketplace plugin description must mention onlyharness.com");

check(manifest.name === "onlyharness", "Plugin manifest name must be onlyharness");
check(Boolean(manifest.description?.includes("harnesses")), "Plugin manifest description must mention harnesses");
check(Boolean(manifest.version?.match(/^\d+\.\d+\.\d+$/)), "Plugin manifest version must be semver");
check(manifest.author?.name === "OnlyHarness", "Plugin author must be OnlyHarness");
check(manifest.author?.url === "https://onlyharness.com", "Plugin author URL must be onlyharness.com");

const onlyharnessMcp = mcp.mcpServers?.onlyharness;
check(Object.keys(mcp.mcpServers ?? {}).length === 1, "Plugin .mcp.json must expose exactly one MCP server");
check(onlyharnessMcp?.type === "http", "Plugin MCP server must use http transport");
check(onlyharnessMcp.url === "https://onlyharness.com/mcp", "Plugin MCP server must point at https://onlyharness.com/mcp");
check(!onlyharnessMcp.headers, "Plugin MCP config must not embed headers or secrets");

check(skill.startsWith("---\n"), "OnlyHarness skill must start with frontmatter");
check(/\nname:\s*onlyharness\n/.test(skill), "OnlyHarness skill frontmatter must set name");
check(/description:\s*".*resource.*harness/i.test(skill), "OnlyHarness skill frontmatter must describe resource and harness usage");
for (const required of [
  "npx onlyharness@latest suggest market research --json",
  "npx onlyharness@latest resources search superpowers --json",
  "npx onlyharness@latest publish-resource ./agent-tool --name agent-tool --type command_pack --json",
  "node packages/harness-cli/dist/hh.mjs suggest market research --json",
  "hh suggest --apply",
  "--target claude-code|codex|cursor",
  "pull_harness",
  "search_resources",
  "resource_detail",
  "resource_use_instructions",
  "publish_resource_package",
  "pricing.model=gate_escrow",
  "HH_ORG_TOKEN",
  "Community stats, stars, forks, thread replies and Harness Heat are not safety guarantees"
]) {
  check(skill.includes(required), `OnlyHarness skill must include guidance: ${required}`);
}
check(!skill.includes("not published yet"), "OnlyHarness skill must not claim the npm package is unpublished");

for (const docs of [
  { name: "README.md", text: readme },
  { name: "llms.txt", text: llms },
  { name: "AGENTS.md", text: agents },
  { name: "public AGENTS.md", text: publicAgents }
]) {
  check(docs.text.includes("https://onlyharness.com/mcp"), `${docs.name} must mention the MCP endpoint`);
  check(docs.text.includes("claude plugin"), `${docs.name} must mention Claude plugin install/validation`);
}

console.log("Claude plugin check passed: marketplace, plugin manifest, MCP config, skill guidance, and docs are in sync");

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
