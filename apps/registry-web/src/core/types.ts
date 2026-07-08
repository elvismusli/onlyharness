export type RegistryItem = {
  owner: string;
  ownerLabel: string;
  name: string;
  title: string;
  summary: string;
  tags: string[];
  job: string;
  outcome: string;
  runtime: string;
  forgeUrl?: string;
  contentType?: "harness" | "directory";
  directory?: {
    url?: string;
    itemCount?: number;
    category?: string;
    notes?: string;
  };
  compatibility?: {
    targets?: CompatibilityTarget[];
  };
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
  installConfirms: number;
  signalCount: number;
  heatQualified: boolean;
  heat: number;
  heatDelta: number;
  freshness: string;
  badge: string;
  cliCommand: string;
  updatedAt: string;
};

export type ResourceItem = {
  id: string;
  title: string;
  summary: string;
  summaryOriginal?: string;
  resourceType: "harness" | "skill" | "plugin" | "workflow" | "mcp_server" | "service_endpoint" | "agent_team" | "subagent_pack" | "command_pack" | "config" | "guide" | "framework" | "agent_runtime" | "directory";
  sourcePlatform: string;
  canonicalUrl: string;
  mirror?: {
    platform: "github";
    owner: string;
    repo: string;
    fullName: string;
    url: string;
    cloneUrl?: string;
    defaultBranch?: string;
    defaultBranchOnly: boolean;
    fork: boolean;
    sourceUrl: string;
    status: "ready" | "pending" | "failed";
    syncedAt?: string;
    error?: string;
  };
  upstreamId: string;
  upstreamOwner: string;
  upstreamRepo?: string;
  licenseStatus: "permissive" | "copyleft" | "proprietary" | "unknown" | "blocked" | "manual_review";
  sourceCheckedAt: string;
  sourceCheckStatus: "active" | "stale" | "archived" | "unavailable";
  lastSeenAt: string;
  installability: "open_only" | "importable" | "installable" | "verified";
  tags: string[];
  worksWith: string[];
  upstreamPopularity: {
    githubStarsSnapshot?: number;
    githubStarsCurrent?: number;
    sourceLabel: string;
  };
  onlyHarnessSignals: {
    stars: number;
    opens: number;
    imports: number;
    installs: number;
    threads: number;
    passedGates: number;
  };
  popularityScore: number;
  trust: {
    sourceChecked: boolean;
    securityScan?: "pass" | "warn" | "fail" | "not_scanned";
    installVerifiedAt?: string;
    gateVerifiedAt?: string;
    riskTier?: string;
  };
  workspaceApproval?: {
    workspaceSlug: string;
    workspaceName: string;
    collectionSlug: string;
    sourceResourceId: string;
    approvalState: "approved" | "approved_with_warning" | "blocked_by_scan";
    approvedBy?: string;
    approvedAt: string;
    note?: string;
  };
  actions: Array<
    | { id: "open_onlyharness"; label: string; url: string }
    | { id: "open_mirror"; label: string; url: string }
    | { id: "open_upstream"; label: string; url: string }
    | { id: "download_archive"; label: string; url: string }
    | { id: "copy_mcp_config"; label: string; command?: string }
    | { id: "install"; label: string; command: string; target: string }
    | { id: "import_github"; label: string; command: string }
    | { id: "claim"; label: string; proofRequired: true }
  >;
};

export type CompatibilityTarget = {
  id?: string;
  name?: string;
  status: "planned" | "available" | "verified";
  notes?: string;
  detail?: string;
  last_verified_at?: string;
};

export type HarnessPricing = {
  model?: "free" | "one_time" | "subscription" | "per_call" | "gate_escrow";
  amount_usd?: number;
  currency?: string;
};

export type CheckoutSession = {
  provider: "manual";
  provider_ref: string;
  checkout_url: string;
  status: "pending";
  owner: string;
  repo: string;
  version: string;
  pricing: HarnessPricing;
  next: string;
};

export type CheckoutLinkState = {
  owner: string;
  repo: string;
  version: string;
  providerRef?: string;
  ref?: string;
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

export type ArchiveVersion = {
  version: string;
  createdAt: string;
  snapshot: boolean;
  current: boolean;
  fileCount: number;
};

export type HarnessDetail = {
  owner: string;
  repo: string;
  forgeUrl?: string;
  social?: Pick<RegistryItem, "stars" | "forks" | "threads" | "runs" | "installConfirms" | "signalCount" | "heatQualified" | "heat" | "heatDelta" | "freshness" | "badge" | "cliCommand">;
  thread?: ThreadItem[];
  example?: { input: string; expected: string };
  files?: string[];
  manifest?: {
    name: string;
    version: string;
    title: string;
    summary: string;
    tags: string[];
    runtime: { primary: string; adapters: string[] };
    agents: Array<{ id: string; role: string; title?: string; prompt: string; tools: string[] }>;
    workflow: { stages: Array<{ id: string; agent: string }> };
    tools: { mcp_servers: Array<{ id: string }>; external_apis: Array<{ id: string; hostname: string }> };
    permissions: Record<string, unknown>;
    quality_gates: { min_score: number; max_cost_usd_per_run: number; max_risk_score: number };
    pricing?: HarnessPricing;
    content?: {
      type?: "harness" | "directory";
      directory?: {
        url?: string;
        item_count?: number;
        category?: string;
        notes?: string;
      };
    };
    compatibility?: {
      targets?: CompatibilityTarget[];
    };
  };
  valid: boolean;
  risk: { score: number; tier: string; reasons: string[]; blocking: string[] };
  evalResult?: { status: string; score: number; cost_usd: number; cases: Array<{ id: string; title: string; score: number; passed: boolean }> };
  security?: { verdict: "pass" | "warn" | "fail"; findings: Array<{ rule: string; file: string; excerpt: string; severity: string }>; scannedAt: string; scanner: string };
  contextCost?: ContextCost;
  standard?: "conformant" | "partial";
  verification?: { lastVerifiedAt?: string };
  versions?: ArchiveVersion[];
  prReview: {
    owner: string;
    repo: string;
    number: number | null;
    title: string;
    source: "local-demo" | "forge-pr";
    demo: boolean;
    status: string;
    markdown: string;
    next: string;
    diff: { riskDelta: number; riskTier: string; changes: Array<{ severity: string; area: string; message: string }> };
  };
  readme: string;
};

export type StorefrontPage = {
  profile: {
    handle: string;
    display_name: string;
    bio: string;
  };
  referralCode: string;
  items: RegistryItem[];
};

export type StorefrontProfile = StorefrontPage["profile"] & {
  user_id: string;
  referral_code: string;
};

export type OrgAuditEntry = {
  slug: string;
  action: string;
  token_name: string | null;
  subject: string | null;
  target: string | null;
  at: string;
};

export type OrgWorkspace = {
  organization: {
    slug: string;
    name: string;
    plan: "free" | "team" | "enterprise";
  };
  items: RegistryItem[];
  permissions: {
    totalHarnesses: number;
    riskTiers: Record<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL", number>;
    maxRiskScore: number;
    maxRiskTier: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    permissionCounts: {
      unrestrictedNetwork: number;
      shell: number;
      browser: number;
      credentials: number;
      externalSend: number;
      moneyMovement: number;
      userData: number;
    };
    riskMarkdown: string;
  };
  audit: OrgAuditEntry[];
};

export type WorkspaceAuditEntry = OrgAuditEntry;

export type WorkspaceMember = {
  id?: string;
  workspace_id?: string;
  workspace_slug?: string;
  user_id: string;
  role: "owner" | "admin" | "moderator" | "publisher" | "member" | "viewer";
  status: "invited" | "active" | "suspended" | "removed";
  source: "direct" | "invite" | "email_domain" | "telegram" | "discord" | "entitlement" | "paid_entitlement" | "token_bootstrap";
  joined_at: string;
  removed_at?: string | null;
};

export type WorkspaceInvite = {
  id?: string;
  workspaceId?: string;
  workspaceSlug?: string;
  email?: string | null;
  role: WorkspaceMember["role"];
  maxUses?: number | null;
  usesCount: number;
  expiresAt?: string | null;
  createdBy?: string | null;
  createdAt: string;
  revokedAt?: string | null;
};

export type WorkspaceCollectionItem = {
  id: string;
  itemRef: string;
  itemSource: "public_resource" | "workspace_resource" | "native_harness" | "external_url";
  sourceResourceId?: string;
  pinnedVersion?: string | null;
  pinnedArchiveHash?: string | null;
  approvalState: "pending_review" | "approved" | "approved_with_warning" | "blocked" | "blocked_by_scan" | "deprecated";
  approvedBy?: string | null;
  approvedAt?: string | null;
  note?: string | null;
  riskSnapshot?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceCollection = {
  slug: string;
  title: string;
  summary?: string | null;
  visibility: "workspace" | "public" | "unlisted";
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  items: WorkspaceCollectionItem[];
};

export type WorkspaceCatalog = {
  workspace: {
    slug: string;
    name: string;
    type: "company" | "community" | "team" | "course" | "agency" | "chat";
    visibility: "private" | "invite_only" | "gated" | "public" | "unlisted";
    plan: "free" | "team" | "enterprise";
    description?: string | null;
    avatarUrl?: string | null;
  };
  resources: ResourceItem[];
  items: ResourceItem[];
  collections: WorkspaceCollection[];
  permissions: {
    totalResources: number;
    hostedArchives: number;
    unscanned: number;
    riskTiers: Record<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN", number>;
  };
  audit: WorkspaceAuditEntry[];
};

export const DETAIL_TABS = ["Overview", "Install", "Trust", "Try sample", "Thread", "Files", "Versions"] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

export type WinKind = "harness" | "publish" | "install" | "checkout" | "cli" | "review" | "leaderboard" | "share" | "storefront" | "profile" | "network";

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
  resourceUse?: {
    note?: string;
    rows: Array<{
      label: string;
      value: string;
      copyLabel: string;
      copyTag: string;
      muted?: boolean;
    }>;
  };
};
