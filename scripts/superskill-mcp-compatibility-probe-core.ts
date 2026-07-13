import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CODEX_PROBE_VERSION = "0.144.3";
export const CLAUDE_PROBE_VERSION = "2.1.112";
export const PROBE_TOKEN_ENV = "SUPERSKILL_ACCESS_TOKEN";
export const PROBE_STDIO_ENV = [
  "SUPERSKILL_ACCESS_TOKEN",
  "SUPERSKILL_PROBE_API_URL",
  "SUPERSKILL_PROBE_CLIENT",
  "SUPERSKILL_PROBE_ROOT",
  "SUPERSKILL_PROBE_STATE_ROOT"
] as const;

const CLIENT_ENV_PASSTHROUGH = [
  "PATH",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS"
] as const;

const CLIENT_ENV_OVERRIDES = new Set([
  ...PROBE_STDIO_ENV,
  "HOME",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "NPM_CONFIG_CACHE",
  "NPM_CONFIG_USERCONFIG",
  "NPM_CONFIG_UPDATE_NOTIFIER",
  "NO_COLOR",
  "CI"
]);

export type ParsedMcpToolCall = {
  server: "superskill_remote_probe" | "superskill_local_probe";
  tool: "publish_resource_package" | "recommend_probe" | "root_probe" | "denied_mutation";
  callIdBound: true;
  callIdDigest: string;
  code: string;
  decision?: "no_safe_match";
  mode?: "roots_list" | "explicit_fallback";
  canonicalMatch?: boolean;
  workspaceDiffCount?: number;
  stateDiffCount?: number;
};

type RawMcpIdentity = Pick<ParsedMcpToolCall, "server" | "tool">;

const EXPECTED_TOOL_IDENTITIES: RawMcpIdentity[] = [
  { server: "superskill_remote_probe", tool: "publish_resource_package" },
  { server: "superskill_local_probe", tool: "recommend_probe" },
  { server: "superskill_local_probe", tool: "root_probe" },
  { server: "superskill_local_probe", tool: "denied_mutation" }
];

export class CompatibilityProbeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export type ProbeClient = "codex" | "claude-code";

export function assertExactClientVersion(client: ProbeClient, output: string): void {
  const expected = client === "codex" ? CODEX_PROBE_VERSION : CLAUDE_PROBE_VERSION;
  const observed = output.match(/\d+\.\d+\.\d+/)?.[0];
  if (observed !== expected) {
    throw new CompatibilityProbeError("PROBE_CLIENT_VERSION_MISMATCH", `${client} exact-pinned client is unavailable`);
  }
}

export function assertLocalSupabaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CompatibilityProbeError("PROBE_SUPABASE_URL_INVALID", "Local Supabase URL is invalid");
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new CompatibilityProbeError("PROBE_LOCAL_SUPABASE_REQUIRED", "Compatibility probe accepts local Supabase only");
  }
  return url;
}

export function assertLocalPostgresUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CompatibilityProbeError("PROBE_DATABASE_URL_INVALID", "Local Postgres URL is invalid");
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new CompatibilityProbeError("PROBE_LOCAL_DATABASE_REQUIRED", "Compatibility probe accepts local Postgres only");
  }
  return url;
}

export function buildStrictClientEnv(source: NodeJS.ProcessEnv, overrides: Record<string, string>): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const name of CLIENT_ENV_PASSTHROUGH) {
    const value = source[name];
    if (value) result[name] = value;
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (!CLIENT_ENV_OVERRIDES.has(name)) {
      throw new CompatibilityProbeError("PROBE_CLIENT_ENV_INVALID", `Client environment key ${name} is not allowlisted`);
    }
    result[name] = value;
  }
  for (const forbidden of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "SUPERSKILL_SUBJECT_SALT"]) {
    if (forbidden in result) throw new CompatibilityProbeError("PROBE_CLIENT_ENV_UNSAFE", "Privileged API material reached a client environment");
  }
  return result;
}

export function measureInvalidPluginPreflight(
  client: ProbeClient,
  input: unknown,
  startServer: () => void
): { code: string; serverStartCount: number } {
  let serverStartCount = 0;
  let code = "PROBE_INVALID_SCHEMA_ACCEPTED";
  try {
    validateProbePluginConfig(client, input);
    serverStartCount += 1;
    startServer();
  } catch (error) {
    code = error instanceof CompatibilityProbeError ? error.code : "PROBE_INVALID_SCHEMA_UNKNOWN";
  }
  return { code, serverStartCount };
}

export function canonicalRoot(root: string): { path: string; uri: string } {
  const canonical = realpathSync(root);
  return { path: canonical, uri: pathToFileURL(canonical).href };
}

export function resolveExplicitFallback(expectedRoot: string, candidate: string): { uri: string; exactExpectedRoot: boolean } {
  const expected = canonicalRoot(expectedRoot);
  const unresolved = path.isAbsolute(candidate) ? candidate : path.resolve(expected.path, candidate);
  let resolved: string;
  try {
    resolved = realpathSync(unresolved);
  } catch {
    throw new CompatibilityProbeError("PROBE_ROOT_INVALID", "Explicit root fallback does not exist");
  }
  const relative = path.relative(expected.path, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new CompatibilityProbeError("PROBE_ROOT_OUTSIDE_WORKSPACE", "Explicit root fallback escapes the expected workspace");
  }
  const uri = pathToFileURL(resolved).href;
  return { uri, exactExpectedRoot: resolved === expected.path };
}

export function snapshotTree(root: string): string {
  const entries: string[] = [];
  visit(root, "", entries);
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

function visit(root: string, relative: string, entries: string[]): void {
  const target = relative ? path.join(root, relative) : root;
  let stat;
  try {
    stat = lstatSync(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!relative && code === "ENOENT") {
      entries.push("root:absent");
      return;
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    entries.push(`l:${relative}:${readlinkSync(target)}`);
    return;
  }
  if (stat.isDirectory()) {
    entries.push(`d:${relative}`);
    for (const name of readdirSync(target).sort()) visit(root, path.join(relative, name), entries);
    return;
  }
  if (stat.isFile()) {
    entries.push(`f:${relative}:${stat.mode & 0o777}:${createHash("sha256").update(readFileSync(target)).digest("hex")}`);
    return;
  }
  entries.push(`o:${relative}:${stat.mode}`);
}

type McpServerConfig = Record<string, unknown>;

export function validateProbePluginConfig(client: ProbeClient, input: unknown): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalidPlugin();
  const servers = client === "codex"
    ? (input as { mcp_servers?: unknown }).mcp_servers
    : (input as { mcpServers?: unknown }).mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) invalidPlugin();
  const record = servers as Record<string, McpServerConfig>;
  if (client === "codex" ? "mcpServers" in input : "mcp_servers" in input) invalidPlugin();
  const names = Object.keys(record).sort();
  if (names.join(",") !== "superskill_local_probe,superskill_remote_probe") invalidPlugin();
  const remote = record.superskill_remote_probe;
  const local = record.superskill_local_probe;
  if (remote?.type !== "http" || typeof remote.url !== "string" || !isLoopbackHttp(remote.url)) invalidPlugin();
  const expectedServerArg = client === "codex" ? "probe-server.mjs" : "${CLAUDE_PLUGIN_ROOT}/probe-server.mjs";
  if (local?.command !== "node" || !Array.isArray(local.args) || local.args.length !== 1 || local.args[0] !== expectedServerArg) invalidPlugin();
  if (client === "codex" ? local.cwd !== "." : typeof local.cwd !== "undefined") invalidPlugin();
  if (client === "codex") {
    if (remote.bearer_token_env_var !== PROBE_TOKEN_ENV || "headers" in remote) invalidPlugin();
    if (!Array.isArray(local.env_vars) || [...local.env_vars].sort().join(",") !== [...PROBE_STDIO_ENV].sort().join(",") || "env" in local) invalidPlugin();
  } else {
    const headers = remote.headers;
    if (!headers || typeof headers !== "object" || Array.isArray(headers)) invalidPlugin();
    if ((headers as Record<string, unknown>).Authorization !== `Bearer \${${PROBE_TOKEN_ENV}}` || "bearer_token_env_var" in remote) invalidPlugin();
    const env = local.env;
    if (!env || typeof env !== "object" || Array.isArray(env) || "env_vars" in local) invalidPlugin();
    if (Object.keys(env as Record<string, unknown>).sort().join(",") !== [...PROBE_STDIO_ENV].sort().join(",")) invalidPlugin();
    for (const name of PROBE_STDIO_ENV) if ((env as Record<string, unknown>)[name] !== `\${${name}}`) invalidPlugin();
  }
  const serialized = JSON.stringify(input);
  if (/eyJ[A-Za-z0-9_-]{20,}|(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}/.test(serialized)) invalidPlugin();
}

function isLoopbackHttp(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.pathname === "/mcp";
  } catch {
    return false;
  }
}

function invalidPlugin(): never {
  throw new CompatibilityProbeError("PROBE_PLUGIN_SCHEMA_INVALID", "Compatibility plugin preflight rejected the MCP schema");
}

export function parseCodexMcpToolCalls(output: string): ParsedMcpToolCall[] {
  const calls: ParsedMcpToolCall[] = [];
  for (const record of jsonLines(output)) {
    const event = codexCompletedEvent(record);
    if (!event) continue;
    const identity = parseIdentity(event.server, event.tool);
    const callId = firstString(event.callId);
    const payload = findResultPayload(event.result);
    if (!identity || !callId || !payload) continue;
    calls.push(toParsedCall(identity, callId, payload));
  }
  return uniqueCalls(calls);
}

export function parseClaudeMcpToolCalls(output: string): ParsedMcpToolCall[] {
  const uses = new Map<string, RawMcpIdentity>();
  const results: Array<{ id: string; result: unknown }> = [];
  for (const record of jsonLines(output)) collectClaudeBlocks(record, uses, results);
  const calls: ParsedMcpToolCall[] = [];
  for (const result of results) {
    const identity = uses.get(result.id);
    const payload = findResultPayload(result.result);
    if (identity && payload) calls.push(toParsedCall(identity, result.id, payload));
  }
  return uniqueCalls(calls);
}

export function assertClientToolIsolation(client: ProbeClient, output: string): void {
  const records = jsonLines(output);
  if (client === "codex") {
    for (const record of records) {
      if (!isRecord(record.item)) continue;
      const itemType = firstString(record.item.type);
      if (["command_execution", "file_change", "web_search"].includes(itemType ?? "")) {
        throw new CompatibilityProbeError("PROBE_FORBIDDEN_CLIENT_TOOL", "Codex used a forbidden shell, filesystem or web tool");
      }
      if (itemType === "mcp_tool_call") {
        const identity = parseIdentity(
          record.item.server ?? record.item.server_name ?? record.item.mcp_server,
          record.item.tool ?? record.item.tool_name
        );
        if (!identity) throw new CompatibilityProbeError("PROBE_FORBIDDEN_CLIENT_TOOL", "Codex used an unallowlisted MCP tool");
      }
    }
    return;
  }
  const toolNames: string[] = [];
  for (const record of records) collectClaudeToolNames(record, toolNames);
  if (toolNames.some((name) => !parseClaudeToolName(name))) {
    throw new CompatibilityProbeError("PROBE_FORBIDDEN_CLIENT_TOOL", "Claude used a forbidden shell, filesystem, web or MCP tool");
  }
}

export function scanRawArtifacts(input: {
  artifacts: string[];
  credentialFragments: string[];
  identityFragments: string[];
  taskFragments?: string[];
}): {
  artifactCount: number;
  credentialMaterialAbsent: boolean;
  providerIdentityAbsent: boolean;
  rawMachineLocationAbsent: boolean;
  taskTextAbsent: boolean;
} {
  const artifacts = input.artifacts.filter((artifact) => artifact.length > 0);
  const combined = artifacts.join("\n");
  const containsFragment = (fragments: string[]) => fragments
    .filter((fragment) => fragment.length >= 4)
    .some((fragment) => combined.includes(fragment));
  return {
    artifactCount: artifacts.length,
    credentialMaterialAbsent: !containsFragment(input.credentialFragments)
      && !/Bearer\s+(?!\$\{)[A-Za-z0-9._~+\/-]{8,}/i.test(combined),
    providerIdentityAbsent: !containsFragment(input.identityFragments),
    rawMachineLocationAbsent: !/file:\/\//i.test(combined)
      && !/(?:^|[\s"'=])\/(?:Users|home|tmp|private\/var|var\/folders)\//m.test(combined),
    taskTextAbsent: !containsFragment(input.taskFragments ?? [])
  };
}

export function assertRawArtifactsSafe(scan: ReturnType<typeof scanRawArtifacts>): void {
  if (
    !scan.credentialMaterialAbsent
    || !scan.providerIdentityAbsent
    || !scan.rawMachineLocationAbsent
    || !scan.taskTextAbsent
  ) {
    throw new CompatibilityProbeError("PROBE_RAW_OUTPUT_UNSAFE", "Raw compatibility artifacts contain prohibited material");
  }
}

function jsonLines(output: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isRecord(parsed)) records.push(parsed);
    } catch {
      // Human diagnostics are intentionally ignored by the structural parser.
    }
  }
  return records;
}

function codexCompletedEvent(record: Record<string, unknown>): {
  server: unknown;
  tool: unknown;
  callId: unknown;
  result: unknown;
} | undefined {
  if (record.type === "mcp_tool_call_end") {
    const nested = isRecord(record.item)
      ? record.item
      : isRecord(record.call)
        ? record.call
        : isRecord(record.msg)
          ? record.msg
          : isRecord(record.event)
            ? record.event
            : record;
    return {
      server: nested.server ?? nested.server_name ?? nested.mcp_server,
      tool: nested.tool ?? nested.tool_name,
      callId: nested.call_id ?? nested.id ?? record.call_id ?? record.id,
      result: nested.result ?? nested.output ?? nested.response ?? nested.message ?? nested.error
    };
  }
  if (record.type === "item.completed" && isRecord(record.item) && record.item.type === "mcp_tool_call") {
    const item = record.item;
    return {
      server: item.server ?? item.server_name ?? item.mcp_server,
      tool: item.tool ?? item.tool_name,
      callId: item.call_id ?? item.id,
      result: item.result ?? item.output ?? item.response ?? item.error
    };
  }
  return undefined;
}

function collectClaudeBlocks(
  value: unknown,
  uses: Map<string, RawMcpIdentity>,
  results: Array<{ id: string; result: unknown }>
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectClaudeBlocks(item, uses, results);
    return;
  }
  if (!isRecord(value)) return;
  if (value.type === "tool_use") {
    const id = firstString(value.id, value.tool_use_id);
    const identity = parseClaudeToolName(firstString(value.name));
    if (id && identity) uses.set(id, identity);
  } else if (value.type === "tool_result") {
    const id = firstString(value.tool_use_id, value.id);
    if (id) results.push({ id, result: value.content ?? value.result ?? value });
  }
  for (const nested of Object.values(value)) collectClaudeBlocks(nested, uses, results);
}

function collectClaudeToolNames(value: unknown, names: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectClaudeToolNames(item, names);
    return;
  }
  if (!isRecord(value)) return;
  if (value.type === "tool_use" && typeof value.name === "string") names.push(value.name);
  for (const nested of Object.values(value)) collectClaudeToolNames(nested, names);
}

function parseClaudeToolName(name: string | undefined): RawMcpIdentity | undefined {
  if (!name) return undefined;
  for (const identity of EXPECTED_TOOL_IDENTITIES) {
    if (name === `${identity.server}.${identity.tool}` || name.endsWith(`${identity.server}__${identity.tool}`)) return identity;
  }
  return undefined;
}

function parseIdentity(serverValue: unknown, toolValue: unknown): RawMcpIdentity | undefined {
  const server = firstString(serverValue);
  const tool = firstString(toolValue);
  return EXPECTED_TOOL_IDENTITIES.find((candidate) => {
    const serverMatches = candidate.server === server
      || [":", "/", "."].some((separator) => server?.endsWith(`${separator}${candidate.server}`));
    return serverMatches && candidate.tool === tool;
  });
}

function findResultPayload(value: unknown, seen = new Set<unknown>()): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      return findResultPayload(JSON.parse(value) as unknown, seen);
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object" || seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findResultPayload(item, seen);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.code === "string" && /^[A-Z0-9_]{3,64}$/.test(record.code)) return record;
  for (const nested of Object.values(record)) {
    const found = findResultPayload(nested, seen);
    if (found) return found;
  }
  return undefined;
}

function toParsedCall(identity: RawMcpIdentity, callId: string, payload: Record<string, unknown>): ParsedMcpToolCall {
  const result: ParsedMcpToolCall = {
    ...identity,
    callIdBound: true,
    callIdDigest: `sha256:${createHash("sha256").update(callId).digest("hex")}`,
    code: String(payload.code)
  };
  if (payload.decision === "no_safe_match") result.decision = payload.decision;
  if (payload.mode === "roots_list" || payload.mode === "explicit_fallback") result.mode = payload.mode;
  if (typeof payload.canonicalMatch === "boolean") result.canonicalMatch = payload.canonicalMatch;
  if (typeof payload.workspaceDiffCount === "number" && Number.isInteger(payload.workspaceDiffCount) && payload.workspaceDiffCount >= 0) {
    result.workspaceDiffCount = payload.workspaceDiffCount;
  }
  if (typeof payload.stateDiffCount === "number" && Number.isInteger(payload.stateDiffCount) && payload.stateDiffCount >= 0) {
    result.stateDiffCount = payload.stateDiffCount;
  }
  return result;
}

function uniqueCalls(calls: ParsedMcpToolCall[]): ParsedMcpToolCall[] {
  return [...new Map(calls.map((call) => [`${call.callIdDigest}:${call.server}:${call.tool}`, call])).values()];
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function assertSanitizedEvidence(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (
    /Bearer\s+/i.test(serialized)
    || /file:\/\//i.test(serialized)
    || /\/Users\//.test(serialized)
    || /(?:access|refresh|service[_-]?role|anon)[_-]?token/i.test(serialized)
    || /"(?:prompt|path|url|email|userId|subject|authorization|headers)"\s*:/i.test(serialized)
    || /eyJ[A-Za-z0-9_-]{20,}/.test(serialized)
  ) {
    throw new CompatibilityProbeError("PROBE_EVIDENCE_UNSAFE", "Compatibility evidence contains prohibited material");
  }
}
