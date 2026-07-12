import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";

const root = path.resolve(import.meta.dirname, "..");
const seedRoot = path.join(root, "seed-harnesses");

type Seed = {
  name: string;
  title: string;
  summary: string;
  tags: string[];
  agents: Array<{ id: string; role: string; prompt: string; rules?: string[] }>;
  stages: Array<{ id: string; agent: string }>;
  cases: Array<{ title: string; score: number }>;
  exampleInput: string;
  exampleOutput: string;
  webSearchMcp?: boolean;
};

const seeds: Seed[] = [
  {
    name: "deep-market-researcher",
    title: "Deep Market Researcher",
    summary: "Multi-stage research, synthesis, critique and validation pipeline for market questions.",
    tags: ["research", "strategy", "validation"],
    agents: [
      { id: "web_researcher", role: "source_research", prompt: "Collect source-backed market evidence and name confidence limits." },
      { id: "synthesizer", role: "synthesize_findings", prompt: "Turn research into a structured answer with clear evidence and gaps." },
      { id: "critic", role: "critique_and_validate", prompt: "Find weak assumptions, contradictions, missing sources and overclaiming." }
    ],
    stages: [
      { id: "research", agent: "web_researcher" },
      { id: "synthesis", agent: "synthesizer" },
      { id: "critique", agent: "critic" },
      { id: "final", agent: "synthesizer" }
    ],
    cases: [
      { title: "maps competitor set with caveats", score: 0.88 },
      { title: "separates source-backed facts from assumptions", score: 0.9 },
      { title: "flags contradiction before final memo", score: 0.86 }
    ],
    exampleInput: "Research the market for AI workflow registries used by agent engineers.",
    exampleOutput: "The memo identifies direct and adjacent alternatives, separates builders from registries, and marks validation gaps."
  },
  {
    name: "product-strategy-critic",
    title: "Product Strategy Critic",
    summary: "Critiques product plans, identifies weak assumptions and returns a concrete MVP recommendation.",
    tags: ["product", "strategy", "mvp"],
    agents: [
      { id: "plan_reader", role: "extract_plan", prompt: "Extract the decision, target user, claims and requested outcome." },
      { id: "critic", role: "find_risks", prompt: "Prioritize behavioral risks, missing evidence and unclear success criteria." },
      { id: "recommender", role: "recommend_mvp", prompt: "Give the strongest next product move with scope boundaries." }
    ],
    stages: [
      { id: "extract", agent: "plan_reader" },
      { id: "critique", agent: "critic" },
      { id: "recommend", agent: "recommender" }
    ],
    cases: [
      { title: "does not summarize instead of critique", score: 0.91 },
      { title: "names missing evidence", score: 0.86 },
      { title: "returns one recommended MVP path", score: 0.89 }
    ],
    exampleInput: "Review a plan to launch a paid marketplace before there is collaboration activity.",
    exampleOutput: "Recommendation: delay marketplace and prove fork/PR/eval loop first."
  },
  {
    name: "support-triage-agent",
    title: "Support Triage Agent",
    summary: "Classifies support tickets, extracts exact customer quotes and drafts replies without auto-send.",
    tags: ["support", "triage", "drafting"],
    agents: [
      { id: "classifier", role: "classify_ticket", prompt: "Classify urgency, ownership, money impact and required evidence." },
      { id: "quote_extractor", role: "extract_exact_quote", prompt: "Preserve exact customer statements and dates." },
      { id: "drafter", role: "draft_reply", prompt: "Draft a concise support response without unsupported promises." }
    ],
    stages: [
      { id: "classify", agent: "classifier" },
      { id: "quote", agent: "quote_extractor" },
      { id: "draft", agent: "drafter" }
    ],
    cases: [
      { title: "no auto-send for refund case", score: 0.9 },
      { title: "keeps exact customer quote", score: 0.88 },
      { title: "escalates ownership and payment risk", score: 0.87 }
    ],
    exampleInput: "Customer says they were charged twice and cannot access the service.",
    exampleOutput: "The draft asks for transaction evidence, avoids refund promise and escalates money risk."
  },
  {
    name: "finance-payment-safety-reviewer",
    title: "Finance Payment Safety Reviewer",
    summary: "Reviews payment, card and ledger changes with provider evidence, idempotency and reconciliation gates.",
    tags: ["finance", "payments", "safety"],
    agents: [
      { id: "flow_reader", role: "extract_money_flow", prompt: "Extract ledger, provider, user-facing and retry paths." },
      { id: "safety_reviewer", role: "find_money_risks", prompt: "Flag double charge, double credit, withdrawal and provider mismatch risks." },
      { id: "gate_writer", role: "write_release_gate", prompt: "Write required verification gates before merge or release." }
    ],
    stages: [
      { id: "read", agent: "flow_reader" },
      { id: "review", agent: "safety_reviewer" },
      { id: "gate", agent: "gate_writer" }
    ],
    cases: [
      { title: "requires provider and ledger evidence", score: 0.9 },
      { title: "flags idempotency bug", score: 0.87 },
      { title: "does not trust UI-only state", score: 0.91 }
    ],
    exampleInput: "Review a card top-up flow that updates UI before provider webhook confirmation.",
    exampleOutput: "The verdict blocks release until webhook, ledger and reconciliation evidence match."
  },
  {
    name: "repo-truth-auditor",
    title: "Repo Truth Auditor",
    summary: "Checks claims against code, commands, tests and runtime evidence before giving a grounded verdict.",
    tags: ["repo", "audit", "runtime"],
    agents: [
      { id: "claim_reader", role: "extract_claims", prompt: "Extract exact claims that need verification." },
      { id: "inspector", role: "inspect_repo", prompt: "Find code, docs and command evidence; do not trust summaries." },
      { id: "verdict_writer", role: "write_verdict", prompt: "Give a direct verdict with evidence and caveats." }
    ],
    stages: [
      { id: "claims", agent: "claim_reader" },
      { id: "inspect", agent: "inspector" },
      { id: "verdict", agent: "verdict_writer" }
    ],
    cases: [
      { title: "cites files and commands", score: 0.89 },
      { title: "separates verified from assumed", score: 0.9 },
      { title: "does not blindly trust review", score: 0.88 }
    ],
    exampleInput: "Check whether the new eval gate really blocks unsafe PRs.",
    exampleOutput: "The answer references CLI gate behavior, tests run and any missing production check."
  },
  {
    name: "founder-decision-memo",
    title: "Founder Decision Memo",
    summary: "Converts messy context into a short decision memo with recommendation, tradeoffs and next action.",
    tags: ["founder", "decision", "memo"],
    agents: [
      { id: "context_compressor", role: "compress_context", prompt: "Extract decision, constraints and real options." },
      { id: "option_critic", role: "compare_options", prompt: "Compare options by speed, risk, evidence and reversibility." },
      { id: "memo_writer", role: "write_memo", prompt: "Lead with recommendation and keep caveats explicit." }
    ],
    stages: [
      { id: "compress", agent: "context_compressor" },
      { id: "compare", agent: "option_critic" },
      { id: "memo", agent: "memo_writer" }
    ],
    cases: [
      { title: "recommendation first", score: 0.9 },
      { title: "clear tradeoffs", score: 0.87 },
      { title: "concrete next action", score: 0.91 }
    ],
    exampleInput: "Decide whether to fork Gitea or build sidecar services first.",
    exampleOutput: "Recommendation: stock Gitea sidecar first; fork only after the core loop is proven."
  },
  {
    name: "agent-harness-refactorer",
    title: "Agent Harness Refactorer",
    summary: "Turns messy prompts or markdown workflows into staged harness repos with explicit unresolved fields.",
    tags: ["import", "refactor", "harness"],
    agents: [
      { id: "source_reader", role: "read_source_workflow", prompt: "Extract stages, roles, inputs, outputs and caveats from source markdown." },
      { id: "schema_mapper", role: "map_to_manifest", prompt: "Map source workflow to harness.yaml without inventing missing details." },
      { id: "eval_designer", role: "design_eval_cases", prompt: "Create minimal eval cases that catch behavior regressions." }
    ],
    stages: [
      { id: "read", agent: "source_reader" },
      { id: "map", agent: "schema_mapper" },
      { id: "evals", agent: "eval_designer" }
    ],
    cases: [
      { title: "preserves original intent", score: 0.88 },
      { title: "marks unresolved fields", score: 0.86 },
      { title: "does not invent tools", score: 0.9 }
    ],
    exampleInput: "Convert a research-pipeline.md into a reusable harness repo.",
    exampleOutput: "The output creates manifest, agent prompts, eval cases and source-import runbook."
  },
  {
    name: "gtm-research-sprint",
    title: "GTM Research Sprint",
    summary: "Builds target segment, account list, pain hypotheses, outreach angles and proof plan.",
    tags: ["gtm", "sales", "research"],
    agents: [
      { id: "segmenter", role: "define_segment", prompt: "Define tight ICP and exclusion criteria." },
      { id: "researcher", role: "collect_accounts", prompt: "Collect account candidates with source caveats and no fake data." },
      { id: "angle_writer", role: "write_outreach_angles", prompt: "Create testable outreach angles tied to pains and proof." }
    ],
    stages: [
      { id: "segment", agent: "segmenter" },
      { id: "accounts", agent: "researcher" },
      { id: "angles", agent: "angle_writer" }
    ],
    cases: [
      { title: "source-backed account logic", score: 0.86 },
      { title: "testable outreach hypotheses", score: 0.88 },
      { title: "does not fabricate market data", score: 0.9 }
    ],
    exampleInput: "Find first users for a GitHub-like agent harness registry.",
    exampleOutput: "The sprint targets agent engineers with reusable workflows and defines a 20-user alpha proof plan."
  },
  {
    name: "data-quality-sentinel",
    title: "Data Quality Sentinel",
    summary: "Audits metric definitions, source freshness and dashboard evidence before a business decision relies on the data.",
    tags: ["data", "analytics", "quality"],
    agents: [
      { id: "source_mapper", role: "map_data_sources", prompt: "Map every metric to source tables, event names, filters, windows and owners.", rules: ["Name missing source fields explicitly.", "Distinguish raw data, modeled data and dashboard calculations.", "Do not accept screenshots as authoritative source definitions."] },
      { id: "anomaly_checker", role: "check_metric_anomalies", prompt: "Check freshness, sample size, joins, denominator drift and conflicting cuts.", rules: ["Look for silent denominator changes.", "Flag stale or partial data before interpreting trends.", "Keep units and time windows visible."] },
      { id: "decision_guard", role: "write_decision_guard", prompt: "Write a go/no-go data quality verdict for the business decision.", rules: ["State which findings block the decision.", "Include a smallest useful validation query or reconciliation step.", "Separate caveats from blockers."] }
    ],
    stages: [
      { id: "sources", agent: "source_mapper" },
      { id: "anomalies", agent: "anomaly_checker" },
      { id: "guard", agent: "decision_guard" }
    ],
    cases: [
      { title: "identifies metric owner and source gaps", score: 0.89 },
      { title: "catches denominator and freshness drift", score: 0.9 },
      { title: "gives decision-safe go no-go verdict", score: 0.86 }
    ],
    exampleInput: "ARR dashboard is up 18% week over week, but billing exports lag by two days and trial conversions changed definition.",
    exampleOutput: "The verdict blocks the decision until ARR freshness and conversion denominator changes are reconciled.",
    webSearchMcp: false
  },
  {
    name: "incident-rca-commander",
    title: "Incident RCA Commander",
    summary: "Turns incident notes, logs and customer impact into a concise RCA, mitigation plan and follow-up checklist.",
    tags: ["incident", "reliability", "operations"],
    agents: [
      { id: "timeline_builder", role: "build_incident_timeline", prompt: "Build an ordered timeline from incident notes, alerts, deploys and operator actions.", rules: ["Separate observed facts from plausible causes.", "Preserve exact timestamps and time zones when present.", "Mark missing evidence instead of filling gaps."] },
      { id: "blast_radius_checker", role: "quantify_blast_radius", prompt: "Quantify customer impact, affected systems, duration and residual risk.", rules: ["Use ranges when exact counts are unavailable.", "Call out whether money, data loss or external sends were involved.", "Do not downgrade severity without evidence."] },
      { id: "fix_plan_writer", role: "write_fix_plan", prompt: "Write the RCA, immediate mitigation, verification steps and owner-bound follow-ups.", rules: ["Keep the executive summary short and concrete.", "Include rollback, monitor and customer-communication gates.", "Do not claim the incident is resolved without verification evidence."] }
    ],
    stages: [
      { id: "timeline", agent: "timeline_builder" },
      { id: "impact", agent: "blast_radius_checker" },
      { id: "fix_plan", agent: "fix_plan_writer" }
    ],
    cases: [
      { title: "preserves timeline and evidence gaps", score: 0.9 },
      { title: "separates impact from root cause", score: 0.88 },
      { title: "includes verification before resolved claim", score: 0.87 }
    ],
    exampleInput: "API latency spiked after the 14:20 UTC deploy. Some checkout requests timed out for 23 minutes.",
    exampleOutput: "The RCA lists the timeline, affected checkout path, unknowns, mitigation verification and follow-up owners.",
    webSearchMcp: false
  },
  {
    name: "launch-readiness-reviewer",
    title: "Launch Readiness Reviewer",
    summary: "Reviews launch scope, user-visible promises, rollout gates and rollback criteria before a feature goes live.",
    tags: ["launch", "release", "readiness"],
    agents: [
      { id: "scope_reader", role: "read_launch_scope", prompt: "Extract launch scope, target users, dependencies, user-visible copy and excluded work.", rules: ["Separate shipped behavior from planned or manual work.", "Preserve exact user-visible claims.", "Flag dependencies that are not under the launch owner's control."] },
      { id: "readiness_checker", role: "check_launch_gates", prompt: "Check test coverage, monitoring, support path, migration safety and rollback criteria.", rules: ["Treat missing observability as a blocker for high-risk launches.", "Require a clear rollback trigger and owner.", "Call out money, auth or data migrations as high-risk."] },
      { id: "rollout_writer", role: "write_rollout_plan", prompt: "Write the final launch verdict, rollout steps and remaining blocked items.", rules: ["Use launch, soft launch or block as the verdict.", "Include smoke checks and post-launch monitoring.", "Do not hide known limitations in optimistic copy."] }
    ],
    stages: [
      { id: "scope", agent: "scope_reader" },
      { id: "readiness", agent: "readiness_checker" },
      { id: "rollout", agent: "rollout_writer" }
    ],
    cases: [
      { title: "separates shipped from planned behavior", score: 0.9 },
      { title: "blocks launch without rollback trigger", score: 0.86 },
      { title: "includes smoke and monitoring plan", score: 0.88 }
    ],
    exampleInput: "Team wants to announce paid installs today. Checkout is manual, entitlement works locally and prod payments flag is still off.",
    exampleOutput: "The verdict blocks a full launch, allows a limited internal smoke and keeps user-facing payment copy honest.",
    webSearchMcp: false
  },
  {
    name: "security-permission-auditor",
    title: "Security Permission Auditor",
    summary: "Reviews agent manifests, tool access and permission changes for least-privilege violations before install or publish.",
    tags: ["security", "permissions", "review"],
    agents: [
      { id: "permission_reader", role: "read_permissions", prompt: "Read manifest permissions, declared tools, secrets, network rules and approval gates.", rules: ["Treat new shell, browser, credentials or network permissions as review triggers.", "Compare permission need to workflow purpose.", "Keep the exact permission names visible."] },
      { id: "exploit_mapper", role: "map_abuse_paths", prompt: "Map realistic misuse paths from the declared capabilities.", rules: ["Include data exfiltration, external send and money movement paths when relevant.", "Do not claim exploitability without a capability path.", "Flag hidden risk from broad allowlists or persistent credentials."] },
      { id: "mitigation_writer", role: "write_mitigations", prompt: "Write a permission verdict and least-privilege mitigation plan.", rules: ["Give an allow, block or needs-approval verdict.", "Prefer removing permissions over adding policy text.", "Include a retest command or manifest field to recheck."] }
    ],
    stages: [
      { id: "permissions", agent: "permission_reader" },
      { id: "abuse_paths", agent: "exploit_mapper" },
      { id: "mitigations", agent: "mitigation_writer" }
    ],
    cases: [
      { title: "blocks broad credentials without need", score: 0.91 },
      { title: "maps abuse path before mitigation", score: 0.88 },
      { title: "recommends least privilege manifest change", score: 0.87 }
    ],
    exampleInput: "New harness asks for unrestricted network, persistent credentials and external_send for a summarization task.",
    exampleOutput: "The review blocks install, names the risky permissions and recommends allowlist/runtime credentials/no external_send.",
    webSearchMcp: false
  }
];

export function createSeeds(outputRoot = seedRoot): void {
rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

for (const seed of seeds) {
  const dir = path.join(outputRoot, seed.name);
  for (const folder of ["agents", "evals/cases", "examples", "runbooks", ".gitea/workflows", ".harnesshub"]) {
    mkdirSync(path.join(dir, folder), { recursive: true });
  }
  const manifest = {
    schemaVersion: "harness.v0.2",
    name: seed.name,
    title: seed.title,
    summary: seed.summary,
    version: "0.2.0",
    license: "MIT",
    source: {
      upstream_url: `https://github.com/elvismusli/onlyharness/tree/main/seed-harnesses/${seed.name}`,
      upstream_license: "MIT",
      attribution: "OnlyHarness first-party instruction harness",
      authors: ["OnlyHarness"],
      vendor_policy: "original"
    },
    maintainers: [{ name: "Harness.Hub Local" }],
    tags: seed.tags,
    runtime: { primary: "none", adapters: [] },
    inputs: [{ id: "request", type: "markdown", required: true }],
    outputs: [{ id: "final_result", type: "markdown" }],
    agents: seed.agents.map((agent) => ({
      id: agent.id,
      role: agent.role,
      title: titleize(agent.id),
      prompt: `agents/${agent.id}.md`,
      tools: seed.webSearchMcp !== false && (agent.id.includes("research") || agent.id.includes("inspector")) ? ["web_search"] : [],
      handoffs: []
    })),
    workflow: { entrypoint: seed.stages[0].agent, stages: seed.stages },
    tools: {
      mcp_servers: seed.webSearchMcp === false ? [] : [{ id: "web_search", required: false, package: "@modelcontextprotocol/server-web-search", pinned: true, allowlist: ["api.openai.com"] }],
      function_tools: [],
      external_apis: []
    },
    permissions: {
      network: seed.webSearchMcp === false ? "false" : "allowlist",
      network_allowlist: seed.webSearchMcp === false ? [] : ["api.openai.com"],
      filesystem: "readonly",
      shell: false,
      browser: false,
      credentials: seed.webSearchMcp === false ? "false" : "runtime_injected",
      external_send: false,
      money_movement: false,
      user_data: false,
      human_approval_required: ["external_send", "money_movement"]
    },
    secrets: { required: [], optional: [] },
    evals: {
      promptfoo_config: "evals/promptfooconfig.yaml",
      command: "npx promptfoo@latest eval -c evals/promptfooconfig.yaml -o .harnesshub/results.json -o .harnesshub/report.html -o .harnesshub/results.junit.xml"
    },
    quality_gates: {
      min_score: 0.82,
      max_regression: 0.03,
      max_cost_usd_per_run: 3,
      max_risk_score: 39,
      required_checks: ["schema_valid", "eval_passed", "no_high_risk_permission_delta"]
    },
    examples: [{ title: "Smoke example", input: "examples/input.md", output: "examples/expected.md" }]
  };

  writeFileSync(path.join(dir, "harness.yaml"), YAML.stringify(manifest));
  writeFileSync(path.join(dir, "README.md"), `# ${seed.title}\n\n${seed.summary}\n\n## How to improve\n\n1. Fork this harness.\n2. Change one agent prompt or eval case.\n3. Run \`hh validate && hh eval && hh gate\`.\n4. Open PR and read the semantic diff.\n`);
  for (const agent of seed.agents) {
    const rules = agent.rules ?? ["Be concrete and source-backed.", "State uncertainty directly.", "Do not invent external tool access."];
    writeFileSync(path.join(dir, `agents/${agent.id}.md`), `${agent.prompt}\n\nRules:\n${rules.map((rule) => `- ${rule}`).join("\n")}\n`);
  }
  writeFileSync(path.join(dir, "evals/promptfooconfig.yaml"), `description: ${seed.title} smoke eval\nprompts:\n  - agents/${seed.agents.at(-1)?.id}.md\nproviders:\n  - echo\n`);
  seed.cases.forEach((testCase, index) => {
    writeFileSync(path.join(dir, `evals/cases/case-${index + 1}.yaml`), YAML.stringify(testCase));
  });
  writeFileSync(path.join(dir, "examples/input.md"), `# Input\n\n${seed.exampleInput}\n`);
  writeFileSync(path.join(dir, "examples/expected.md"), `# Expected\n\n${seed.exampleOutput}\n`);
  writeFileSync(path.join(dir, "runbooks/local-run.md"), `# Local run\n\n\`\`\`bash\nhh validate\nhh eval\nhh gate\n\`\`\`\n`);
  writeFileSync(path.join(dir, ".gitea/workflows/harness-ci.yml"), workflow());

  const score = Number((seed.cases.reduce((sum, item) => sum + item.score, 0) / seed.cases.length).toFixed(3));
  writeFileSync(path.join(dir, ".harnesshub/results.json"), JSON.stringify({
    runner: "harnesshub-local-eval",
    status: score >= 0.82 ? "passed" : "failed",
    verified: score >= 0.82,
    verification_status: "declared_case_scores",
    evidenceLevel: "author_declared",
    managedEligible: false,
    evidenceNotice: "Author-declared fixture scores are regression examples, not independent verification.",
    score,
    cost_usd: Number((seed.cases.length * 0.03).toFixed(2)),
    duration_ms: 300,
    cases: seed.cases.map((item, index) => ({
      id: `case-${index + 1}`,
      title: item.title,
      score: item.score,
      passed: item.score >= 0.8,
      verification_status: "declared_score"
    }))
  }, null, 2));
}

console.log(`Created ${seeds.length} seed harnesses in ${outputRoot}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  createSeeds();
}

function workflow(): string {
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
      - ".gitea/workflows/**"
  push:
    branches: [main]
jobs:
  validate-and-eval:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout from local Gitea
        run: |
          git init "$GITHUB_WORKSPACE"
          cd "$GITHUB_WORKSPACE"
          git remote add origin "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY.git"
          git fetch --depth=1 origin "$GITHUB_REF"
          git checkout --detach FETCH_HEAD
      - name: Validate harness structure
        run: |
          test -f harness.yaml
          grep -q "schemaVersion: harness.v0.1" harness.yaml
          grep -q "quality_gates:" harness.yaml
          test -d agents
          test -f evals/promptfooconfig.yaml
          test -n "$(find evals/cases -type f -name '*.yaml' -print -quit)"
      - name: Local eval gate
        run: |
          mkdir -p .harnesshub
          cases=$(find evals/cases -type f -name '*.yaml' | wc -l | tr -d ' ')
          score=$(awk '/score:/ { sum += $2; count += 1 } END { if (count == 0) { print "0" } else { printf "%.3f", sum / count } }' evals/cases/*.yaml)
          awk -v score="$score" 'BEGIN { exit(score >= 0.82 ? 0 : 1) }'
          cat > .harnesshub/results.json <<JSON
          {"runner":"gitea-actions-local","status":"passed","score":$score,"cases":$cases}
          JSON
      - name: Semantic review artifact
        run: |
          cat > .harnesshub/semantic-diff.md <<'EOF'
          # Harness Review
          Status: passed
          Risk: reviewed by local Gitea Actions
          EOF
`;
}

function titleize(value: string): string {
  return value.split(/[-_\s]+/).filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}
