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
  mcpServers?: Record<string, { type?: string; url?: string; headers?: unknown; command?: string; args?: string[]; env?: unknown }>;
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

check(marketplace.name === "superskill", "Marketplace name must be superskill");
check(marketplace.owner?.name === "SuperSkill", "Marketplace owner must be SuperSkill");
check(Boolean(marketplace.metadata?.description?.includes("SuperSkill")), "Marketplace description must name SuperSkill");
check(Array.isArray(marketplace.plugins) && marketplace.plugins.length === 2, "Marketplace must expose SuperSkill and the temporary deprecated compatibility plugin");
check(Boolean(marketplace.plugins?.find((entry) => entry.name === "onlyharness")?.description?.includes("Deprecated compatibility")), "Legacy OnlyHarness plugin must remain explicitly deprecated until cold-client migration proof exists");

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
  "npx onlyharness@latest publish-resource ./agent-tool --workspace acme --name agent-tool --type command_pack --json",
  "node packages/harness-cli/dist/hh.mjs suggest market research --json",
  "hh suggest --apply",
  "--target claude-code|codex|cursor",
  "pull_harness",
  "search_resources",
  "resource_detail",
  "resource_use_instructions",
  "publish_resource_package",
  "pricing.model=gate_escrow",
  "HH_WORKSPACE_TOKEN",
  "HH_ORG_TOKEN",
  "Community stats, stars, forks, thread replies and Harness Heat are not safety guarantees"
]) {
  check(skill.includes(required), `OnlyHarness skill must include guidance: ${required}`);
}
check(!skill.includes("not published yet"), "OnlyHarness skill must not claim the npm package is unpublished");

const superskillRoot = path.join(root, "plugins/superskill");
const superskillManifest = readJson<PluginManifest>(path.join(superskillRoot, ".claude-plugin/plugin.json"));
const superskillMcp = readJson<McpConfig>(path.join(superskillRoot, ".mcp.json"));
const superskillRuntime = readJson<{ schemaVersion?: string; cliPackage?: string; cliVersion?: string; pluginVersion?: string; cliIntegrity?: string | null; cliReleaseStatus?: string; activationContractVersion?: string }>(path.join(superskillRoot, "runtime.json"));
const superskillSkill = readFileSync(path.join(superskillRoot, "skills/superskill/SKILL.md"), "utf8");
const superskillEntry = marketplace.plugins?.find((entry) => entry.name === "superskill");
check(superskillEntry?.source === "./plugins/superskill", "SuperSkill marketplace source must point at ./plugins/superskill");
check(superskillManifest.name === "superskill", "SuperSkill Claude manifest name must be superskill");
check(superskillManifest.version === superskillRuntime.pluginVersion, "SuperSkill Claude manifest and runtime plugin versions must match");
check(superskillManifest.author?.name === "SuperSkill" && superskillManifest.author.url === "https://superskill.sh", "SuperSkill manifest must use the canonical product identity");
check(superskillMcp.mcpServers?.superskill?.url === "https://superskill.sh/mcp", "SuperSkill must use the canonical public browse-only MCP endpoint");
check(!superskillMcp.mcpServers?.superskill?.headers, "SuperSkill MCP must not embed the internal token");
check(superskillRuntime.schemaVersion === "superskill.runtime.v1", "SuperSkill runtime schema must be v1");
check(superskillRuntime.cliPackage === "onlyharness" && /^\d+\.\d+\.\d+$/.test(superskillRuntime.cliVersion ?? ""), "SuperSkill runtime must pin an exact onlyharness version");
check(
  (superskillRuntime.cliReleaseStatus === "unpublished" && superskillRuntime.cliIntegrity === null) ||
  (superskillRuntime.cliReleaseStatus === "published" && /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(superskillRuntime.cliIntegrity ?? "")),
  "SuperSkill runtime must fail closed before publication and pin official npm integrity after publication"
);
check(superskillRuntime.activationContractVersion === "superskill.activation.v1", "SuperSkill activation contract must be v1");
check(Object.keys(superskillMcp.mcpServers ?? {}).sort().join(",") === "superskill,superskill_local", "SuperSkill plugin must expose one remote and one local MCP server");
check(
  superskillMcp.mcpServers?.superskill_local?.command === "npx"
    && JSON.stringify(superskillMcp.mcpServers.superskill_local.args) === JSON.stringify(["--yes", `${superskillRuntime.cliPackage}@${superskillRuntime.cliVersion}`, "mcp", "superskill"])
    && !superskillMcp.mcpServers.superskill_local.env
    && !superskillMcp.mcpServers.superskill_local.headers,
  "Local SuperSkill MCP must use the exact pinned CLI without embedded credential transport"
);
for (const required of [
  `onlyharness@${superskillRuntime.cliVersion}`,
  "superskill_local",
  "LOCAL_MCP_UNAVAILABLE",
  "no_safe_match",
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
  "workspace_install",
  "agent_reported",
  "never downgrade an exact link to an id-only/latest call",
  ".agents/skills",
  ".codex/harnesses"
]) check(superskillSkill.includes(required), `SuperSkill shared skill must include ${required}`);
check(!superskillSkill.includes("onlyharness@latest"), "SuperSkill managed commands must never use latest");
check(!superskillSkill.includes("HH_TOKEN") && !superskillSkill.includes("HH_SUPERSKILL_TOKEN"), "SuperSkill shared skill must not expose legacy environment credential transport");
check(!superskillSkill.includes("auth login --shell") && !superskillSkill.includes("eval \"$("), "SuperSkill shared skill must not require token export or a second shell session");
check(!/npx[^\n]*(?:recommend|activation (?:start|mark|finish|keep|remove))/.test(superskillSkill), "SuperSkill lifecycle must use local MCP tools, not shell CLI fallback");

for (const docs of [
  { name: "README.md", text: readme },
  { name: "llms.txt", text: llms },
  { name: "AGENTS.md", text: agents },
  { name: "public AGENTS.md", text: publicAgents }
]) {
  check(docs.text.includes("https://superskill.sh/mcp"), `${docs.name} must mention the canonical MCP endpoint`);
  check(docs.text.includes("claude plugin"), `${docs.name} must mention Claude plugin install/validation`);
}

console.log("Claude plugin check passed: marketplace, plugin manifest, MCP config, skill guidance, and docs are in sync");

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
