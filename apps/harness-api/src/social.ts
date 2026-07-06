export type Counters = {
  stars: number;
  forks: number;
  threads: number;
  runs: number;
};

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseRestKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;

export async function fetchCountersMap(): Promise<Map<string, Counters>> {
  const counters = new Map<string, Counters>();
  if (!supabaseUrl || !supabaseRestKey) return counters;

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/harness_counters?select=owner,repo,stars,forks,threads,runs`, {
      headers: restHeaders()
    });
    if (!response.ok) return counters;
    for (const row of await response.json() as Array<Counters & { owner: string; repo: string }>) {
      counters.set(`${row.owner}/${row.repo}`, {
        stars: Number(row.stars) || 0,
        forks: Number(row.forks) || 0,
        threads: Number(row.threads) || 0,
        runs: Number(row.runs) || 0
      });
    }
  } catch {
    return counters;
  }

  return counters;
}

export function heatFor(counters: Counters, evalScore: number, riskTier: string, updatedAt: string): number {
  const daysOld = Math.max(0, (Date.now() - Date.parse(updatedAt)) / 86_400_000);
  const decay = Math.min(3.8, daysOld * 0.08);
  const riskPenalty = riskTier === "CRITICAL" ? 4.2 : riskTier === "HIGH" ? 2.3 : riskTier === "MEDIUM" ? 0.9 : 0;
  const heat = counters.stars / 5 + counters.forks / 2 + counters.threads / 3 + counters.runs / 50 + evalScore * 4.8 - riskPenalty - decay;
  return Math.max(0, Number(heat.toFixed(1)));
}

export function badgeFor(riskTier: string, evalScore: number, heat: number, totalSignals: number): string {
  if (totalSignals === 0) return "new";
  if (heat >= 24) return "Wild West Top 10";
  if (evalScore >= 0.9) return `eval ${evalScore.toFixed(2)}`;
  if (riskTier === "LOW") return "safe to try";
  if (riskTier === "HIGH" || riskTier === "CRITICAL") return "needs review";
  return "community pick";
}

export function socialFromCounters(
  counters: Counters | undefined,
  context: { riskTier: string; evalScore: number; updatedAt: string }
) {
  const realCounters = counters ?? { stars: 0, forks: 0, threads: 0, runs: 0 };
  const heat = heatFor(realCounters, context.evalScore, context.riskTier, context.updatedAt);
  const totalSignals = realCounters.stars + realCounters.forks + realCounters.threads + realCounters.runs;
  const daysOld = Math.max(0, (Date.now() - Date.parse(context.updatedAt)) / 86_400_000);
  return {
    ...realCounters,
    heat,
    heatDelta: 0,
    freshness: daysOld < 2 ? "warm" : daysOld < 9 ? "cooling" : "needs release",
    badge: badgeFor(context.riskTier, context.evalScore, heat, totalSignals)
  };
}

function restHeaders() {
  return {
    apikey: supabaseRestKey ?? "",
    authorization: `Bearer ${supabaseRestKey ?? ""}`
  };
}
