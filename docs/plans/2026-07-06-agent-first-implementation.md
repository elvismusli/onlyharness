# Agent-First Upgrades Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the CLI-first agent surface from [2026-07-06-agent-first-surface.md](2026-07-06-agent-first-surface.md): `npx onlyharness` in one command, agent-grade CLI DX, AGENTS.md/CLAUDE.md, a thin 5-tool MCP server at `/mcp`, RFC 9728 auth discovery, OpenAPI, MCP Registry entry, and a vendor skill.

**Architecture:** The `hh` CLI becomes a self-contained esbuild bundle published to npm as `onlyharness` (bin `hh`), with a stable exit-code taxonomy and `--json` everywhere. The Fastify API gains an extracted `registry.ts` core reused by both REST routes and a stateless Streamable-HTTP MCP adapter (~5 meta-tools) mounted at `/mcp`. Discovery files (AGENTS.md, .well-known, openapi.json, server.json) cross-link every surface.

**Tech Stack:** esbuild (bundle), node:test (unit), tsx smoke scripts (integration, repo idiom), @modelcontextprotocol/sdk@^1.29 (StreamableHTTPServerTransport, stateless), Caddy routing, mcp-publisher (registry).

**Testing note:** the repo has no unit-test runner; the established idiom is typecheck + `scripts/smoke*.ts`. Tasks below use `node:test` for new pure logic and extend the smoke scripts for network behavior — keep that split.

**User-action checkpoints (cannot be done by the agent alone):** npm login/publish (A7), DNS TXT record for MCP Registry namespace (D3).

---

## Stage A — P0: `hh` on npm as `onlyharness`

### Task A1: Bundle the CLI with esbuild

**Files:**
- Modify: `packages/harness-cli/package.json`
- Create: `packages/harness-cli/README.md`

**Step 1: Add esbuild and bundle script**

In `packages/harness-cli/package.json` replace the whole file with:

```json
{
  "name": "onlyharness",
  "version": "0.2.0",
  "description": "OnlyHarness CLI (hh) — find, pull, run, eval, gate and publish AI-agent harnesses from onlyharness.com",
  "type": "module",
  "license": "MIT",
  "homepage": "https://onlyharness.com",
  "repository": { "type": "git", "url": "git+https://github.com/elvismusli/onlyharness.git", "directory": "packages/harness-cli" },
  "keywords": ["ai-agents", "harness", "mcp", "cli", "agent-workflows"],
  "bin": { "hh": "./dist/hh.mjs", "onlyharness": "./dist/hh.mjs" },
  "files": ["dist", "README.md"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit && npm run bundle",
    "bundle": "esbuild src/index.ts --bundle --platform=node --format=esm --target=node20 --banner:js='#!/usr/bin/env node' --outfile=dist/hh.mjs",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "node --test test/",
    "prepublishOnly": "npm run build && npm test"
  },
  "devDependencies": {
    "@harnesshub/schema": "0.1.0",
    "@harnesshub/semantic-diff": "0.1.0",
    "@types/node": "^24.0.10",
    "commander": "^14.0.0",
    "esbuild": "^0.25.0",
    "typescript": "^5.8.3",
    "yaml": "^2.8.0"
  }
}
```

Key decisions encoded here: name `onlyharness` (verified free on npm 2026-07-06; `hh` is taken), **all runtime deps become devDependencies** because the bundle is self-contained (published package installs with zero deps — fastest possible `npx`), `private` removed, bin points at the bundle not `src/index.ts`.

Note: `"main"`/`"types"` removed on purpose — this is a bin-only package.

**Step 2: Install and bundle**

Run: `npm install && npm run bundle -w onlyharness`
Expected: `dist/hh.mjs` created, no errors. (esbuild inlines `@harnesshub/schema`, `@harnesshub/semantic-diff`, `commander`, `yaml`; node builtins stay external via `--platform=node`.)

Gotcha: workspace name changes from `@harnesshub/cli` to `onlyharness` — update every `-w @harnesshub/cli` reference: `scripts/smoke.ts` (3 spawn calls use `npm exec -w @harnesshub/cli`), `README.md`, `apps/registry-web/public/llms.txt`, root `package.json` if it pins the workspace by name. Grep first:

Run: `grep -rn "@harnesshub/cli" --include='*.ts' --include='*.json' --include='*.md' --include='*.txt' . | grep -v node_modules`

**Step 3: Smoke the bundle directly**

Run: `node packages/harness-cli/dist/hh.mjs --help && node packages/harness-cli/dist/hh.mjs doctor`
Expected: help lists all 13 commands; doctor exits 0 against https://onlyharness.com/api with `[OK]`.

**Step 4: Commit**

```bash
git add packages/harness-cli scripts/smoke.ts README.md apps/registry-web/public/llms.txt package-lock.json
git commit -m "Rename CLI package to onlyharness, bundle with esbuild for npm"
```

### Task A2: Exit-code taxonomy + next-command errors

**Files:**
- Modify: `packages/harness-cli/src/index.ts`
- Create: `packages/harness-cli/test/exit-codes.test.ts`

**Step 1: Add the taxonomy and a `fail` helper near the top of src/index.ts**

```ts
export const EXIT = { OK: 0, GENERAL: 1, AUTH: 2, VALIDATION: 3, NOT_FOUND: 4 } as const;

export function failMessage(message: string, next?: string): string {
  return next ? `${message}\nNext: ${next}` : message;
}

function fail(message: string, code: number, next?: string): never {
  console.error(failMessage(message, next));
  process.exit(code);
}
```

**Step 2: Apply per command** (replace existing `throw new Error` / bare exits):

- `pull`: registry 404 → `fail(\`Harness ${owner}/${name} not found.\`, EXIT.NOT_FOUND, \`hh search ${name.replaceAll("-", " ")}\`)`; non-empty dir without --force → EXIT.VALIDATION with next `hh pull ${harness} --force`.
- `publish`: 401 → EXIT.AUTH, next `Log on at https://onlyharness.com, then export HH_TOKEN=<access token> and retry`; other non-ok → EXIT.GENERAL.
- `run`: missing harness.yaml → EXIT.NOT_FOUND, next `hh pull <owner>/<name>`; eval failed → EXIT.VALIDATION (not 1).
- `validate --strict` fail, `gate` fail, `eval` fail → EXIT.VALIDATION.
- `doctor` unreachable → EXIT.GENERAL, next `check HH_REGISTRY_URL (current: ${registryUrl})`.
- `fetchJson` network errors → EXIT.GENERAL with the URL in the message.
- Top-level `program.parseAsync(...).catch` → print `error.message`, exit `(error as {exitCode?: number}).exitCode ?? EXIT.GENERAL`. Have `fail` throw an object with `exitCode` instead of calling process.exit directly inside async actions if needed — keep it simple: `process.exit` inside `fail` is fine because commander actions are awaited.

**Step 3: Write the unit test** `packages/harness-cli/test/exit-codes.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const HH = new URL("../dist/hh.mjs", import.meta.url).pathname;

test("pull of a missing harness exits 4 and names the next command", () => {
  const r = spawnSync("node", [HH, "pull", "harnesses/definitely-not-real-xyz"], {
    encoding: "utf8",
    env: { ...process.env, HH_REGISTRY_URL: "https://onlyharness.com/api" }
  });
  assert.equal(r.status, 4);
  assert.match(r.stderr, /Next: hh search/);
});

test("run outside a harness dir exits 4", () => {
  const r = spawnSync("node", [HH, "run", "/tmp"], { encoding: "utf8" });
  assert.equal(r.status, 4);
  assert.match(r.stderr, /hh pull/);
});
```

**Step 4: Run tests — expect FAIL first** (`pull` currently throws with exit 1): `npm run bundle -w onlyharness && npm test -w onlyharness`. Implement Step 2 until PASS. (Bundle before test — tests exercise the artifact we ship.)

Note: pull-404 currently surfaces as a generic `fetchJson` error; you must special-case status 404 in `pull` (fetch manually or make `fetchJson` throw `{status}`).

**Step 5: Commit** — `git commit -m "CLI: exit-code taxonomy and next-command error hints"`

### Task A3: `--json` on every command

**Files:** Modify `packages/harness-cli/src/index.ts`; extend `packages/harness-cli/test/exit-codes.test.ts`

**Step 1:** Add `--json` to `pull`, `run`, `publish`, `doctor`, `gate` (search/validate/inspect/eval already have it). Contract: on success print a single JSON object to stdout; on failure print `{"error": string, "code": number, "next": string|null}` to stderr, same exit codes. Shapes:

- `pull --json` → `{ "owner", "name", "out", "files", "skipped" }`
- `run --json` → `{ "title", "input", "expected", "eval": {status, score, minScore} }`
- `publish --json` → `{ "title", "name", "url": "https://onlyharness.com" }`
- `doctor --json` → `{ "registry", "ok", "indexed", "node", "tokenSet" }`
- `gate --json` → `{ "passed", "score", "risk", "cost", "failures": string[] }`

**Step 2:** Test: `doctor --json` parses and has `ok: true` (against prod), `run --json` in a pulled dir has `eval.status`. Add to test file, run, PASS.

**Step 3:** Commit — `git commit -m "CLI: --json output on all commands"`

### Task A4: Extend the repo smoke to cover the agent loop

**Files:** Modify `scripts/smoke.ts`

After the existing API boot on port 8799, append (mirroring existing style):

```ts
const cliEnv = { ...process.env, HH_REGISTRY_URL: "http://127.0.0.1:8799" };
run("node", ["packages/harness-cli/dist/hh.mjs", "doctor"], { env: cliEnv });
run("node", ["packages/harness-cli/dist/hh.mjs", "search", "research", "--json"], { env: cliEnv });
const pullTmp = mkdtempSync(path.join(os.tmpdir(), "hh-smoke-"));
run("node", ["packages/harness-cli/dist/hh.mjs", "pull", "harnesses/deep-market-researcher", "--out", path.join(pullTmp, "dmr")], { env: cliEnv });
run("node", ["packages/harness-cli/dist/hh.mjs", "run", path.join(pullTmp, "dmr")], { env: cliEnv });
rmSync(pullTmp, { recursive: true, force: true });
```

(`run()` needs an optional `env` param — extend its options type.) Update the final console.log line to mention the CLI loop. Run `npm run smoke` → passes. Commit: `"Smoke: cover hh doctor/search/pull/run agent loop"`.

### Task A5: README + llms.txt install story

**Files:** Modify `README.md`, `apps/registry-web/public/llms.txt`, `packages/harness-cli/README.md` (create — npm page).

Replace the clone-based CLI instructions with:

```
npx onlyharness search market research
npx onlyharness pull harnesses/deep-market-researcher
npm i -g onlyharness   # installs the `hh` command
```

`packages/harness-cli/README.md`: 30-line quickstart (search→pull→run→eval→gate, HH_TOKEN publish, HH_REGISTRY_URL, exit codes table, --json contract). This file IS the npm page — agents will read it via `npm view onlyharness readme`. Commit.

### Task A6: Version + typecheck + full check

Run: `npm run check && npm run smoke` at root. Expected: all green. Commit any stragglers.

### Task A7: Publish to npm — **USER ACTION**

```bash
npm login                       # user, with 2FA
npm publish -w onlyharness --dry-run   # review the file list: dist/hh.mjs + README only
npm publish -w onlyharness
npx -y onlyharness@latest doctor       # verify from the public registry
```

If the name got squatted between planning and publish, fall back to `onlyharness-cli` (also verified free) and update A5 docs.

**Deploy:** `llms.txt` changed → redeploy web (standard in-place deploy per memory: rsync + `docker compose ... up -d --build` from `/opt/onlyharness/infra`). Verify: `curl -s https://onlyharness.com/llms.txt | grep "npx onlyharness"`.

---

## Stage B — P0: AGENTS.md + CLAUDE.md

### Task B1: Author AGENTS.md at repo root

**Files:** Create `AGENTS.md`, `CLAUDE.md`; modify `apps/registry-web/public/llms.txt`.

`AGENTS.md` sections (keep ≤120 lines): What this repo is (registry + web + CLI monorepo); Dev commands (`npm install && npm run dev`, check/smoke, ports 5177/8787); How to use the service as an agent (npx onlyharness quickstart, HTTP API base + 4 endpoints, MCP endpoint once live); Project conventions (typecheck+smoke green before commit; Win98 design system rules — no border-radius, bevel vars; playful copy except auth/permissions); Where things live (table of dirs). `CLAUDE.md` = 5 lines: "Read AGENTS.md first" + Claude-specific notes (deploy via memory'd in-place method, never commit `infra/production.env`).

### Task B2: Serve AGENTS.md on the site

Copy to `apps/registry-web/public/AGENTS.md`. Add to `llms.txt` header: `Repo guidance: https://onlyharness.com/AGENTS.md`. Verify locally: `curl -s http://127.0.0.1:5177/AGENTS.md | head -3`.

### Task B3: AGENTS.md in the harness scaffold

**Files:** Modify `packages/harness-cli/src/index.ts` (`createHarnessFromMarkdown`) — add:

```ts
writeFileSync(path.join(out, "AGENTS.md"), `# ${title} — agent guide\n\nThis directory is an OnlyHarness harness.\n\n- Validate: hh validate . --strict\n- Run the bundled example (no LLM calls): hh run .\n- Score eval cases: hh eval . && hh gate --dir .\n- Manifest (runtime, permissions, gates): harness.yaml\n- Do not enable external_send or money_movement without human approval (see permissions).\n`);
```

Rebundle + `npm run smoke` (import path covered). Commit stage B: `"Add AGENTS.md/CLAUDE.md and scaffold agent guide"`. Deploy web (llms.txt + AGENTS.md).

---

## Stage C — P1: MCP server at /mcp

### Task C1: Extract registry core out of server.ts (no behavior change)

**Files:** Create `apps/harness-api/src/registry.ts`; modify `apps/harness-api/src/server.ts`.

Move verbatim from server.ts: `RegistryItem` type, `scanRegistry`, `scanHarnessRoot`, `registryItemFromDir`, `sortRegistry`, `filterRegistry` (extract the /registry route's q/outcome/sort filtering into `searchRegistry(query)` so REST and MCP share it), `computeSocial`, `checksum`, `inferOutcome`, `badgeFor`, `threadFor`, `readExample`, `listHarnessFiles`, `collectFiles`, `resolveHarnessPath`, `readEvalResult`, `readMaybe`, `statDate`, `statSafe`, `socialFromItem`, `MAX_ARCHIVE_FILE_BYTES`, archive-file assembly (`buildArchive(root)`), and the markdown-import execution (`importMarkdown(name, markdown, userId)` wrapping the spawnSync + appendState). server.ts keeps only Fastify wiring and auth.

Verify: `npm run check && npm run smoke` — both green (smoke boots the API and hits registry/detail/import). Commit: `"api: extract registry core for reuse by MCP"`.

### Task C2: MCP server module with 5 tools

**Files:** Create `apps/harness-api/src/mcp.ts`; modify `apps/harness-api/package.json` (add `"@modelcontextprotocol/sdk": "^1.29.0"`).

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildArchive, importMarkdown, resolveHarnessPath, searchRegistry, registryDetail } from "./registry.js";

export function buildMcpServer(auth: { bearer?: string; verify: (token: string) => Promise<{ id: string } | undefined> }) {
  const server = new McpServer({ name: "onlyharness", version: "0.2.0" });

  server.registerTool("search_harnesses", {
    description: "Search the OnlyHarness registry of reusable AI-agent harnesses. Multi-word queries AND-match name/title/summary/tags. Returns cards with stars, forks, eval score, heat and the pull command.",
    inputSchema: { query: z.string(), sort: z.enum(["trending", "stars", "forks", "threads", "new"]).optional(), limit: z.number().int().min(1).max(50).optional() }
  }, async ({ query, sort, limit }) => json(searchRegistry({ q: query, sort: sort ?? "trending" }).slice(0, limit ?? 10)));

  server.registerTool("harness_details", {
    description: "Full detail for one harness: manifest (agents, workflow, permissions, quality gates), README, example input/output, eval results, risk report, file list.",
    inputSchema: { owner: z.string(), name: z.string() }
  }, async ({ owner, name }) => json(registryDetail(owner, name) ?? { error: `Harness ${owner}/${name} not found. Try search_harnesses first.` }));

  server.registerTool("pull_harness", {
    description: "Download all files of a harness as {path, content}[] — write them to disk to get a runnable harness directory, then run `hh run <dir>` / `hh eval <dir>`.",
    inputSchema: { owner: z.string(), name: z.string() }
  }, async ({ owner, name }) => {
    const root = resolveHarnessPath(owner, name);
    return json(root ? buildArchive(root) : { error: `Harness ${owner}/${name} not found.` });
  });

  server.registerTool("publish_harness", {
    description: "Publish a markdown workflow as a new harness (requires an OnlyHarness account token in the Authorization header of this MCP connection).",
    inputSchema: { name: z.string(), markdown: z.string().min(20) }
  }, async ({ name, markdown }) => {
    const user = auth.bearer ? await auth.verify(auth.bearer) : undefined;
    if (!user) return json({ error: "Authorization required. Connect with a Bearer token from onlyharness.com (see /.well-known/oauth-protected-resource)." });
    return json(await importMarkdown(name, markdown, user.id));
  });

  server.registerTool("docs_search", {
    description: "Search OnlyHarness live documentation (API, CLI, harness format, safety rules) — fresher than training data.",
    inputSchema: { query: z.string() }
  }, async ({ query }) => json(await searchDocs(query)));

  return server;
}
```

`json(x)` helper → `{ content: [{ type: "text", text: JSON.stringify(x, null, 2) }] }`. `searchDocs`: fetch `process.env.DOCS_URL ?? "https://onlyharness.com/llms.txt"`, cache in module var for 5 min, split on `\n## `, return sections whose text includes any query term (fallback: full text when no match). `registryDetail(owner, name)` is the existing detail-route body extracted in C1.

### Task C3: Mount stateless Streamable HTTP at /mcp in Fastify

**Files:** Modify `apps/harness-api/src/server.ts`.

```ts
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer } from "./mcp.js";

app.route({
  method: ["POST", "GET", "DELETE"],
  url: "/mcp",
  handler: async (request, reply) => {
    if (request.method !== "POST") {
      return reply.code(405).send({ jsonrpc: "2.0", error: { code: -32000, message: "Stateless server: POST only" }, id: null });
    }
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    const server = buildMcpServer({ bearer, verify: verifySupabaseToken });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.setHeader("Access-Control-Allow-Origin", corsOriginFor(request));
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
    reply.raw.on("close", () => { void transport.close(); void server.close(); });
  }
});
```

Notes: per-request server instance = the SDK's documented stateless pattern; `enableJsonResponse: true` gives plain JSON responses (no SSE stream) — matches HF's "direct response" choice. `verifySupabaseToken(token)` = extract the existing `requireUser` fetch into a token-in/user-out function during C1. Fastify has already parsed the JSON body — pass `request.body` as the third arg. CORS: reuse `isAllowedOrigin`.

Add 401 discovery for the no-token case at the transport level? No — keep auth per-tool (publish only, reads anonymous), but DO add the RFC 9728 pointer when publish is rejected: include `"See https://onlyharness.com/.well-known/oauth-protected-resource"` in the error text (done in C2) and set `WWW-Authenticate` on the REST publish 401 in server.ts:

```ts
reply.header("WWW-Authenticate", 'Bearer resource_metadata="https://onlyharness.com/.well-known/oauth-protected-resource"').code(401).send({ error: "Sign in required" });
```

### Task C4: .well-known protected-resource metadata

**Files:** Create `apps/registry-web/public/.well-known/oauth-protected-resource` (extensionless file, JSON content):

```json
{
  "resource": "https://onlyharness.com/mcp",
  "authorization_servers": ["https://<SUPABASE_PROJECT>.supabase.co/auth/v1"],
  "bearer_methods_supported": ["header"],
  "resource_documentation": "https://onlyharness.com/llms.txt"
}
```

(Read the real Supabase URL from `apps/registry-web/.env.local` / `infra/production.env` — do not invent it.) Verify vite copies dotdirs: `npm run build -w @harnesshub/registry-web && ls apps/registry-web/dist/.well-known/`. Caddy `file_server` must send JSON content-type for the extensionless file — if it serves `application/octet-stream`, rename to `oauth-protected-resource` is spec-fixed, so instead add a Caddy `header` matcher in `infra/Caddyfile`:

```
	handle /.well-known/oauth-protected-resource {
		root * /srv/web
		header Content-Type application/json
		file_server
	}
```

### Task C5: Route /mcp through Caddy

**Files:** Modify `infra/Caddyfile` (web container) — add ABOVE the catch-all handle:

```
	handle /mcp* {
		reverse_proxy api:8787
	}
```

(No strip_prefix — Fastify listens on `/mcp`.) Mirror in `infra/Caddyfile.local-smoke` if it proxies /api.

### Task C6: MCP smoke script

**Files:** Create `scripts/smoke-mcp.ts`; modify root `package.json` scripts (`"smoke:mcp": "tsx scripts/smoke-mcp.ts"`).

Script: boot API on 8798 (same pattern as smoke.ts), then three raw JSON-RPC POSTs to `http://127.0.0.1:8798/mcp` with headers `{"Content-Type":"application/json","Accept":"application/json, text/event-stream"}`:

1. `initialize` (protocolVersion "2025-06-18", capabilities {}, clientInfo) → expect `result.serverInfo.name === "onlyharness"`.
2. `tools/list` → expect exactly `["search_harnesses","harness_details","pull_harness","publish_harness","docs_search"]`.
3. `tools/call` `search_harnesses` `{query:"research"}` → expect content[0].text parses to array with ≥1 item having `owner` and `cliCommand`.
4. `tools/call` `publish_harness` without auth → expect error text mentioning `.well-known`.

Run: `npm run smoke:mcp` → 4 assertions pass. Then `npm run check && npm run smoke` still green. Commit stage C in two commits: `"api: MCP server with 5 meta-tools at /mcp"` and `"infra: route /mcp, RFC 9728 well-known, MCP smoke"`.

### Task C7: Deploy + prod verification + docs cross-links

Deploy (in-place, both containers rebuild). Verify:

```bash
curl -s -X POST https://onlyharness.com/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' | grep onlyharness
curl -s https://onlyharness.com/.well-known/oauth-protected-resource | python3 -m json.tool
claude mcp add --transport http onlyharness https://onlyharness.com/mcp   # manual: then /mcp in Claude Code, call search_harnesses
```

Update `llms.txt` + `AGENTS.md` with the MCP section (endpoint, 5 tools, one-command install). Redeploy web. Commit.

---

## Stage D — P1: OpenAPI + MCP Registry entry

### Task D1: OpenAPI document

**Files:** Create `apps/harness-api/src/openapi.ts` (hand-authored `const openapi = {...}` — OpenAPI 3.1, info, servers [https://onlyharness.com/api], paths: /healthz GET, /registry GET (q, outcome, sort, response schema of RegistryItem[]), /leaderboard GET, /repos/{owner}/{repo}/harness GET, /repos/{owner}/{repo}/archive GET, /imports/markdown-to-harness POST with bearerAuth securityScheme); modify `server.ts`: `app.get("/openapi.json", async () => openapi);`

Verify: `curl -s http://127.0.0.1:8787/openapi.json | python3 -m json.tool | head`. Link from llms.txt (`OpenAPI: https://onlyharness.com/api/openapi.json`). Commit.

### Task D2: server.json for the MCP Registry

**Files:** Create `server.json` at repo root:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json",
  "name": "com.onlyharness/registry",
  "description": "Search, inspect, pull and publish reusable AI-agent harnesses from onlyharness.com",
  "repository": { "url": "https://github.com/elvismusli/onlyharness", "source": "github" },
  "version": "0.2.0",
  "remotes": [{ "type": "streamable-http", "url": "https://onlyharness.com/mcp" }]
}
```

(Check the current schema URL/shape against github.com/modelcontextprotocol/registry docs at implementation time — API is v0.1-frozen but the schema date stamp may have moved.)

### Task D3: Publish to registry.modelcontextprotocol.io — **USER ACTION (DNS)**

```bash
brew install mcp-publisher   # or the documented install path
mcp-publisher login dns --domain onlyharness.com   # prints a TXT record
# USER: add the TXT record in the onlyharness.com DNS panel, wait for propagation
mcp-publisher publish
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=onlyharness"   # verify listed
```

Commit `server.json` + a README badge/line. Registry is in preview — if publish fails, park the task and keep server.json in-repo (subregistries also crawl GitHub).

---

## Stage E — P2: Vendor skill + Claude Code plugin

### Task E1: Plugin with skill + MCP config

**Files:** Create `.claude-plugin/marketplace.json`, `plugins/onlyharness/.claude-plugin/plugin.json`, `plugins/onlyharness/skills/onlyharness/SKILL.md`, `plugins/onlyharness/.mcp.json`.

- `marketplace.json`: `{ "name": "onlyharness", "owner": {"name": "OnlyHarness"}, "plugins": [{ "name": "onlyharness", "source": "./plugins/onlyharness", "description": "Find, pull, run, eval and publish AI-agent harnesses from onlyharness.com" }] }`
- `plugin.json`: name/description/version/author.
- `.mcp.json`: `{ "mcpServers": { "onlyharness": { "type": "http", "url": "https://onlyharness.com/mcp" } } }`
- `SKILL.md` frontmatter description (the trigger surface — make it earn invocation): `"Use when the user wants a ready-made AI-agent workflow/harness (research, support triage, finance safety review, GTM…): search onlyharness.com, pull a harness, run its example, eval and gate it, or publish one."` Body ≤80 lines: the npx quickstart, the search→pull→run→eval→gate loop with exact commands, HH_TOKEN publish, exit-code table, HTTP API fallback, MCP tools list.

Verify locally: `claude plugin marketplace add ./` then install `onlyharness` in a scratch session; `/skills` lists it; asking "find me a market research harness" triggers the skill. Commit: `"Add onlyharness Claude Code plugin: skill + MCP config"`.

### Task E2: Cross-link everything (closing the loop)

llms.txt gains: AGENTS.md, /mcp + 5 tools, openapi.json, npm package, plugin install line (`claude plugin marketplace add elvismusli/onlyharness`). AGENTS.md gains the same block. README "For agents" section consolidates. Deploy web. Final verification sweep (the "agent never gets lost" acceptance test):

```bash
npx -y onlyharness doctor                     # CLI path, zero setup
curl -s https://onlyharness.com/llms.txt      # names ALL other surfaces
curl -s https://onlyharness.com/AGENTS.md
curl -s https://onlyharness.com/api/openapi.json
curl -s -X POST https://onlyharness.com/mcp ... initialize   # MCP path
```

Every surface must mention at least two other surfaces. Done.

---

## Sequencing, estimates, risks

| Stage | Depends on | Size | Risk |
|---|---|---|---|
| A (npm CLI) | — | ~half day | npm name squat → fallback `onlyharness-cli`; esbuild ESM edge cases (verify `--help` after bundle) |
| B (AGENTS.md) | — (parallel with A) | ~1h | none |
| C (MCP) | C1 refactor first | ~1 day | Fastify↔raw-transport wiring (hijack + parsed body); SDK stateless nuances — keep `enableJsonResponse: true`; if hijack fights the SDK, mount a plain `node:http` fallback route |
| D (OpenAPI+registry) | C live for D3 | ~2h + DNS wait | registry in preview; schema drift — re-check server.json schema |
| E (plugin) | A+C shipped | ~2h | plugin spec drift — verify against current Claude Code docs |

Rollback: all deploys are in-place container rebuilds; previous images remain on the server (`docker compose ... up -d` with the prior git commit re-rsynced). npm publishes are append-only — bump patch to fix, never unpublish.

Out of scope (explicitly): full OAuth 2.1 AS integration (Bearer fallback is the shipped path; revisit when Supabase-as-AS or a proxy is justified), A2A, SSE transport, tool-per-endpoint MCP.
