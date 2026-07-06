import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type Counters = {
  stars: number;
  forks: number;
  threads: number;
  runs: number;
  installConfirms: number;
};

export const HEAT_SIGNAL_THRESHOLD = 3;

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseRestKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const workspaceRoot = path.resolve(process.env.HARNESS_WORKSPACE_ROOT ?? path.join(import.meta.dirname, "../../.."));
const localEventsPath = path.resolve(process.env.HARNESS_EVENTS_PATH ?? path.join(workspaceRoot, "data/events.jsonl"));

export async function fetchCountersMap(): Promise<Map<string, Counters>> {
  const counters = new Map<string, Counters>();

  if (supabaseUrl && supabaseRestKey) {
    await mergeSupabase(counters, mergeSupabaseAggregateCounters);
    await mergeSupabase(counters, mergeSupabaseUserActions);
    await mergeSupabase(counters, mergeSupabaseThreadPosts);
    await mergeSupabase(counters, mergeSupabaseVerificationRuns);
    await mergeSupabase(counters, mergeSupabaseInstallConfirms);
  }

  mergeLocalInstallConfirms(counters);
  mergeLocalVerificationRuns(counters);
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
  if (qualifiesForHeat(totalSignals, installConfirms) && heat >= 24) return "Wild West Top 10";
  if (evalScore >= 0.9) return `eval ${evalScore.toFixed(2)}`;
  if (riskTier === "LOW") return "low-risk scan";
  if (riskTier === "HIGH" || riskTier === "CRITICAL") return "needs review";
  return "community pick";
}

export function signalCount(counters: Counters): number {
  return counters.stars + counters.forks + counters.threads + counters.runs + counters.installConfirms;
}

export function qualifiesForHeat(totalSignals: number, installConfirms = 0): boolean {
  return installConfirms > 0 || totalSignals >= HEAT_SIGNAL_THRESHOLD;
}

export function socialFromCounters(
  counters: Counters | undefined,
  context: { riskTier: string; evalScore: number; updatedAt: string }
) {
  const realCounters = counters ?? { stars: 0, forks: 0, threads: 0, runs: 0, installConfirms: 0 };
  const heat = heatFor(realCounters, context.evalScore, context.riskTier, context.updatedAt);
  const totalSignals = signalCount(realCounters);
  const heatQualified = qualifiesForHeat(totalSignals, realCounters.installConfirms);
  const daysOld = Math.max(0, (Date.now() - Date.parse(context.updatedAt)) / 86_400_000);
  return {
    ...realCounters,
    signalCount: totalSignals,
    heatQualified,
    heat,
    heatDelta: 0,
    freshness: heatQualified ? daysOld < 2 ? "warm" : daysOld < 9 ? "cooling" : "needs release" : "collecting signals",
    badge: badgeFor(context.riskTier, context.evalScore, heat, totalSignals, realCounters.installConfirms)
  };
}

export function mergeUserActionRows(counters: Map<string, Counters>, rows: UserActionRow[]): void {
  for (const [key, current] of counters) counters.set(key, { ...current, stars: 0 });

  const actionsByHarness = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.action !== "star" || !row.owner || !row.repo || row.id === undefined || row.id === null) continue;
    const key = `${row.owner}/${row.repo}`;
    const actions = actionsByHarness.get(key) ?? new Set<string>();
    actions.add(String(row.id));
    actionsByHarness.set(key, actions);
  }

  for (const [key, actions] of actionsByHarness) {
    const current = counters.get(key) ?? emptyCounters();
    counters.set(key, { ...current, stars: actions.size });
  }
}

export function mergeThreadPostRows(counters: Map<string, Counters>, rows: ThreadPostCounterRow[]): void {
  for (const [key, current] of counters) counters.set(key, { ...current, threads: 0 });

  const postsByHarness = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.owner || !row.repo || !row.id) continue;
    const key = `${row.owner}/${row.repo}`;
    const posts = postsByHarness.get(key) ?? new Set<string>();
    posts.add(row.id);
    postsByHarness.set(key, posts);
  }

  for (const [key, posts] of postsByHarness) {
    const current = counters.get(key) ?? emptyCounters();
    counters.set(key, { ...current, threads: posts.size });
  }
}

export function mergeVerificationRunRows(counters: Map<string, Counters>, rows: EventRunRow[], options: { reset?: boolean } = { reset: true }): void {
  const reset = options.reset ?? true;
  if (reset) {
    for (const [key, current] of counters) counters.set(key, { ...current, runs: 0 });
  }

  const runsByHarness = new Map<string, Set<string>>();
  rows.forEach((row, index) => {
    if (row.kind !== "gate" || row.target !== "passed" || !row.owner || !row.repo) return;
    const key = `${row.owner}/${row.repo}`;
    const id = row.id ?? row.created_at ?? row.at ?? `${row.subject ?? "anonymous"}:${index}`;
    const runs = runsByHarness.get(key) ?? new Set<string>();
    runs.add(String(id));
    runsByHarness.set(key, runs);
  });

  for (const [key, runs] of runsByHarness) {
    const current = counters.get(key) ?? emptyCounters();
    counters.set(key, { ...current, runs: (reset ? 0 : current.runs) + runs.size });
  }
}

async function mergeSupabase(counters: Map<string, Counters>, merger: (counters: Map<string, Counters>) => Promise<void>): Promise<void> {
  try {
    await merger(counters);
  } catch {
    // Keep the registry usable when one Supabase-backed signal is temporarily unavailable.
  }
}

async function mergeSupabaseAggregateCounters(counters: Map<string, Counters>): Promise<void> {
  if (!supabaseUrl || !supabaseRestKey) return;
  const response = await fetch(`${supabaseUrl}/rest/v1/harness_counters?select=owner,repo,stars,forks,threads`, {
    headers: restHeaders()
  });
  if (!response.ok) return;
  for (const row of await response.json() as AggregateCounterRow[]) {
    if (!row.owner || !row.repo) continue;
    counters.set(`${row.owner}/${row.repo}`, {
      stars: Number(row.stars) || 0,
      forks: Number(row.forks) || 0,
      threads: Number(row.threads) || 0,
      runs: 0,
      installConfirms: 0
    });
  }
}

async function mergeSupabaseUserActions(counters: Map<string, Counters>): Promise<void> {
  if (!supabaseUrl || !supabaseRestKey) return;
  const params = new URLSearchParams({
    select: "owner,repo,id,action",
    action: "eq.star",
    owner: "not.is.null",
    repo: "not.is.null",
    limit: "10000"
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/user_harness_actions?${params.toString()}`, {
    headers: restHeaders()
  });
  if (!response.ok) return;
  mergeUserActionRows(counters, await response.json() as UserActionRow[]);
}

async function mergeSupabaseThreadPosts(counters: Map<string, Counters>): Promise<void> {
  if (!supabaseUrl || !supabaseRestKey) return;
  const params = new URLSearchParams({
    select: "owner,repo,id",
    owner: "not.is.null",
    repo: "not.is.null",
    limit: "10000"
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/harness_thread_posts?${params.toString()}`, {
    headers: restHeaders()
  });
  if (!response.ok) return;
  mergeThreadPostRows(counters, await response.json() as ThreadPostCounterRow[]);
}

async function mergeSupabaseVerificationRuns(counters: Map<string, Counters>): Promise<void> {
  if (!supabaseUrl || !supabaseRestKey) return;
  const params = new URLSearchParams({
    select: "owner,repo,id,kind,target",
    kind: "eq.gate",
    target: "eq.passed",
    owner: "not.is.null",
    repo: "not.is.null",
    limit: "10000"
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/events?${params.toString()}`, {
    headers: restHeaders()
  });
  if (!response.ok) return;
  mergeVerificationRunRows(counters, await response.json() as EventRunRow[]);
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

function mergeLocalVerificationRuns(counters: Map<string, Counters>): void {
  if (!existsSync(localEventsPath)) return;
  const rows: EventRunRow[] = [];
  for (const line of readFileSync(localEventsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as EventRunRow;
      if (row.kind === "gate" && row.target === "passed") rows.push(row);
    } catch {
      // Ignore corrupt local telemetry lines.
    }
  }
  mergeVerificationRunRows(counters, rows, { reset: false });
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

function emptyCounters(): Counters {
  return { stars: 0, forks: 0, threads: 0, runs: 0, installConfirms: 0 };
}

type AggregateCounterRow = {
  owner?: string | null;
  repo?: string | null;
  stars?: number | string | null;
  forks?: number | string | null;
  threads?: number | string | null;
};

export type UserActionRow = {
  owner?: string | null;
  repo?: string | null;
  id?: number | string | null;
  action?: string | null;
};

export type ThreadPostCounterRow = {
  owner?: string | null;
  repo?: string | null;
  id?: string | null;
};

export type EventRunRow = {
  owner?: string | null;
  repo?: string | null;
  id?: number | string | null;
  kind?: string | null;
  target?: string | null;
  subject?: string | null;
  created_at?: string | null;
  at?: string | null;
};
