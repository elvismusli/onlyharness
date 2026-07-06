import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import YAML from "yaml";
import { inspectHarness, validateHarnessDir, type SecurityReport as ManifestSecurityReport } from "@harnesshub/schema";
import { diffHarnessDirs, semanticDiffMarkdown } from "@harnesshub/semantic-diff";
import { scanHarnessDir, type SecurityReport as StaticSecurityReport } from "./security-scan.js";
import { fetchCountersMap, socialFromCounters, type Counters } from "./social.js";

const workspaceRoot = path.resolve(process.env.HARNESS_WORKSPACE_ROOT ?? path.join(import.meta.dirname, "../../.."));
const seedRoot = path.join(workspaceRoot, "seed-harnesses");
const importRoot = path.join(workspaceRoot, "data/imports");
const statePath = path.join(workspaceRoot, "data/harness-state.json");
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseRestKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? supabaseAnonKey;
const webhookToken = process.env.HARNESS_WEBHOOK_TOKEN;
const corsOrigins = parseCsv(process.env.HARNESS_CORS_ORIGINS);

type RegistryItem = {
  owner: string;
  ownerLabel: string;
  name: string;
  title: string;
  summary: string;
  tags: string[];
  outcome: string;
  runtime: string;
  repoPath: string;
  forgeUrl: string;
  valid: boolean;
  riskScore: number;
  riskTier: string;
  evalStatus: string;
  evalScore: number;
  security: {
    verdict: StaticSecurityReport["verdict"];
    findings: number;
    scanner: StaticSecurityReport["scanner"];
  };
  standard: "conformant" | "partial";
  forks: number;
  stars: number;
  threads: number;
  runs: number;
  heat: number;
  heatDelta: number;
  freshness: string;
  badge: string;
  cliCommand: string;
  updatedAt: string;
};

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

const app = Fastify({ logger: true });
await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || isAllowedOrigin(origin)) return callback(null, true);
    return callback(null, false);
  }
});

app.get("/healthz", async () => ({ ok: true, workspaceRoot }));

app.get("/registry", async (request) => {
  const query = request.query as { q?: string; risk?: string; eval?: string; runtime?: string; outcome?: string; sort?: string };
  const counters = await fetchCountersMap();
  let items = scanRegistry(counters);
  if (query.q) {
    const terms = query.q.toLowerCase().split(/\s+/).filter(Boolean);
    items = items.filter((item) => {
      const haystack = `${item.name} ${item.title} ${item.summary} ${item.outcome} ${item.tags.join(" ")}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }
  if (query.risk && query.risk !== "all") items = items.filter((item) => item.riskTier === query.risk);
  if (query.eval && query.eval !== "all") items = items.filter((item) => item.evalStatus === query.eval);
  if (query.runtime && query.runtime !== "all") items = items.filter((item) => item.runtime === query.runtime);
  if (query.outcome && query.outcome !== "all") items = items.filter((item) => item.outcome === query.outcome);
  items = sortRegistry(items, query.sort ?? "trending");
  return { items };
});

app.get("/leaderboard", async (request) => {
  const query = request.query as { limit?: string };
  const limit = Math.min(Number(query.limit ?? 10), 50);
  const counters = await fetchCountersMap();
  return { items: sortRegistry(scanRegistry(counters), "heat").slice(0, limit) };
});

app.get("/repos/:owner/:repo/harness", async (request, reply) => {
  const { owner, repo } = request.params as { owner: string; repo: string };
  const root = resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const inspection = inspectHarness(root);
  const evalResult = readEvalResult(root);
  const security = securityReportFor(root, inspection.security, inspection.manifest?.permissions.network_allowlist ?? []);
  const standard = standardLevel(Boolean(inspection.valid), inspection.manifest, security);
  const counters = await fetchCountersMap();
  const item = registryItemFromDir(owner, root, counters);
  return {
    owner,
    repo,
    root,
    forgeUrl: owner === "harnesses" ? `${process.env.GITEA_BASE_URL ?? "http://127.0.0.1:3000"}/${owner}/${repo}` : `file://${root}`,
    social: item ? socialFromItem(item) : undefined,
    thread: await fetchThreadPosts(owner, repo),
    example: readExample(root),
    files: listHarnessFiles(root),
    ...inspection,
    evalResult,
    security,
    standard,
    readme: readMaybe(path.join(root, "README.md")),
    prReview: samplePrReview(root)
  };
});

const MAX_ARCHIVE_FILE_BYTES = 256 * 1024;

app.get("/repos/:owner/:repo/archive", async (request, reply) => {
  const { owner, repo } = request.params as { owner: string; repo: string };
  const root = resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const files = listHarnessFiles(root).map((file) => {
    const full = path.join(root, file);
    const size = statSafe(full) ? statSync(full).size : 0;
    if (size > MAX_ARCHIVE_FILE_BYTES) {
      return { path: file, truncated: true, content: "" };
    }
    return { path: file, truncated: false, content: readMaybe(full) };
  });
  return { owner, repo, files };
});

app.get("/repos/:owner/:repo/thread", async (request, reply) => {
  const { owner, repo } = request.params as { owner: string; repo: string };
  const root = resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  return { items: await fetchThreadPosts(owner, repo) };
});

app.get("/repos/:owner/:repo/security-report", async (request, reply) => {
  const { owner, repo } = request.params as { owner: string; repo: string };
  const root = resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const inspection = inspectHarness(root);
  return securityReportFor(root, inspection.security, inspection.manifest?.permissions.network_allowlist ?? []);
});

app.get("/prs/:owner/:repo/:number/semantic-diff", async (request, reply) => {
  const { owner, repo } = request.params as { owner: string; repo: string; number: string };
  const root = resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  return samplePrReview(root);
});

app.post("/imports/markdown-to-harness", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = request.body as ImportRequest;
  if (!body?.markdown || body.markdown.length < 20) {
    return reply.code(400).send({ error: "markdown must be at least 20 characters" });
  }
  const name = slugify(body.name ?? firstHeading(body.markdown) ?? "imported-harness");
  const target = path.join(importRoot, name);
  mkdirSync(path.dirname(target), { recursive: true });
  const tempSource = path.join(workspaceRoot, "data", `${name}.source.md`);
  writeFileSync(tempSource, body.markdown);
  const cli = spawnSync("npm", ["exec", "-w", "@harnesshub/cli", "--", "hh", "import-md", tempSource, "--out", target, "--name", name], {
    cwd: workspaceRoot,
    encoding: "utf8"
  });
  if (cli.status !== 0) {
    return reply.code(500).send({ error: cli.stderr || cli.stdout || "import failed" });
  }
  const item = registryItemFromDir("local", target, new Map());
  appendState({ type: "import", name, target, userId: user.id, at: new Date().toISOString() });
  return { item, output: cli.stdout };
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

function scanRegistry(counters: Map<string, Counters>): RegistryItem[] {
  return [
    ...scanHarnessRoot("harnesses", seedRoot, counters),
    ...scanHarnessRoot("local", importRoot, counters)
  ];
}

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

async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<{ id: string; email?: string } | undefined> {
  if (!supabaseUrl || !supabaseAnonKey) return { id: "local-dev" };
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Sign in required" });
    return undefined;
  }
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: supabaseAnonKey,
        authorization
      }
    });
    if (!response.ok) {
      reply.code(401).send({ error: "Invalid or expired session" });
      return undefined;
    }
    const user = await response.json() as { id?: string; email?: string };
    if (!user.id) {
      reply.code(401).send({ error: "Invalid session user" });
      return undefined;
    }
    return { id: user.id, email: user.email };
  } catch {
    reply.code(503).send({ error: "Auth provider unavailable" });
    return undefined;
  }
}

function requireInternalToken(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!webhookToken) return true;
  const value = request.headers["x-harness-token"];
  const token = Array.isArray(value) ? value[0] : value;
  if (token === webhookToken) return true;
  reply.code(401).send({ error: "Invalid internal token" });
  return false;
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

function securityReportFor(root: string, manifestSecurity: ManifestSecurityReport | undefined, networkAllowlist: string[]) {
  return scanHarnessDir(root, { manifestSecurity, networkAllowlist });
}

function standardLevel(
  valid: boolean,
  manifest: ReturnType<typeof validateHarnessDir>["manifest"],
  security: StaticSecurityReport
): "conformant" | "partial" {
  if (!valid || !manifest) return "partial";
  if (security.verdict !== "pass") return "partial";
  if (!manifest.evals.promptfoo_config || !manifest.examples.length) return "partial";
  return "conformant";
}

function scanHarnessRoot(owner: string, root: string, counters: Map<string, Counters>): RegistryItem[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => registryItemFromDir(owner, path.join(root, entry.name), counters))
    .filter(Boolean) as RegistryItem[];
}

function registryItemFromDir(owner: string, repoPath: string, counters: Map<string, Counters>): RegistryItem | undefined {
  const validation = validateHarnessDir(repoPath);
  if (!validation.manifest) return undefined;
  const evalResult = readEvalResult(repoPath);
  const updatedAt = statDate(repoPath);
  const security = securityReportFor(repoPath, validation.security, validation.manifest.permissions.network_allowlist);
  if (security.verdict === "fail") return undefined;
  const social = socialFromCounters(counters.get(`${owner}/${validation.manifest.name}`), {
    riskTier: validation.risk.tier,
    evalScore: evalResult?.score ?? 0,
    updatedAt
  });
  return {
    owner,
    ownerLabel: owner === "harnesses" ? "onlyharness" : "local",
    name: validation.manifest.name,
    title: validation.manifest.title,
    summary: validation.manifest.summary,
    tags: validation.manifest.tags,
    outcome: inferOutcome(validation.manifest.tags),
    runtime: validation.manifest.runtime.primary,
    repoPath,
    forgeUrl: owner === "harnesses" ? `${process.env.GITEA_BASE_URL ?? "http://127.0.0.1:3000"}/${owner}/${validation.manifest.name}` : `file://${repoPath}`,
    valid: validation.valid,
    riskScore: validation.risk.score,
    riskTier: validation.risk.tier,
    evalStatus: evalResult?.status ?? "unknown",
    evalScore: evalResult?.score ?? 0,
    security: {
      verdict: security.verdict,
      findings: security.findings.length,
      scanner: security.scanner
    },
    standard: standardLevel(validation.valid, validation.manifest, security),
    forks: social.forks,
    stars: social.stars,
    threads: social.threads,
    runs: social.runs,
    heat: social.heat,
    heatDelta: social.heatDelta,
    freshness: social.freshness,
    badge: social.badge,
    cliCommand: `hh pull ${owner}/${validation.manifest.name}`,
    updatedAt
  };
}

function sortRegistry(items: RegistryItem[], sort: string): RegistryItem[] {
  const sorted = [...items];
  if (sort === "stars") return sorted.sort((a, b) => b.stars - a.stars);
  if (sort === "forks") return sorted.sort((a, b) => b.forks - a.forks);
  if (sort === "threads") return sorted.sort((a, b) => b.threads - a.threads);
  if (sort === "new") return sorted.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return sorted.sort((a, b) => b.heat - a.heat);
}

function socialFromItem(item: RegistryItem) {
  return {
    stars: item.stars,
    forks: item.forks,
    threads: item.threads,
    runs: item.runs,
    heat: item.heat,
    heatDelta: item.heatDelta,
    freshness: item.freshness,
    badge: item.badge,
    cliCommand: item.cliCommand
  };
}

function inferOutcome(tags: string[]): string {
  const set = new Set(tags.map((tag) => tag.toLowerCase()));
  if (set.has("finance") || set.has("payments") || set.has("safety")) return "Finance safety";
  if (set.has("support") || set.has("triage")) return "Support";
  if (set.has("research") || set.has("validation") || set.has("gtm")) return "Research";
  if (set.has("founder") || set.has("decision") || set.has("product") || set.has("strategy")) return "Strategy";
  if (set.has("repo") || set.has("audit") || set.has("runtime")) return "Engineering";
  return "Builder tools";
}

function readExample(root: string) {
  return {
    input: readMaybe(path.join(root, "examples/input.md")),
    expected: readMaybe(path.join(root, "examples/expected.md"))
  };
}

function listHarnessFiles(root: string) {
  const files: string[] = [];
  collectFiles(root, root, files);
  return files.slice(0, 80);
}

function collectFiles(root: string, dir: string, files: string[]) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".harnesshub" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(root, full, files);
    else files.push(path.relative(root, full));
  }
}

function resolveHarnessPath(owner: string, repo: string): string | undefined {
  const roots = owner === "local" ? [importRoot] : owner === "harnesses" ? [seedRoot] : [seedRoot, importRoot];
  for (const root of roots) {
    const candidate = path.join(root, repo);
    if (existsSync(path.join(candidate, "harness.yaml"))) return candidate;
  }
  return undefined;
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
  const temp = path.join(workspaceRoot, "data", ".review-variant");
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

function readEvalResult(root: string) {
  const file = path.join(root, ".harnesshub/results.json");
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function readMaybe(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function appendState(event: unknown) {
  mkdirSync(path.dirname(statePath), { recursive: true });
  const current = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : [];
  current.push(event);
  writeFileSync(statePath, JSON.stringify(current.slice(-200), null, 2));
}

function statDate(root: string): string {
  return new Date(readdirSync(root).reduce((latest, file) => {
    const mtime = statSafe(path.join(root, file));
    return Math.max(latest, mtime);
  }, 0)).toISOString();
}

function statSafe(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
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
