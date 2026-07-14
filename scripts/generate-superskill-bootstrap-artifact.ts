import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const pluginRoot = path.join(root, "plugins/superskill/skills/superskill");
const outputPath = path.join(root, "packages/harness-cli/src/generated/superskill-plugin.ts");
const contractPath = path.join(root, "data/superskill/bootstrap.json");
const relativeFiles = ["SKILL.md", "references/consent.md", "references/lifecycle.md"];
const files = await Promise.all(relativeFiles.map(async (relative) => ({
  path: relative,
  content: await readFile(path.join(pluginRoot, relative), "utf8")
})));
const artifactDigest = digest(files);
const runtime = JSON.parse(await readFile(path.join(root, "plugins/superskill/runtime.json"), "utf8")) as {
  cliPackage: string;
  cliVersion: string;
  pluginVersion: string;
  cliIntegrity: string | null;
  cliReleaseStatus: "published" | "unpublished";
};
const generated = `// generated from plugins/superskill/skills/superskill; do not edit
export const UNIVERSAL_SUPERSKILL_FILES = ${JSON.stringify(files, null, 2)} as const;
export const UNIVERSAL_SUPERSKILL_ARTIFACT_DIGEST = ${JSON.stringify(artifactDigest)} as const;
`;
const adapterContract = (client: "codex" | "claude-code") => {
  return client === "codex"
    ? {
      client,
      path: ".codex/config.toml",
      mcp_servers: {
        superskill: {
          url: "https://superskill.sh/mcp",
          default_tools_approval_mode: "prompt"
        },
        superskill_local: {
          command: "npx",
          args: ["--yes", `${runtime.cliPackage}@${runtime.cliVersion}`, "mcp", "superskill"],
          default_tools_approval_mode: "prompt"
        }
      },
      tokenStored: false
    }
    : {
      client,
      path: ".mcp.json",
      mcpServers: {
        superskill: {
          type: "http",
          url: "https://superskill.sh/mcp"
        },
        superskill_local: {
          command: "npx",
          args: ["--yes", `${runtime.cliPackage}@${runtime.cliVersion}`, "mcp", "superskill"]
        }
      },
      credentialTransport: "os-keychain-browser-broker",
      tokenStored: false
    };
};
const adapter = (client: "codex" | "claude-code") => ({
  path: client === "codex" ? ".codex/config.toml" : ".mcp.json",
  contractDigest: digestCanonical(adapterContract(client))
});
const contract = `${JSON.stringify({
  schemaVersion: "superskill.bootstrap-contract.v1",
  installer: {
    package: runtime.cliPackage,
    version: runtime.cliVersion,
    integrity: runtime.cliIntegrity,
    releaseStatus: runtime.cliReleaseStatus
  },
  universalSkill: { name: "superskill", version: runtime.pluginVersion, artifactDigest },
  clientAdapters: { codex: adapter("codex"), "claude-code": adapter("claude-code") }
}, null, 2)}\n`;

if (process.argv.includes("--write")) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated, "utf8");
  await writeFile(contractPath, contract, "utf8");
  process.stdout.write(`updated ${path.relative(root, outputPath)}\n`);
} else {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  const currentContract = await readFile(contractPath, "utf8").catch(() => "");
  if (current !== generated) throw new Error(`${path.relative(root, outputPath)} is stale; run this script with --write`);
  if (currentContract !== contract) throw new Error(`${path.relative(root, contractPath)} is stale; run this script with --write`);
  process.stdout.write(`ok ${path.relative(root, outputPath)} (${artifactDigest})\n`);
}

function digest(input: Array<{ path: string; content: string }>): string {
  const hash = createHash("sha256");
  for (const file of [...input].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(file.path, "utf8");
    hash.update("\0");
    hash.update(createHash("sha256").update(file.content, "utf8").digest("hex"), "utf8");
    hash.update("\n");
  }
  return `sha256:${hash.digest("hex")}`;
}

function digestCanonical(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}
