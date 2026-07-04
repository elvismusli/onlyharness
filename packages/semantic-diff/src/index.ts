import { readFileSync } from "node:fs";
import path from "node:path";
import {
  readManifest,
  scoreRisk,
  validateHarnessDir
} from "@harnesshub/schema";
import type { HarnessManifest } from "@harnesshub/schema";

export type DiffSeverity = "SAFE" | "REVIEW" | "RISKY" | "BLOCKING";

export type SemanticChange = {
  severity: DiffSeverity;
  area: string;
  message: string;
  before?: unknown;
  after?: unknown;
};

export type SemanticDiff = {
  baseName: string;
  headName: string;
  status: "passed" | "review" | "failed";
  riskDelta: number;
  riskTier: string;
  changes: SemanticChange[];
  blocking: string[];
};

export function diffHarnessDirs(baseDir: string, headDir: string): SemanticDiff {
  const base = readManifest(baseDir);
  const headValidation = validateHarnessDir(headDir);
  if (!headValidation.manifest) {
    return {
      baseName: base.name,
      headName: path.basename(headDir),
      status: "failed",
      riskDelta: 100,
      riskTier: "CRITICAL",
      changes: [{
        severity: "BLOCKING",
        area: "schema",
        message: "Head harness is invalid and cannot be diffed"
      }],
      blocking: headValidation.issues.map((issue) => issue.message)
    };
  }
  return diffManifests(base, headValidation.manifest, baseDir, headDir);
}

export function diffManifests(base: HarnessManifest, head: HarnessManifest, baseDir?: string, headDir?: string): SemanticDiff {
  const changes: SemanticChange[] = [];
  const blocking: string[] = [];
  const baseRisk = scoreRisk(base);
  const headRisk = scoreRisk(head);
  const add = (change: SemanticChange) => {
    changes.push(change);
    if (change.severity === "BLOCKING") blocking.push(change.message);
  };

  compareScalar("metadata", "version", base.version, head.version, "REVIEW", add);
  compareScalar("runtime", "primary runtime", base.runtime.primary, head.runtime.primary, "REVIEW", add);
  compareScalar("quality_gates", "min score", base.quality_gates.min_score, head.quality_gates.min_score, head.quality_gates.min_score < base.quality_gates.min_score ? "RISKY" : "REVIEW", add);
  compareScalar("quality_gates", "max risk score", base.quality_gates.max_risk_score, head.quality_gates.max_risk_score, head.quality_gates.max_risk_score > base.quality_gates.max_risk_score ? "RISKY" : "REVIEW", add);

  compareComponentIds("agents", base.agents.map((agent) => agent.id), head.agents.map((agent) => agent.id), add);
  compareComponentIds("workflow.stages", base.workflow.stages.map((stage) => stage.id), head.workflow.stages.map((stage) => stage.id), add);
  compareComponentIds("tools.mcp_servers", base.tools.mcp_servers.map((tool) => tool.id), head.tools.mcp_servers.map((tool) => tool.id), add, "RISKY");
  compareComponentIds("tools.external_apis", base.tools.external_apis.map((tool) => tool.id), head.tools.external_apis.map((tool) => tool.id), add, "RISKY");
  compareComponentIds("secrets.required", base.secrets.required, head.secrets.required, add, "RISKY");

  const permissionKeys = ["network", "filesystem", "shell", "browser", "credentials", "external_send", "money_movement", "user_data"] as const;
  for (const key of permissionKeys) {
    if (base.permissions[key] !== head.permissions[key]) {
      const severity = permissionEscalationSeverity(key, base.permissions[key], head.permissions[key]);
      add({
        severity,
        area: "permissions",
        message: `${key}: ${String(base.permissions[key])} -> ${String(head.permissions[key])}`,
        before: base.permissions[key],
        after: head.permissions[key]
      });
    }
  }

  if (baseDir && headDir) {
    for (const agent of head.agents) {
      const baseAgent = base.agents.find((candidate) => candidate.id === agent.id);
      if (baseAgent?.prompt && agent.prompt && baseAgent.prompt === agent.prompt) {
        const basePromptPath = path.join(baseDir, agent.prompt);
        const headPromptPath = path.join(headDir, agent.prompt);
        try {
          if (readFileSync(basePromptPath, "utf8") !== readFileSync(headPromptPath, "utf8")) {
            add({ severity: "REVIEW", area: "prompts", message: `${agent.prompt} changed` });
          }
        } catch {
          add({ severity: "REVIEW", area: "prompts", message: `${agent.prompt} could not be compared` });
        }
      }
    }
  }

  if (headRisk.score > baseRisk.score) {
    add({
      severity: headRisk.tier === "CRITICAL" ? "BLOCKING" : headRisk.tier === "HIGH" ? "RISKY" : "REVIEW",
      area: "risk",
      message: `risk score changed ${baseRisk.score} ${baseRisk.tier} -> ${headRisk.score} ${headRisk.tier}`,
      before: baseRisk,
      after: headRisk
    });
  }
  for (const reason of headRisk.blocking) {
    add({ severity: "BLOCKING", area: "risk", message: reason });
  }

  const failed = blocking.length > 0;
  return {
    baseName: base.name,
    headName: head.name,
    status: failed ? "failed" : changes.some((change) => change.severity === "RISKY") ? "review" : "passed",
    riskDelta: headRisk.score - baseRisk.score,
    riskTier: headRisk.tier,
    changes,
    blocking
  };
}

export function semanticDiffMarkdown(diff: SemanticDiff): string {
  const lines = [
    "# Harness Review",
    "",
    `Status: ${diff.status}`,
    `Risk: ${diff.riskTier} (${diff.riskDelta >= 0 ? "+" : ""}${diff.riskDelta})`,
    ""
  ];
  if (diff.changes.length) {
    lines.push("## Changed", ...diff.changes.map((change) => `- [${change.severity}] ${change.area}: ${change.message}`), "");
  } else {
    lines.push("No semantic harness changes detected.", "");
  }
  if (diff.blocking.length) {
    lines.push("## Blocking", ...diff.blocking.map((item) => `- ${item}`), "");
  }
  return lines.join("\n");
}

function compareScalar(area: string, label: string, before: unknown, after: unknown, severity: DiffSeverity, add: (change: SemanticChange) => void) {
  if (before !== after) {
    add({ severity, area, message: `${label}: ${String(before)} -> ${String(after)}`, before, after });
  }
}

function compareComponentIds(area: string, baseIds: string[], headIds: string[], add: (change: SemanticChange) => void, severity: DiffSeverity = "REVIEW") {
  const base = new Set(baseIds);
  const head = new Set(headIds);
  for (const id of headIds) {
    if (!base.has(id)) add({ severity, area, message: `added ${id}` });
  }
  for (const id of baseIds) {
    if (!head.has(id)) add({ severity: severity === "RISKY" ? "REVIEW" : severity, area, message: `removed ${id}` });
  }
}

function permissionEscalationSeverity(key: string, before: unknown, after: unknown): DiffSeverity {
  if (key === "money_movement" && after === true) return "BLOCKING";
  if (key === "shell" && after === true) return "RISKY";
  if (key === "credentials" && after === "persistent") return "RISKY";
  if (key === "filesystem" && after === "unrestricted") return "BLOCKING";
  if (key === "network" && after === "unrestricted") return "RISKY";
  if (key === "external_send" && after === true) return "RISKY";
  return before === after ? "SAFE" : "REVIEW";
}
