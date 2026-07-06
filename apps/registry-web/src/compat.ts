import type { CompatibilityTarget, HarnessDetail, RegistryItem } from "./types";

const DEFAULT_TARGETS: CompatibilityTarget[] = [
  { id: "claude-code", name: "Claude Code", status: "available", detail: "hh install --target claude-code" },
  { id: "codex", name: "Codex", status: "available", detail: "hh install --target codex" },
  { id: "cursor", name: "Cursor", status: "available", detail: "hh install --target cursor" },
  { id: "mcp", name: "MCP", status: "available", detail: "pull_instructions + pull_harness" },
  { id: "cli", name: "CLI", status: "available", detail: "local hh install/run/eval/gate" },
  { id: "github", name: "GitHub", status: "available", detail: "archive curl or verified git publish" }
];

const DIRECTORY_TARGETS: CompatibilityTarget[] = [
  { id: "open-link", name: "Open link", status: "available", detail: "source directory URL" },
  { id: "license-review", name: "License review", status: "planned", detail: "required before vendoring upstream content" },
  { id: "harness-import", name: "Harness import", status: "planned", detail: "convert selected entries only after source review" }
];

export function compatibilityTargetsFor(item?: RegistryItem, detail?: HarnessDetail): CompatibilityTarget[] {
  if (!item) return DEFAULT_TARGETS;
  const isDirectory = item.contentType === "directory" || detail?.manifest?.content?.type === "directory";
  if (isDirectory) {
    const url = item.directory?.url ?? detail?.manifest?.content?.directory?.url ?? item.forgeUrl;
    return DIRECTORY_TARGETS.map((target) => target.id === "open-link" ? { ...target, detail: url } : target);
  }

  const declared = detail?.manifest?.compatibility?.targets ?? item.compatibility?.targets ?? [];
  if (!declared.length) return DEFAULT_TARGETS;

  const merged = DEFAULT_TARGETS.map((target) => {
    const declaredTarget = declared.find((entry) => targetKey(entry) === targetKey(target));
    return declaredTarget ? normalizeTarget({ ...target, ...declaredTarget }) : target;
  });
  for (const target of declared) {
    if (!merged.some((entry) => targetKey(entry) === targetKey(target))) merged.push(normalizeTarget(target));
  }
  return merged;
}

export function targetLabel(target: CompatibilityTarget): string {
  return target.name ?? target.id ?? "Target";
}

export function targetDetail(target: CompatibilityTarget): string {
  return target.detail ?? target.notes ?? target.last_verified_at ?? "No setup notes yet";
}

export function targetTone(target: CompatibilityTarget): "safe" | "warn" {
  return target.status === "planned" ? "warn" : "safe";
}

export function topTargetLabels(item: RegistryItem, detail?: HarnessDetail, max = 4): string[] {
  return compatibilityTargetsFor(item, detail)
    .filter((target) => target.status !== "planned")
    .slice(0, max)
    .map(targetLabel);
}

function normalizeTarget(target: CompatibilityTarget): CompatibilityTarget {
  return {
    ...target,
    name: target.name ?? labelForId(target.id),
    detail: target.detail ?? target.notes
  };
}

function targetKey(target: CompatibilityTarget): string {
  return (target.id ?? target.name ?? "").toLowerCase().replace(/\s+/g, "-");
}

function labelForId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  if (id === "claude-code") return "Claude Code";
  if (id === "mcp") return "MCP";
  if (id === "cli") return "CLI";
  if (id === "github") return "GitHub";
  return id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
