import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { openapi } from "../apps/harness-api/src/openapi.js";

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
const authorizationServerPath = path.join(root, "apps/registry-web/public/.well-known/oauth-authorization-server");
const caddyfilePaths = [
  path.join(root, "infra/Caddyfile"),
  path.join(root, "infra/Caddyfile.local-smoke")
];
const cliPackagePath = path.join(root, "packages/harness-cli/package.json");
const cliSourcePath = path.join(root, "packages/harness-cli/src/index.ts");
const llmsPath = path.join(root, "apps/registry-web/public/llms.txt");
const readmePath = path.join(root, "README.md");

const expectedSchema = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
const expectedName = "com.onlyharness/registry";
const expectedRemoteUrl = "https://superskill.sh/mcp";
const expectedMcpTools = [
  "search_harnesses",
  "harness_detail",
  "search_resources",
  "resource_detail",
  "resource_use_instructions",
  "pull_instructions",
  "pull_harness",
  "search_docs",
  "publish_markdown_to_harness",
  "publish_resource_package"
];

const rootText = readFileSync(rootServerPath, "utf8");
const publicText = readFileSync(publicServerPath, "utf8");
const rootServer = JSON.parse(rootText) as ServerJson;
const publicServer = JSON.parse(publicText) as ServerJson;
const protectedResource = JSON.parse(readFileSync(protectedResourcePath, "utf8")) as ProtectedResourceMetadata;
check(!existsSync(authorizationServerPath), "vanity OAuth authorization-server metadata must stay absent until one issuer owns a complete valid flow");
const caddyfiles = caddyfilePaths.map((file) => ({ file, text: readFileSync(file, "utf8") }));
const cliPackage = JSON.parse(readFileSync(cliPackagePath, "utf8")) as { version?: string };
const cliSource = readFileSync(cliSourcePath, "utf8");
const mcpSource = readFileSync(path.join(root, "apps/harness-api/src/mcp.ts"), "utf8");
const llms = readFileSync(llmsPath, "utf8");
const readme = readFileSync(readmePath, "utf8");

check(JSON.stringify(rootServer, null, 2) === JSON.stringify(publicServer, null, 2), "apps/registry-web/public/server.json must match root server.json exactly");
check(rootServer.$schema === expectedSchema, `server.json must use ${expectedSchema}`);
check(rootServer.name === expectedName, `server.json name must be ${expectedName}`);
check(rootServer.title === "SuperSkill Registry", "server.json title must be SuperSkill Registry");
check(Boolean(rootServer.description?.includes("superskill.sh")), "server.json description must mention superskill.sh");
check(rootServer.websiteUrl === "https://superskill.sh", "server.json websiteUrl must be https://superskill.sh");
check(rootServer.repository?.url === "https://github.com/elvismusli/onlyharness", "server.json repository URL must point to onlyharness GitHub repo");
check(rootServer.repository?.source === "github", "server.json repository source must be github");
check(rootServer.version === cliPackage.version, "server.json version must match packages/harness-cli/package.json version");
check(cliSource.includes(`.version("${cliPackage.version}")`), "hh --version source must match packages/harness-cli/package.json version");
check(mcpSource.includes(`MCP_SERVER_VERSION = "${cliPackage.version}"`), "MCP server version must match packages/harness-cli/package.json version");
const mcpInventorySource = /export const MCP_TOOL_NAMES = \[([\s\S]*?)\] as const;/.exec(mcpSource)?.[1] ?? "";
const mcpInventory = [...mcpInventorySource.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
check(JSON.stringify(mcpInventory) === JSON.stringify(expectedMcpTools), "MCP source tool inventory must stay exact and ordered");
const openapiMcp = openapi.paths["/mcp"].post as { "x-mcp-server-version"?: string; "x-mcp-tools"?: string[]; description?: string };
check(openapiMcp["x-mcp-server-version"] === cliPackage.version, "OpenAPI MCP version must match the runtime version");
check(JSON.stringify(openapiMcp["x-mcp-tools"]) === JSON.stringify(expectedMcpTools), "OpenAPI MCP tool inventory must match runtime order exactly");
check(Boolean(openapiMcp.description?.includes("isError=true") && openapiMcp.description.includes("structuredContent")), "OpenAPI must document MCP logical failure semantics");

check(Array.isArray(rootServer.remotes) && rootServer.remotes.length === 1, "server.json must expose exactly one remote transport");
const remote = rootServer.remotes?.[0];
check(remote?.type === "streamable-http", "server.json remote transport must be streamable-http");
check(remote?.url === expectedRemoteUrl, `server.json remote URL must be ${expectedRemoteUrl}`);
check(!remote?.headers?.some((header) => header.value || header.isSecret), "server.json remote must not embed secret-bearing headers");
check(!rootServer.packages?.length, "server.json must stay remote-only until there is a real MCP package, not just the hh CLI package");

check(protectedResource.resource === expectedRemoteUrl, "OAuth protected resource metadata must point at the MCP remote");
check(protectedResource.authorization_servers === undefined, "OAuth protected resource metadata must not advertise a vanity authorization server");
check(protectedResource.bearer_methods_supported?.includes("header"), "OAuth protected resource metadata must support Bearer header auth");
check(protectedResource.resource_documentation === "https://superskill.sh/llms.txt", "OAuth protected resource metadata must link llms.txt");
check(!JSON.stringify(protectedResource).includes("127.0.0.1"), "OAuth protected resource metadata must not contain local URLs");
check(!JSON.stringify(protectedResource).includes("localhost"), "OAuth protected resource metadata must not contain localhost URLs");

for (const { file, text } of caddyfiles) {
  const name = path.relative(root, file);
  const protectedResourceHandle = /handle\s+\/\.well-known\/oauth-protected-resource\s*\{[\s\S]*?file_server[\s\S]*?\}/.exec(text)?.[0] ?? "";
  const protectedResourceHandleIndex = text.indexOf("handle /.well-known/oauth-protected-resource");
  const authorizationServerHandle = /handle\s+\/\.well-known\/oauth-authorization-server\s*\{[\s\S]*?respond 404[\s\S]*?\}/.exec(text)?.[0] ?? "";
  const authorizationServerHandleIndex = text.indexOf("handle /.well-known/oauth-authorization-server");
  const spaFallbackIndex = text.indexOf("try_files {path} /index.html");
  check(Boolean(protectedResourceHandle), `${name} must handle /.well-known/oauth-protected-resource`);
  check(Boolean(authorizationServerHandle), `${name} must return 404 for /.well-known/oauth-authorization-server`);
  check(
    protectedResourceHandleIndex >= 0 && spaFallbackIndex >= 0 && protectedResourceHandleIndex < spaFallbackIndex,
    `${name} must serve /.well-known/oauth-protected-resource before the SPA fallback`
  );
  check(
    authorizationServerHandleIndex >= 0 && spaFallbackIndex >= 0 && authorizationServerHandleIndex < spaFallbackIndex,
    `${name} must reject /.well-known/oauth-authorization-server before the SPA fallback`
  );
  check(protectedResourceHandle.includes("header Content-Type application/json"), `${name} must serve the extensionless protected-resource metadata as application/json`);
  check(!authorizationServerHandle.includes("file_server"), `${name} must not serve authorization-server metadata`);
  check(authorizationServerHandle.includes('header Cache-Control "no-store"'), `${name} authorization-server 404 must not be cached`);
}

for (const docs of [
  { name: "llms.txt", text: llms },
  { name: "README.md", text: readme }
]) {
  check(docs.text.includes("https://superskill.sh/server.json"), `${docs.name} must link public MCP Registry metadata`);
  check(docs.text.includes(expectedRemoteUrl), `${docs.name} must link the MCP remote endpoint`);
  check(docs.text.includes("https://superskill.sh/api/openapi.json"), `${docs.name} must link OpenAPI`);
  check(docs.text.includes("https://superskill.sh/.well-known/oauth-protected-resource"), `${docs.name} must link OAuth protected resource metadata`);
  check(docs.text.includes("superskill_local"), `${docs.name} must document the local browser-auth broker for protected actions`);
  check(!docs.text.includes("--bearer-token-env-var HH_TOKEN"), `${docs.name} must not configure interactive MCP credentials through the environment`);
  check(!docs.text.includes("HH_SUPERSKILL_TOKEN"), `${docs.name} must not expose the transition-only internal credential`);
  check(!docs.text.includes("/auth/device/"), `${docs.name} must not expose hidden transition device endpoints`);
  check(docs.text.includes("does not advertise") || docs.text.includes("intentionally returns 404"), `${docs.name} must document that no vanity authorization server is advertised`);
  for (const tool of expectedMcpTools) check(docs.text.includes(tool), `${docs.name} must list MCP tool ${tool}`);
  check(docs.text.includes("structuredContent"), `${docs.name} must document MCP structured results`);
  check(docs.text.includes("isError"), `${docs.name} must document MCP logical error results`);
}

console.log("MCP Registry metadata check passed: server.json schema, remote transport, public copy, and docs links are in sync");

function check(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
