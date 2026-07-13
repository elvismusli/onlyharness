import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pluginRoot = path.join(root, "plugins/superskill");
const manifest = readJson<Record<string, any>>(path.join(pluginRoot, ".codex-plugin/plugin.json"));
const claude = readJson<Record<string, any>>(path.join(pluginRoot, ".claude-plugin/plugin.json"));
const marketplace = readJson<Record<string, any>>(path.join(root, ".agents/plugins/marketplace.json"));
const runtime = readJson<Record<string, string | null>>(path.join(pluginRoot, "runtime.json"));
const cliPackage = readJson<Record<string, string>>(path.join(root, "packages/harness-cli/package.json"));
const mcp = readJson<Record<string, any>>(path.join(pluginRoot, ".mcp.json"));
const skill = readFileSync(path.join(pluginRoot, "skills/superskill/SKILL.md"), "utf8");
const cliRuntimeSource = readFileSync(path.join(root, "packages/harness-cli/src/lib/superskill-types.ts"), "utf8");
const cliReadme = readFileSync(path.join(root, "packages/harness-cli/README.md"), "utf8");

check(manifest.name === "superskill", "Codex manifest name must be superskill");
check(manifest.version === claude.version, "Claude and Codex manifest versions must match");
check(manifest.version === runtime.pluginVersion, "Plugin manifests and runtime plugin version must match");
check(manifest.skills === "./skills/", "Codex skills path must be ./skills/");
check(manifest.mcpServers === "./.mcp.json", "Codex MCP path must be ./.mcp.json");
check(!("apps" in manifest) && !("hooks" in manifest), "Internal-alpha plugin must not declare apps or hooks");
check(!manifest.interface?.privacyPolicyURL && !manifest.interface?.termsOfServiceURL, "Dead privacy/terms URLs must be omitted");
check(marketplace.name === "superskill", "Codex marketplace name must be superskill");
check(marketplace.plugins?.length === 1 && marketplace.plugins[0]?.name === "superskill", "Codex marketplace must expose superskill only");
check(marketplace.plugins[0]?.source?.path === "./plugins/superskill", "Codex local source path must start with ./");
check(marketplace.plugins[0]?.policy?.products?.includes("CODEX"), "Codex marketplace policy must include CODEX");
check(manifest.author?.name === "SuperSkill" && manifest.homepage === "https://superskill.sh" && manifest.interface?.websiteURL === "https://superskill.sh", "Codex manifest must use canonical SuperSkill identity");
check(mcp.mcpServers?.superskill?.url === "https://superskill.sh/mcp" && !mcp.mcpServers.superskill.headers, "Remote MCP must be canonical browse-only without headers");
check(Object.keys(mcp.mcpServers ?? {}).sort().join(",") === "superskill,superskill_local", "Plugin must expose the remote registry and bundled local lifecycle MCP only");
check(
  mcp.mcpServers?.superskill_local?.command === "npx"
    && JSON.stringify(mcp.mcpServers.superskill_local.args) === JSON.stringify(["--yes", `${runtime.cliPackage}@${runtime.cliVersion}`, "mcp", "superskill"])
    && !("env" in mcp.mcpServers.superskill_local)
    && !("headers" in mcp.mcpServers.superskill_local),
  "Local lifecycle MCP must use the exact pinned CLI without embedded credentials"
);
for (const required of [
  "superskill_local",
  "LOCAL_MCP_UNAVAILABLE",
  "activation_doctor",
  "recommend",
  "activation_start",
  "activation_mark_loaded",
  "activation_mark_invoked",
  "activation_finish",
  "activation_keep",
  "activation_remove",
  "never downgrade an exact link to an id-only/latest call"
]) check(skill.includes(required), `Shared skill must use local MCP contract: ${required}`);
check(!/npx[^\n]*(?:recommend|activation (?:start|mark|finish|keep|remove))/.test(skill), "Shared skill must not fall back to shell for managed lifecycle");
check(!skill.includes("@latest"), "Shared skill must not use latest");
check(cliRuntimeSource.includes(`cliPackage: "${runtime.cliPackage}"`) && cliRuntimeSource.includes(`cliVersion: "${runtime.cliVersion}"`) && cliRuntimeSource.includes(`activationContractVersion: "${runtime.activationContractVersion}"`), "CLI, runtime.json and generated pin contract must use one concrete version");
check(cliPackage.name === runtime.cliPackage && cliPackage.version === runtime.cliVersion, "CLI package version and SuperSkill runtime.json must match exactly before release");
check(
  (runtime.cliReleaseStatus === "unpublished" && runtime.cliIntegrity === null) ||
  (runtime.cliReleaseStatus === "published" && /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(runtime.cliIntegrity ?? "")),
  "Runtime publication state must fail closed or pin official npm integrity"
);
for (const command of [
  "claude plugin marketplace add elvismusli/onlyharness",
  "claude plugin install superskill@superskill",
  "codex plugin marketplace add elvismusli/onlyharness --ref main",
  "codex plugin add superskill@superskill"
]) check(cliReadme.includes(command), `CLI README must include ${command}`);

console.log("Codex SuperSkill plugin check passed: manifest, marketplace, shared skill, MCP and runtime are aligned");

function readJson<T>(file: string): T {
  check(existsSync(file), `Missing ${path.relative(root, file)}`);
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
