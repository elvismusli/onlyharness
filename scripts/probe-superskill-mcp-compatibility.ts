import { createHmac, randomBytes } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  assertExactClientVersion,
  assertClientToolIsolation,
  assertLocalPostgresUrl,
  assertLocalSupabaseUrl,
  assertRawArtifactsSafe,
  assertSanitizedEvidence,
  buildStrictClientEnv,
  CLAUDE_PROBE_VERSION,
  CODEX_PROBE_VERSION,
  CompatibilityProbeError,
  measureInvalidPluginPreflight,
  parseClaudeMcpToolCalls,
  parseCodexMcpToolCalls,
  type ParsedMcpToolCall,
  PROBE_STDIO_ENV,
  scanRawArtifacts,
  snapshotTree,
  validateProbePluginConfig
} from "./superskill-mcp-compatibility-probe-core.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = path.join(repoRoot, "docs", "reports", "evidence");
const serverFixture = path.join(repoRoot, "scripts", "fixtures", "superskill-mcp-compat-probe-server.mjs");
const args = parseArgs(process.argv.slice(2));
const startedAt = new Date().toISOString();

type ClientEvidence = {
  client: "codex" | "claude-code";
  expectedVersion: string;
  exactVersion: boolean;
  processStatus: number;
  diagnosticCode: string;
  pluginLoaded: boolean;
  remotePublishCode: string;
  localRecommendCode: string;
  localRecommendDecision: string;
  rootCode: string;
  rootMode: string;
  rootCanonicalMatch: boolean;
  deniedMutationCode: string;
  workspaceDiffCount: number;
  stateDiffCount: number;
  toolCalls: ParsedMcpToolCall[];
  isolatedEnvironment: boolean;
  shellToolDisabled: boolean;
};

type CapturedChild = { child: ChildProcess; output: () => string };
type ProbePlugin = { root: string; configText: string; manifestText: string };
type ClientRun = {
  output: string;
  status: number;
  isolatedEnvironment: boolean;
  shellToolDisabled: boolean;
};

let api: CapturedChild | undefined;
let qa: Awaited<ReturnType<typeof provisionQaUser>> | undefined;
const tempRoot = mkdtempSync(path.join(tmpdir(), "superskill-mcp-compat-"));
let finalEvidence: Record<string, unknown>;
let versionEvidence: Record<string, unknown> | undefined;
let invalidSchemaEvidence: Record<string, unknown> = { code: "not_run", serverStartCount: -1, stateDiffCount: -1 };
let localSupabaseEvidence: Record<string, unknown> | undefined;
let remoteMcpEvidence: Record<string, unknown> | undefined;
let clientEvidenceSnapshot: ClientEvidence[] | undefined;
let localStdioEvidence: Record<string, unknown> | undefined;
let apiLog = "";
const generatedConfigs: string[] = [];
const rawClientOutputs: string[] = [];
const credentialFragments: string[] = [];
const identityFragments: string[] = [];
let safetyEvidence = scanRawArtifacts({ artifacts: [], credentialFragments: [], identityFragments: [] });

try {
  versionEvidence = exactClientVersions();
  const invalidStateRoot = path.join(tempRoot, "invalid-schema-state");
  const invalidBefore = snapshotTree(invalidStateRoot);
  const invalidMeasured = measureInvalidPluginPreflight("codex", { mcpServers: {} }, () => {
    throw new CompatibilityProbeError("PROBE_INVALID_SCHEMA_SERVER_STARTED", "Invalid schema started a server");
  });
  const invalidAfter = snapshotTree(invalidStateRoot);
  const invalidStateDiffCount = invalidBefore === invalidAfter ? 0 : 1;
  if (invalidMeasured.code !== "PROBE_PLUGIN_SCHEMA_INVALID" || invalidMeasured.serverStartCount !== 0 || invalidStateDiffCount !== 0) {
    throw new CompatibilityProbeError("PROBE_INVALID_SCHEMA_PREFLIGHT_FAILED", "Invalid schema preflight is not fail-closed");
  }
  invalidSchemaEvidence = { ...invalidMeasured, stateDiffCount: invalidStateDiffCount };

  const supabaseUrlValue = requiredEnv("SUPABASE_URL", "PROBE_LOCAL_SUPABASE_ENV_MISSING");
  const supabaseUrl = assertLocalSupabaseUrl(supabaseUrlValue);
  const databaseUrl = assertLocalPostgresUrl(requiredEnv("SUPABASE_DB_URL", "PROBE_LOCAL_DATABASE_ENV_MISSING"));
  const anonKey = requiredEnv("SUPABASE_ANON_KEY", "PROBE_LOCAL_SUPABASE_ENV_MISSING");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY", "PROBE_LOCAL_SUPABASE_ENV_MISSING");
  const subjectSalt = requiredEnv("SUPERSKILL_SUBJECT_SALT", "PROBE_LOCAL_SUPABASE_ENV_MISSING");
  if (Buffer.byteLength(subjectSalt, "utf8") < 32) {
    throw new CompatibilityProbeError("PROBE_SUBJECT_SALT_INVALID", "Subject salt is unavailable");
  }
  credentialFragments.push(anonKey, serviceRoleKey, subjectSalt);
  await requireLocalSupabaseHealth(supabaseUrl);
  qa = await provisionQaUser({ supabaseUrl, anonKey, serviceRoleKey, subjectSalt });
  credentialFragments.push(qa.accessToken);
  identityFragments.push(qa.userId, qa.email, qa.subject);
  localSupabaseEvidence = {
    confirmedQaUser: true,
    actualBearerUsed: true,
    operatorGrantRpcUsed: true,
    grantCleanupZeroRows: false,
    auditCleanupZeroIdentityRows: false
  };

  const port = await reservePort();
  const apiBase = new URL(`http://127.0.0.1:${port}/`);
  api = startApi({ port, supabaseUrl, anonKey, serviceRoleKey, subjectSalt });
  await waitForHealth(apiBase);

  const directAnonymousCode = await callRemotePublish(apiBase, undefined);
  const directAuthenticatedCode = await callRemotePublish(apiBase, qa.accessToken);
  if (directAnonymousCode !== "AUTH_REQUIRED" || directAuthenticatedCode !== "PUBLISH_DISABLED") {
    throw new CompatibilityProbeError("PROBE_REMOTE_AUTH_CONTRACT_FAILED", "Remote MCP auth or containment contract failed");
  }
  remoteMcpEvidence = { anonymousCode: directAnonymousCode, authenticatedCode: directAuthenticatedCode };

  const workspace = path.join(tempRoot, "workspace");
  const stateRoot = path.join(tempRoot, "server-state");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(path.join(workspace, "immutable-fixture.txt"), "compatibility-probe\n", { mode: 0o600 });
  const workspaceBefore = snapshotTree(workspace);
  const stateBefore = snapshotTree(stateRoot);

  const codexPlugin = createProbePlugin("codex", apiBase, tempRoot);
  const claudePlugin = createProbePlugin("claude-code", apiBase, tempRoot);
  generatedConfigs.push(codexPlugin.configText, codexPlugin.manifestText, claudePlugin.configText, claudePlugin.manifestText);
  const baseProbeEnv = {
    SUPERSKILL_ACCESS_TOKEN: qa.accessToken,
    SUPERSKILL_PROBE_API_URL: apiBase.href,
    SUPERSKILL_PROBE_ROOT: workspace,
    SUPERSKILL_PROBE_STATE_ROOT: stateRoot
  };

  const anonymousLocalCode = await callLocalAnonymousRecommend({ apiBase, workspace, stateRoot });
  if (anonymousLocalCode !== "SUPERSKILL_AUTH_REQUIRED") {
    throw new CompatibilityProbeError("PROBE_LOCAL_STDIO_AUTH_CONTRACT_FAILED", "Local stdio no-bearer request did not fail closed");
  }
  localStdioEvidence = { anonymousCode: anonymousLocalCode };

  const clients: ClientEvidence[] = [];
  const codexRun = await runCodex({ plugin: codexPlugin, workspace, env: { ...baseProbeEnv, SUPERSKILL_PROBE_CLIENT: "codex" } });
  rawClientOutputs.push(codexRun.output);
  clients.push(summarizeClient("codex", CODEX_PROBE_VERSION, codexRun));
  clientEvidenceSnapshot = [...clients];
  assertClientPassed(clients[0]);

  const claudeRun = await runClaude({ plugin: claudePlugin, workspace, env: { ...baseProbeEnv, SUPERSKILL_PROBE_CLIENT: "claude-code" } });
  rawClientOutputs.push(claudeRun.output);
  clients.push(summarizeClient("claude-code", CLAUDE_PROBE_VERSION, claudeRun));
  clientEvidenceSnapshot = [...clients];
  assertClientPassed(clients[1]);
  if (snapshotTree(workspace) !== workspaceBefore || snapshotTree(stateRoot) !== stateBefore) {
    throw new CompatibilityProbeError("PROBE_DENIED_MUTATION_STATE_CHANGED", "Compatibility client flow changed workspace or probe state");
  }

  const cleanup = await cleanupQaAndVerify(qa, databaseUrl);
  qa = undefined;
  localSupabaseEvidence.grantCleanupZeroRows = cleanup.grantRows === 0;
  localSupabaseEvidence.auditCleanupZeroIdentityRows = cleanup.auditRows === 0;
  if (cleanup.grantRows !== 0 || cleanup.auditRows !== 0) {
    throw new CompatibilityProbeError("PROBE_QA_CLEANUP_FAILED", "QA cleanup left identity-bearing rows");
  }

  if (api) {
    await stopChild(api.child);
    apiLog = api.output();
    api = undefined;
  }
  safetyEvidence = scanRawArtifacts({
    artifacts: [...rawClientOutputs, apiLog, ...generatedConfigs],
    credentialFragments,
    identityFragments,
    taskFragments: [...probeTask("codex").split("\n"), ...probeTask("claude-code").split("\n")]
  });
  assertRawArtifactsSafe(safetyEvidence);

  finalEvidence = {
    schemaVersion: "superskill.mcp-compatibility-evidence.v1",
    observedAt: startedAt,
    status: "pass",
    goDecision: "batch_d_go",
    localSupabase: localSupabaseEvidence,
    apiFlags: { managedEnabled: true, hostedPublishEnabled: false },
    remoteMcp: remoteMcpEvidence,
    localStdio: localStdioEvidence,
    invalidSchema: invalidSchemaEvidence,
    clients,
    finalSnapshot: { workspaceDiffCount: 0, stateDiffCount: 0 },
    safety: durableSafety(safetyEvidence),
    versions: versionEvidence
  };
} catch (error) {
  const code = error instanceof CompatibilityProbeError ? error.code : "PROBE_INTERNAL_ERROR";
  if (qa) {
    const failedQa = qa;
    try {
      const databaseUrl = assertLocalPostgresUrl(requiredEnv("SUPABASE_DB_URL", "PROBE_LOCAL_DATABASE_ENV_MISSING"));
      const cleanup = await cleanupQaAndVerify(failedQa, databaseUrl);
      if (localSupabaseEvidence) {
        localSupabaseEvidence.grantCleanupZeroRows = cleanup.grantRows === 0;
        localSupabaseEvidence.auditCleanupZeroIdentityRows = cleanup.auditRows === 0;
      }
      qa = undefined;
    } catch {
      if (localSupabaseEvidence) {
        localSupabaseEvidence.grantCleanupZeroRows = false;
        localSupabaseEvidence.auditCleanupZeroIdentityRows = false;
      }
    }
  }
  if (api) {
    await stopChild(api.child).catch(() => undefined);
    apiLog = api.output();
    api = undefined;
  }
  safetyEvidence = scanRawArtifacts({
    artifacts: [...rawClientOutputs, apiLog, ...generatedConfigs],
    credentialFragments,
    identityFragments,
    taskFragments: [...probeTask("codex").split("\n"), ...probeTask("claude-code").split("\n")]
  });
  const cleanupFailed = localSupabaseEvidence
    && (localSupabaseEvidence.grantCleanupZeroRows !== true || localSupabaseEvidence.auditCleanupZeroIdentityRows !== true);
  const safetyFailed = !safetyEvidence.credentialMaterialAbsent
    || !safetyEvidence.providerIdentityAbsent
    || !safetyEvidence.rawMachineLocationAbsent
    || !safetyEvidence.taskTextAbsent;
  const evidenceCode = cleanupFailed ? "PROBE_QA_CLEANUP_FAILED" : safetyFailed ? "PROBE_RAW_OUTPUT_UNSAFE" : code;
  finalEvidence = {
    schemaVersion: "superskill.mcp-compatibility-evidence.v1",
    observedAt: startedAt,
    status: evidenceCode.includes("MISSING") || evidenceCode.includes("UNAVAILABLE") ? "blocked" : "fail",
    goDecision: "batch_d_no_go",
    blockerCode: evidenceCode,
    invalidSchema: invalidSchemaEvidence,
    ...(versionEvidence ? { versions: versionEvidence } : {}),
    ...(localSupabaseEvidence ? { localSupabase: localSupabaseEvidence } : {}),
    ...(remoteMcpEvidence ? { remoteMcp: remoteMcpEvidence } : {}),
    ...(localStdioEvidence ? { localStdio: localStdioEvidence } : {}),
    ...(clientEvidenceSnapshot ? { clients: clientEvidenceSnapshot } : {}),
    safety: durableSafety(safetyEvidence)
  };
} finally {
  if (qa) {
    const databaseUrlValue = process.env.SUPABASE_DB_URL;
    if (databaseUrlValue) await cleanupQaAndVerify(qa, assertLocalPostgresUrl(databaseUrlValue)).catch(() => undefined);
  }
  if (api) await stopChild(api.child);
  rmSync(tempRoot, { recursive: true, force: true });
}

assertSanitizedEvidence(finalEvidence);
if (args.evidenceOut) {
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(args.evidenceOut, `${JSON.stringify(finalEvidence, null, 2)}\n`, { mode: 0o600 });
}
process.stdout.write(`${JSON.stringify(finalEvidence)}\n`);
if (finalEvidence.status !== "pass") process.exitCode = 1;

function parseArgs(values: string[]): { evidenceOut?: string } {
  let evidenceOut: string | undefined;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== "--evidence-out" || !values[index + 1]) throw new CompatibilityProbeError("PROBE_ARGS_INVALID", "Expected --evidence-out <file>");
    const resolved = path.resolve(repoRoot, values[++index]);
    const relative = path.relative(evidenceRoot, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || path.extname(resolved) !== ".json") {
      throw new CompatibilityProbeError("PROBE_EVIDENCE_LOCATION_INVALID", "Evidence output must be a JSON file under the report evidence directory");
    }
    evidenceOut = resolved;
  }
  return { evidenceOut };
}

function requiredEnv(name: string, code: string): string {
  const value = process.env[name];
  if (!value) throw new CompatibilityProbeError(code, `${name} is unavailable`);
  return value;
}

function exactClientVersions(): Record<string, unknown> {
  const versionHome = path.join(tempRoot, "version-home");
  const npmCache = path.join(tempRoot, "version-npm-cache");
  const npmrc = path.join(tempRoot, "version-npmrc");
  mkdirSync(versionHome, { recursive: true });
  mkdirSync(npmCache, { recursive: true });
  writeFileSync(npmrc, "update-notifier=false\n", { mode: 0o600 });
  const env = buildStrictClientEnv(process.env, {
    HOME: versionHome,
    NPM_CONFIG_CACHE: npmCache,
    NPM_CONFIG_USERCONFIG: npmrc,
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NO_COLOR: "1",
    CI: "1"
  });
  const codex = spawnSync("npx", ["--yes", `@openai/codex@${CODEX_PROBE_VERSION}`, "--version"], { env, encoding: "utf8", timeout: 60_000 });
  const claude = spawnSync("claude", ["--version"], { env, encoding: "utf8", timeout: 30_000 });
  if (codex.status !== 0 || claude.status !== 0) throw new CompatibilityProbeError("PROBE_CLIENT_UNAVAILABLE", "Exact clients are unavailable");
  assertExactClientVersion("codex", codex.stdout);
  assertExactClientVersion("claude-code", claude.stdout);
  return {
    codex: { expected: CODEX_PROBE_VERSION, exact: true },
    claudeCode: { expected: CLAUDE_PROBE_VERSION, exact: true }
  };
}

async function requireLocalSupabaseHealth(base: URL): Promise<void> {
  let response: Response;
  try {
    response = await fetch(new URL("auth/v1/health", base));
  } catch {
    throw new CompatibilityProbeError("PROBE_LOCAL_SUPABASE_UNAVAILABLE", "Local Supabase is unavailable");
  }
  if (!response.ok) throw new CompatibilityProbeError("PROBE_LOCAL_SUPABASE_UNAVAILABLE", "Local Supabase is unavailable");
}

async function provisionQaUser(input: { supabaseUrl: URL; anonKey: string; serviceRoleKey: string; subjectSalt: string }) {
  const email = `compat-${randomBytes(10).toString("hex")}@example.invalid`;
  const password = randomBytes(32).toString("base64url");
  const admin = await fetch(new URL("auth/v1/admin/users", input.supabaseUrl), {
    method: "POST",
    headers: serviceHeaders(input.serviceRoleKey),
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  const adminBody = asRecord(await safeJson(admin));
  if (!admin.ok || typeof adminBody?.id !== "string") throw new CompatibilityProbeError("PROBE_QA_PROVISION_FAILED", "Confirmed local QA user could not be provisioned");
  const userId = adminBody.id as string;
  try {
    const login = await fetch(new URL("auth/v1/token?grant_type=password", input.supabaseUrl), {
      method: "POST",
      headers: { apikey: input.anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const loginBody = asRecord(await safeJson(login));
    if (!login.ok || typeof loginBody?.access_token !== "string") throw new CompatibilityProbeError("PROBE_QA_LOGIN_FAILED", "Local QA access token could not be minted");
    const subject = `user:${createHmac("sha256", input.subjectSalt).update(`superskill-user:${userId}`).digest("hex")}`;
    const grant = await fetch(new URL("rest/v1/rpc/upsert_superskill_access_grant", input.supabaseUrl), {
      method: "POST",
      headers: serviceHeaders(input.serviceRoleKey),
      body: JSON.stringify({
        p_subject: subject,
        p_user_id: userId,
        p_scope: "superskill:managed",
        p_cohort: "batch-d-local",
        p_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        p_actor: "compatibility-probe"
      })
    });
    if (!grant.ok) throw new CompatibilityProbeError("PROBE_OPERATOR_GRANT_FAILED", "Operator grant RPC failed");
    return { ...input, userId, email, subject, accessToken: loginBody.access_token as string };
  } catch (error) {
    await deleteQaUser(input.supabaseUrl, input.serviceRoleKey, userId).catch(() => undefined);
    throw error;
  }
}

async function deleteQaUser(supabaseUrl: URL, serviceRoleKey: string, userId: string): Promise<void> {
  const response = await fetch(new URL(`auth/v1/admin/users/${encodeURIComponent(userId)}`, supabaseUrl), {
    method: "DELETE",
    headers: serviceHeaders(serviceRoleKey)
  });
  if (!response.ok && response.status !== 404) throw new CompatibilityProbeError("PROBE_QA_CLEANUP_FAILED", "QA cleanup failed");
}

async function cleanupQaAndVerify(
  qaUser: Awaited<ReturnType<typeof provisionQaUser>>,
  databaseUrl: URL
): Promise<{ grantRows: number; auditRows: number }> {
  await deleteQaUser(qaUser.supabaseUrl, qaUser.serviceRoleKey, qaUser.userId);
  const auditDelete = runLocalSql(databaseUrl, [
    "delete from public.superskill_access_grant_audit",
    "where user_id = :'qa_user_id'::uuid or subject = :'qa_subject';"
  ].join("\n"), { qa_user_id: qaUser.userId, qa_subject: qaUser.subject });
  if (auditDelete.status !== 0) throw new CompatibilityProbeError("PROBE_QA_AUDIT_CLEANUP_FAILED", "QA audit cleanup failed");
  const grants = await grantRows(qaUser);
  const auditCount = runLocalSql(databaseUrl, [
    "select count(*)",
    "from public.superskill_access_grant_audit",
    "where user_id = :'qa_user_id'::uuid or subject = :'qa_subject';"
  ].join("\n"), { qa_user_id: qaUser.userId, qa_subject: qaUser.subject });
  const parsedAuditCount = Number(auditCount.output.trim());
  if (auditCount.status !== 0 || !Number.isInteger(parsedAuditCount) || parsedAuditCount < 0) {
    throw new CompatibilityProbeError("PROBE_QA_AUDIT_VERIFY_FAILED", "QA audit cleanup could not be verified");
  }
  return { grantRows: grants.length, auditRows: parsedAuditCount };
}

function runLocalSql(databaseUrl: URL, sql: string, variables: Record<string, string>): { status: number; output: string } {
  const env = buildStrictClientEnv(process.env, {});
  env.PGHOST = databaseUrl.hostname;
  env.PGPORT = databaseUrl.port || "5432";
  env.PGUSER = decodeURIComponent(databaseUrl.username);
  env.PGPASSWORD = decodeURIComponent(databaseUrl.password);
  env.PGDATABASE = databaseUrl.pathname.replace(/^\//, "");
  const variableArgs = Object.entries(variables).flatMap(([name, value]) => ["-v", `${name}=${value}`]);
  const result = spawnSync("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", ...variableArgs], {
    env,
    input: sql,
    encoding: "utf8",
    timeout: 15_000
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

async function grantRows(qaUser: Awaited<ReturnType<typeof provisionQaUser>>): Promise<unknown[]> {
  const url = new URL("rest/v1/superskill_access_grants", qaUser.supabaseUrl);
  url.searchParams.set("select", "scope");
  url.searchParams.set("user_id", `eq.${qaUser.userId}`);
  const response = await fetch(url, { headers: serviceHeaders(qaUser.serviceRoleKey) });
  const body = await safeJson(response);
  return response.ok && Array.isArray(body) ? body : ["unavailable"];
}

function serviceHeaders(key: string): Record<string, string> {
  return { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
}

function startApi(input: { port: number; supabaseUrl: URL; anonKey: string; serviceRoleKey: string; subjectSalt: string }): CapturedChild {
  const child = spawn(process.execPath, ["--import", "tsx", "apps/harness-api/src/server.ts"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HARNESS_API_PORT: String(input.port),
      HARNESS_API_HOST: "127.0.0.1",
      SUPABASE_URL: input.supabaseUrl.href.replace(/\/$/, ""),
      SUPABASE_ANON_KEY: input.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: input.serviceRoleKey,
      SUPERSKILL_SUBJECT_SALT: input.subjectSalt,
      SUPERSKILL_ENABLED: "true",
      HOSTED_RESOURCE_PUBLISH_ENABLED: "false",
      SUPERSKILL_TELEMETRY_ENABLED: "false",
      SUPERSKILL_TOKEN_HASHES: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const chunks: Buffer[] = [];
  let bytes = 0;
  const collect = (chunk: Buffer) => {
    bytes += chunk.byteLength;
    if (bytes <= 4 * 1024 * 1024) chunks.push(Buffer.from(chunk));
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  return { child, output: () => Buffer.concat(chunks).toString("utf8") };
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), delay(3_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([once(child, "exit"), delay(1_000)]);
  }
}

async function waitForHealth(base: URL): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    try {
      const response = await fetch(new URL("healthz", base));
      if (response.ok) return;
    } catch {
      // bounded retry
    }
    await delay(100);
  }
  throw new CompatibilityProbeError("PROBE_API_UNAVAILABLE", "Local API did not start");
}

async function callRemotePublish(base: URL, accessToken: string | undefined): Promise<string> {
  const client = new Client({ name: "superskill-remote-compatibility-probe", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("mcp", base), {
    requestInit: accessToken ? { headers: { authorization: `Bearer ${accessToken}` } } : undefined
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "publish_resource_package",
      arguments: {
        name: "compatibility-probe",
        version: "0.0.0-probe",
        idempotencyKey: "batch-d-compatibility-probe",
        resourceType: "guide",
        files: [{ path: "README.md", content: "# Compatibility probe\n\nThis publish must remain disabled." }]
      }
    });
    const structured = result.structuredContent as { code?: unknown } | undefined;
    const content = Array.isArray(result.content) ? result.content as Array<{ type?: unknown; text?: unknown }> : [];
    const text = content.find((item) => item.type === "text")?.text;
    const parsed = typeof text === "string" ? safeParse(text) : undefined;
    return typeof structured?.code === "string" ? structured.code : typeof parsed?.code === "string" ? parsed.code : "PROBE_REMOTE_CODE_MISSING";
  } finally {
    await client.close();
  }
}

async function callLocalAnonymousRecommend(input: { apiBase: URL; workspace: string; stateRoot: string }): Promise<string> {
  const strict = buildStrictClientEnv(process.env, {
    SUPERSKILL_PROBE_API_URL: input.apiBase.href,
    SUPERSKILL_PROBE_CLIENT: "codex",
    SUPERSKILL_PROBE_ROOT: input.workspace,
    SUPERSKILL_PROBE_STATE_ROOT: input.stateRoot,
    HOME: path.join(tempRoot, "anonymous-stdio-home"),
    NO_COLOR: "1",
    CI: "1"
  });
  mkdirSync(strict.HOME!, { recursive: true });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverFixture],
    cwd: input.workspace,
    stderr: "pipe",
    env: Object.fromEntries(Object.entries(strict).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
  });
  const client = new Client({ name: "superskill-local-anonymous-proof", version: "1.0.0" }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [] }));
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: "recommend_probe", arguments: { client: "codex" } });
    const structured = result.structuredContent as { code?: unknown } | undefined;
    const text = Array.isArray(result.content)
      ? (result.content as Array<{ type?: unknown; text?: unknown }>).find((item) => item.type === "text")?.text
      : undefined;
    const parsed = typeof text === "string" ? safeParse(text) : undefined;
    return typeof structured?.code === "string"
      ? structured.code
      : typeof parsed?.code === "string"
        ? parsed.code
        : "PROBE_LOCAL_STDIO_CODE_MISSING";
  } finally {
    await client.close();
  }
}

function createProbePlugin(client: "codex" | "claude-code", apiBase: URL, root: string): ProbePlugin {
  const plugin = path.join(root, client === "codex" ? "codex-plugin" : "claude-plugin");
  mkdirSync(path.join(plugin, client === "codex" ? ".codex-plugin" : ".claude-plugin"), { recursive: true });
  copyFileSync(serverFixture, path.join(plugin, "probe-server.mjs"));
  const remote = client === "codex"
    ? { type: "http", url: new URL("mcp", apiBase).href, bearer_token_env_var: "SUPERSKILL_ACCESS_TOKEN" }
    : { type: "http", url: new URL("mcp", apiBase).href, headers: { Authorization: "Bearer ${SUPERSKILL_ACCESS_TOKEN}" } };
  const config = {
    [client === "codex" ? "mcp_servers" : "mcpServers"]: {
      superskill_remote_probe: remote,
      superskill_local_probe: client === "codex"
        ? { command: "node", args: ["probe-server.mjs"], cwd: ".", env_vars: [...PROBE_STDIO_ENV] }
        : {
          command: "node",
          args: ["${CLAUDE_PLUGIN_ROOT}/probe-server.mjs"],
          env: Object.fromEntries(PROBE_STDIO_ENV.map((name) => [name, `\${${name}}`]))
        }
    }
  };
  validateProbePluginConfig(client, config);
  const configText = `${JSON.stringify(config, null, 2)}\n`;
  writeFileSync(path.join(plugin, ".mcp.json"), configText);
  const manifest = client === "codex"
    ? {
      name: "superskill-compatibility-probe",
      version: "1.0.0",
      description: "Ephemeral Batch D transport probe.",
      author: { name: "OnlyHarness" },
      license: "MIT",
      keywords: ["mcp", "compatibility"],
      mcpServers: "./.mcp.json",
      interface: { displayName: "SuperSkill compatibility probe", shortDescription: "Ephemeral MCP compatibility proof" }
    }
    : { name: "superskill-compatibility-probe", version: "1.0.0", description: "Ephemeral Batch D transport probe.", author: { name: "OnlyHarness" } };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(path.join(plugin, client === "codex" ? ".codex-plugin" : ".claude-plugin", "plugin.json"), manifestText);
  return { root: plugin, configText, manifestText };
}

async function runCodex(input: { plugin: ProbePlugin; workspace: string; env: Record<string, string> }): Promise<ClientRun> {
  const codexHome = path.join(tempRoot, "codex-home");
  const marketplace = path.join(tempRoot, "codex-marketplace");
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(path.join(marketplace, ".agents", "plugins"), { recursive: true });
  mkdirSync(path.join(marketplace, "plugins"), { recursive: true });
  const installedSource = path.join(marketplace, "plugins", "superskill-compatibility-probe");
  copyDirectory(input.plugin.root, installedSource);
  const authSource = path.join(homedir(), ".codex", "auth.json");
  if (!existsSync(authSource)) throw new CompatibilityProbeError("PROBE_CODEX_AUTH_UNAVAILABLE", "Codex auth is unavailable");
  copyFileSync(authSource, path.join(codexHome, "auth.json"));
  writeFileSync(path.join(marketplace, ".agents", "plugins", "marketplace.json"), `${JSON.stringify({
    name: "batch-d-compatibility",
    plugins: [{
      name: "superskill-compatibility-probe",
      source: { source: "local", path: "./plugins/superskill-compatibility-probe" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL", products: ["CODEX"] },
      category: "Developer Tools"
    }]
  }, null, 2)}\n`);
  const npmCache = path.join(tempRoot, "npm-cache");
  const npmrc = path.join(tempRoot, "empty-npmrc");
  mkdirSync(npmCache, { recursive: true });
  writeFileSync(npmrc, "update-notifier=false\n", { mode: 0o600 });
  const env = buildStrictClientEnv(process.env, {
    ...input.env,
    HOME: codexHome,
    CODEX_HOME: codexHome,
    NPM_CONFIG_CACHE: npmCache,
    NPM_CONFIG_USERCONFIG: npmrc,
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NO_COLOR: "1",
    CI: "1"
  });
  const binary = ["--yes", `@openai/codex@${CODEX_PROBE_VERSION}`];
  const marketplaceResult = await runCaptured("npx", [...binary, "plugin", "marketplace", "add", marketplace, "--json"], env, undefined, 60_000);
  if (marketplaceResult.status !== 0) throw new CompatibilityProbeError("PROBE_CODEX_MARKETPLACE_FAILED", "Codex temporary marketplace failed");
  const pluginResult = await runCaptured("npx", [...binary, "plugin", "add", "superskill-compatibility-probe@batch-d-compatibility", "--json"], env, undefined, 60_000);
  if (pluginResult.status !== 0) throw new CompatibilityProbeError("PROBE_CODEX_PLUGIN_INSTALL_FAILED", "Codex temporary plugin install failed");
  const prompt = probeTask("codex");
  const execArgs = [
    ...binary,
    "-a", "never",
    "-c", "features.shell_tool=false",
    "-c", "shell_environment_policy.inherit=\"none\"",
    "-c", "plugins.\"superskill-compatibility-probe\".mcp_servers.superskill_remote_probe.default_tools_approval_mode=\"approve\"",
    "-c", "plugins.\"superskill-compatibility-probe\".mcp_servers.superskill_local_probe.default_tools_approval_mode=\"approve\"",
    "exec",
    "--ephemeral",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--json",
    "-s", "read-only",
    "-C", input.workspace,
    "-"
  ];
  const result = await runCaptured("npx", execArgs, env, prompt, 120_000);
  return {
    output: result.output,
    status: result.status,
    isolatedEnvironment: privilegedClientKeysAbsent(env),
    shellToolDisabled: execArgs.includes("features.shell_tool=false")
      && execArgs.includes("shell_environment_policy.inherit=\"none\"")
      && execArgs.indexOf("-a") < execArgs.indexOf("exec")
  };
}

async function runClaude(input: { plugin: ProbePlugin; workspace: string; env: Record<string, string> }): Promise<ClientRun> {
  const claudeHome = path.join(tempRoot, "claude-home");
  const claudeConfig = path.join(claudeHome, ".claude");
  mkdirSync(claudeConfig, { recursive: true });
  const authCandidates = [
    path.join(homedir(), ".claude", ".credentials.json"),
    path.join(homedir(), ".claude", "credentials.json")
  ];
  for (const source of authCandidates) {
    if (existsSync(source)) copyFileSync(source, path.join(claudeConfig, path.basename(source)));
  }
  const env = buildStrictClientEnv(process.env, {
    ...input.env,
    HOME: claudeHome,
    CLAUDE_CONFIG_DIR: claudeConfig,
    NO_COLOR: "1",
    CI: "1"
  });
  const authStatus = await runCaptured("claude", ["auth", "status"], env, undefined, 30_000, input.workspace);
  rawClientOutputs.push(authStatus.output);
  if (authStatus.status !== 0) {
    throw new CompatibilityProbeError(
      "PROBE_CLAUDE_AUTH_ISOLATION_UNAVAILABLE",
      "Claude authentication is unavailable in a clean temporary HOME and CLAUDE_CONFIG_DIR"
    );
  }
  const allowedTools = [
    "mcp__plugin_superskill-compatibility-probe_superskill_remote_probe__publish_resource_package",
    "mcp__plugin_superskill-compatibility-probe_superskill_local_probe__recommend_probe",
    "mcp__plugin_superskill-compatibility-probe_superskill_local_probe__root_probe",
    "mcp__plugin_superskill-compatibility-probe_superskill_local_probe__denied_mutation"
  ];
  const claudeArgs = [
    "--print",
    "--output-format", "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--setting-sources", "",
    "--plugin-dir", input.plugin.root,
    "--tools", allowedTools.join(","),
    "--allowedTools", allowedTools.join(","),
    "--permission-mode", "dontAsk",
    "--no-chrome"
  ];
  const result = await runCaptured("claude", claudeArgs, env, probeTask("claude-code"), 120_000, input.workspace);
  return {
    output: result.output,
    status: result.status,
    isolatedEnvironment: privilegedClientKeysAbsent(env),
    shellToolDisabled: allowedTools.length === 4
      && claudeArgs.includes("--tools")
      && claudeArgs.includes("--allowedTools")
      && !claudeArgs.includes("--dangerously-skip-permissions")
  };
}

function probeTask(client: "codex" | "claude-code"): string {
  return [
    "Use only the two SuperSkill compatibility probe MCP servers; do not use shell or filesystem tools.",
    "Call the remote publish_resource_package once with name compatibility-client-probe, version 0.0.0-probe, idempotencyKey batch-d-client-probe-0001, resourceType guide, and README.md content of at least twenty characters; report its stable disabled code.",
    `Call local recommend_probe once with client ${client}; require no_safe_match.`,
    "Call local root_probe once with explicitFallback set to a single dot.",
    "Call local denied_mutation once and report the stable denial code."
  ].join("\n");
}

function summarizeClient(client: "codex" | "claude-code", expectedVersion: string, run: ClientRun): ClientEvidence {
  assertClientToolIsolation(client, run.output);
  const toolCalls = client === "codex" ? parseCodexMcpToolCalls(run.output) : parseClaudeMcpToolCalls(run.output);
  const remote = exactCall(toolCalls, "superskill_remote_probe", "publish_resource_package");
  const recommend = exactCall(toolCalls, "superskill_local_probe", "recommend_probe");
  const root = exactCall(toolCalls, "superskill_local_probe", "root_probe");
  const denied = exactCall(toolCalls, "superskill_local_probe", "denied_mutation");
  return {
    client,
    expectedVersion,
    exactVersion: true,
    processStatus: run.status,
    diagnosticCode: diagnoseClientOutput(client, run),
    pluginLoaded: run.status === 0 && toolCalls.length === 4,
    remotePublishCode: remote?.code ?? "PROBE_CLIENT_REMOTE_CALL_MISSING",
    localRecommendCode: typeof recommend?.code === "string" ? recommend.code : "PROBE_CLIENT_LOCAL_CALL_MISSING",
    localRecommendDecision: recommend?.decision === "no_safe_match" ? "no_safe_match" : "missing",
    rootCode: typeof root?.code === "string" ? root.code : "PROBE_CLIENT_ROOT_CALL_MISSING",
    rootMode: typeof root?.mode === "string" ? root.mode : "missing",
    rootCanonicalMatch: root?.canonicalMatch === true,
    deniedMutationCode: typeof denied?.code === "string" ? denied.code : "PROBE_CLIENT_DENIAL_MISSING",
    workspaceDiffCount: typeof denied?.workspaceDiffCount === "number" ? denied.workspaceDiffCount : 1,
    stateDiffCount: typeof denied?.stateDiffCount === "number" ? denied.stateDiffCount : 1,
    toolCalls,
    isolatedEnvironment: run.isolatedEnvironment,
    shellToolDisabled: run.shellToolDisabled
  };
}

function exactCall(
  calls: ParsedMcpToolCall[],
  server: ParsedMcpToolCall["server"],
  tool: ParsedMcpToolCall["tool"]
): ParsedMcpToolCall | undefined {
  const matching = calls.filter((call) => call.server === server && call.tool === tool);
  return matching.length === 1 ? matching[0] : undefined;
}

function privilegedClientKeysAbsent(env: NodeJS.ProcessEnv): boolean {
  return ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "SUPERSKILL_SUBJECT_SALT"]
    .every((name) => !(name in env));
}

function diagnoseClientOutput(client: "codex" | "claude-code", run: { output: string; status: number }): string {
  if (run.status !== 0) {
    if (/authentication|login required|not logged in/i.test(run.output)) return "PROBE_CLIENT_MODEL_AUTH_UNAVAILABLE";
    if (/mcp.*(?:failed|error)|failed.*mcp/i.test(run.output)) return "PROBE_CLIENT_MCP_START_FAILED";
    if (/plugin.*(?:failed|error)|failed.*plugin/i.test(run.output)) return "PROBE_CLIENT_PLUGIN_LOAD_FAILED";
    if (/timed out|timeout/i.test(run.output)) return "PROBE_CLIENT_TIMEOUT";
    return "PROBE_CLIENT_PROCESS_FAILED";
  }
  const calls = client === "codex" ? parseCodexMcpToolCalls(run.output) : parseClaudeMcpToolCalls(run.output);
  if (calls.length === 0) return client === "codex" ? "PROBE_CODEX_TOOL_NOT_OBSERVED" : "PROBE_CLAUDE_TOOL_NOT_OBSERVED";
  return "PROBE_CLIENT_CALLS_OBSERVED";
}

function assertClientPassed(client: ClientEvidence): void {
  if (
    !client.exactVersion
    || !client.pluginLoaded
    || client.remotePublishCode !== "PUBLISH_DISABLED"
    || client.localRecommendCode !== "PROBE_NO_SAFE_MATCH"
    || client.localRecommendDecision !== "no_safe_match"
    || client.rootCode !== "PROBE_ROOT_OK"
    || !client.rootCanonicalMatch
    || client.deniedMutationCode !== "MUTATION_DENIED"
    || client.workspaceDiffCount !== 0
    || client.stateDiffCount !== 0
    || client.toolCalls.length !== 4
    || client.toolCalls.some((call) => !call.callIdBound || !/^sha256:[a-f0-9]{64}$/.test(call.callIdDigest))
    || !client.isolatedEnvironment
    || !client.shellToolDisabled
  ) throw new CompatibilityProbeError("PROBE_REAL_CLIENT_FLOW_FAILED", `${client.client} real-client flow failed`);
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address !== "object") throw new CompatibilityProbeError("PROBE_PORT_UNAVAILABLE", "Local port unavailable");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function runCaptured(command: string, commandArgs: string[], env: NodeJS.ProcessEnv, input: string | undefined, timeout: number, cwd = repoRoot): Promise<{ output: string; status: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0;
    const collect = (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size <= 4 * 1024 * 1024) chunks.push(Buffer.from(chunk));
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ output: Buffer.concat(chunks).toString("utf8"), status: status ?? 1 });
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

function copyDirectory(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true });
  for (const name of [".mcp.json", "probe-server.mjs"]) copyFileSync(path.join(source, name), path.join(destination, name));
  for (const manifestDir of [".codex-plugin", ".claude-plugin"]) {
    const manifest = path.join(source, manifestDir, "plugin.json");
    if (!existsSync(manifest)) continue;
    mkdirSync(path.join(destination, manifestDir), { recursive: true });
    copyFileSync(manifest, path.join(destination, manifestDir, "plugin.json"));
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function safeParse(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function durableSafety(scan: ReturnType<typeof scanRawArtifacts>): Record<string, unknown> {
  return {
    rawArtifactCount: scan.artifactCount,
    credentialMaterialRecorded: !scan.credentialMaterialAbsent,
    providerIdentityRecorded: !scan.providerIdentityAbsent,
    rawMachineLocationRecorded: !scan.rawMachineLocationAbsent,
    taskTextRecorded: !scan.taskTextAbsent
  };
}
