import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const idSchema = z.string().min(2).regex(/^[a-z][a-z0-9_-]*$/);
const pathSchema = z.string().min(1).refine((value) => !path.isAbsolute(value), "Paths must be relative to the harness root");
const dependencyRefSchema = z.string().min(2).regex(/^[a-z0-9][a-z0-9_./:@-]*$/);
const networkPermissionSchema = z.preprocess((value) => value === false ? "false" : value, z.enum(["false", "allowlist", "unrestricted"]));
const credentialPermissionSchema = z.preprocess((value) => value === false ? "false" : value, z.enum(["false", "runtime_injected", "persistent"]));

const permissionSchema = z.object({
  network: networkPermissionSchema.default("false"),
  network_allowlist: z.array(z.string().min(1)).default([]),
  filesystem: z.enum(["none", "readonly", "workspace-write", "unrestricted"]).default("readonly"),
  shell: z.boolean().default(false),
  browser: z.boolean().default(false),
  credentials: credentialPermissionSchema.default("false"),
  external_send: z.boolean().default(false),
  money_movement: z.boolean().default(false),
  user_data: z.boolean().default(false),
  human_approval_required: z.array(z.string().min(1)).default([])
}).strict();

const agentSchema = z.object({
  id: idSchema,
  role: z.string().min(2),
  title: z.string().min(2).optional(),
  prompt: pathSchema,
  model_hint: z.string().optional(),
  tools: z.array(idSchema).default([]),
  handoffs: z.array(idSchema).default([])
}).strict();

const workflowStageSchema = z.object({
  id: idSchema,
  agent: idSchema
}).strict();

const toolSchema = z.object({
  mcp_servers: z.array(z.object({
    id: idSchema,
    required: z.boolean().default(false),
    package: z.string().min(1).optional(),
    pinned: z.boolean().default(false),
    allowlist: z.array(z.string().min(1)).default([])
  }).strict()).default([]),
  function_tools: z.array(z.object({
    id: idSchema,
    path: pathSchema,
    pinned: z.boolean().default(false)
  }).strict()).default([]),
  external_apis: z.array(z.object({
    id: idSchema,
    hostname: z.string().min(1),
    purpose: z.string().min(4),
    write: z.boolean().default(false)
  }).strict()).default([])
}).strict();

const pricingSchema = z.object({
  model: z.enum(["free", "one_time", "subscription", "per_call", "gate_escrow"]).default("free"),
  amount_usd: z.number().positive().optional(),
  period: z.enum(["month", "year"]).optional(),
  currency: z.string().length(3).default("USD")
}).strict();

const sourceSchema = z.object({
  upstream_url: z.string().url().optional(),
  upstream_license: z.string().min(2).optional(),
  attribution: z.string().min(2).optional(),
  authors: z.array(z.string().min(1)).default([]),
  vendor_policy: z.enum(["original", "vendored", "link-only"]).default("original")
}).strict();

const compatibilitySchema = z.object({
  targets: z.array(z.object({
    id: idSchema,
    name: z.string().min(1).optional(),
    status: z.enum(["planned", "available", "verified"]),
    notes: z.string().min(1).optional(),
    last_verified_at: z.string().datetime({ offset: true }).optional()
  }).strict()).default([])
}).strict();

const dependencySchema = z.object({
  ref: dependencyRefSchema,
  version: z.string().min(1).optional(),
  optional: z.boolean().default(false),
  reason: z.string().min(2).optional()
}).strict();

const contentSchema = z.object({
  type: z.enum(["harness", "directory"]).default("harness"),
  directory: z.object({
    url: z.string().url().optional(),
    item_count: z.number().int().nonnegative().optional(),
    category: idSchema.optional(),
    notes: z.string().min(1).optional()
  }).strict().optional()
}).strict();

export const harnessManifestSchema = z.object({
  schemaVersion: z.enum(["harness.v0.1", "harness.v0.2"]),
  name: idSchema,
  title: z.string().min(2),
  summary: z.string().min(12),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/),
  license: z.string().min(2),
  visibility: z.enum(["public", "org", "private"]).default("public"),
  pricing: pricingSchema.default({ model: "free", currency: "USD" }),
  org: idSchema.optional(),
  source: sourceSchema.default({ authors: [], vendor_policy: "original" }),
  compatibility: compatibilitySchema.default({ targets: [] }),
  depends_on: z.array(dependencySchema).default([]),
  content: contentSchema.default({ type: "harness" }),
  maintainers: z.array(z.object({
    name: z.string().min(2),
    url: z.string().url().optional()
  }).strict()).default([]),
  tags: z.array(idSchema).default([]),
  runtime: z.object({
    primary: z.enum(["openai-agents-sdk", "langgraph", "custom", "none"]),
    adapters: z.array(z.enum(["openai-agents-sdk", "langgraph", "custom"])).default([])
  }).strict(),
  entrypoint: z.object({
    command: z.string().min(2),
    cwd: z.string().default(".")
  }).strict().optional(),
  inputs: z.array(z.object({
    id: idSchema,
    type: z.enum(["string", "number", "boolean", "json", "markdown"]),
    required: z.boolean().default(false)
  }).strict()).default([]),
  outputs: z.array(z.object({
    id: idSchema,
    type: z.enum(["string", "json", "markdown", "artifact"])
  }).strict()).default([]),
  agents: z.array(agentSchema).min(1),
  workflow: z.object({
    entrypoint: idSchema,
    stages: z.array(workflowStageSchema).min(1)
  }).strict(),
  tools: toolSchema.default({ mcp_servers: [], function_tools: [], external_apis: [] }),
  permissions: permissionSchema,
  secrets: z.object({
    required: z.array(z.string().regex(/^[A-Z0-9_]+$/)).default([]),
    optional: z.array(z.string().regex(/^[A-Z0-9_]+$/)).default([])
  }).strict().default({ required: [], optional: [] }),
  evals: z.object({
    promptfoo_config: pathSchema,
    command: z.string().min(8)
  }).strict(),
  quality_gates: z.object({
    min_score: z.number().min(0).max(1).default(0.82),
    max_regression: z.number().min(0).max(1).default(0.03),
    max_cost_usd_per_run: z.number().positive().default(3),
    max_risk_score: z.number().int().min(0).max(100).default(39),
    required_checks: z.array(z.string().min(2)).default(["schema_valid", "eval_passed"])
  }).strict(),
  examples: z.array(z.object({
    title: z.string().min(2),
    input: pathSchema,
    output: pathSchema
  }).strict()).default([])
}).strict().superRefine((manifest, ctx) => {
  if (manifest.visibility === "org" && !manifest.org) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["org"],
      message: "org is required when visibility is org"
    });
  }
  if (manifest.pricing.model !== "free" && manifest.pricing.model !== "subscription" && !manifest.pricing.amount_usd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pricing", "amount_usd"],
      message: "amount_usd is required for paid pricing models"
    });
  }
  if (manifest.pricing.model === "subscription") {
    if (!manifest.pricing.amount_usd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pricing", "amount_usd"],
        message: "amount_usd is required for subscription pricing"
      });
    }
    if (!manifest.pricing.period) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pricing", "period"],
        message: "period is required for subscription pricing"
      });
    }
  }
});

export type HarnessManifest = z.infer<typeof harnessManifestSchema>;

export type ValidationIssue = {
  path: string;
  message: string;
  severity: "error" | "warning";
};

export type ValidationResult = {
  valid: boolean;
  manifest?: HarnessManifest;
  issues: ValidationIssue[];
  risk: RiskReport;
  security: SecurityReport;
};

export type RiskTier = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type RiskReport = {
  score: number;
  tier: RiskTier;
  reasons: string[];
  blocking: string[];
};

export type SecurityFindingSeverity = "info" | "warning" | "error" | "blocking";

export type SecurityFindingCategory = "secrets" | "permissions" | "tools" | "money" | "validation";

export type SecurityFinding = {
  id: string;
  category: SecurityFindingCategory;
  severity: SecurityFindingSeverity;
  path: string;
  message: string;
  recommendation?: string;
};

export type SecurityReport = {
  status: "passed" | "review" | "blocked";
  findings: SecurityFinding[];
  summary: {
    info: number;
    warning: number;
    error: number;
    blocking: number;
  };
};

export const harnessJsonSchema = zodToJsonSchema(harnessManifestSchema, "HarnessManifestV0_2");

export function parseManifestText(text: string): HarnessManifest {
  const parsed = YAML.parse(text);
  return harnessManifestSchema.parse(parsed);
}

export function manifestPath(rootDir: string): string {
  return path.join(rootDir, "harness.yaml");
}

export function readManifest(rootDir: string): HarnessManifest {
  const filePath = manifestPath(rootDir);
  return parseManifestText(readFileSync(filePath, "utf8"));
}

export function validateHarnessDir(rootDir: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  let manifest: HarnessManifest | undefined;

  const filePath = manifestPath(rootDir);
  if (!existsSync(filePath)) {
    issues.push({ path: "harness.yaml", message: "Missing harness.yaml", severity: "error" });
    return { valid: false, issues, risk: emptyRisk(), security: emptySecurityReport() };
  }

  let raw = "";
  try {
    raw = readFileSync(filePath, "utf8");
    manifest = parseManifestText(raw);
  } catch (error) {
    issues.push({ path: "harness.yaml", message: error instanceof Error ? error.message : String(error), severity: "error" });
    return { valid: false, issues, risk: emptyRisk(), security: emptySecurityReport(issues) };
  }

  const agentIds = new Set(manifest.agents.map((agent) => agent.id));
  if (!agentIds.has(manifest.workflow.entrypoint)) {
    issues.push({ path: "workflow.entrypoint", message: `Unknown entrypoint agent '${manifest.workflow.entrypoint}'`, severity: "error" });
  }

  for (const agent of manifest.agents) {
    assertRelativeFile(rootDir, agent.prompt, `agents.${agent.id}.prompt`, issues);
    for (const handoff of agent.handoffs) {
      if (!agentIds.has(handoff)) {
        issues.push({ path: `agents.${agent.id}.handoffs`, message: `Unknown handoff target '${handoff}'`, severity: "error" });
      }
    }
    for (const tool of agent.tools) {
      if (!allToolIds(manifest).has(tool)) {
        issues.push({ path: `agents.${agent.id}.tools`, message: `Unknown tool '${tool}'`, severity: "error" });
      }
    }
  }

  for (const stage of manifest.workflow.stages) {
    if (!agentIds.has(stage.agent)) {
      issues.push({ path: `workflow.stages.${stage.id}`, message: `Unknown stage agent '${stage.agent}'`, severity: "error" });
    }
  }

  assertRelativeFile(rootDir, manifest.evals.promptfoo_config, "evals.promptfoo_config", issues);
  for (const example of manifest.examples) {
    assertRelativeFile(rootDir, example.input, `examples.${example.title}.input`, issues);
    assertRelativeFile(rootDir, example.output, `examples.${example.title}.output`, issues);
  }

  const security = scanManifestSecurity(manifest, { manifestText: raw });
  for (const finding of security.findings) {
    if (finding.severity === "error" || finding.severity === "blocking") {
      issues.push({ path: finding.path, message: finding.message, severity: "error" });
    }
  }

  const risk = scoreRisk(manifest, issues);
  return { valid: issues.every((issue) => issue.severity !== "error") && risk.blocking.length === 0, manifest, issues, risk, security };
}

export function inspectHarness(rootDir: string) {
  const validation = validateHarnessDir(rootDir);
  const manifest = validation.manifest;
  return {
    rootDir,
    valid: validation.valid,
    issues: validation.issues,
    risk: validation.risk,
    manifest,
    components: manifest ? {
      agents: manifest.agents.length,
      stages: manifest.workflow.stages.length,
      tools: allToolIds(manifest).size,
      examples: manifest.examples.length,
      requiredSecrets: manifest.secrets.required.length
    } : undefined,
    security: validation.security
  };
}

export function scanManifestSecurity(
  manifest: HarnessManifest,
  options: { manifestText?: string } = {}
): SecurityReport {
  const findings: SecurityFinding[] = [];
  const add = (finding: SecurityFinding) => findings.push(finding);

  if (options.manifestText && containsSecretLookingValue(options.manifestText)) {
    add({
      id: "literal-secret",
      category: "secrets",
      severity: "blocking",
      path: "harness.yaml",
      message: "Manifest appears to contain a literal secret value",
      recommendation: "Replace literal secret values with entries under secrets.required or secrets.optional."
    });
  }

  if (manifest.permissions.money_movement) {
    add({
      id: "money-movement",
      category: "money",
      severity: "blocking",
      path: "permissions.money_movement",
      message: "Harness requests money/card/ledger movement capability",
      recommendation: "Require explicit security review and human approval before public listing."
    });
  }

  if (manifest.permissions.filesystem === "unrestricted") {
    add({
      id: "unrestricted-filesystem",
      category: "permissions",
      severity: "blocking",
      path: "permissions.filesystem",
      message: "Harness requests unrestricted filesystem access",
      recommendation: "Scope filesystem access to readonly or workspace-write."
    });
  }

  const highRiskPermissions: Array<[boolean, string, string, SecurityFindingSeverity, string]> = [
    [manifest.permissions.network === "unrestricted", "unrestricted-network", "permissions.network", "warning", "Harness requests unrestricted network access"],
    [manifest.permissions.shell, "shell-access", "permissions.shell", "warning", "Harness requests shell access"],
    [manifest.permissions.browser, "browser-automation", "permissions.browser", "warning", "Harness requests browser automation"],
    [manifest.permissions.credentials === "persistent", "persistent-credentials", "permissions.credentials", "warning", "Harness requests persistent credentials"],
    [manifest.permissions.external_send, "external-send", "permissions.external_send", "warning", "Harness can send data to external systems"],
    [manifest.permissions.user_data, "user-data", "permissions.user_data", "warning", "Harness handles user data"]
  ];
  for (const [enabled, id, issuePath, severity, message] of highRiskPermissions) {
    if (enabled) {
      add({
        id,
        category: "permissions",
        severity,
        path: issuePath,
        message,
        recommendation: "Keep the permission disabled unless the harness cannot work without it."
      });
    }
  }

  for (const server of manifest.tools.mcp_servers) {
    if (!server.pinned) {
      add({
        id: "unpinned-mcp-server",
        category: "tools",
        severity: "error",
        path: `tools.mcp_servers.${server.id}`,
        message: `MCP server '${server.id}' is not pinned`,
        recommendation: "Pin MCP server package/version before verified registry use."
      });
    }
  }
  for (const tool of manifest.tools.function_tools) {
    if (!tool.pinned) {
      add({
        id: "unpinned-function-tool",
        category: "tools",
        severity: "error",
        path: `tools.function_tools.${tool.id}`,
        message: `Function tool '${tool.id}' is not pinned`,
        recommendation: "Pin function tools before verified registry use."
      });
    }
  }

  return summarizeSecurity(findings);
}

export function scoreRisk(manifest: HarnessManifest, issues: ValidationIssue[] = []): RiskReport {
  let score = 0;
  const reasons: string[] = [];
  const blocking: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(`+${points} ${reason}`);
  };

  if (manifest.permissions.network === "allowlist") add(10, "network allowlist");
  if (manifest.permissions.network === "unrestricted") add(25, "unrestricted network");
  if (manifest.permissions.filesystem === "readonly") add(5, "filesystem readonly");
  if (manifest.permissions.filesystem === "workspace-write") add(15, "filesystem workspace-write");
  if (manifest.permissions.filesystem === "unrestricted") {
    add(30, "filesystem unrestricted");
    blocking.push("Unrestricted filesystem is blocked in public alpha");
  }
  if (manifest.permissions.shell) add(35, "shell access");
  if (manifest.permissions.browser) add(15, "browser automation");
  if (manifest.permissions.credentials === "runtime_injected") add(10, "runtime injected credentials");
  if (manifest.permissions.credentials === "persistent") add(25, "persistent credentials");
  if (manifest.permissions.external_send) add(25, "external send capability");
  if (manifest.permissions.user_data) add(20, "user data handling");
  if (manifest.permissions.money_movement) {
    add(50, "money/card/ledger movement");
    blocking.push("Money movement is blocked unless explicitly overridden by security review");
  }
  for (const server of manifest.tools.mcp_servers) {
    if (!server.pinned) add(15, `unpinned MCP server ${server.id}`);
  }
  for (const tool of manifest.tools.function_tools) {
    if (!tool.pinned) add(15, `unpinned function tool ${tool.id}`);
  }
  score += manifest.secrets.required.length * 10;
  if (manifest.secrets.required.length) reasons.push(`+${manifest.secrets.required.length * 10} required secrets`);
  if (!manifest.evals.promptfoo_config) add(30, "missing eval config");

  for (const issue of issues) {
    if (issue.severity === "error") blocking.push(issue.message);
  }

  const capped = Math.min(score, 100);
  return {
    score: capped,
    tier: capped < 20 ? "LOW" : capped < 40 ? "MEDIUM" : capped < 70 ? "HIGH" : "CRITICAL",
    reasons,
    blocking
  };
}

export function riskMarkdown(report: RiskReport): string {
  const lines = [`# Harness Risk`, "", `Risk: ${report.score} ${report.tier}`, ""];
  if (report.reasons.length) {
    lines.push("## Reasons", ...report.reasons.map((reason) => `- ${reason}`), "");
  }
  if (report.blocking.length) {
    lines.push("## Blocking", ...report.blocking.map((reason) => `- ${reason}`), "");
  }
  return lines.join("\n");
}

function assertRelativeFile(rootDir: string, relativePath: string, issuePath: string, issues: ValidationIssue[]) {
  const fullPath = path.resolve(rootDir, relativePath);
  if (!fullPath.startsWith(path.resolve(rootDir))) {
    issues.push({ path: issuePath, message: `Path '${relativePath}' escapes harness root`, severity: "error" });
    return;
  }
  if (!existsSync(fullPath)) {
    issues.push({ path: issuePath, message: `Referenced file '${relativePath}' does not exist`, severity: "error" });
  }
}

function allToolIds(manifest: HarnessManifest): Set<string> {
  return new Set([
    ...manifest.tools.mcp_servers.map((tool) => tool.id),
    ...manifest.tools.function_tools.map((tool) => tool.id),
    ...manifest.tools.external_apis.map((tool) => tool.id)
  ]);
}

function containsSecretLookingValue(text: string): boolean {
  return /(sk-[A-Za-z0-9]{20,}|api[_-]?key:\s*['"]?[A-Za-z0-9_\-]{24,}|token:\s*['"]?[A-Za-z0-9_\-]{24,})/i.test(text);
}

function emptyRisk(): RiskReport {
  return { score: 0, tier: "LOW", reasons: [], blocking: [] };
}

function summarizeSecurity(findings: SecurityFinding[]): SecurityReport {
  const summary = {
    info: findings.filter((finding) => finding.severity === "info").length,
    warning: findings.filter((finding) => finding.severity === "warning").length,
    error: findings.filter((finding) => finding.severity === "error").length,
    blocking: findings.filter((finding) => finding.severity === "blocking").length
  };
  return {
    status: summary.blocking > 0 || summary.error > 0 ? "blocked" : summary.warning > 0 ? "review" : "passed",
    findings,
    summary
  };
}

function emptySecurityReport(issues: ValidationIssue[] = []): SecurityReport {
  return summarizeSecurity(issues.map((issue) => ({
    id: "schema-validation-error",
    category: "validation",
    severity: issue.severity === "error" ? "error" : "warning",
    path: issue.path,
    message: issue.message
  })));
}
