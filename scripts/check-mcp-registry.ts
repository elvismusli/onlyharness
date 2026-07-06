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

type ProtectedResourceMetadata = {
  resource?: string;
  authorization_servers?: string[];
  bearer_methods_supported?: string[];
  resource_documentation?: string;
};

const root = path.resolve(import.meta.dirname, "..");
const rootServerPath = path.join(root, "server.json");
const publicServerPath = path.join(root, "apps/registry-web/public/server.json");
const protectedResourcePath = path.join(root, "apps/registry-web/public/.well-known/oauth-protected-resource");
const caddyfilePaths = [
  path.join(root, "infra/Caddyfile"),
  path.join(root, "infra/Caddyfile.local-smoke")
];
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
const protectedResource = JSON.parse(readFileSync(protectedResourcePath, "utf8")) as ProtectedResourceMetadata;
const caddyfiles = caddyfilePaths.map((file) => ({ file, text: readFileSync(file, "utf8") }));
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

check(protectedResource.resource === expectedRemoteUrl, "OAuth protected resource metadata must point at the MCP remote");
check(protectedResource.authorization_servers?.includes("https://onlyharness.com"), "OAuth protected resource metadata must name onlyharness.com as the auth server");
check(protectedResource.bearer_methods_supported?.includes("header"), "OAuth protected resource metadata must support Bearer header auth");
check(protectedResource.resource_documentation === "https://onlyharness.com/llms.txt", "OAuth protected resource metadata must link llms.txt");
check(!JSON.stringify(protectedResource).includes("127.0.0.1"), "OAuth protected resource metadata must not contain local URLs");
check(!JSON.stringify(protectedResource).includes("localhost"), "OAuth protected resource metadata must not contain localhost URLs");

for (const { file, text } of caddyfiles) {
  const name = path.relative(root, file);
  const protectedResourceHandle = /handle\s+\/\.well-known\/oauth-protected-resource\s*\{[\s\S]*?file_server[\s\S]*?\}/.exec(text)?.[0] ?? "";
  const protectedResourceHandleIndex = text.indexOf("handle /.well-known/oauth-protected-resource");
  const spaFallbackIndex = text.indexOf("try_files {path} /index.html");
  check(Boolean(protectedResourceHandle), `${name} must handle /.well-known/oauth-protected-resource`);
  check(
    protectedResourceHandleIndex >= 0 && spaFallbackIndex >= 0 && protectedResourceHandleIndex < spaFallbackIndex,
    `${name} must serve /.well-known/oauth-protected-resource before the SPA fallback`
  );
  check(protectedResourceHandle.includes("header Content-Type application/json"), `${name} must serve the extensionless protected-resource metadata as application/json`);
}

for (const docs of [
  { name: "llms.txt", text: llms },
  { name: "README.md", text: readme }
]) {
  check(docs.text.includes("https://onlyharness.com/server.json"), `${docs.name} must link public MCP Registry metadata`);
  check(docs.text.includes(expectedRemoteUrl), `${docs.name} must link the MCP remote endpoint`);
  check(docs.text.includes("https://onlyharness.com/api/openapi.json"), `${docs.name} must link OpenAPI`);
  check(docs.text.includes("https://onlyharness.com/.well-known/oauth-protected-resource"), `${docs.name} must link OAuth protected resource metadata`);
}

console.log("MCP Registry metadata check passed: server.json schema, remote transport, public copy, and docs links are in sync");

function check(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
