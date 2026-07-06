import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

const HH = new URL("../dist/hh.mjs", import.meta.url).pathname;
const seedHarness = path.resolve(import.meta.dirname, "../../../seed-harnesses/deep-market-researcher");
const gtmHarness = path.resolve(import.meta.dirname, "../../../seed-harnesses/gtm-research-sprint");

let server: Server;
let registryUrl = "";
let sawPullToken = false;
let sawUpdateToken = false;
let sawSetupBundleToken = false;
let sawSetupArchiveToken = false;
let sawOrgPublishToken = false;
let sawOrgPullToken = false;
let orgPublishedNames: string[] = [];
let verificationEvents: Array<{ kind?: string; owner?: string; repo?: string; version?: string; target?: string; client?: string; path?: string }> = [];

before(async () => {
  server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");

    if (request.url === "/healthz") {
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.url?.startsWith("/registry")) {
      const url = new URL(request.url, "http://127.0.0.1");
      const query = url.searchParams.get("q") ?? "";
      if (query.includes("paid")) {
        response.end(JSON.stringify({ items: [{
          owner: "harnesses",
          name: "paid-harness",
          title: "Paid Harness",
          summary: "Paid fixture for payment gating.",
          tags: ["paid"],
          stars: 1,
          forks: 0,
          threads: 0,
          evalScore: 0.9,
          evalStatus: "passed",
          heat: 1,
          riskScore: 10,
          riskTier: "LOW",
          cliCommand: "hh pull harnesses/paid-harness"
        }] }));
        return;
      }
      response.end(JSON.stringify({ items: [{
        owner: "harnesses",
        name: "deep-market-researcher",
        title: "Deep Market Researcher",
        summary: "Multi-stage research pipeline.",
        tags: ["research", "strategy"],
        stars: 42,
        forks: 7,
        threads: 3,
        evalScore: 0.9,
        evalStatus: "passed",
        heat: 12,
        riskScore: 18,
        riskTier: "LOW",
        cliCommand: "hh pull harnesses/deep-market-researcher",
        contextCost: { approxTokens: 1800, files: 6 }
      }] }));
      return;
    }

    if (request.url === "/events" && request.method === "POST") {
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        verificationEvents.push(JSON.parse(raw || "{}"));
        response.statusCode = 202;
        response.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    if (request.url === "/orgs/acme/bundle") {
      if (!request.headers.authorization) {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: "Org token required" }));
        return;
      }
      if (request.headers.authorization !== "Bearer org-token") {
        response.statusCode = 403;
        response.end(JSON.stringify({ error: "Invalid org token" }));
        return;
      }
      sawSetupBundleToken = true;
      response.end(JSON.stringify({
        organization: { slug: "acme", name: "Acme", plan: "team" },
        bundle: {
          version: "0.2.0",
          harnesses: [{ owner: "harnesses", name: "deep-market-researcher", version: "0.2.0" }],
          configs: [
            { path: ".claude/onlyharness/acme.md", content: "# Acme setup\n" },
            { path: "../outside-from-setup-test.md", content: "must not write\n" }
          ]
        }
      }));
      return;
    }

    if (request.url === "/orgs/acme/imports/markdown-to-harness" && request.method === "POST") {
      if (request.headers.authorization !== "Bearer org-token") {
        response.statusCode = 403;
        response.end(JSON.stringify({ error: "Invalid org token" }));
        return;
      }
      sawOrgPublishToken = true;
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        const body = JSON.parse(raw || "{}") as { name?: string };
        const name = body.name ?? "team-workflow";
        orgPublishedNames.push(name);
        response.end(JSON.stringify({
          item: { owner: "@acme", name, title: titleizeTest(name) },
          snapshotVersion: "0.1.0"
        }));
      });
      return;
    }

    if (request.url?.startsWith("/repos/@acme/team-workflow/archive")) {
      if (request.headers.authorization !== "Bearer org-token") {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: "Org token required" }));
        return;
      }
      sawOrgPullToken = true;
      response.end(JSON.stringify({
        owner: "@acme",
        repo: "team-workflow",
        version: "0.1.0",
        files: [{ path: "README.md", truncated: false, content: "# Team Workflow\n" }]
      }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/definitely-not-real-xyz/archive")) {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "Harness not found" }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/paid-harness/archive")) {
      response.statusCode = 402;
      response.end(JSON.stringify({
        error: "Payment required",
        code: "PAYMENT_REQUIRED",
        checkout_url: "https://onlyharness.com/checkout?owner=harnesses&repo=paid-harness",
        pricing: { model: "one_time", amount_usd: 9, currency: "USD" }
      }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/paid-harness/harness")) {
      response.end(JSON.stringify({
        owner: "harnesses",
        repo: "paid-harness",
        manifest: {
          name: "paid-harness",
          title: "Paid Harness",
          summary: "Paid fixture for payment gating.",
          version: "0.1.0",
          pricing: { model: "one_time", amount_usd: 9, currency: "USD" },
          compatibility: { targets: [{ id: "claude-code", status: "available" }] }
        },
        evalResult: { status: "passed", score: 0.9, verification_status: "declared_case_scores", cases: [] },
        risk: { score: 10, tier: "LOW", blocking: [] },
        security: { verdict: "pass", findings: [] },
        contextCost: { approxTokens: 700, files: 2, bytes: 4000, status: "estimated" },
        standard: "harness.v0.2"
      }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/x402-no-wallet/archive")) {
      response.statusCode = 402;
      response.setHeader("PAYMENT-REQUIRED", x402PaymentRequiredHeader(9_000_000));
      response.end(JSON.stringify(x402PaymentRequiredBody(9, 9_000_000)));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/x402-expensive/archive")) {
      response.statusCode = 402;
      response.setHeader("PAYMENT-REQUIRED", x402PaymentRequiredHeader(25_000_000));
      response.end(JSON.stringify(x402PaymentRequiredBody(25, 25_000_000)));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/payments-disabled/archive")) {
      response.statusCode = 402;
      response.end(JSON.stringify({
        error: "Payment required",
        code: "PAYMENT_REQUIRED",
        checkout_url: "https://onlyharness.com/checkout?owner=harnesses&repo=payments-disabled",
        payments_enabled: false,
        next: "Payments are disabled in this environment.",
        pricing: { model: "one_time", amount_usd: 9, currency: "USD" }
      }));
      return;
    }

    if (request.url?.startsWith("/repos/directories/awesome-agent-directories/archive")) {
      response.statusCode = 409;
      response.end(JSON.stringify({
        error: "Directory link only",
        code: "DIRECTORY_LINK_ONLY",
        owner: "directories",
        repo: "awesome-agent-directories",
        url: "https://example.com/awesome-agent-directories",
        next: "open https://example.com/awesome-agent-directories"
      }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/token-required/archive")) {
      sawPullToken = request.headers.authorization === "Bearer paid-token";
      response.end(JSON.stringify({
        owner: "harnesses",
        repo: "token-required",
        version: "0.1.0",
        files: [{ path: "README.md", truncated: false, content: "# token-required\n" }]
      }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/deep-market-researcher/archive")) {
      if (request.headers.authorization === "Bearer update-token") sawUpdateToken = true;
      if (request.headers.authorization === "Bearer org-token") sawSetupArchiveToken = true;
      response.end(JSON.stringify({
        owner: "harnesses",
        repo: "deep-market-researcher",
        version: "0.2.0",
        files: [
          { path: "harness.yaml", truncated: false, content: updatedHarnessYaml() },
          { path: "README.md", truncated: false, content: "# Deep Market Researcher\n\nUpdated registry version.\n" },
          { path: "agents/web_researcher.md", truncated: false, content: "Updated researcher prompt.\n" },
          { path: "agents/synthesizer.md", truncated: false, content: "Updated synthesizer prompt.\n" },
          { path: "agents/critic.md", truncated: false, content: "Updated critic prompt.\n" },
          { path: "evals/promptfooconfig.yaml", truncated: false, content: "description: updated\nprompts: []\nproviders: []\n" },
          { path: "evals/cases/case-1.yaml", truncated: false, content: "title: Updated\nscore: 0.9\n" },
          { path: "examples/input.md", truncated: false, content: "updated input\n" },
          { path: "examples/expected.md", truncated: false, content: "updated expected\n" }
        ]
      }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/deep-market-researcher/harness")) {
      response.end(JSON.stringify({
        owner: "harnesses",
        repo: "deep-market-researcher",
        manifest: {
          name: "deep-market-researcher",
          title: "Deep Market Researcher",
          summary: "Multi-stage research pipeline.",
          version: "0.2.0",
          pricing: { model: "free", currency: "USD" },
          compatibility: {
            targets: [
              { id: "claude-code", status: "available" },
              { id: "onlyharness", status: "available" }
            ]
          }
        },
        evalResult: { status: "passed", score: 0.9, verification_status: "declared_case_scores", cases: [] },
        risk: { score: 18, tier: "LOW", blocking: [] },
        security: { verdict: "pass", findings: [] },
        contextCost: { approxTokens: 1800, files: 6, bytes: 12000, status: "estimated" },
        standard: "harness.v0.2",
        verification: { lastVerifiedAt: "2026-07-06T10:00:00.000Z" }
      }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/semver-harness/harness")) {
      response.end(JSON.stringify({
        owner: "harnesses",
        repo: "semver-harness",
        manifest: { name: "semver-harness", version: "0.10.0" }
      }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/prerelease-harness/harness")) {
      response.end(JSON.stringify({
        owner: "harnesses",
        repo: "prerelease-harness",
        manifest: { name: "prerelease-harness", version: "0.2.0" }
      }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  registryUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("pull of a missing harness exits 4 and names the next command", async () => {
  const result = await runCli(["pull", "harnesses/definitely-not-real-xyz"], { HH_REGISTRY_URL: registryUrl });

  assert.equal(result.status, 4);
  assert.match(result.stderr, /Next: hh search/);
});

test("pull of a paid harness exits 5 and returns JSON payment guidance", async () => {
  const result = await runCli(["pull", "harnesses/paid-harness", "--json"], { HH_REGISTRY_URL: registryUrl });

  assert.equal(result.status, 5);
  const body = JSON.parse(result.stderr) as { error?: string; code?: number; next?: string };
  assert.match(body.error ?? "", /Payment required/);
  assert.equal(body.code, 5);
  assert.match(body.next ?? "", /checkout/);
});

test("pull of a paid harness with disabled payments returns honest next step", async () => {
  const result = await runCli(["pull", "harnesses/payments-disabled", "--json"], { HH_REGISTRY_URL: registryUrl });

  assert.equal(result.status, 5);
  const body = JSON.parse(result.stderr) as { next?: string };
  assert.equal(body.next, "Payments are disabled in this environment.");
});

test("pull of a link-only directory exits 3 and returns open guidance", async () => {
  const result = await runCli(["pull", "directories/awesome-agent-directories", "--json"], { HH_REGISTRY_URL: registryUrl });

  assert.equal(result.status, 3);
  const body = JSON.parse(result.stderr) as { error?: string; code?: number; next?: string };
  assert.match(body.error ?? "", /link-only/);
  assert.equal(body.code, 3);
  assert.equal(body.next, "open https://example.com/awesome-agent-directories");
});

test("pull --pay exits 5 when the registry does not offer x402 requirements", async () => {
  const result = await runCli(["pull", "harnesses/paid-harness", "--pay", "--json"], { HH_REGISTRY_URL: registryUrl });

  assert.equal(result.status, 5);
  const body = JSON.parse(result.stderr) as { error?: string; next?: string };
  assert.match(body.error ?? "", /x402 payment requirements/);
  assert.match(body.next ?? "", /checkout/);
});

test("pull --pay exits 5 before signing when wallet key is missing", async () => {
  const result = await runCli(["pull", "harnesses/x402-no-wallet", "--pay", "--json"], {
    HH_REGISTRY_URL: registryUrl,
    HH_WALLET_KEY: "",
    EVM_PRIVATE_KEY: ""
  });

  assert.equal(result.status, 5);
  const body = JSON.parse(result.stderr) as { error?: string; next?: string };
  assert.match(body.error ?? "", /HH_WALLET_KEY/);
  assert.match(body.next ?? "", /HH_MAX_PAY_USD/);
});

test("pull --pay exits 5 before signing when x402 price exceeds HH_MAX_PAY_USD", async () => {
  const result = await runCli(["pull", "harnesses/x402-expensive", "--pay", "--json"], {
    HH_REGISTRY_URL: registryUrl,
    HH_MAX_PAY_USD: "20",
    HH_WALLET_KEY: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  });

  assert.equal(result.status, 5);
  const body = JSON.parse(result.stderr) as { error?: string; next?: string };
  assert.match(body.error ?? "", /HH_MAX_PAY_USD/);
  assert.match(body.next ?? "", /Raise HH_MAX_PAY_USD/);
});

test("pull sends HH_TOKEN as a bearer token", async () => {
  sawPullToken = false;
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-token-pull-"));
  try {
    const result = await runCli(["pull", "harnesses/token-required", "--out", out], { HH_REGISTRY_URL: registryUrl, HH_TOKEN: "paid-token" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(sawPullToken, true);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("suggest prints a trust summary and records a privacy-safe suggested event", async () => {
  verificationEvents = [];
  const result = await runCli(["suggest", "market", "research", "--json"], { HH_REGISTRY_URL: registryUrl });

  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout) as {
    suggestion?: {
      owner?: string;
      name?: string;
      trust?: { eval?: string; risk?: string; security?: string; context?: string; lastVerifiedAt?: string; payment?: string; compatibility?: string[] };
    };
    candidates?: unknown[];
  };
  assert.equal(body.suggestion?.owner, "harnesses");
  assert.equal(body.suggestion?.name, "deep-market-researcher");
  assert.match(body.suggestion?.trust?.eval ?? "", /passed 0\.9/);
  assert.match(body.suggestion?.trust?.risk ?? "", /LOW/);
  assert.equal(body.suggestion?.trust?.security, "pass (0 findings)");
  assert.equal(body.suggestion?.trust?.context, "~1.8k/6 files");
  assert.equal(body.suggestion?.trust?.payment, "free");
  assert.ok(body.suggestion?.trust?.compatibility?.includes("claude-code:available"));
  assert.equal(body.suggestion?.trust?.lastVerifiedAt, "2026-07-06T10:00:00.000Z");
  assert.equal(body.candidates?.length, 1);
  assert.equal(verificationEvents.length, 1);
  assert.deepEqual(verificationEvents[0], {
    kind: "suggested",
    owner: "harnesses",
    repo: "deep-market-researcher",
    version: "0.2.0",
    target: "inspect",
    client: "hh"
  });
});

test("suggest --apply installs the selected harness and records applied after writing files", async () => {
  verificationEvents = [];
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-suggest-apply-"));
  try {
    const result = await runCli(["suggest", "market", "research", "--apply", "--out", out, "--json"], { HH_REGISTRY_URL: registryUrl });

    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout) as { applied?: { owner?: string; name?: string; version?: string; out?: string; files?: number } };
    assert.equal(body.applied?.owner, "harnesses");
    assert.equal(body.applied?.name, "deep-market-researcher");
    assert.equal(body.applied?.version, "0.2.0");
    assert.equal(body.applied?.out, out);
    assert.ok((body.applied?.files ?? 0) > 0);
    await readFile(path.join(out, "harness.yaml"), "utf8");
    const source = JSON.parse(await readFile(path.join(out, ".harnesshub/source.json"), "utf8")) as { owner?: string; name?: string; version?: string; registry?: string; files?: string[] };
    assert.equal(source.owner, "harnesses");
    assert.equal(source.name, "deep-market-researcher");
    assert.equal(source.version, "0.2.0");
    assert.equal(source.registry, registryUrl);
    assert.ok(source.files?.includes("README.md"));
    assert.deepEqual(verificationEvents.map((event) => event.kind), ["suggested", "applied"]);
    for (const event of verificationEvents) {
      assert.equal(event.owner, "harnesses");
      assert.equal(event.repo, "deep-market-researcher");
      assert.equal(event.version, "0.2.0");
      assert.equal(event.client, "hh");
      assert.equal(event.path, undefined);
    }
    assert.equal(verificationEvents[0].target, "apply");
    assert.equal(verificationEvents[1].target, "scoped-install");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("suggest --apply does not bypass paid archive 402", async () => {
  verificationEvents = [];
  const result = await runCli(["suggest", "paid", "workflow", "--apply", "--json"], { HH_REGISTRY_URL: registryUrl });

  assert.equal(result.status, 5);
  const body = JSON.parse(result.stderr) as { error?: string; code?: number; next?: string };
  assert.match(body.error ?? "", /Payment required/);
  assert.equal(body.code, 5);
  assert.match(body.next ?? "", /checkout/);
  assert.deepEqual(verificationEvents.map((event) => event.kind), ["suggested"]);
  assert.equal(verificationEvents[0].target, "apply");
});

test("setup installs an org bundle with org-token auth and idempotent retry", async () => {
  sawSetupBundleToken = false;
  sawSetupArchiveToken = false;
  const parent = await mkdtemp(path.join(os.tmpdir(), "hh-setup-parent-"));
  const out = path.join(parent, "team");
  try {
    const result = await runCli(["setup", "@acme", "--out", out, "--token", "org-token", "--json"], { HH_REGISTRY_URL: registryUrl });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(sawSetupBundleToken, true);
    assert.equal(sawSetupArchiveToken, true);
    assert.doesNotMatch(result.stdout, /org-token/);
    const body = JSON.parse(result.stdout) as { organization?: { slug?: string }; bundleVersion?: string; harnesses?: Array<{ path?: string }>; configs?: Array<{ path?: string }> };
    assert.equal(body.organization?.slug, "acme");
    assert.equal(body.bundleVersion, "0.2.0");
    assert.ok(body.harnesses?.some((item) => item.path === "harnesses/deep-market-researcher"));
    assert.ok(body.configs?.some((item) => item.path === ".claude/onlyharness/acme.md"));
    await readFile(path.join(out, "harnesses/deep-market-researcher/harness.yaml"), "utf8");
    await readFile(path.join(out, ".claude/onlyharness/acme.md"), "utf8");
    const setup = JSON.parse(await readFile(path.join(out, ".harnesshub/setup.json"), "utf8")) as { organization?: { slug?: string }; bundleVersion?: string };
    assert.equal(setup.organization?.slug, "acme");
    assert.equal(setup.bundleVersion, "0.2.0");
    await assert.rejects(readFile(path.join(parent, "outside-from-setup-test.md"), "utf8"));

    const retry = await runCli(["setup", "@acme", "--out", out, "--token", "org-token", "--json"], { HH_REGISTRY_URL: registryUrl });
    assert.equal(retry.status, 0, retry.stderr);

    const denied = await runCli(["setup", "@acme", "--out", path.join(parent, "denied"), "--token", "bad-token", "--json"], { HH_REGISTRY_URL: registryUrl });
    assert.equal(denied.status, 2);
    assert.doesNotMatch(denied.stderr, /bad-token/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("publish --org sends HH_ORG_TOKEN to the org import endpoint", async () => {
  sawOrgPublishToken = false;
  orgPublishedNames = [];
  const root = await mkdtemp(path.join(os.tmpdir(), "hh-org-publish-"));
  const source = path.join(root, "team.md");
  try {
    await writeFile(source, "# Team Workflow\n\nPublish this workflow into a private org namespace.");

    const result = await runCli(["publish", source, "--name", "team-workflow", "--org", "acme", "--json"], { HH_REGISTRY_URL: registryUrl, HH_ORG_TOKEN: "org-token" });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(sawOrgPublishToken, true);
    assert.doesNotMatch(result.stdout, /org-token/);
    const body = JSON.parse(result.stdout) as { owner?: string; name?: string; title?: string };
    assert.equal(body.owner, "@acme");
    assert.equal(body.name, "team-workflow");

    const denied = await runCli(["publish", source, "--name", "team-workflow", "--org", "acme", "--org-token", "bad-token", "--json"], { HH_REGISTRY_URL: registryUrl });
    assert.equal(denied.status, 2);
    assert.doesNotMatch(denied.stderr, /bad-token/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sync imports local repo markdown candidates into an org namespace", async () => {
  sawOrgPublishToken = false;
  orgPublishedNames = [];
  const repo = await mkdtemp(path.join(os.tmpdir(), "hh-sync-repo-"));
  try {
    await mkdir(path.join(repo, ".claude/skills/research"), { recursive: true });
    await mkdir(path.join(repo, "runbooks"), { recursive: true });
    await mkdir(path.join(repo, "docs"), { recursive: true });
    await writeFile(path.join(repo, ".claude/skills/research/SKILL.md"), "---\ndescription: Use for team research synthesis.\n---\n# Research Skill\n\nRun the team research workflow.\n");
    await writeFile(path.join(repo, "runbooks/team-review.md"), "# Team Review\n\nReview a candidate workflow before publishing it to the team catalog.\n");
    await writeFile(path.join(repo, "README.md"), "# Ignore generic repo readme\n");
    await writeFile(path.join(repo, "docs/ignored.md"), "# Ignore general docs\n");

    const result = await runCli(["sync", repo, "--org", "acme", "--org-token", "org-token", "--json"], { HH_REGISTRY_URL: registryUrl });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(sawOrgPublishToken, true);
    assert.doesNotMatch(result.stdout, /org-token/);
    const body = JSON.parse(result.stdout) as { org?: string; imported?: Array<{ path?: string; name?: string }>; skipped?: Array<{ path?: string }> };
    assert.equal(body.org, "acme");
    assert.deepEqual(orgPublishedNames.sort(), ["research", "runbooks-team-review"]);
    assert.ok(body.imported?.some((item) => item.path === ".claude/skills/research/SKILL.md" && item.name === "research"));
    assert.ok(body.imported?.some((item) => item.path === "runbooks/team-review.md" && item.name === "runbooks-team-review"));
    assert.ok(!body.imported?.some((item) => item.path === "README.md" || item.path === "docs/ignored.md"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("pull of an org harness sends HH_ORG_TOKEN as a bearer token", async () => {
  sawOrgPullToken = false;
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-org-pull-"));
  try {
    const result = await runCli(["pull", "@acme/team-workflow", "--out", out, "--json"], { HH_REGISTRY_URL: registryUrl, HH_ORG_TOKEN: "org-token" });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(sawOrgPullToken, true);
    assert.doesNotMatch(result.stdout, /org-token/);
    const body = JSON.parse(result.stdout) as { owner?: string; name?: string; version?: string };
    assert.equal(body.owner, "@acme");
    assert.equal(body.name, "team-workflow");
    assert.equal(body.version, "0.1.0");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("pull writes source metadata for update flows", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-source-pull-"));
  try {
    const result = await runCli(["pull", "harnesses/token-required", "--out", out], { HH_REGISTRY_URL: registryUrl });
    assert.equal(result.status, 0, result.stderr);
    const source = JSON.parse(await readFile(path.join(out, ".harnesshub/source.json"), "utf8")) as { owner?: string; name?: string; version?: string; registry?: string };
    assert.equal(source.owner, "harnesses");
    assert.equal(source.name, "token-required");
    assert.equal(source.version, "0.1.0");
    assert.equal(source.registry, registryUrl);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("doctor --harness reports local harness validity", async () => {
  const result = await runCli(["doctor", "--harness", seedHarness, "--json"], { HH_REGISTRY_URL: registryUrl });

  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout) as { harness?: { valid?: boolean; name?: string; version?: string; contextCost?: { approxTokens?: number; files?: number; status?: string } } };
  assert.equal(body.harness?.valid, true);
  assert.equal(body.harness?.name, "deep-market-researcher");
  assert.equal(body.harness?.version, "0.1.0");
  assert.equal(body.harness?.contextCost?.status, "estimated");
  assert.equal(typeof body.harness?.contextCost?.approxTokens, "number");
  assert.equal(typeof body.harness?.contextCost?.files, "number");
});

test("inspect --json includes local context cost", async () => {
  const result = await runCli(["inspect", seedHarness, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout) as { contextCost?: { approxTokens?: number; files?: number; status?: string } };
  assert.equal(body.contextCost?.status, "estimated");
  assert.equal(typeof body.contextCost?.approxTokens, "number");
  assert.equal(typeof body.contextCost?.files, "number");
});

test("adapt generates target adapter files without overwriting by default", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-adapt-"));
  try {
    const result = await runCli(["adapt", seedHarness, "--target", "claude-code", "--out", out, "--json"]);

    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout) as { target?: string; harness?: string; files?: string[]; next?: string[] };
    assert.equal(body.target, "claude-code");
    assert.equal(body.harness, "deep-market-researcher");
    assert.ok(body.files?.some((file) => file.endsWith("SKILL.md")));
    assert.ok(body.next?.some((step) => step.includes("hh gate")));
    const skill = await readFile(path.join(out, "SKILL.md"), "utf8");
    assert.match(skill, /Deep Market Researcher/);
    assert.match(skill, /hh eval/);

    const duplicate = await runCli(["adapt", seedHarness, "--target", "claude-code", "--out", out, "--json"]);
    assert.equal(duplicate.status, 3);
    const duplicateBody = JSON.parse(duplicate.stderr) as { error?: string; next?: string };
    assert.match(duplicateBody.error ?? "", /already exists/);
    assert.match(duplicateBody.next ?? "", /--force/);

    const overwrite = await runCli(["adapt", seedHarness, "--target", "claude-code", "--out", out, "--force", "--json"]);
    assert.equal(overwrite.status, 0, overwrite.stderr);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("mcp-config writes package-backed MCP client config", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-mcp-config-"));
  const configPath = path.join(out, "mcp.json");
  try {
    const result = await runCli(["mcp-config", seedHarness, "--target", "claude-desktop", "--out", configPath, "--json"]);

    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout) as { target?: string; harness?: string; servers?: Array<{ id?: string; package?: string }>; config?: { mcpServers?: Record<string, { command?: string; args?: string[] }> } };
    assert.equal(body.target, "claude-desktop");
    assert.equal(body.harness, "deep-market-researcher");
    assert.ok(body.servers?.some((server) => server.id === "web_search" && server.package === "@modelcontextprotocol/server-web-search"));
    assert.equal(body.config?.mcpServers?.web_search?.command, "npx");
    assert.deepEqual(body.config?.mcpServers?.web_search?.args, ["-y", "@modelcontextprotocol/server-web-search"]);
    const written = JSON.parse(await readFile(configPath, "utf8")) as { mcpServers?: Record<string, { command?: string; args?: string[] }> };
    assert.deepEqual(written, body.config);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("pin writes pin metadata and outdated exits 3 for newer registry version", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-outdated-"));
  try {
    await cp(seedHarness, out, { recursive: true });
    await mkdir(path.join(out, ".harnesshub"), { recursive: true });
    await writeFile(path.join(out, ".harnesshub/source.json"), JSON.stringify({
      owner: "harnesses",
      name: "deep-market-researcher",
      version: "0.1.0",
      registry: registryUrl,
      pulledAt: new Date().toISOString(),
      files: ["README.md", "obsolete.md"]
    }, null, 2));

    const pin = await runCli(["pin", out, "--json"], { HH_REGISTRY_URL: registryUrl });
    assert.equal(pin.status, 0, pin.stderr);
    const pinBody = JSON.parse(pin.stdout) as { owner?: string; name?: string; version?: string };
    assert.equal(pinBody.owner, "harnesses");
    assert.equal(pinBody.name, "deep-market-researcher");
    assert.equal(pinBody.version, "0.1.0");

    const outdated = await runCli(["outdated", out, "--json"], { HH_REGISTRY_URL: "http://127.0.0.1:1" });
    assert.equal(outdated.status, 3, outdated.stderr);
    const body = JSON.parse(outdated.stdout) as { outdated?: boolean; current?: string; latest?: string };
    assert.equal(body.outdated, true);
    assert.equal(body.current, "0.1.0");
    assert.equal(body.latest, "0.2.0");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("update --diff previews without mutating files", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-update-diff-"));
  try {
    await cp(seedHarness, out, { recursive: true });
    await mkdir(path.join(out, ".harnesshub"), { recursive: true });
    await writeFile(path.join(out, ".harnesshub/source.json"), JSON.stringify({
      owner: "harnesses",
      name: "deep-market-researcher",
      version: "0.1.0",
      registry: registryUrl,
      pulledAt: new Date().toISOString(),
      files: ["README.md"]
    }, null, 2));
    const before = await readFile(path.join(out, "README.md"), "utf8");
    const result = await runCli(["update", out, "--diff", "--json"], { HH_REGISTRY_URL: "http://127.0.0.1:1" });
    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout) as { diff?: { status?: string }; current?: string; latest?: string };
    assert.equal(body.current, "0.1.0");
    assert.equal(body.latest, "0.2.0");
    assert.equal(typeof body.diff?.status, "string");
    const after = await readFile(path.join(out, "README.md"), "utf8");
    assert.equal(after, before);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("update --force sends HH_TOKEN, updates metadata, and removes stale managed files", async () => {
  sawUpdateToken = false;
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-update-force-"));
  try {
    await cp(seedHarness, out, { recursive: true });
    await mkdir(path.join(out, ".harnesshub"), { recursive: true });
    await writeFile(path.join(out, "obsolete.md"), "old managed file\n");
    await writeFile(path.join(out, ".harnesshub/source.json"), JSON.stringify({
      owner: "harnesses",
      name: "deep-market-researcher",
      version: "0.1.0",
      registry: registryUrl,
      pulledAt: new Date().toISOString(),
      files: ["README.md", "obsolete.md"]
    }, null, 2));

    const result = await runCli(["update", out, "--force", "--json"], { HH_REGISTRY_URL: "http://127.0.0.1:1", HH_TOKEN: "update-token" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(sawUpdateToken, true);
    const body = JSON.parse(result.stdout) as { previous?: string; version?: string };
    assert.equal(body.previous, "0.1.0");
    assert.equal(body.version, "0.2.0");
    const source = JSON.parse(await readFile(path.join(out, ".harnesshub/source.json"), "utf8")) as { version?: string; registry?: string; files?: string[] };
    assert.equal(source.version, "0.2.0");
    assert.equal(source.registry, registryUrl);
    assert.ok(source.files?.includes("README.md"));
    await assert.rejects(readFile(path.join(out, "obsolete.md"), "utf8"));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("outdated compares semver numerically and prerelease below stable", async () => {
  const semverDir = await mkdtemp(path.join(os.tmpdir(), "hh-semver-"));
  const prereleaseDir = await mkdtemp(path.join(os.tmpdir(), "hh-prerelease-"));
  try {
    await mkdir(path.join(semverDir, ".harnesshub"), { recursive: true });
    await writeFile(path.join(semverDir, ".harnesshub/source.json"), JSON.stringify({
      owner: "harnesses",
      name: "semver-harness",
      version: "0.2.0",
      registry: registryUrl,
      pulledAt: new Date().toISOString()
    }, null, 2));
    const semver = await runCli(["outdated", semverDir, "--json"], { HH_REGISTRY_URL: "http://127.0.0.1:1" });
    assert.equal(semver.status, 3, semver.stderr);
    assert.equal((JSON.parse(semver.stdout) as { latest?: string; outdated?: boolean }).latest, "0.10.0");

    await mkdir(path.join(prereleaseDir, ".harnesshub"), { recursive: true });
    await writeFile(path.join(prereleaseDir, ".harnesshub/source.json"), JSON.stringify({
      owner: "harnesses",
      name: "prerelease-harness",
      version: "0.2.0-beta.1",
      registry: registryUrl,
      pulledAt: new Date().toISOString()
    }, null, 2));
    const prerelease = await runCli(["outdated", prereleaseDir, "--json"], { HH_REGISTRY_URL: "http://127.0.0.1:1" });
    assert.equal(prerelease.status, 3, prerelease.stderr);
    assert.equal((JSON.parse(prerelease.stdout) as { latest?: string; outdated?: boolean }).outdated, true);
  } finally {
    await rm(semverDir, { recursive: true, force: true });
    await rm(prereleaseDir, { recursive: true, force: true });
  }
});

test("run outside a harness dir exits 4", async () => {
  const result = await runCli(["run", "/tmp"]);

  assert.equal(result.status, 4);
  assert.match(result.stderr, /hh pull/);
});

test("doctor --json returns machine readable status", async () => {
  const result = await runCli(["doctor", "--json"], { HH_REGISTRY_URL: registryUrl });

  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout) as { ok?: boolean; indexed?: number; registry?: string };
  assert.equal(body.ok, true);
  assert.equal(body.indexed, 1);
  assert.equal(body.registry, registryUrl);
});

test("audit-setup reports local skill conflicts, stale skills and a share card without absolute paths", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "hh-audit-home-"));
  const project = await mkdtemp(path.join(os.tmpdir(), "hh-audit-project-"));
  try {
    const homeSkill = path.join(home, ".claude/skills/research/SKILL.md");
    const projectSkill = path.join(project, ".claude/skills/research-copy/SKILL.md");
    await mkdir(path.dirname(homeSkill), { recursive: true });
    await mkdir(path.dirname(projectSkill), { recursive: true });
    await writeFile(homeSkill, [
      "---",
      "description: Use for market research competitor analysis and synthesis workflows.",
      "---",
      "# Research",
      "Collect market facts and synthesize a decision memo."
    ].join("\n"));
    await writeFile(path.join(path.dirname(homeSkill), "reference.md"), "Longer market research notes for context.\n");
    await writeFile(projectSkill, [
      "---",
      "description: Use for market research competitor analysis and buyer synthesis.",
      "---",
      "# Research Copy",
      "Overlapping trigger on purpose."
    ].join("\n"));
    const oldDate = new Date(Date.now() - 130 * 86_400_000);
    await utimes(homeSkill, oldDate, oldDate);
    await utimes(path.join(path.dirname(homeSkill), "reference.md"), oldDate, oldDate);

    const result = await runCli(["audit-setup", "--home-dir", home, "--project-dir", project, "--stale-days", "90", "--json"]);

    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout) as {
      summary?: { skills?: number; conflicts?: number; staleSkills?: number; approxTokens?: number };
      conflicts?: unknown[];
      stale?: unknown[];
      shareCard?: string;
      recommendations?: string[];
    };
    assert.equal(body.summary?.skills, 2);
    assert.equal(body.summary?.conflicts, 1);
    assert.equal(body.summary?.staleSkills, 1);
    assert.ok((body.summary?.approxTokens ?? 0) > 0);
    assert.equal(body.conflicts?.length, 1);
    assert.equal(body.stale?.length, 1);
    assert.match(body.shareCard ?? "", /OnlyHarness setup audit/);
    assert.doesNotMatch(body.shareCard ?? "", new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(body.recommendations?.some((item) => /overlapping/i.test(item)));
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  }
});

test("benchmark compares candidate harnesses against analogs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hh-benchmark-"));
  const suite = path.join(root, "suite.yaml");
  try {
    await writeFile(suite, YAML.stringify({
      category: "research",
      title: "Research Benchmark",
      min_score: 0.82,
      candidates: [{ name: "deep-market-researcher", path: seedHarness }],
      analogs: [{ name: "gtm-research-sprint", path: gtmHarness }]
    }));

    const result = await runCli(["benchmark", suite, "--json"], { HH_REGISTRY_URL: registryUrl });

    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout) as {
      runner?: string;
      status?: string;
      summary?: { candidates?: number; analogs?: number; candidateDeltaVsAnalog?: number };
      rows?: Array<{ role?: string; name?: string; score?: number; verified?: boolean }>;
    };
    assert.equal(body.runner, "harnesshub-category-benchmark");
    assert.equal(body.status, "passed");
    assert.equal(body.summary?.candidates, 1);
    assert.equal(body.summary?.analogs, 1);
    assert.equal(body.summary?.candidateDeltaVsAnalog, 0);
    assert.ok(body.rows?.some((row) => row.role === "candidate" && row.name === "deep-market-researcher" && row.verified === true && row.score === 0.88));
    assert.ok(body.rows?.some((row) => row.role === "analog" && row.name === "gtm-research-sprint" && row.verified === true && row.score === 0.88));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("benchmark missing suite returns JSON not found guidance", async () => {
  const missing = path.join(os.tmpdir(), `hh-missing-benchmark-${Date.now()}.yaml`);
  const result = await runCli(["benchmark", missing, "--json"], { HH_REGISTRY_URL: registryUrl });

  assert.equal(result.status, 4);
  const body = JSON.parse(result.stderr) as { error?: string; code?: number; next?: string };
  assert.match(body.error ?? "", /Benchmark suite not found/);
  assert.equal(body.code, 4);
  assert.match(body.next ?? "", /hh benchmark/);
});

test("extract creates a valid harness with inferred depends_on and redacted source markdown", async () => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "hh-extract-source-"));
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-extract-out-"));
  await rm(out, { recursive: true, force: true });
  try {
    const baseSkill = path.join(sourceRoot, ".claude/skills/base-helper/SKILL.md");
    const mainSkillDir = path.join(sourceRoot, ".claude/skills/sales-research");
    const mainSkill = path.join(mainSkillDir, "SKILL.md");
    await mkdir(path.dirname(baseSkill), { recursive: true });
    await mkdir(mainSkillDir, { recursive: true });
    await writeFile(baseSkill, "---\ndescription: Base helper used by extracted skills.\n---\n# Base Helper\n");
    await writeFile(mainSkill, [
      "---",
      "description: Use for sales research workflow extraction and buyer synthesis.",
      "depends_on:",
      "  - org/acme-foundation@1.0.0",
      "---",
      "# Sales Research",
      "Load alongside base-helper when customer evidence is thin."
    ].join("\n"));
    await writeFile(path.join(mainSkillDir, "notes.md"), "token=abcdefghijklmnopqrstuvwxyz\nUse private notes carefully.\n");

    const dryRun = await runCli(["extract", "sales-research", "--home-dir", sourceRoot, "--project-dir", sourceRoot, "--out", out, "--dry-run", "--json"]);

    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.doesNotMatch(dryRun.stdout, new RegExp(sourceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await assert.rejects(readFile(path.join(out, "harness.yaml"), "utf8"));

    const result = await runCli(["extract", mainSkillDir, "--out", out, "--json"]);

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, new RegExp(sourceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const body = JSON.parse(result.stdout) as { name?: string; markdownFiles?: number; depends_on?: Array<{ ref?: string; version?: string; optional?: boolean }> };
    assert.equal(body.name, "sales-research");
    assert.equal(body.markdownFiles, 2);
    assert.ok(body.depends_on?.some((dependency) => dependency.ref === "org/acme-foundation" && dependency.version === "1.0.0" && dependency.optional === false));
    assert.ok(body.depends_on?.some((dependency) => dependency.ref === "skill:base-helper" && dependency.optional === true));

    const manifest = YAML.parse(await readFile(path.join(out, "harness.yaml"), "utf8")) as {
      schemaVersion?: string;
      visibility?: string;
      depends_on?: Array<{ ref?: string; version?: string }>;
      compatibility?: { targets?: Array<{ id?: string }> };
    };
    assert.equal(manifest.schemaVersion, "harness.v0.2");
    assert.equal(manifest.visibility, "private");
    assert.ok(manifest.depends_on?.some((dependency) => dependency.ref === "skill:base-helper"));
    assert.ok(manifest.depends_on?.some((dependency) => dependency.ref === "org/acme-foundation" && dependency.version === "1.0.0"));
    assert.ok(manifest.compatibility?.targets?.some((target) => target.id === "claude-code"));
    const copiedNotes = await readFile(path.join(out, "runbooks/source/notes.md"), "utf8");
    assert.match(copiedNotes, /token=REDACTED/);
    const readme = await readFile(path.join(out, "README.md"), "utf8");
    assert.doesNotMatch(readme, new RegExp(sourceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const validate = await runCli(["validate", out, "--strict", "--json"]);
    assert.equal(validate.status, 0, validate.stderr);

    const duplicate = await runCli(["extract", mainSkillDir, "--out", out, "--json"]);
    assert.equal(duplicate.status, 3);
    const duplicateBody = JSON.parse(duplicate.stderr) as { error?: string };
    assert.match(duplicateBody.error ?? "", /not empty/);
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});

test("extract by skill name refuses ambiguous home and project matches without writing", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "hh-extract-home-"));
  const project = await mkdtemp(path.join(os.tmpdir(), "hh-extract-project-"));
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-extract-ambiguous-out-"));
  await rm(out, { recursive: true, force: true });
  try {
    const homeSkill = path.join(home, ".claude/skills/dupe/SKILL.md");
    const projectSkill = path.join(project, ".claude/skills/dupe/SKILL.md");
    await mkdir(path.dirname(homeSkill), { recursive: true });
    await mkdir(path.dirname(projectSkill), { recursive: true });
    await writeFile(homeSkill, "---\ndescription: Home duplicate skill.\n---\n# Dupe\n");
    await writeFile(projectSkill, "---\ndescription: Project duplicate skill.\n---\n# Dupe\n");

    const result = await runCli(["extract", "dupe", "--home-dir", home, "--project-dir", project, "--out", out, "--json"]);

    assert.equal(result.status, 3);
    const body = JSON.parse(result.stderr) as { error?: string; next?: string };
    assert.match(body.error ?? "", /ambiguous/);
    assert.match(body.next ?? "", /Candidates/);
    await assert.rejects(readFile(path.join(out, "harness.yaml"), "utf8"));
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});

test("run --json exposes eval status for a pulled harness", async () => {
  const result = await runCli(["run", seedHarness, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout) as { eval?: { status?: string; score?: number } };
  assert.equal(body.eval?.status, "passed");
  assert.equal(typeof body.eval?.score, "number");
});

test("eval and gate record privacy-safe verification events for pulled harnesses", async () => {
  verificationEvents = [];
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-verification-events-"));
  try {
    await cp(seedHarness, out, { recursive: true });
    await mkdir(path.join(out, ".harnesshub"), { recursive: true });
    await writeFile(path.join(out, ".harnesshub/source.json"), JSON.stringify({
      owner: "harnesses",
      name: "deep-market-researcher",
      version: "0.1.0",
      registry: registryUrl,
      pulledAt: new Date().toISOString()
    }, null, 2));

    const evalResult = await runCli(["eval", out, "--json"], { HH_REGISTRY_URL: "http://127.0.0.1:1" });
    assert.equal(evalResult.status, 0, evalResult.stderr);
    const gateResult = await runCli(["gate", "--dir", out, "--json"], { HH_REGISTRY_URL: "http://127.0.0.1:1" });
    assert.equal(gateResult.status, 0, gateResult.stderr);

    assert.deepEqual(verificationEvents.map((event) => event.kind), ["eval", "gate"]);
    for (const event of verificationEvents) {
      assert.equal(event.owner, "harnesses");
      assert.equal(event.repo, "deep-market-researcher");
      assert.equal(event.version, "0.1.0");
      assert.equal(event.target, "passed");
      assert.equal(event.client, "hh");
      assert.equal(event.path, undefined);
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

function runCli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [HH, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`hh ${args.join(" ")} timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 10_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  });
}

function titleizeTest(value: string): string {
  return value.split("-").filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

function x402PaymentRequiredBody(priceUsd: number, amount: number) {
  const paymentRequired = x402PaymentRequired(priceUsd, amount);
  return {
    error: "Payment required",
    code: "PAYMENT_REQUIRED",
    checkout_url: "https://onlyharness.com/checkout?owner=harnesses&repo=x402",
    payments_enabled: true,
    pricing: { model: "one_time", amount_usd: priceUsd, currency: "USD" },
    x402: {
      enabled: true,
      requirements: paymentRequired.accepts,
      paymentRequired
    }
  };
}

function x402PaymentRequiredHeader(amount: number): string {
  return Buffer.from(JSON.stringify(x402PaymentRequired(amount / 1_000_000, amount)), "utf8").toString("base64");
}

function x402PaymentRequired(priceUsd: number, amount: number) {
  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: `http://127.0.0.1/repos/harnesses/x402/archive?version=0.1.0`,
      description: `harnesses/x402@$${priceUsd}`,
      mimeType: "application/json"
    },
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      amount: String(amount),
      payTo: "0x000000000000000000000000000000000000dEaD",
      maxTimeoutSeconds: 300,
      extra: { name: "harnesses/x402", version: "0.1.0" }
    }]
  };
}

function updatedHarnessYaml(): string {
  return `schemaVersion: harness.v0.1
name: deep-market-researcher
title: Deep Market Researcher
summary: Multi-stage research, synthesis, critique and validation pipeline for market questions.
version: 0.2.0
license: MIT
tags: [research, strategy, validation]
runtime:
  primary: openai-agents-sdk
  adapters: []
agents:
  - id: web_researcher
    role: research
    prompt: agents/web_researcher.md
    tools: []
    handoffs: []
  - id: synthesizer
    role: synthesis
    prompt: agents/synthesizer.md
    tools: []
    handoffs: []
  - id: critic
    role: critique
    prompt: agents/critic.md
    tools: []
    handoffs: []
workflow:
  entrypoint: web_researcher
  stages:
    - id: research
      agent: web_researcher
tools:
  mcp_servers: []
  function_tools: []
  external_apis: []
permissions:
  network: allowlist
  network_allowlist: [api.openai.com]
  filesystem: readonly
  shell: false
  browser: false
  credentials: runtime_injected
  external_send: false
  money_movement: false
  user_data: false
  human_approval_required: []
evals:
  promptfoo_config: evals/promptfooconfig.yaml
  command: npx promptfoo@latest eval -c evals/promptfooconfig.yaml
quality_gates:
  min_score: 0.82
  max_regression: 0.03
  max_cost_usd_per_run: 3
  max_risk_score: 39
  required_checks: [schema_valid, eval_passed]
examples:
  - title: Updated
    input: examples/input.md
    output: examples/expected.md
`;
}
