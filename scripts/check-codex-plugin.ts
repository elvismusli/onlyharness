import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pluginRoot = path.join(root, "plugins/superskill");
const manifest = readJson<Record<string, any>>(path.join(pluginRoot, ".codex-plugin/plugin.json"));
const claude = readJson<Record<string, any>>(path.join(pluginRoot, ".claude-plugin/plugin.json"));
const marketplace = readJson<Record<string, any>>(path.join(root, ".agents/plugins/marketplace.json"));
const runtime = readJson<Record<string, string>>(path.join(pluginRoot, "runtime.json"));
const cliPackage = readJson<Record<string, string>>(path.join(root, "packages/harness-cli/package.json"));
const mcp = readJson<Record<string, any>>(path.join(pluginRoot, ".mcp.json"));
const skill = readFileSync(path.join(pluginRoot, "skills/superskill/SKILL.md"), "utf8");
const cliRuntimeSource = readFileSync(path.join(root, "packages/harness-cli/src/lib/superskill-types.ts"), "utf8");
const cliReadme = readFileSync(path.join(root, "packages/harness-cli/README.md"), "utf8");

check(manifest.name === "superskill", "Codex manifest name must be superskill");
check(manifest.version === claude.version, "Claude and Codex manifest versions must match");
check(manifest.skills === "./skills/", "Codex skills path must be ./skills/");
check(manifest.mcpServers === "./.mcp.json", "Codex MCP path must be ./.mcp.json");
check(!("apps" in manifest) && !("hooks" in manifest), "Internal-alpha plugin must not declare apps or hooks");
check(!manifest.interface?.privacyPolicyURL && !manifest.interface?.termsOfServiceURL, "Dead privacy/terms URLs must be omitted");
check(marketplace.name === "onlyharness", "Codex marketplace name must be onlyharness");
check(marketplace.plugins?.length === 1 && marketplace.plugins[0]?.name === "superskill", "Codex marketplace must expose superskill only");
check(marketplace.plugins[0]?.source?.path === "./plugins/superskill", "Codex local source path must start with ./");
check(marketplace.plugins[0]?.policy?.products?.includes("CODEX"), "Codex marketplace policy must include CODEX");
check(mcp.mcpServers?.onlyharness?.url === "https://onlyharness.com/mcp" && !mcp.mcpServers.onlyharness.headers, "MCP must be browse-only without headers");
check(skill.includes(`npx --yes ${runtime.cliPackage}@${runtime.cliVersion}`), "Shared skill must invoke the concrete runtime version");
check(!skill.includes("@latest"), "Shared skill must not use latest");
check(cliRuntimeSource.includes(`cliPackage: "${runtime.cliPackage}"`) && cliRuntimeSource.includes(`cliVersion: "${runtime.cliVersion}"`) && cliRuntimeSource.includes(`activationContractVersion: "${runtime.activationContractVersion}"`), "CLI, runtime.json and generated pin contract must use one concrete version");
check(cliPackage.name === runtime.cliPackage && cliPackage.version === runtime.cliVersion, "CLI package version and SuperSkill runtime.json must match exactly before release");
for (const command of [
  "claude plugin marketplace add elvismusli/onlyharness",
  "claude plugin install superskill@onlyharness",
  "codex plugin marketplace add elvismusli/onlyharness --ref main",
  "codex plugin add superskill@onlyharness"
]) check(cliReadme.includes(command), `CLI README must include ${command}`);

console.log("Codex SuperSkill plugin check passed: manifest, marketplace, shared skill, MCP and runtime are aligned");

function readJson<T>(file: string): T {
  check(existsSync(file), `Missing ${path.relative(root, file)}`);
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
