import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import YAML from "yaml";
import { diffHarnessDirs, semanticDiffMarkdown } from "@harnesshub/semantic-diff";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer, type PublishMarkdownHandler } from "./mcp.js";
import { openapi } from "./openapi.js";
import { recordEvent, sanitizeEvent } from "./events.js";
import { requireArchivePaymentAccess } from "./payments.js";
import { fetchCountersMap } from "./social.js";
import * as registry from "./registry.js";

const statePath = path.join(registry.workspaceRoot, "data/harness-state.json");
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseRestKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? supabaseAnonKey;
const webhookToken = process.env.HARNESS_WEBHOOK_TOKEN;
const corsOrigins = parseCsv(process.env.HARNESS_CORS_ORIGINS);
const resourceMetadataUrl = "https://onlyharness.com/.well-known/oauth-protected-resource";

type ImportRequest = {
  name?: string;
  markdown: string;
};

type ThreadItem = {
  id: string;
  author: string;
  userId?: string;
  role: string;
  kind: string;
  body: string;
  likes: number;
  at: string;
};

type AuthUser = { id: string; email?: string };

type AuthResult = {
  user?: AuthUser;
  status?: number;
  error?: string;
};

const app = Fastify({ logger: true });
await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || isAllowedOrigin(origin)) return callback(null, true);
    return callback(null, false);
  }
});

app.get("/healthz", async () => ({ ok: true, workspaceRoot: registry.workspaceRoot }));

app.get("/openapi.json", async () => openapi);

app.get("/registry", async (request) => {
  const query = request.query as { q?: string; risk?: string; eval?: string; runtime?: string; outcome?: string; sort?: string };
  const counters = await fetchCountersMap();
  return { items: registry.searchRegistry(query, counters) };
});

app.get("/leaderboard", async (request) => {
  const query = request.query as { limit?: string };
  const limit = Math.min(Number(query.limit ?? 10), 50);
  const counters = await fetchCountersMap();
  return { items: registry.sortRegistry(registry.scanRegistry(counters), "heat").slice(0, limit) };
});

app.get("/repos/:owner/:repo/harness", async (request, reply) => {
  const { owner, repo } = request.params as { owner: string; repo: string };
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const { inspection, evalResult, security, standard } = registry.registryDetailBasics(root);
  const counters = await fetchCountersMap();
  const item = registry.registryItemFromDir(owner, root, counters);
  return {
    owner,
    repo,
    root,
    forgeUrl: owner === "harnesses" ? `${process.env.GITEA_BASE_URL ?? "http://127.0.0.1:3000"}/${owner}/${repo}` : `file://${root}`,
    social: item ? registry.socialFromItem(item) : undefined,
    thread: await fetchThreadPosts(owner, repo),
    example: registry.readExample(root),
    files: registry.listHarnessFiles(root),
    ...inspection,
    evalResult,
    security,
    standard,
    readme: registry.readMaybe(path.join(root, "README.md")),
    prReview: samplePrReview(root)
  };
});

app.get("/repos/:owner/:repo/archive", async (request, reply) => {
  const { owner, repo } = request.params as { owner: string; repo: string };
  const query = request.query as { version?: string };
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const archive = registry.buildArchiveForVersion(owner, repo, root, query.version);
  if (!archive) return reply.code(404).send({ error: "Harness version not found" });
  const manifest = registry.registryDetailBasics(root).inspection.manifest;
  if (!manifest) return reply.code(500).send({ error: "Harness manifest unavailable" });
  const authorization = headerValue(request.headers.authorization);
  const auth = authorization ? await userFromAuthorization(authorization) : {};
  const payment = await requireArchivePaymentAccess({
    owner,
    repo,
    version: archive.version,
    manifest,
    authorization,
    userId: auth.user?.id
  });
  if (!payment.allowed) {
    await recordEvent({ kind: "checkout", owner, repo, version: archive.version, subject: eventSubject(auth.user?.id), target: "archive", client: "api" });
    return reply.code(payment.status).send(payment.body);
  }
  await recordEvent({ kind: "pull", owner, repo, version: archive.version, subject: eventSubject(auth.user?.id), target: "archive", client: "api" });
  return { owner, repo, version: archive.version, snapshot: archive.snapshot, files: archive.files };
});

app.get("/repos/:owner/:repo/thread", async (request, reply) => {
  const { owner, repo } = request.params as { owner: string; repo: string };
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  return { items: await fetchThreadPosts(owner, repo) };
});

app.get("/repos/:owner/:repo/security-report", async (request, reply) => {
  const { owner, repo } = request.params as { owner: string; repo: string };
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  return registry.registryDetailBasics(root).security;
});

app.get("/prs/:owner/:repo/:number/semantic-diff", async (request, reply) => {
  const { owner, repo } = request.params as { owner: string; repo: string; number: string };
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  return samplePrReview(root);
});

app.post("/mcp", async (request, reply) => {
  const server = buildMcpServer({ publishMarkdown: publishMarkdownFromMcp });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  reply.raw.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  } catch (error) {
    request.log.error({ error }, "MCP request failed");
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(500, { "content-type": "application/json" });
      reply.raw.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null
      }));
    }
  }
});

app.get("/mcp", async (_request, reply) => mcpMethodNotAllowed(reply));
app.delete("/mcp", async (_request, reply) => mcpMethodNotAllowed(reply));

app.post("/imports/markdown-to-harness", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = request.body as ImportRequest;
  const result = await importMarkdownToHarness(body, user);
  if ("error" in result) return reply.code(result.status ?? 500).send({ error: result.error });
  return result;
});

app.post("/events", async (request, reply) => {
  const authorization = headerValue(request.headers.authorization);
  const auth = authorization ? await userFromAuthorization(authorization) : {};
  const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
  const event = sanitizeEvent({
    kind: String(body.kind ?? ""),
    owner: typeof body.owner === "string" ? body.owner : undefined,
    repo: typeof body.repo === "string" ? body.repo : undefined,
    version: typeof body.version === "string" ? body.version : undefined,
    target: typeof body.target === "string" ? body.target : undefined,
    client: typeof body.client === "string" ? body.client : undefined,
    subject: eventSubject(auth.user?.id)
  });
  if (!event) return reply.code(400).send({ error: "Invalid event" });
  await recordEvent(event);
  return reply.code(202).send({ ok: true });
});

app.post("/webhooks/gitea", async (request, reply) => {
  if (!requireInternalToken(request, reply)) return;
  appendState({ type: "webhook", headers: safeHeaders(request.headers), payload: request.body, at: new Date().toISOString() });
  return { ok: true, mode: "recorded-local-webhook" };
});

app.post("/internal/eval-result", async (request, reply) => {
  if (!requireInternalToken(request, reply)) return;
  appendState({ type: "eval-result", payload: request.body, at: new Date().toISOString() });
  return { ok: true };
});

const port = Number(process.env.HARNESS_API_PORT ?? 8787);
const host = process.env.HARNESS_API_HOST ?? "127.0.0.1";
await app.listen({ port, host });

function parseCsv(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((origin) => origin.trim()).filter(Boolean));
}

function isAllowedOrigin(origin: string): boolean {
  if (corsOrigins.size === 0 || corsOrigins.has("*") || corsOrigins.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<AuthUser | undefined> {
  const result = await userFromAuthorization(headerValue(request.headers.authorization));
  if (result.user) return result.user;
  if (result.status === 401) {
    reply.header("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl}"`);
  }
  reply.code(result.status ?? 401).send({ error: result.error ?? "Sign in required" });
  return undefined;
}

async function userFromAuthorization(authorization: string | undefined): Promise<AuthResult> {
  if (!supabaseUrl || !supabaseAnonKey) return { user: { id: "local-dev" } };
  if (!authorization?.startsWith("Bearer ")) {
    return { status: 401, error: "Sign in required" };
  }
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: supabaseAnonKey,
        authorization
      }
    });
    if (!response.ok) {
      return { status: 401, error: "Invalid or expired session" };
    }
    const user = await response.json() as { id?: string; email?: string };
    if (!user.id) {
      return { status: 401, error: "Invalid session user" };
    }
    return { user: { id: user.id, email: user.email } };
  } catch {
    return { status: 503, error: "Auth provider unavailable" };
  }
}

const publishMarkdownFromMcp: PublishMarkdownHandler = async (body, authorization) => {
  const auth = await userFromAuthorization(authorization);
  if (!auth.user) {
    return {
      error: auth.error ?? "Authorization required",
      status: auth.status ?? 401,
      resource_metadata: resourceMetadataUrl
    };
  }
  const result = await importMarkdownToHarness(body, auth.user);
  return "error" in result ? result : result;
};

async function importMarkdownToHarness(body: ImportRequest, user: AuthUser) {
  if (!body?.markdown || body.markdown.length < 20) {
    return { status: 400, error: "markdown must be at least 20 characters" };
  }
  const name = slugify(body.name ?? firstHeading(body.markdown) ?? "imported-harness");
  const target = path.join(registry.importRoot, name);
  mkdirSync(path.dirname(target), { recursive: true });
  const tempSource = path.join(registry.workspaceRoot, "data", `${name}.source.md`);
  writeFileSync(tempSource, body.markdown);
  const cliCommand = importCliCommand(tempSource, target, name);
  const cli = spawnSync(cliCommand.command, cliCommand.args, {
    cwd: registry.workspaceRoot,
    encoding: "utf8"
  });
  if (cli.status !== 0) {
    return { status: 500, error: cli.stderr || cli.stdout || "import failed" };
  }
  const item = registry.registryItemFromDir("local", target, new Map());
  const snapshot = registry.writeArchiveSnapshot("local", name, target);
  await recordEvent({ kind: "applied", owner: "local", repo: name, version: snapshot?.version, subject: eventSubject(user.id), target: "publish", client: "api" });
  appendState({ type: "import", name, target, userId: user.id, at: new Date().toISOString() });
  return { item, output: cli.stdout, snapshotVersion: snapshot?.version };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requireInternalToken(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!webhookToken) return true;
  const value = request.headers["x-harness-token"];
  const token = Array.isArray(value) ? value[0] : value;
  if (token === webhookToken) return true;
  reply.code(401).send({ error: "Invalid internal token" });
  return false;
}

function mcpMethodNotAllowed(reply: FastifyReply) {
  return reply.code(405).send({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null
  });
}

function safeHeaders(headers: FastifyRequest["headers"]) {
  const { authorization, cookie, "x-harness-token": token, ...safe } = headers;
  void authorization;
  void cookie;
  void token;
  return safe;
}

async function fetchThreadPosts(owner: string, repo: string): Promise<ThreadItem[]> {
  if (!supabaseUrl || !supabaseRestKey) return [];

  try {
    const params = new URLSearchParams({
      select: "id,user_id,kind,body,created_at",
      owner: `eq.${owner}`,
      repo: `eq.${repo}`,
      order: "created_at.desc",
      limit: "50"
    });
    const response = await fetch(`${supabaseUrl}/rest/v1/harness_thread_posts?${params.toString()}`, {
      headers: supabaseRestHeaders()
    });
    if (!response.ok) return [];

    const rows = await response.json() as Array<{
      id: string;
      user_id: string;
      kind: string;
      body: string;
      created_at: string;
    }>;
    const profiles = await fetchProfiles(rows.map((row) => row.user_id));

    return rows.reverse().map((row) => ({
      id: row.id,
      author: profiles.get(row.user_id) ?? `user-${row.user_id.slice(0, 6)}`,
      userId: row.user_id,
      role: "member",
      kind: row.kind,
      body: row.body,
      likes: 0,
      at: relativeTime(row.created_at)
    }));
  } catch {
    return [];
  }
}

async function fetchProfiles(userIds: string[]): Promise<Map<string, string>> {
  const profiles = new Map<string, string>();
  const ids = Array.from(new Set(userIds)).filter(Boolean);
  if (!ids.length || !supabaseUrl || !supabaseRestKey) return profiles;

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/profiles?select=id,display_name&id=in.(${ids.join(",")})`, {
      headers: supabaseRestHeaders()
    });
    if (!response.ok) return profiles;
    for (const row of await response.json() as Array<{ id: string; display_name?: string }>) {
      if (row.display_name) profiles.set(row.id, row.display_name);
    }
  } catch {
    return profiles;
  }

  return profiles;
}

function supabaseRestHeaders() {
  return {
    apikey: supabaseRestKey ?? "",
    authorization: `Bearer ${supabaseRestKey ?? ""}`
  };
}

function eventSubject(userId: string | undefined): string {
  return userId ? `user:${userId}` : "anonymous";
}

function importCliCommand(tempSource: string, target: string, name: string) {
  const bundledCli = path.join(registry.workspaceRoot, "packages/harness-cli/dist/hh.mjs");
  if (existsSync(bundledCli)) {
    return { command: "node", args: [bundledCli, "import-md", tempSource, "--out", target, "--name", name] };
  }
  return {
    command: "npm",
    args: ["exec", "--", "tsx", "packages/harness-cli/src/index.ts", "import-md", tempSource, "--out", target, "--name", name]
  };
}

function samplePrReview(root: string) {
  const base = root;
  const head = createReviewVariant(root);
  const diff = diffHarnessDirs(base, head);
  return {
    number: 0,
    title: "Demo: tighten workflow and permission profile",
    demo: true,
    status: diff.status,
    markdown: semanticDiffMarkdown(diff),
    diff
  };
}

function createReviewVariant(root: string): string {
  const temp = path.join(registry.workspaceRoot, "data", ".review-variant");
  rmDir(temp);
  copyDir(root, temp);
  const manifestPath = path.join(temp, "harness.yaml");
  const manifest = YAML.parse(readFileSync(manifestPath, "utf8"));
  manifest.version = "0.1.1";
  if (manifest.permissions) {
    manifest.permissions.external_send = true;
    manifest.permissions.human_approval_required = Array.from(new Set([...(manifest.permissions.human_approval_required ?? []), "external_send"]));
  }
  writeFileSync(manifestPath, YAML.stringify(manifest));
  return temp;
}

function appendState(event: unknown) {
  mkdirSync(path.dirname(statePath), { recursive: true });
  const current = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : [];
  current.push(event);
  writeFileSync(statePath, JSON.stringify(current.slice(-200), null, 2));
}

function relativeTime(value: string): string {
  const diff = Date.now() - Date.parse(value);
  if (!Number.isFinite(diff) || diff < 60_000) return "now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function firstHeading(markdown: string): string | undefined {
  return markdown.split("\n").find((line) => line.startsWith("# "))?.replace(/^#\s+/, "").trim();
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "imported-harness";
}

function rmDir(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

function copyDir(source: string, target: string) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".harnesshub") continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else writeFileSync(to, readFileSync(from));
  }
}
