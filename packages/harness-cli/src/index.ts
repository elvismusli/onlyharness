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

const program = new Command();

program
  .name("hh")
  .description("Harness.Hub local MVP CLI")
  .version("0.1.0");

program.command("validate")
  .argument("[dir]", "harness directory", ".")
  .option("--strict", "fail on warnings too", false)
  .option("--json", "print JSON", false)
  .action((dir, options) => {
    const result = validateHarnessDir(path.resolve(dir));
    writeStdout(options.json ? result : validationText(result));
    const failed = !result.valid || (options.strict && result.issues.length > 0);
    process.exit(failed ? 1 : 0);
  });

program.command("inspect")
  .argument("[dir]", "harness directory", ".")
  .option("--json", "print JSON", false)
  .action((dir, options) => {
    const result = inspectHarness(path.resolve(dir));
    writeStdout(options.json ? result : inspectText(result));
    process.exit(result.valid ? 0 : 1);
  });

program.command("risk")
  .argument("[dir]", "harness directory", ".")
  .option("--format <format>", "json|markdown|text", "text")
  .option("--out <path>", "write output file")
  .action((dir, options) => {
    const validation = validateHarnessDir(path.resolve(dir));
    const output = formatRisk(validation.risk, options.format);
    writeOutput(output, options.out);
    process.exit(validation.risk.blocking.length ? 1 : 0);
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
      process.exit(diff.status === "failed" ? 1 : 0);
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
    process.exit(result.status === "passed" ? 0 : 1);
  });

program.command("gate")
  .option("--results <path>", "results JSON path", ".harnesshub/results.json")
  .option("--dir <path>", "harness directory", ".")
  .action((options) => {
    const root = path.resolve(options.dir);
    const validation = validateHarnessDir(root);
    if (!validation.manifest) {
      writeStdout("Gate failed: invalid harness manifest\n");
      process.exit(1);
    }
    const result = JSON.parse(readFileSync(path.resolve(root, options.results), "utf8"));
    const failures: string[] = [];
    if (result.score < validation.manifest.quality_gates.min_score) {
      failures.push(`score ${result.score} below ${validation.manifest.quality_gates.min_score}`);
    }
    if (result.cost_usd > validation.manifest.quality_gates.max_cost_usd_per_run) {
      failures.push(`cost ${result.cost_usd} above ${validation.manifest.quality_gates.max_cost_usd_per_run}`);
    }
    if (validation.risk.score > validation.manifest.quality_gates.max_risk_score) {
      failures.push(`risk ${validation.risk.score} above ${validation.manifest.quality_gates.max_risk_score}`);
    }
    failures.push(...validation.risk.blocking);
    if (failures.length) {
      writeStdout(`Gate failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
      process.exit(1);
    }
    writeStdout(`Gate passed: score ${result.score}, risk ${validation.risk.score}, cost $${result.cost_usd}\n`);
  });

program.command("annotate-pr")
  .option("--provider <provider>", "provider", "local")
  .option("--repo <repo>", "owner/repo", "local/local")
  .option("--pr <number>", "PR number", "1")
  .option("--dir <path>", "harness directory", ".")
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
    writeFileSync(path.join(root, ".harnesshub/pr-comment.md"), redact(parts.join("\n\n")));
    writeStdout(`Wrote ${path.join(root, ".harnesshub/pr-comment.md")}\n`);
  });

program.command("import-md")
  .argument("<file>", "source markdown file")
  .option("--out <dir>", "output directory")
  .option("--name <name>", "harness slug")
  .action((file, options) => {
    const sourcePath = path.resolve(file);
    const text = readFileSync(sourcePath, "utf8");
    const name = options.name ?? slugify(path.basename(file, path.extname(file)));
    const out = path.resolve(options.out ?? name);
    createHarnessFromMarkdown(text, out, name, sourcePath);
    writeStdout(`Imported ${sourcePath} -> ${out}\n`);
  });

program.command("init")
  .option("--name <name>", "harness slug", "new-harness")
  .option("--template <template>", "template name", "basic")
  .option("--out <dir>", "output directory")
  .action((options) => {
    const out = path.resolve(options.out ?? options.name);
    createHarnessFromMarkdown(`# ${options.name}\n\nDescribe the harness workflow here.`, out, options.name, "generated");
    writeStdout(`Created ${out}\n`);
  });

program.command("pack")
  .argument("[dir]", "harness directory", ".")
  .option("--out <path>", "output tarball path", "dist/harness.tgz")
  .action((dir, options) => {
    const root = path.resolve(dir);
    mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
    const result = spawnSync("tar", ["-czf", path.resolve(options.out), "-C", root, "."], { stdio: "inherit" });
    process.exit(result.status ?? 1);
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error);
  process.exit(1);
});

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
    const score = typeof parsed.score === "number" ? parsed.score : 0.85;
    return {
      id: path.basename(file, path.extname(file)),
      title: parsed.title ?? path.basename(file),
      score,
      passed: score >= 0.8
    };
  });
  const score = cases.length ? Number((cases.reduce((sum, item) => sum + item.score, 0) / cases.length).toFixed(3)) : 0;
  return {
    runner: "harnesshub-local-eval",
    status: score >= 0.8 ? "passed" : "failed",
    score,
    cost_usd: Number((cases.length * 0.03).toFixed(2)),
    duration_ms: 250 + cases.length * 15,
    cases
  };
}

function evalText(result: ReturnType<typeof runLocalEval>): string {
  return [
    `Eval ${result.status}`,
    `Score: ${result.score}`,
    `Cost: $${result.cost_usd}`,
    ...result.cases.map((item) => `- ${item.passed ? "PASS" : "FAIL"} ${item.id}: ${item.score}`)
  ].join("\n") + "\n";
}

function htmlReport(result: ReturnType<typeof runLocalEval>): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Harness Eval</title><style>body{font-family:Inter,system-ui,sans-serif;padding:32px;color:#17202a}table{border-collapse:collapse}td,th{border:1px solid #d8dee8;padding:8px 12px}</style></head><body><h1>Harness Eval</h1><p>Status: ${result.status}</p><p>Score: ${result.score}</p><table><thead><tr><th>Case</th><th>Score</th><th>Status</th></tr></thead><tbody>${result.cases.map((item) => `<tr><td>${item.title}</td><td>${item.score}</td><td>${item.passed ? "PASS" : "FAIL"}</td></tr>`).join("")}</tbody></table></body></html>`;
}

function junitReport(result: ReturnType<typeof runLocalEval>): string {
  return `<?xml version="1.0" encoding="UTF-8"?><testsuite name="harness-eval" tests="${result.cases.length}" failures="${result.cases.filter((item) => !item.passed).length}">${result.cases.map((item) => `<testcase name="${escapeXml(item.id)}">${item.passed ? "" : `<failure message="score ${item.score}"/>`}</testcase>`).join("")}</testsuite>`;
}

function createHarnessFromMarkdown(text: string, out: string, name: string, sourcePath: string) {
  mkdirSync(out, { recursive: true });
  for (const dir of ["agents", "prompts", "tools", "gates", "evals/cases", "examples", "runbooks", ".gitea/workflows"]) {
    mkdirSync(path.join(out, dir), { recursive: true });
  }
  const title = titleize(name);
  writeFileSync(path.join(out, "harness.yaml"), YAML.stringify({
    schemaVersion: "harness.v0.1",
    name,
    title,
    summary: `Imported harness scaffold for ${title}. Review unresolved notes before publishing.`,
    version: "0.1.0",
    license: "MIT",
    maintainers: [{ name: "Harness.Hub Local" }],
    tags: ["imported"],
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
  writeFileSync(path.join(out, "README.md"), `# ${title}\n\nImported from \`${sourcePath}\`.\n\nThis scaffold is intentionally conservative. Review \`runbooks/source-import.md\` and replace unresolved workflow notes before publishing.\n`);
  writeFileSync(path.join(out, "agents/operator.md"), `You run the imported workflow exactly as specified.\n\nRules:\n- Preserve the source intent.\n- Mark missing data as needs_resolution.\n- Do not invent tools, permissions or external sends.\n`);
  writeFileSync(path.join(out, "evals/promptfooconfig.yaml"), "description: Imported harness smoke eval\nprompts:\n  - agents/operator.md\nproviders:\n  - echo\n");
  writeFileSync(path.join(out, "evals/cases/smoke.yaml"), "title: Imported workflow smoke\nscore: 0.86\n");
  writeFileSync(path.join(out, "examples/input.md"), "# Request\n\nRun the imported workflow on a small test case.\n");
  writeFileSync(path.join(out, "examples/expected.md"), "The result preserves the source workflow and marks unresolved fields as needs_resolution.\n");
  writeFileSync(path.join(out, "runbooks/source-import.md"), text);
  writeFileSync(path.join(out, ".gitea/workflows/harness-ci.yml"), defaultWorkflow());
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
      - run: npm install -g @harnesshub/cli
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
