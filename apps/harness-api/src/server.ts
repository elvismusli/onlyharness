import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import YAML from "yaml";
import { inspectHarness, validateHarnessDir } from "@harnesshub/schema";
import { diffHarnessDirs, semanticDiffMarkdown } from "@harnesshub/semantic-diff";

const workspaceRoot = path.resolve(process.env.HARNESS_WORKSPACE_ROOT ?? path.join(import.meta.dirname, "../../.."));
const seedRoot = path.join(workspaceRoot, "seed-harnesses");
const importRoot = path.join(workspaceRoot, "data/imports");
const statePath = path.join(workspaceRoot, "data/harness-state.json");
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
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
  let items = scanRegistry();
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
  return { items: sortRegistry(scanRegistry(), "heat").slice(0, limit) };
});

app.get("/repos/:owner/:repo/harness", async (request, reply) => {
  const { owner, repo } = request.params as { owner: string; repo: string };
  const root = resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const inspection = inspectHarness(root);
  const evalResult = readEvalResult(root);
  const item = registryItemFromDir(owner, root);
  return {
    owner,
    repo,
    root,
    forgeUrl: owner === "harnesses" ? `${process.env.GITEA_BASE_URL ?? "http://127.0.0.1:3000"}/${owner}/${repo}` : `file://${root}`,
    social: item ? socialFromItem(item) : undefined,
    thread: threadFor(repo, inspection.manifest?.title ?? repo, inspection.manifest?.tags ?? []),
    example: readExample(root),
    files: listHarnessFiles(root),
    ...inspection,
    evalResult,
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
  const inspection = inspectHarness(root);
  return { items: threadFor(repo, inspection.manifest?.title ?? repo, inspection.manifest?.tags ?? []) };
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
  const item = registryItemFromDir("local", target);
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

function scanRegistry(): RegistryItem[] {
  return [
    ...scanHarnessRoot("harnesses", seedRoot),
    ...scanHarnessRoot("local", importRoot)
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

function scanHarnessRoot(owner: string, root: string): RegistryItem[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => registryItemFromDir(owner, path.join(root, entry.name)))
    .filter(Boolean) as RegistryItem[];
}

function registryItemFromDir(owner: string, repoPath: string): RegistryItem | undefined {
  const validation = validateHarnessDir(repoPath);
  if (!validation.manifest) return undefined;
  const evalResult = readEvalResult(repoPath);
  const updatedAt = statDate(repoPath);
  const social = computeSocial(validation.manifest.name, validation.manifest.title, validation.manifest.tags, validation.risk.tier, evalResult?.score ?? 0, updatedAt);
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
    forks: social.forks,
    stars: social.stars,
    threads: social.threads,
    runs: social.runs,
    heat: social.heat,
    heatDelta: social.heatDelta,
    freshness: social.freshness,
    badge: badgeFor(validation.risk.tier, evalResult?.score ?? 0, social.heat),
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

function computeSocial(name: string, title: string, tags: string[], riskTier: string, evalScore: number, updatedAt: string) {
  const hash = checksum(`${name}:${title}:${tags.join(",")}`);
  const stars = 380 + (hash % 1500);
  const forks = 42 + (Math.floor(hash / 7) % 320);
  const threads = 9 + (Math.floor(hash / 11) % 70);
  const runs = 720 + (Math.floor(hash / 13) % 6800);
  const daysOld = Math.max(0, (Date.now() - Date.parse(updatedAt)) / 86_400_000);
  const decay = Math.min(3.8, daysOld * 0.08);
  const riskPenalty = riskTier === "CRITICAL" ? 4.2 : riskTier === "HIGH" ? 2.3 : riskTier === "MEDIUM" ? 0.9 : 0;
  const heat = Math.max(4.2, Math.min(42, stars / 115 + forks / 28 + threads / 7 + runs / 1200 + evalScore * 4.8 - riskPenalty - decay));
  return {
    stars,
    forks,
    threads,
    runs,
    heat: Number(heat.toFixed(1)),
    heatDelta: Number((((hash % 38) - 8) / 10).toFixed(1)),
    freshness: daysOld < 2 ? "warm" : daysOld < 9 ? "cooling" : "needs release"
  };
}

function checksum(value: string): number {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
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

function badgeFor(riskTier: string, evalScore: number, heat: number): string {
  if (heat >= 24) return "Wild West Top 10";
  if (evalScore >= 0.9) return `eval ${evalScore.toFixed(2)}`;
  if (riskTier === "LOW") return "safe to try";
  if (riskTier === "HIGH" || riskTier === "CRITICAL") return "needs review";
  return "community pick";
}

function threadFor(repo: string, title: string, tags: string[]) {
  const tag = tags[0] ?? "agent";
  const hash = checksum(repo);
  return [
    {
      id: `${repo}-recipe`,
      author: "mira",
      role: "builder",
      kind: "recipe",
      body: `Tried ${title} with a messy ${tag} brief. The best part is that it marks unresolved fields instead of pretending everything is known.`,
      likes: 8 + (hash % 34),
      at: "2h ago"
    },
    {
      id: `${repo}-question`,
      author: "alex",
      role: "operator",
      kind: "question",
      body: "Can someone share the smallest input that still passes eval? I want to fork this for an internal workflow.",
      likes: 3 + (hash % 12),
      at: "yesterday"
    },
    {
      id: `${repo}-maintainer`,
      author: "onlyharness",
      role: "maintainer",
      kind: "maintainer note",
      body: "CLI path is stable: pull, run examples, then eval and gate before you remix.",
      likes: 12 + (hash % 41),
      at: "3d ago"
    }
  ];
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
    number: 7,
    title: "Tighten workflow and permission profile",
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
