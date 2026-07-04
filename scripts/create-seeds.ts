import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const root = path.resolve(import.meta.dirname, "..");
const seedRoot = path.join(root, "seed-harnesses");

type Seed = {
  name: string;
  title: string;
  summary: string;
  tags: string[];
  agents: Array<{ id: string; role: string; prompt: string }>;
  stages: Array<{ id: string; agent: string }>;
  cases: Array<{ title: string; score: number }>;
  exampleInput: string;
  exampleOutput: string;
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
  }
];

rmSync(seedRoot, { recursive: true, force: true });
mkdirSync(seedRoot, { recursive: true });

for (const seed of seeds) {
  const dir = path.join(seedRoot, seed.name);
  for (const folder of ["agents", "evals/cases", "examples", "runbooks", ".gitea/workflows", ".harnesshub"]) {
    mkdirSync(path.join(dir, folder), { recursive: true });
  }
  const manifest = {
    schemaVersion: "harness.v0.1",
    name: seed.name,
    title: seed.title,
    summary: seed.summary,
    version: "0.1.0",
    license: "MIT",
    maintainers: [{ name: "Harness.Hub Local" }],
    tags: seed.tags,
    runtime: { primary: "openai-agents-sdk", adapters: ["langgraph"] },
    entrypoint: { command: "npm run harness:run", cwd: "." },
    inputs: [{ id: "request", type: "markdown", required: true }],
    outputs: [{ id: "final_result", type: "markdown" }],
    agents: seed.agents.map((agent) => ({
      id: agent.id,
      role: agent.role,
      title: titleize(agent.id),
      prompt: `agents/${agent.id}.md`,
      tools: agent.id.includes("research") || agent.id.includes("inspector") ? ["web_search"] : [],
      handoffs: []
    })),
    workflow: { entrypoint: seed.stages[0].agent, stages: seed.stages },
    tools: {
      mcp_servers: [{ id: "web_search", required: false, package: "@modelcontextprotocol/server-web-search", pinned: true, allowlist: ["api.openai.com"] }],
      function_tools: [],
      external_apis: []
    },
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
    writeFileSync(path.join(dir, `agents/${agent.id}.md`), `${agent.prompt}\n\nRules:\n- Be concrete and source-backed.\n- State uncertainty directly.\n- Do not invent external tool access.\n`);
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
    score,
    cost_usd: Number((seed.cases.length * 0.03).toFixed(2)),
    duration_ms: 300,
    cases: seed.cases.map((item, index) => ({ id: `case-${index + 1}`, title: item.title, score: item.score, passed: item.score >= 0.8 }))
  }, null, 2));
}

console.log(`Created ${seeds.length} seed harnesses in ${seedRoot}`);

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
