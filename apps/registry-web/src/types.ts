export type RegistryItem = {
  owner: string;
  ownerLabel: string;
  name: string;
  title: string;
  summary: string;
  tags: string[];
  outcome: string;
  runtime: string;
  forgeUrl: string;
  valid: boolean;
  riskScore: number;
  riskTier: string;
  evalStatus: string;
  evalScore: number;
  security: {
    verdict: "pass" | "warn" | "fail";
    findings: number;
    scanner: string;
  };
  contextCost: ContextCost;
  standard: "conformant" | "partial";
  forks: number;
  stars: number;
  threads: number;
  runs: number;
  heat: number;
  heatDelta: number;
  freshness: string;
  badge: string;
  cliCommand: string;
  updatedAt: string;
};

export type ContextCost = {
  approxTokens: number;
  files: number;
  bytes: number;
  status: "estimated";
};

export type ThreadItem = {
  id: string;
  author: string;
  role: string;
  kind: string;
  body: string;
  likes: number;
  at: string;
  userId?: string;
};

export type HarnessDetail = {
  owner: string;
  repo: string;
  root: string;
  forgeUrl: string;
  social?: Pick<RegistryItem, "stars" | "forks" | "threads" | "runs" | "heat" | "heatDelta" | "freshness" | "badge" | "cliCommand">;
  thread?: ThreadItem[];
  example?: { input: string; expected: string };
  files?: string[];
  manifest?: {
    name: string;
    title: string;
    summary: string;
    tags: string[];
    runtime: { primary: string; adapters: string[] };
    agents: Array<{ id: string; role: string; title?: string; prompt: string; tools: string[] }>;
    workflow: { stages: Array<{ id: string; agent: string }> };
    tools: { mcp_servers: Array<{ id: string }>; external_apis: Array<{ id: string; hostname: string }> };
    permissions: Record<string, unknown>;
    quality_gates: { min_score: number; max_cost_usd_per_run: number; max_risk_score: number };
  };
  valid: boolean;
  risk: { score: number; tier: string; reasons: string[]; blocking: string[] };
  evalResult?: { status: string; score: number; cost_usd: number; cases: Array<{ id: string; title: string; score: number; passed: boolean }> };
  security?: { verdict: "pass" | "warn" | "fail"; findings: Array<{ rule: string; file: string; excerpt: string; severity: string }>; scannedAt: string; scanner: string };
  contextCost?: ContextCost;
  standard?: "conformant" | "partial";
  prReview: { status: string; markdown: string; diff: { riskDelta: number; riskTier: string; changes: Array<{ severity: string; area: string; message: string }> } };
  readme: string;
};

export const DETAIL_TABS = ["Overview", "Try", "Thread", "Evals", "Files"] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

export type WinKind = "harness" | "publish" | "install" | "cli" | "review" | "leaderboard" | "share";

/* stacking order = position in the wins array (last = top); z-index derives from it */
export type FloatWin = {
  id: string;
  kind: WinKind;
  hkey?: string;
  x: number;
  y: number;
  minimized: boolean;
};

export type DialogSpec = {
  title: string;
  icon: string;
  body: string;
  cancel?: boolean;
};
