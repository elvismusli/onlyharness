import { readFileSync } from "node:fs";
import path from "node:path";

type ServerJson = {
  $schema?: string;
  name?: string;
  title?: string;
  description?: string;
  websiteUrl?: string;
  repository?: { url?: string; source?: string };
  version?: string;
  remotes?: Array<{ type?: string; url?: string; headers?: Array<{ name?: string; isSecret?: boolean; value?: string }> }>;
  packages?: Array<{ registryType?: string; identifier?: string; version?: string; transport?: { type?: string } }>;
};

const root = path.resolve(import.meta.dirname, "..");
const rootServerPath = path.join(root, "server.json");
const publicServerPath = path.join(root, "apps/registry-web/public/server.json");
const cliPackagePath = path.join(root, "packages/harness-cli/package.json");
const llmsPath = path.join(root, "apps/registry-web/public/llms.txt");
const readmePath = path.join(root, "README.md");

const expectedSchema = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
const expectedName = "com.onlyharness/registry";
const expectedRemoteUrl = "https://onlyharness.com/mcp";

const rootText = readFileSync(rootServerPath, "utf8");
const publicText = readFileSync(publicServerPath, "utf8");
const rootServer = JSON.parse(rootText) as ServerJson;
const publicServer = JSON.parse(publicText) as ServerJson;
const cliPackage = JSON.parse(readFileSync(cliPackagePath, "utf8")) as { version?: string };
const llms = readFileSync(llmsPath, "utf8");
const readme = readFileSync(readmePath, "utf8");

check(JSON.stringify(rootServer, null, 2) === JSON.stringify(publicServer, null, 2), "apps/registry-web/public/server.json must match root server.json exactly");
check(rootServer.$schema === expectedSchema, `server.json must use ${expectedSchema}`);
check(rootServer.name === expectedName, `server.json name must be ${expectedName}`);
check(rootServer.title === "OnlyHarness Registry", "server.json title must be OnlyHarness Registry");
check(Boolean(rootServer.description?.includes("onlyharness.com")), "server.json description must mention onlyharness.com");
check(rootServer.websiteUrl === "https://onlyharness.com", "server.json websiteUrl must be https://onlyharness.com");
check(rootServer.repository?.url === "https://github.com/elvismusli/onlyharness", "server.json repository URL must point to onlyharness GitHub repo");
check(rootServer.repository?.source === "github", "server.json repository source must be github");
check(rootServer.version === cliPackage.version, "server.json version must match packages/harness-cli/package.json version");

check(Array.isArray(rootServer.remotes) && rootServer.remotes.length === 1, "server.json must expose exactly one remote transport");
const remote = rootServer.remotes?.[0];
check(remote?.type === "streamable-http", "server.json remote transport must be streamable-http");
check(remote?.url === expectedRemoteUrl, `server.json remote URL must be ${expectedRemoteUrl}`);
check(!remote?.headers?.some((header) => header.value || header.isSecret), "server.json remote must not embed secret-bearing headers");
check(!rootServer.packages?.length, "server.json must stay remote-only until there is a real MCP package, not just the hh CLI package");

for (const docs of [
  { name: "llms.txt", text: llms },
  { name: "README.md", text: readme }
]) {
  check(docs.text.includes("https://onlyharness.com/server.json"), `${docs.name} must link public MCP Registry metadata`);
  check(docs.text.includes(expectedRemoteUrl), `${docs.name} must link the MCP remote endpoint`);
  check(docs.text.includes("https://onlyharness.com/api/openapi.json"), `${docs.name} must link OpenAPI`);
}

console.log("MCP Registry metadata check passed: server.json schema, remote transport, public copy, and docs links are in sync");

function check(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
