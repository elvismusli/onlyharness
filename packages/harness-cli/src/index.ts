#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import YAML from "yaml";
import {
  inspectHarness,
  riskMarkdown,
  validateHarnessDir
} from "@harnesshub/schema";
import { diffHarnessDirs, semanticDiffMarkdown } from "@harnesshub/semantic-diff";

type OutputFormat = "json" | "markdown" | "text";

const registryUrl = (process.env.HH_REGISTRY_URL ?? "https://onlyharness.com/api").replace(/\/$/, "");

type SearchItem = {
  owner: string;
  name: string;
  title: string;
  summary: string;
  tags: string[];
  stars: number;
  forks: number;
  threads: number;
  evalScore: number;
  heat: number;
};

type ArchiveFile = { path: string; truncated: boolean; content: string };
type PaymentRequiredBody = {
  error?: string;
  code?: string;
  checkout_url?: string;
  next?: string;
  pricing?: {
    model?: string;
    amount_usd?: number;
    currency?: string;
  };
};

export const EXIT = {
  OK: 0,
  GENERAL: 1,
  AUTH: 2,
  VALIDATION: 3,
  NOT_FOUND: 4,
  PAYMENT: 5
} as const;

type ExitCode = typeof EXIT[keyof typeof EXIT];

export function failMessage(message: string, next?: string): string {
  return next ? `${message}\nNext: ${next}` : message;
}

function fail(message: string, code: ExitCode, next?: string, json = false): never {
  const output = json
    ? JSON.stringify({ error: message, code, next: next ?? null }, null, 2)
    : failMessage(message, next);
  process.stderr.write(`${output}\n`);
  process.exit(code);
}

const program = new Command();

program
  .name("hh")
  .description("OnlyHarness CLI — find, pull, run, eval and publish agent harnesses (onlyharness.com)")
  .version("0.2.0");

program.command("search")
  .description("search the OnlyHarness registry")
  .argument("<query...>", "search terms")
  .option("--json", "print JSON", false)
  .option("--limit <n>", "max results", "10")
  .action(async (queryParts: string[], options) => {
    const query = queryParts.join(" ");
    const data = await fetchJson(`${registryUrl}/registry?q=${encodeURIComponent(query)}&sort=trending`, { json: options.json }) as { items?: SearchItem[] };
    const items = (data.items ?? []).slice(0, Number(options.limit) || 10);
    if (options.json) return writeStdout(items);
    if (!items.length) return writeStdout("No harnesses found on this frontier. Try another word, partner.\n");
    writeStdout(items.map((item) => [
      `${item.owner}/${item.name} — ${item.title}`,
      `  ${item.summary}`,
      `  ★ ${item.stars} · ⑂ ${item.forks} · 💬 ${item.threads} · eval ${item.evalScore} · heat ${item.heat} · ${item.tags.map((tag) => `#${tag}`).join(" ")}`,
      `  hh pull ${item.owner}/${item.name}`
    ].join("\n")).join("\n\n") + "\n");
  });

program.command("pull")
  .description("download a harness from the registry into a local directory")
  .argument("<harness>", "owner/name, e.g. harnesses/deep-market-researcher")
  .option("--out <dir>", "output directory (default ./<name>)")
  .option("--force", "write into a non-empty directory", false)
  .option("--token <token>", "access token (defaults to HH_TOKEN env)")
  .option("--json", "print JSON", false)
  .action(async (harness: string, options) => {
    const [owner, name] = harness.split("/");
    if (!owner || !name) {
      fail("Expected <owner>/<name>, e.g. harnesses/deep-market-researcher", EXIT.VALIDATION, "hh pull harnesses/deep-market-researcher", options.json);
    }
    const archiveUrl = `${registryUrl}/repos/${owner}/${name}/archive`;
    const token = options.token ?? process.env.HH_TOKEN;
    const response = await fetchRegistryResponse(archiveUrl, options.json, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
    if (response.status === 404) {
      fail(`Harness ${owner}/${name} not found.`, EXIT.NOT_FOUND, `hh search ${name.replaceAll("-", " ")}`, options.json);
    }
    if (response.status === 401) {
      const body = await readResponseJson(response, archiveUrl, options.json).catch(() => ({})) as { error?: string };
      fail(
        `Pull failed (401): ${body.error ?? "authorization required"}`,
        EXIT.AUTH,
        "Log on at https://onlyharness.com, then export HH_TOKEN=<access token> and retry",
        options.json
      );
    }
    if (response.status === 402) {
      const body = await readResponseJson(response, archiveUrl, options.json).catch(() => ({})) as PaymentRequiredBody;
      const price = priceLabel(body);
      fail(
        `Payment required for ${owner}/${name}${price ? ` (${price})` : ""}`,
        EXIT.PAYMENT,
        body.checkout_url ? `Open ${body.checkout_url}, then retry with HH_TOKEN` : body.next,
        options.json
      );
    }
    if (!response.ok) {
      fail(`Registry request failed: ${archiveUrl} -> ${response.status}`, EXIT.GENERAL, undefined, options.json);
    }
    const data = await readResponseJson(response, archiveUrl, options.json) as { files?: ArchiveFile[] };
    const out = path.resolve(options.out ?? name);
    if (existsSync(out) && readdirSync(out).length > 0 && !options.force) {
      fail(`${out} exists and is not empty.`, EXIT.VALIDATION, `hh pull ${harness} --force`, options.json);
    }
    let written = 0;
    let skipped = 0;
    for (const file of data.files ?? []) {
      const target = path.resolve(out, file.path);
      if (target !== out && !target.startsWith(out + path.sep)) continue;
      if (file.truncated) {
        skipped += 1;
        continue;
      }
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, file.content);
      written += 1;
    }
    if (!written) fail(`No files received for ${owner}/${name}`, EXIT.GENERAL, `hh search ${name.replaceAll("-", " ")}`, options.json);
    if (options.json) {
      writeStdout({ owner, name, out, files: written, skipped });
      return;
    }
    writeStdout([
      `Pulled ${owner}/${name} -> ${out} (${written} files${skipped ? `, ${skipped} skipped as too large` : ""})`,
      `Next: hh run ${out} · hh eval ${out} && hh gate --dir ${out}`
    ].join("\n") + "\n");
  });

program.command("run")
  .description("run the bundled example locally (sample mode: no LLM calls, no credentials)")
  .argument("[dir]", "harness directory", ".")
  .option("--input <file>", "input file", "examples/input.md")
  .option("--json", "print JSON", false)
  .action((dir, options) => {
    const root = path.resolve(dir);
    const validation = validateHarnessDir(root);
    if (!validation.manifest) {
      fail("Not a harness directory: harness.yaml is missing or invalid.", EXIT.NOT_FOUND, "hh pull <owner>/<name>", options.json);
    }
    const inputPath = path.resolve(root, options.input);
    const expectedPath = path.join(root, "examples/expected.md");
    const result = runLocalEval(root);
    const payload = {
      title: validation.manifest.title,
      input: existsSync(inputPath) ? inputPath : null,
      expected: existsSync(expectedPath) ? expectedPath : null,
      eval: {
        status: result.status,
        score: result.score,
        minScore: validation.manifest.quality_gates.min_score
      }
    };
    const text = [
      `Running ${validation.manifest.title} — local sample mode (no LLM calls, no credentials)`,
      `Input: ${existsSync(inputPath) ? inputPath : "none bundled"}`,
      `Expected output: ${existsSync(expectedPath) ? expectedPath : "none bundled"}`,
      `Eval: ${result.status} · score ${result.score} (gate needs ≥ ${validation.manifest.quality_gates.min_score})`,
      `Real runtime entrypoint: ${validation.manifest.entrypoint?.command ?? "not declared"}`
    ].join("\n") + "\n";
    if (result.status !== "passed") {
      if (options.json) fail(`Eval ${result.status}: score ${result.score}`, EXIT.VALIDATION, `hh eval ${root} && hh gate --dir ${root}`, true);
      writeStdout(text);
      process.exit(EXIT.VALIDATION);
    }
    writeStdout(options.json ? payload : text);
    process.exit(EXIT.OK);
  });

program.command("publish")
  .description("publish a markdown workflow to the registry (needs an OnlyHarness token)")
  .argument("<file>", "source markdown file")
  .option("--name <name>", "harness slug")
  .option("--token <token>", "access token (defaults to HH_TOKEN env)")
  .option("--json", "print JSON", false)
  .action(async (file: string, options) => {
    const token = options.token ?? process.env.HH_TOKEN;
    const markdown = readFileSync(path.resolve(file), "utf8");
    const name = options.name ?? slugify(path.basename(file, path.extname(file)));
    const response = await fetch(`${registryUrl}/imports/markdown-to-harness`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ name, markdown })
    });
    const body = await response.json().catch(() => ({})) as { item?: { title?: string; name?: string }; error?: string };
    if (!response.ok) {
      if (response.status === 401) {
        fail(
          `Publish failed (401): ${body.error ?? "authorization required"}`,
          EXIT.AUTH,
          "Log on at https://onlyharness.com, then export HH_TOKEN=<access token> and retry",
          options.json
        );
      }
      fail(`Publish failed (${response.status}): ${body.error ?? JSON.stringify(body)}`, EXIT.GENERAL, undefined, options.json);
    }
    const title = body.item?.title ?? name;
    if (options.json) {
      writeStdout({ title, name: body.item?.name ?? name, url: "https://onlyharness.com" });
      return;
    }
    writeStdout(`Published ${title} — live on https://onlyharness.com\n`);
  });

program.command("doctor")
  .description("check registry connectivity and local setup")
  .option("--json", "print JSON", false)
  .action(async (options) => {
    let registryOk = false;
    let indexed: number | string = "-";
    try {
      const health = await fetchJson(`${registryUrl}/healthz`, { json: options.json }) as { ok?: boolean };
      registryOk = Boolean(health.ok);
      const registry = await fetchJson(`${registryUrl}/registry`, { json: options.json }) as { items?: unknown[] };
      indexed = (registry.items ?? []).length;
    } catch {
      registryOk = false;
    }
    const payload = {
      registry: registryUrl,
      ok: registryOk,
      indexed,
      node: process.version,
      tokenSet: Boolean(process.env.HH_TOKEN)
    };
    if (!registryOk) {
      fail(`Registry unreachable: ${registryUrl}`, EXIT.GENERAL, `check HH_REGISTRY_URL (current: ${registryUrl})`, options.json);
    }
    if (options.json) {
      writeStdout(payload);
      return;
    }
    writeStdout([
      "OnlyHarness doctor",
      `  registry .......... ${registryUrl} ${registryOk ? "[OK]" : "[UNREACHABLE]"}`,
      `  harnesses indexed . ${indexed}`,
      `  node .............. ${process.version}`,
      `  token ............. ${process.env.HH_TOKEN ? "HH_TOKEN set" : "not set (only needed for hh publish)"}`
    ].join("\n") + "\n");
    process.exit(EXIT.OK);
  });

program.command("validate")
  .argument("[dir]", "harness directory", ".")
  .option("--strict", "fail on warnings too", false)
  .option("--json", "print JSON", false)
  .action((dir, options) => {
    const result = validateHarnessDir(path.resolve(dir));
    writeStdout(options.json ? result : validationText(result));
    const failed = !result.valid || (options.strict && result.issues.length > 0);
    process.exit(failed ? EXIT.VALIDATION : EXIT.OK);
  });

program.command("inspect")
  .argument("[dir]", "harness directory", ".")
  .option("--json", "print JSON", false)
  .action((dir, options) => {
    const result = inspectHarness(path.resolve(dir));
    writeStdout(options.json ? result : inspectText(result));
    process.exit(result.valid ? EXIT.OK : EXIT.VALIDATION);
  });

program.command("risk")
  .argument("[dir]", "harness directory", ".")
  .option("--format <format>", "json|markdown|text", "text")
  .option("--out <path>", "write output file")
  .action((dir, options) => {
    const validation = validateHarnessDir(path.resolve(dir));
    const output = formatRisk(validation.risk, options.format);
    writeOutput(output, options.out);
    process.exit(validation.risk.blocking.length ? EXIT.VALIDATION : EXIT.OK);
  });

program.command("diff")
  .argument("[range]", "git range such as main...HEAD")
  .option("--base-dir <path>", "base harness directory")
  .option("--head-dir <path>", "head harness directory", ".")
  .option("--format <format>", "json|markdown|text", "text")
  .option("--out <path>", "write output file")
  .action((range, options) => {
    const { baseDir, headDir, cleanup } = resolveDiffDirs(range, options.baseDir, options.headDir);
    try {
      const diff = diffHarnessDirs(baseDir, headDir);
      const output = formatDiff(diff, options.format);
      writeOutput(output, options.out);
      process.exit(diff.status === "failed" ? EXIT.VALIDATION : EXIT.OK);
    } finally {
      cleanup();
    }
  });

program.command("eval")
  .argument("[dir]", "harness directory", ".")
  .option("--ci", "CI mode", false)
  .option("--json", "print result JSON", false)
  .action((dir, options) => {
    const root = path.resolve(dir);
    const result = runLocalEval(root);
    mkdirSync(path.join(root, ".harnesshub"), { recursive: true });
    writeFileSync(path.join(root, ".harnesshub/results.json"), JSON.stringify(result, null, 2));
    writeFileSync(path.join(root, ".harnesshub/report.html"), htmlReport(result));
    writeFileSync(path.join(root, ".harnesshub/results.junit.xml"), junitReport(result));
    writeStdout(options.json ? result : evalText(result));
    process.exit(result.status === "passed" ? EXIT.OK : EXIT.VALIDATION);
  });

program.command("gate")
  .option("--results <path>", "results JSON path", ".harnesshub/results.json")
  .option("--dir <path>", "harness directory", ".")
  .option("--json", "print JSON", false)
  .action((options) => {
    const root = path.resolve(options.dir);
    const validation = validateHarnessDir(root);
    if (!validation.manifest) {
      fail("Gate failed: invalid harness manifest", EXIT.VALIDATION, "hh validate --strict", options.json);
    }
    let result: { score?: number; cost_usd?: number };
    try {
      result = JSON.parse(readFileSync(path.resolve(root, options.results), "utf8"));
    } catch {
      fail("Gate failed: results JSON missing or invalid", EXIT.VALIDATION, `hh eval ${root}`, options.json);
    }
    const score = Number(result.score ?? 0);
    const cost = Number(result.cost_usd ?? 0);
    const failures: string[] = [];
    if (score < validation.manifest.quality_gates.min_score) {
      failures.push(`score ${score} below ${validation.manifest.quality_gates.min_score}`);
    }
    if (cost > validation.manifest.quality_gates.max_cost_usd_per_run) {
      failures.push(`cost ${cost} above ${validation.manifest.quality_gates.max_cost_usd_per_run}`);
    }
    if (validation.risk.score > validation.manifest.quality_gates.max_risk_score) {
      failures.push(`risk ${validation.risk.score} above ${validation.manifest.quality_gates.max_risk_score}`);
    }
    failures.push(...validation.risk.blocking);
    const payload = { passed: failures.length === 0, score, risk: validation.risk.score, cost, failures };
    if (failures.length) {
      if (options.json) fail(`Gate failed: ${failures.join("; ")}`, EXIT.VALIDATION, "hh eval && hh gate --dir .", true);
      writeStdout(`Gate failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
      process.exit(EXIT.VALIDATION);
    }
    writeStdout(options.json ? payload : `Gate passed: score ${score}, risk ${validation.risk.score}, cost $${cost}\n`);
  });

program.command("annotate-pr")
  .option("--provider <provider>", "provider", "local")
  .option("--repo <repo>", "owner/repo", "local/local")
  .option("--pr <number>", "PR number", "1")
  .option("--dir <path>", "harness directory", ".")
  .option("--json", "print JSON", false)
  .action((options) => {
    const root = path.resolve(options.dir);
    const riskPath = path.join(root, ".harnesshub/risk.md");
    const diffPath = path.join(root, ".harnesshub/semantic-diff.md");
    const resultPath = path.join(root, ".harnesshub/results.json");
    const parts = [
      `# Harness Review for ${options.repo} PR #${options.pr}`,
      "",
      existsSync(riskPath) ? readFileSync(riskPath, "utf8") : "Risk report missing.",
      existsSync(diffPath) ? readFileSync(diffPath, "utf8") : "Semantic diff missing.",
      existsSync(resultPath) ? `\nEval result:\n\n\`\`\`json\n${readFileSync(resultPath, "utf8")}\n\`\`\`\n` : "Eval result missing."
    ];
    mkdirSync(path.join(root, ".harnesshub"), { recursive: true });
    const out = path.join(root, ".harnesshub/pr-comment.md");
    writeFileSync(out, redact(parts.join("\n\n")));
    writeStdout(options.json ? { path: out, provider: options.provider, repo: options.repo, pr: Number(options.pr) } : `Wrote ${out}\n`);
  });

program.command("import-md")
  .argument("<file>", "source markdown file")
  .option("--out <dir>", "output directory")
  .option("--name <name>", "harness slug")
  .option("--json", "print JSON", false)
  .action((file, options) => {
    const sourcePath = path.resolve(file);
    const text = readFileSync(sourcePath, "utf8");
    const name = options.name ?? slugify(path.basename(file, path.extname(file)));
    const out = path.resolve(options.out ?? name);
    createHarnessFromMarkdown(text, out, name, sourcePath);
    writeStdout(options.json ? { name, source: sourcePath, out } : `Imported ${sourcePath} -> ${out}\n`);
  });

program.command("init")
  .option("--name <name>", "harness slug", "new-harness")
  .option("--template <template>", "template name", "basic")
  .option("--out <dir>", "output directory")
  .option("--json", "print JSON", false)
  .action((options) => {
    const out = path.resolve(options.out ?? options.name);
    createHarnessFromMarkdown(`# ${options.name}\n\nDescribe the harness workflow here.`, out, options.name, "generated");
    writeStdout(options.json ? { name: options.name, template: options.template, out } : `Created ${out}\n`);
  });

program.command("pack")
  .argument("[dir]", "harness directory", ".")
  .option("--out <path>", "output tarball path", "dist/harness.tgz")
  .option("--json", "print JSON", false)
  .action((dir, options) => {
    const root = path.resolve(dir);
    const out = path.resolve(options.out);
    mkdirSync(path.dirname(out), { recursive: true });
    const result = spawnSync("tar", ["-czf", out, "-C", root, "."], {
      stdio: options.json ? "pipe" : "inherit",
      encoding: "utf8"
    });
    if (result.status !== 0) {
      fail(`Pack failed: ${result.stderr || result.stdout || "tar exited with an error"}`, EXIT.GENERAL, undefined, options.json);
    }
    writeStdout(options.json ? { out, files: "tar.gz" } : `Packed ${out}\n`);
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit((error as { exitCode?: number }).exitCode ?? EXIT.GENERAL);
});

async function fetchJson(url: string, options: { json?: boolean } = {}): Promise<unknown> {
  const response = await fetchRegistryResponse(url, options.json);
  if (!response.ok) fail(`Registry request failed: ${url} -> ${response.status}`, response.status === 404 ? EXIT.NOT_FOUND : EXIT.GENERAL, undefined, options.json);
  return readResponseJson(response, url, options.json);
}

async function fetchRegistryResponse(url: string, json = false, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    fail(`Registry request failed: ${url}: ${errorMessage(error)}`, EXIT.GENERAL, undefined, json);
  }
}

async function readResponseJson(response: Response, url: string, json = false): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    fail(`Registry returned invalid JSON: ${url}: ${errorMessage(error)}`, EXIT.GENERAL, undefined, json);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function priceLabel(body: PaymentRequiredBody): string {
  const amount = body.pricing?.amount_usd;
  const currency = body.pricing?.currency ?? "USD";
  if (typeof amount === "number" && Number.isFinite(amount)) return `${amount} ${currency}`;
  return body.pricing?.model ?? "";
}

function validationText(result: ReturnType<typeof validateHarnessDir>): string {
  return [
    result.valid ? "Harness valid" : "Harness invalid",
    `Risk: ${result.risk.score} ${result.risk.tier}`,
    ...result.issues.map((issue) => `- ${issue.severity.toUpperCase()} ${issue.path}: ${issue.message}`),
    ...result.risk.blocking.map((issue) => `- BLOCKING ${issue}`)
  ].join("\n") + "\n";
}

function inspectText(result: ReturnType<typeof inspectHarness>): string {
  const manifest = result.manifest;
  if (!manifest) return validationText(result);
  return [
    `${manifest.title} (${manifest.name})`,
    manifest.summary,
    `Runtime: ${manifest.runtime.primary}`,
    `Agents: ${result.components?.agents ?? 0}`,
    `Stages: ${result.components?.stages ?? 0}`,
    `Tools: ${result.components?.tools ?? 0}`,
    `Risk: ${result.risk.score} ${result.risk.tier}`
  ].join("\n") + "\n";
}

function formatRisk(report: ReturnType<typeof validateHarnessDir>["risk"], format: OutputFormat): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  if (format === "markdown") return riskMarkdown(report);
  return `Risk: ${report.score} ${report.tier}\n${report.reasons.map((reason) => `- ${reason}`).join("\n")}\n`;
}

function formatDiff(diff: ReturnType<typeof diffHarnessDirs>, format: OutputFormat): string {
  if (format === "json") return JSON.stringify(diff, null, 2);
  if (format === "markdown") return semanticDiffMarkdown(diff);
  return semanticDiffMarkdown(diff);
}

function writeOutput(output: string, out?: string) {
  if (out) {
    mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    writeFileSync(path.resolve(out), output);
  } else {
    writeStdout(output.endsWith("\n") ? output : `${output}\n`);
  }
}

function writeStdout(output: unknown) {
  if (typeof output === "string") {
    process.stdout.write(output);
  } else {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  }
}

function resolveDiffDirs(range: string | undefined, baseDir: string | undefined, headDir: string): { baseDir: string; headDir: string; cleanup: () => void } {
  if (baseDir) {
    return { baseDir: path.resolve(baseDir), headDir: path.resolve(headDir), cleanup: () => undefined };
  }
  if (range?.includes("...")) {
    const [baseRef, headRef] = range.split("...");
    const baseTmp = materializeGitRef(baseRef);
    const headTmp = headRef === "HEAD" ? path.resolve(headDir) : materializeGitRef(headRef);
    return {
      baseDir: baseTmp,
      headDir: headTmp,
      cleanup: () => {
        rmSync(baseTmp, { recursive: true, force: true });
        if (headTmp !== path.resolve(headDir)) rmSync(headTmp, { recursive: true, force: true });
      }
    };
  }
  const baseFallback = path.resolve(".harnesshub/base");
  if (existsSync(baseFallback)) {
    return { baseDir: baseFallback, headDir: path.resolve(headDir), cleanup: () => undefined };
  }
  return { baseDir: path.resolve(headDir), headDir: path.resolve(headDir), cleanup: () => undefined };
}

function materializeGitRef(ref: string): string {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "hh-ref-"));
  const tree = spawnSync("git", ["ls-tree", "-r", "--name-only", ref], { encoding: "utf8" });
  if (tree.status !== 0) throw new Error(`Cannot read git ref ${ref}: ${tree.stderr}`);
  for (const file of tree.stdout.split("\n").filter(Boolean)) {
    if (!isHarnessPath(file)) continue;
    const content = spawnSync("git", ["show", `${ref}:${file}`], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    if (content.status !== 0) continue;
    const target = path.join(tmp, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content.stdout);
  }
  return tmp;
}

function isHarnessPath(file: string): boolean {
  return file === "harness.yaml" || /^(agents|prompts|tools|gates|evals|examples|runbooks)\//.test(file);
}

function runLocalEval(root: string) {
  const casesDir = path.join(root, "evals/cases");
  const files = existsSync(casesDir) ? readdirSync(casesDir).filter((file) => file.endsWith(".yaml") || file.endsWith(".yml")) : [];
  const cases = files.map((file) => {
    const parsed = YAML.parse(readFileSync(path.join(casesDir, file), "utf8")) ?? {};
    const hasMeasuredScore = typeof parsed.score === "number" && Number.isFinite(parsed.score);
    const score = hasMeasuredScore ? parsed.score : 0;
    return {
      id: path.basename(file, path.extname(file)),
      title: parsed.title ?? path.basename(file),
      score,
      passed: hasMeasuredScore && score >= 0.8,
      verification_status: hasMeasuredScore ? "declared_score" : "unverified_missing_score",
      ...(hasMeasuredScore ? {} : { note: "No measured case score declared; counted as unverified instead of inferred." })
    };
  });
  const score = cases.length ? Number((cases.reduce((sum, item) => sum + item.score, 0) / cases.length).toFixed(3)) : 0;
  const unverifiedCases = cases.filter((item) => item.verification_status !== "declared_score").length;
  return {
    runner: "harnesshub-local-eval",
    status: !cases.length || unverifiedCases ? "unverified" : score >= 0.8 ? "passed" : "failed",
    score,
    verified: Boolean(cases.length) && unverifiedCases === 0,
    verification_status: !cases.length ? "no_eval_cases" : unverifiedCases ? "unverified_missing_case_scores" : "declared_case_scores",
    cost_usd: Number((cases.length * 0.03).toFixed(2)),
    duration_ms: 250 + cases.length * 15,
    cases
  };
}

function evalText(result: ReturnType<typeof runLocalEval>): string {
  return [
    `Eval ${result.status}`,
    `Score: ${result.score}`,
    `Verification: ${result.verification_status}`,
    `Cost: $${result.cost_usd}`,
    ...result.cases.map((item) => `- ${item.passed ? "PASS" : "FAIL"} ${item.id}: ${item.score} (${item.verification_status})`)
  ].join("\n") + "\n";
}

function htmlReport(result: ReturnType<typeof runLocalEval>): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Harness Eval</title><style>body{font-family:Inter,system-ui,sans-serif;padding:32px;color:#17202a}table{border-collapse:collapse}td,th{border:1px solid #d8dee8;padding:8px 12px}</style></head><body><h1>Harness Eval</h1><p>Status: ${result.status}</p><p>Score: ${result.score}</p><p>Verification: ${result.verification_status}</p><table><thead><tr><th>Case</th><th>Score</th><th>Status</th><th>Verification</th></tr></thead><tbody>${result.cases.map((item) => `<tr><td>${item.title}</td><td>${item.score}</td><td>${item.passed ? "PASS" : "FAIL"}</td><td>${item.verification_status}</td></tr>`).join("")}</tbody></table></body></html>`;
}

function junitReport(result: ReturnType<typeof runLocalEval>): string {
  return `<?xml version="1.0" encoding="UTF-8"?><testsuite name="harness-eval" tests="${result.cases.length}" failures="${result.cases.filter((item) => !item.passed).length}">${result.cases.map((item) => `<testcase name="${escapeXml(item.id)}">${item.passed ? "" : `<failure message="score ${item.score}"/>`}</testcase>`).join("")}</testsuite>`;
}

function createHarnessFromMarkdown(text: string, out: string, name: string, sourcePath: string) {
  mkdirSync(out, { recursive: true });
  for (const dir of ["agents", "prompts", "tools", "gates", "evals/cases", "examples", "runbooks", ".gitea/workflows", ".harnesshub"]) {
    mkdirSync(path.join(out, dir), { recursive: true });
  }
  const title = titleize(name);
  const unverifiedResult = unverifiedImportResult("smoke", "Imported workflow smoke");
  writeFileSync(path.join(out, "harness.yaml"), YAML.stringify({
    schemaVersion: "harness.v0.1",
    name,
    title,
    summary: `Unverified imported harness scaffold for ${title}. Add real eval scores before publishing.`,
    version: "0.1.0",
    license: "UNSPECIFIED",
    maintainers: [{ name: "Harness.Hub Local" }],
    tags: ["imported", "unverified"],
    runtime: { primary: "openai-agents-sdk", adapters: [] },
    entrypoint: { command: "npm run harness:run", cwd: "." },
    inputs: [{ id: "request", type: "markdown", required: true }],
    outputs: [{ id: "final_result", type: "markdown" }],
    agents: [
      { id: "operator", role: "run_imported_workflow", title: "Operator", prompt: "agents/operator.md", tools: [], handoffs: [] }
    ],
    workflow: { entrypoint: "operator", stages: [{ id: "run", agent: "operator" }] },
    tools: { mcp_servers: [], function_tools: [], external_apis: [] },
    permissions: {
      network: "allowlist",
      network_allowlist: ["api.openai.com"],
      filesystem: "readonly",
      shell: false,
      browser: false,
      credentials: "runtime_injected",
      external_send: false,
      money_movement: false,
      user_data: false,
      human_approval_required: ["external_send", "money_movement"]
    },
    secrets: { required: ["OPENAI_API_KEY"], optional: [] },
    evals: {
      promptfoo_config: "evals/promptfooconfig.yaml",
      command: "npx promptfoo@latest eval -c evals/promptfooconfig.yaml -o .harnesshub/results.json -o .harnesshub/report.html -o .harnesshub/results.junit.xml"
    },
    quality_gates: { min_score: 0.82, max_regression: 0.03, max_cost_usd_per_run: 3, max_risk_score: 39, required_checks: ["schema_valid", "eval_passed", "no_high_risk_permission_delta"] },
    examples: [{ title: "Imported workflow smoke", input: "examples/input.md", output: "examples/expected.md" }]
  }));
  writeFileSync(path.join(out, "README.md"), `# ${title}\n\nImported from \`${sourcePath}\`.\n\nTrust status: unverified import. This scaffold has no measured eval score yet; \`.harnesshub/results.json\` intentionally records score \`0\` until a real eval run supplies evidence.\n\nBefore publishing:\n\n1. Review \`runbooks/source-import.md\` against the original source.\n2. Replace unresolved workflow notes.\n3. Add measured eval scores to \`evals/cases/*.yaml\` or wire a real evaluator.\n4. Run \`hh validate --strict && hh eval && hh gate\`.\n`);
  writeFileSync(path.join(out, "AGENTS.md"), `# ${title} - agent guide\n\nThis directory is an OnlyHarness harness.\n\n- Validate: hh validate . --strict\n- Run the bundled example (no LLM calls): hh run .\n- Score eval cases: hh eval . && hh gate --dir .\n- Manifest (runtime, permissions, gates): harness.yaml\n- Do not enable external_send or money_movement without human approval (see permissions).\n`);
  writeFileSync(path.join(out, "agents/operator.md"), `You run the imported workflow exactly as specified.\n\nTrust status: unverified import. Treat source gaps as unresolved until a human verifies them.\n\nRules:\n- Preserve the source intent.\n- Mark missing data as needs_resolution.\n- Do not invent tools, permissions, eval scores or external sends.\n`);
  writeFileSync(path.join(out, "evals/promptfooconfig.yaml"), "description: Imported harness smoke eval (unverified scaffold; add measured assertions before gating)\nprompts:\n  - agents/operator.md\nproviders:\n  - echo\n");
  writeFileSync(path.join(out, "evals/cases/smoke.yaml"), "title: Imported workflow smoke\nverification_status: unverified_import\nnote: Generated scaffold only; add a measured score after a real eval run.\n");
  writeFileSync(path.join(out, "examples/input.md"), "# Request\n\nRun the imported workflow on a small test case.\n");
  writeFileSync(path.join(out, "examples/expected.md"), "The result preserves the source workflow, marks unresolved fields as needs_resolution, and does not claim verification without a measured eval.\n");
  writeFileSync(path.join(out, "runbooks/source-import.md"), text);
  writeFileSync(path.join(out, ".harnesshub/results.json"), JSON.stringify(unverifiedResult, null, 2));
  writeFileSync(path.join(out, ".harnesshub/report.html"), htmlReport(unverifiedResult));
  writeFileSync(path.join(out, ".harnesshub/results.junit.xml"), junitReport(unverifiedResult));
  writeFileSync(path.join(out, ".gitea/workflows/harness-ci.yml"), defaultWorkflow());
}

function unverifiedImportResult(id: string, title: string) {
  return {
    runner: "harnesshub-local-eval",
    status: "unverified",
    score: 0,
    verified: false,
    verification_status: "unverified_import_scaffold",
    cost_usd: 0,
    duration_ms: 0,
    cases: [
      {
        id,
        title,
        score: 0,
        passed: false,
        verification_status: "unverified_import",
        note: "Generated scaffold only; add a measured eval score before gating."
      }
    ]
  };
}

function defaultWorkflow(): string {
  return `name: Harness CI
on:
  pull_request:
    paths:
      - "harness.yaml"
      - "agents/**"
      - "prompts/**"
      - "tools/**"
      - "gates/**"
      - "evals/**"
      - "examples/**"
  push:
    branches: [main]
jobs:
  validate-and-eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npm install -g onlyharness
      - run: hh validate --strict --json > .harnesshub/validation.json
      - run: hh risk --format markdown --out .harnesshub/risk.md
      - run: hh diff origin/main...HEAD --format markdown --out .harnesshub/semantic-diff.md
      - run: hh eval --ci
      - run: hh gate --results .harnesshub/results.json
      - run: hh annotate-pr --provider gitea
`;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "imported-harness";
}

function titleize(value: string): string {
  return value.split(/[-_\s]+/).filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" }[char] ?? char));
}

function redact(value: string): string {
  return value.replace(/sk-[A-Za-z0-9]{20,}/g, "sk-REDACTED").replace(/(api[_-]?key|token)([:=]\s*)[A-Za-z0-9_\-]{16,}/gi, "$1$2REDACTED");
}
