import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANAGED_KINDS = new Set([
  "recommended", "recommendation_accepted", "activation_started", "activation_ready",
  "activation_loaded", "activation_invoked", "outcome_reported", "activation_pinned",
  "activation_removed", "activation_failed"
]);

export type PilotEvent = {
  kind?: string;
  subject?: string;
  eventId?: string;
  event_id?: string;
  recommendationId?: string;
  recommendation_id?: string;
  activationId?: string;
  activation_id?: string;
  target?: string;
  outcome?: string;
};

export function buildPilotReport(rows: PilotEvent[]) {
  const deduped = new Map<string, PilotEvent>();
  let fallback = 0;
  for (const row of rows) {
    if (!row.kind || !MANAGED_KINDS.has(row.kind) || !row.subject?.startsWith("pilot:")) continue;
    const key = row.eventId ?? row.event_id ?? `missing:${fallback++}`;
    if (!deduped.has(key)) deduped.set(key, row);
  }
  const events = [...deduped.values()];
  const testers = unique(events.map((row) => row.subject));
  const attempts = unique(events.filter((row) => row.kind === "recommended").map((row) => row.recommendationId ?? row.recommendation_id));
  const activations = unique(events.map((row) => row.activationId ?? row.activation_id));
  const byKind = Object.fromEntries([...MANAGED_KINDS].map((kind) => [kind, events.filter((row) => row.kind === kind).length]));
  const byClient = Object.fromEntries(["claude-code", "codex"].map((client) => [client, {
    events: events.filter((row) => row.target === client).length,
    testers: unique(events.filter((row) => row.target === client).map((row) => row.subject)).size,
    attempts: unique(events.filter((row) => row.target === client && row.kind === "recommended").map((row) => row.recommendationId ?? row.recommendation_id)).size
  }]));
  return {
    schemaVersion: "superskill.pilot-report.v1",
    testers: testers.size,
    attempts: attempts.size,
    activations: activations.size,
    byKind,
    byClient,
    gate: {
      requiredTesters: 20,
      requiredAttempts: 100,
      testersMet: testers.size >= 20,
      attemptsMet: attempts.size >= 100,
      passed: testers.size >= 20 && attempts.size >= 100
    },
    limitations: [
      "Tester count uses server-derived pilot subjects from distinct internal tokens.",
      "Missing lifecycle events are reported as gaps and are not inferred from later states.",
      "This aggregate contains no task, prompt, path, token, email, or repository content."
    ]
  } as const;
}

function unique(values: Array<string | null | undefined>): Set<string> {
  return new Set(values.filter((value): value is string => Boolean(value)));
}

function readJsonl(file: string): PilotEvent[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as PilotEvent]; } catch { return []; }
  });
}

function inputPath(argv: string[]): string {
  const index = argv.indexOf("--events");
  return path.resolve(index >= 0 && argv[index + 1] ? argv[index + 1] : process.env.HARNESS_EVENTS_PATH ?? "data/events.jsonl");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = buildPilotReport(readJsonl(inputPath(process.argv.slice(2))));
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else console.log(`SuperSkill pilot: ${report.testers}/20 testers, ${report.attempts}/100 attempts, gate ${report.gate.passed ? "passed" : "not met"}`);
}
