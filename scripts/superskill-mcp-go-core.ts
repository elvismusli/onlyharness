import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const REQUIRED_LOCAL_TOOLS = [
  "activation_doctor",
  "recommend",
  "activation_start",
  "activation_mark_loaded",
  "activation_mark_invoked",
  "activation_finish",
  "activation_keep",
  "activation_remove"
] as const;

type Runtime = {
  cliPackage: string;
  cliVersion: string;
  pluginVersion: string;
  cliIntegrity: string | null;
  cliReleaseStatus: "published" | "unpublished";
  activationContractVersion: string;
};

type Marketplace = {
  name?: string;
  plugins?: Array<{ name?: string; source?: unknown }>;
};

export type SuperSkillDistributionContract = {
  marketplace: "superskill";
  pluginCoordinate: "superskill@superskill";
  cli: string;
  pluginVersion: string;
  oneLink: string;
  localServer: "superskill_local";
  localTools: readonly string[];
  releaseStatus: Runtime["cliReleaseStatus"];
};

export function validateSuperSkillDistributionContract(root: string): SuperSkillDistributionContract {
  const runtime = readJson<Runtime>(root, "plugins/superskill/runtime.json");
  const cliPackage = readJson<{ name?: string; version?: string }>(root, "packages/harness-cli/package.json");
  const claudeManifest = readJson<{ name?: string; version?: string }>(root, "plugins/superskill/.claude-plugin/plugin.json");
  const codexManifest = readJson<{ name?: string; version?: string; mcpServers?: string }>(root, "plugins/superskill/.codex-plugin/plugin.json");
  const claudeMarketplace = readJson<Marketplace>(root, ".claude-plugin/marketplace.json");
  const codexMarketplace = readJson<Marketplace>(root, ".agents/plugins/marketplace.json");
  const mcp = readJson<{ mcpServers?: Record<string, { type?: string; url?: string; command?: string; args?: string[] }> }>(root, "plugins/superskill/.mcp.json");
  const bootstrap = readJson<{ installer?: { package?: string; version?: string; integrity?: string | null; releaseStatus?: string } }>(root, "data/superskill/bootstrap.json");
  const skill = read(root, "plugins/superskill/skills/superskill/SKILL.md");
  const cliReadme = read(root, "packages/harness-cli/README.md");
  const currentPlans = [
    "docs/plans/superskill-mvp/04-client-integration-and-activation.md",
    "docs/plans/superskill-mvp/05-verification-and-rollout.md",
    "docs/plans/superskill-mvp/06-execution-backlog.md"
  ].map((file) => read(root, file)).join("\n");

  assert.equal(cliPackage.name, runtime.cliPackage);
  assert.equal(cliPackage.version, runtime.cliVersion);
  assert.equal(claudeManifest.name, "superskill");
  assert.equal(codexManifest.name, "superskill");
  assert.equal(claudeManifest.version, runtime.pluginVersion);
  assert.equal(codexManifest.version, runtime.pluginVersion);
  assert.equal(codexManifest.mcpServers, "./.mcp.json");
  assert.equal(claudeMarketplace.name, "superskill");
  assert.ok(claudeMarketplace.plugins?.some((entry) => entry.name === "superskill"));
  assert.equal(codexMarketplace.name, "superskill");
  assert.deepEqual(codexMarketplace.plugins?.map((entry) => entry.name), ["superskill"]);

  const local = mcp.mcpServers?.superskill_local;
  assert.equal(local?.command, "npx");
  assert.deepEqual(local?.args, ["--yes", `${runtime.cliPackage}@${runtime.cliVersion}`, "mcp", "superskill"]);
  assert.equal(mcp.mcpServers?.superskill?.type, "http");
  assert.equal(mcp.mcpServers?.superskill?.url, "https://superskill.sh/mcp");
  assert.equal(bootstrap.installer?.package, runtime.cliPackage);
  assert.equal(bootstrap.installer?.version, runtime.cliVersion);
  assert.equal(bootstrap.installer?.integrity, runtime.cliIntegrity);
  assert.equal(bootstrap.installer?.releaseStatus, runtime.cliReleaseStatus);

  for (const tool of REQUIRED_LOCAL_TOOLS) assert.ok(skill.includes(tool), `Shared skill is missing local MCP tool ${tool}`);
  assert.ok(skill.includes("superskill_local"));
  assert.ok(!/npx[^\n]*(?:recommend|activation (?:start|mark|finish|keep|remove))/.test(skill), "Shared skill must not replace the MCP lifecycle with shell commands");

  const pluginCoordinate = "superskill@superskill" as const;
  for (const command of [
    "claude plugin marketplace add elvismusli/onlyharness",
    `claude plugin install ${pluginCoordinate}`,
    "codex plugin marketplace add elvismusli/onlyharness --ref main",
    `codex plugin add ${pluginCoordinate}`
  ]) assert.ok(cliReadme.includes(command), `CLI README is missing ${command}`);
  assert.ok(currentPlans.includes(`claude plugin install ${pluginCoordinate}`));
  assert.ok(currentPlans.includes(`codex plugin add ${pluginCoordinate}`));
  assert.ok(!currentPlans.includes("superskill@onlyharness"), "Current SuperSkill plans contain the obsolete plugin coordinate");
  assert.ok(!currentPlans.includes("marketplace update onlyharness"), "Current SuperSkill plans contain the obsolete Claude marketplace name");
  assert.ok(!currentPlans.includes("marketplace upgrade onlyharness"), "Current SuperSkill plans contain the obsolete Codex marketplace name");

  const oneLink = `https://superskill.sh/api/superskill/install`;
  assert.ok(cliReadme.includes(`npx --yes ${runtime.cliPackage}@${runtime.cliVersion} superskill install ${oneLink} --auto`));

  return {
    marketplace: "superskill",
    pluginCoordinate,
    cli: `${runtime.cliPackage}@${runtime.cliVersion}`,
    pluginVersion: runtime.pluginVersion,
    oneLink,
    localServer: "superskill_local",
    localTools: REQUIRED_LOCAL_TOOLS,
    releaseStatus: runtime.cliReleaseStatus
  };
}

export async function probeBundledSuperSkillMcp(root: string): Promise<{ tools: string[]; doctorCode: string; stateInitialized: false }> {
  const cli = path.join(root, "packages/harness-cli/dist/hh.mjs");
  assert.ok(existsSync(cli), "Build onlyharness before the MCP-primary smoke");
  const temporary = mkdtempSync(path.join(os.tmpdir(), "superskill-mcp-go-"));
  const project = path.join(temporary, "project");
  const home = path.join(temporary, "home");
  mkdirSync(project);
  mkdirSync(home);
  execFileSync("git", ["init", "-q"], { cwd: project });
  const env = cleanEnvironment({
    HOME: home,
    PATH: process.env.PATH ?? "",
    HH_SUPERSKILL_DOCTOR_SKIP_NPM_VIEW: "1",
    HH_SUPERSKILL_TELEMETRY: "off",
    NO_COLOR: "1"
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp", "superskill"],
    cwd: project,
    env,
    stderr: "pipe"
  });
  const client = new Client({ name: "superskill-mcp-go-smoke", version: "1.0.0" }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, async () => ({
    roots: [{ uri: pathToFileURL(execFileSync("pwd", ["-P"], { cwd: project, encoding: "utf8" }).trim()).href, name: "workspace" }]
  }));
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const tools = listed.tools.map((tool) => tool.name);
    assert.deepEqual(tools, [...REQUIRED_LOCAL_TOOLS]);
    const doctor = await client.callTool({ name: "activation_doctor", arguments: { client: "codex" } });
    assert.equal(doctor.isError, undefined);
    const payload = structured(doctor);
    assert.equal(payload.ok, true);
    assert.equal(payload.code, "ACTIVATION_DOCTOR_ATTENTION");
    assert.equal(existsSync(path.join(project, ".onlyharness")), false, "Read-only MCP doctor must not initialize project state");
    return { tools, doctorCode: payload.code as string, stateInitialized: false };
  } finally {
    await client.close().catch(() => undefined);
    rmSync(temporary, { recursive: true, force: true });
  }
}

function structured(result: CallToolResult): Record<string, unknown> {
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

function readJson<T>(root: string, relative: string): T {
  return JSON.parse(read(root, relative)) as T;
}

function read(root: string, relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}

function cleanEnvironment(values: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = { ...values };
  for (const key of ["TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS"]) {
    if (process.env[key]) result[key] = process.env[key]!;
  }
  return result;
}
