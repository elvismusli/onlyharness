import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type Counters = {
  stars: number;
  forks: number;
  threads: number;
  runs: number;
  installConfirms: number;
};

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseRestKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const workspaceRoot = path.resolve(process.env.HARNESS_WORKSPACE_ROOT ?? path.join(import.meta.dirname, "../../.."));
const localEventsPath = path.resolve(process.env.HARNESS_EVENTS_PATH ?? path.join(workspaceRoot, "data/events.jsonl"));

export async function fetchCountersMap(): Promise<Map<string, Counters>> {
  const counters = new Map<string, Counters>();

  if (supabaseUrl && supabaseRestKey) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/harness_counters?select=owner,repo,stars,forks,threads`, {
        headers: restHeaders()
      });
      if (response.ok) {
        for (const row of await response.json() as Array<Omit<Counters, "installConfirms" | "runs"> & { owner: string; repo: string }>) {
          counters.set(`${row.owner}/${row.repo}`, {
            stars: Number(row.stars) || 0,
            forks: Number(row.forks) || 0,
            threads: Number(row.threads) || 0,
            runs: 0,
            installConfirms: 0
          });
        }
      }
      await mergeSupabaseInstallConfirms(counters);
    } catch {
      // Fall through to local events below.
    }
  }

  mergeLocalInstallConfirms(counters);
  return counters;
}

export function heatFor(counters: Counters, evalScore: number, riskTier: string, updatedAt: string): number {
  const daysOld = Math.max(0, (Date.now() - Date.parse(updatedAt)) / 86_400_000);
  const decay = Math.min(3.8, daysOld * 0.08);
  const riskPenalty = riskTier === "CRITICAL" ? 4.2 : riskTier === "HIGH" ? 2.3 : riskTier === "MEDIUM" ? 0.9 : 0;
  const heat = counters.stars / 5 + counters.forks / 2 + counters.threads / 3 + counters.runs / 50 + counters.installConfirms / 4 + evalScore * 4.8 - riskPenalty - decay;
  return Math.max(0, Number(heat.toFixed(1)));
}

export function badgeFor(riskTier: string, evalScore: number, heat: number, totalSignals: number, installConfirms = 0): string {
  if (installConfirms > 0) return `works in Claude Code: ${installConfirms} confirms`;
  if (totalSignals === 0) return "new";
  if (heat >= 24) return "Wild West Top 10";
  if (evalScore >= 0.9) return `eval ${evalScore.toFixed(2)}`;
  if (riskTier === "LOW") return "low-risk scan";
  if (riskTier === "HIGH" || riskTier === "CRITICAL") return "needs review";
  return "community pick";
}

export function socialFromCounters(
  counters: Counters | undefined,
  context: { riskTier: string; evalScore: number; updatedAt: string }
) {
  const realCounters = counters ?? { stars: 0, forks: 0, threads: 0, runs: 0, installConfirms: 0 };
  const heat = heatFor(realCounters, context.evalScore, context.riskTier, context.updatedAt);
  const totalSignals = realCounters.stars + realCounters.forks + realCounters.threads + realCounters.runs + realCounters.installConfirms;
  const daysOld = Math.max(0, (Date.now() - Date.parse(context.updatedAt)) / 86_400_000);
  return {
    ...realCounters,
    heat,
    heatDelta: 0,
    freshness: daysOld < 2 ? "warm" : daysOld < 9 ? "cooling" : "needs release",
    badge: badgeFor(context.riskTier, context.evalScore, heat, totalSignals, realCounters.installConfirms)
  };
}

async function mergeSupabaseInstallConfirms(counters: Map<string, Counters>): Promise<void> {
  if (!supabaseUrl || !supabaseRestKey) return;
  const params = new URLSearchParams({
    select: "owner,repo,subject",
    kind: "eq.install",
    client: "eq.claude-code",
    owner: "not.is.null",
    repo: "not.is.null",
    limit: "10000"
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/events?${params.toString()}`, {
    headers: restHeaders()
  });
  if (!response.ok) return;
  mergeInstallConfirmRows(counters, await response.json() as EventConfirmRow[]);
}

function mergeLocalInstallConfirms(counters: Map<string, Counters>): void {
  if (!existsSync(localEventsPath)) return;
  const rows: EventConfirmRow[] = [];
  for (const line of readFileSync(localEventsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as EventConfirmRow & { kind?: string; client?: string };
      if (row.kind === "install" && row.client === "claude-code") rows.push(row);
    } catch {
      // Ignore corrupt local telemetry lines.
    }
  }
  mergeInstallConfirmRows(counters, rows);
}

function mergeInstallConfirmRows(counters: Map<string, Counters>, rows: EventConfirmRow[]): void {
  const subjectsByHarness = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.owner || !row.repo || !row.subject || row.subject === "anonymous") continue;
    const key = `${row.owner}/${row.repo}`;
    const subjects = subjectsByHarness.get(key) ?? new Set<string>();
    subjects.add(row.subject);
    subjectsByHarness.set(key, subjects);
  }
  for (const [key, subjects] of subjectsByHarness) {
    const current = counters.get(key) ?? { stars: 0, forks: 0, threads: 0, runs: 0, installConfirms: 0 };
    counters.set(key, { ...current, installConfirms: subjects.size });
  }
}

type EventConfirmRow = {
  owner?: string | null;
  repo?: string | null;
  subject?: string | null;
};

function restHeaders() {
  return {
    apikey: supabaseRestKey ?? "",
    authorization: `Bearer ${supabaseRestKey ?? ""}`
  };
}
