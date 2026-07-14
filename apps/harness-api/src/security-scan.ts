import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { SecurityReport as ManifestSecurityReport } from "@harnesshub/schema";
import type { ManagedPermissions } from "@harnesshub/capability-schema/browser";

export type SecurityFinding = {
  rule: string;
  file: string;
  excerpt: string;
  severity: "warn" | "fail";
};

export type SecurityReport = {
  verdict: "pass" | "warn" | "fail";
  findings: SecurityFinding[];
  scannedAt: string;
  scanner: "static-v2";
};

export type SecurityScanFile = { path: string; content: string };
export type InferredCapability = {
  capability: string;
  status: "detected" | "not_detected";
  evidence: Array<{ file: string; rule: string }>;
};
export type RecomputedCapabilityDiff = {
  status: "pass" | "warn" | "fail";
  declared: ManagedPermissions;
  inferred: InferredCapability[];
  differences: Array<{ field: string; declared: string; inferred: string }>;
};

const TEXT_EXTENSIONS = new Set([".md", ".txt", ".yaml", ".yml", ".json", ".js", ".ts", ".mjs", ".cjs", ".sh", ".py"]);
const MAX_SCAN_BYTES = 256 * 1024;
const DEFAULT_ALLOWED_HOSTS = new Set(["superskill.sh", "www.superskill.sh", "onlyharness.com", "www.onlyharness.com", "github.com", "raw.githubusercontent.com"]);

type CapabilityKey = "network" | "shell" | "filesystem" | "browser" | "credentials" | "externalSend" | "moneyMovement" | "userData";
type StaticRule = { id: string; severity: "warn" | "fail"; pattern: RegExp; capability?: CapabilityKey; observation?: true };

const RULES: StaticRule[] = [
  { id: "pipe-to-shell", severity: "fail", pattern: /(curl|wget)[^\n]{0,120}\|\s*(ba)?sh/i },
  { id: "base64-exec", severity: "fail", pattern: /base64\s+(-d|--decode)[^\n]{0,80}\|\s*(ba)?sh|eval\(atob/i },
  { id: "secret-exfiltration", severity: "fail", pattern: /\$\{?[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\}?[^\n]{0,120}(curl|wget|fetch|http)/i },
  { id: "literal-private-key", severity: "fail", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i },
  { id: "literal-secret", severity: "fail", pattern: /\b(?:sk-|sk_|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{16,}\b|\b(?:api[_ -]?key|token|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/i },
  { id: "absolute-sensitive-path", severity: "fail", pattern: /(?:^|[\s"'`])(?:~\/(?:\.ssh|\.aws|\.gnupg|\.kube|\.config\/(?:gcloud|gh))|\/(?:Users|home)\/[^/\s]+\/(?:\.ssh|\.aws|\.gnupg|\.kube|\.config\/(?:gcloud|gh)|Library\/Keychains)|\/etc\/(?:passwd|shadow|sudoers)(?:\b|\/)|[A-Za-z]:\\Users\\[^\\\s]+\\(?:\.ssh|\.aws|\.kube))(?:[/\\][^\s"'`]*)?/i, capability: "credentials" },
  { id: "unicode-bidi-control", severity: "fail", pattern: /[\u202A-\u202E\u2066-\u2069]/u },
  { id: "unicode-hidden-control", severity: "fail", pattern: /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u },
  { id: "secondary-download", severity: "fail", pattern: /\b(?:curl|wget)\b[^\n]{0,160}https?:\/\/|\bdownload\s+(?:and\s+)?(?:run|execute|install)\b/i, capability: "network" },
  { id: "secondary-install", severity: "fail", pattern: /\b(?:npm|pnpm|yarn)\s+(?:install|add)\b|\b(?:pip|pip3)\s+install\b|\b(?:brew|apt(?:-get)?)\s+install\b/i, capability: "shell" },
  { id: "prompt-override", severity: "fail", pattern: /ignore (all )?(previous|prior|above) instructions|disregard (the )?system prompt/i },
  { id: "hidden-from-user", severity: "warn", pattern: /do not (tell|show|inform|reveal)[^\n]{0,40}(user|human)/i },
  { id: "network-signal", severity: "warn", pattern: /https?:\/\/|\b(?:curl|wget|fetch|http request|web search)\b/i, capability: "network", observation: true },
  { id: "shell-signal", severity: "warn", pattern: /```(?:bash|sh|shell|zsh)\b|\b(?:run|execute)\s+(?:the\s+)?(?:command|shell)|\b(?:bash|zsh|sh)\s+-c\b/i, capability: "shell", observation: true },
  { id: "filesystem-write-signal", severity: "warn", pattern: /\b(?:write|edit|modify|delete|remove|rename|overwrite|create)\s+(?:the\s+)?(?:file|files|directory|folder)\b|\b(?:rm|mv|cp|mkdir)\s+-?[A-Za-z]/i, capability: "filesystem", observation: true },
  { id: "browser-signal", severity: "warn", pattern: /\b(?:browser|playwright|chrome|chromium)\b[^\n]{0,80}\b(?:open|navigate|click|type|visit|control)\b|\b(?:navigate|click)\b[^\n]{0,60}\b(?:page|browser)\b/i, capability: "browser", observation: true },
  { id: "credentials-signal", severity: "warn", pattern: /\b(?:api key|access token|auth token|credential|credentials|private key|environment variable|env var)\b/i, capability: "credentials", observation: true },
  { id: "external-send-signal", severity: "warn", pattern: /\b(?:send|post|upload|email|message|publish)\b[^\n]{0,80}\b(?:email|message|file|data|reply|request|response|externally|customer|user)\b/i, capability: "externalSend", observation: true },
  { id: "money-movement-signal", severity: "warn", pattern: /\b(?:pay|charge|refund|withdraw|transfer|debit|credit)\b[^\n]{0,80}\b(?:money|funds|payment|card|wallet|ledger|customer|account|transaction)\b|\b(?:money movement|issue refund|send payment)\b/i, capability: "moneyMovement", observation: true },
  { id: "user-data-signal", severity: "warn", pattern: /\b(?:customer|user|account|ticket|personal|profile)\s+(?:data|record|records|details|information)\b/i, capability: "userData", observation: true }
];

export function scanHarnessDir(
  root: string,
  options: { networkAllowlist?: string[]; manifestSecurity?: ManifestSecurityReport } = {}
): SecurityReport {
  const files = listTextFiles(root).map((file) => ({ path: file, content: readFileSync(path.join(root, file), "utf8") }));
  return scanHarnessFiles(files, { ...options, includeCapabilitySignals: false });
}

export function scanHarnessFiles(
  files: SecurityScanFile[],
  options: { networkAllowlist?: string[]; manifestSecurity?: ManifestSecurityReport; scannedAt?: string; includeCapabilitySignals?: boolean } = {}
): SecurityReport {
  const findings: SecurityFinding[] = [];
  for (const finding of options.manifestSecurity?.findings ?? []) {
    findings.push({
      rule: `manifest-${finding.id}`,
      file: finding.path,
      excerpt: finding.message,
      severity: finding.severity === "blocking" || finding.severity === "error" ? "fail" : "warn"
    });
  }

  const allowedHosts = new Set([...DEFAULT_ALLOWED_HOSTS, ...(options.networkAllowlist ?? [])]);
  for (const { path: file, content: text } of [...files].sort((left, right) => Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8")))) {
    for (const rule of RULES) {
      if (rule.observation && options.includeCapabilitySignals === false) continue;
      if (rule.id === "secondary-install" && /^\.gitea\/workflows\//.test(file)) continue;
      const match = text.match(rule.pattern);
      if (match && !(rule.id === "network-signal" && networkSignalIsFullyAllowlisted(text, allowedHosts))) {
        findings.push({ rule: rule.id, file, excerpt: cleanExcerpt(match[0]), severity: rule.severity });
      }
    }
    for (const finding of externalUrlFindings(file, text, allowedHosts)) findings.push(finding);
  }

  return {
    verdict: findings.some((finding) => finding.severity === "fail") ? "fail" : findings.length ? "warn" : "pass",
    findings,
    scannedAt: options.scannedAt ?? new Date().toISOString(),
    scanner: "static-v2"
  };
}

function networkSignalIsFullyAllowlisted(text: string, allowedHosts: Set<string>): boolean {
  if (/\b(?:curl|wget|fetch|http request|web search)\b/i.test(text)) return false;
  const urls = [...text.matchAll(/https?:\/\/[a-z0-9.-]+(?::\d+)?[^\s)"']*/gi)].map((match) => match[0]);
  if (!urls.length) return false;
  return urls.every((value) => {
    try {
      return allowedHosts.has(new URL(value).hostname);
    } catch {
      return false;
    }
  });
}

export function recomputeCapabilityDiff(files: SecurityScanFile[], declared: ManagedPermissions): RecomputedCapabilityDiff {
  const evidence = new Map<CapabilityKey, Array<{ file: string; rule: string }>>();
  for (const key of capabilityKeys) evidence.set(key, []);
  for (const file of [...files].sort((left, right) => Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8")))) {
    // The manifest declares capabilities, sources and eval commands. Treating those
    // structured fields as agent behavior makes the diff compare declarations to
    // themselves and turns source attribution URLs into false network evidence.
    if (isStructuredHarnessManifest(file.path)) continue;
    for (const rule of RULES) {
      if (!rule.capability || !hasBehavioralCapabilityMatch(file.content, rule)) continue;
      evidence.get(rule.capability)!.push({ file: file.path, rule: rule.id });
    }
  }
  const inferred = capabilityKeys.map((capability) => ({
    capability,
    status: evidence.get(capability)!.length ? "detected" as const : "not_detected" as const,
    evidence: uniqueEvidence(evidence.get(capability)!)
  }));
  const differences: RecomputedCapabilityDiff["differences"] = [];
  let status: RecomputedCapabilityDiff["status"] = "pass";
  for (const item of inferred) {
    if (item.status !== "detected" || declaredAllows(declared, item.capability as CapabilityKey)) continue;
    differences.push({ field: item.capability, declared: declaredValue(declared, item.capability as CapabilityKey), inferred: "detected" });
    if (criticalUndeclared.has(item.capability as CapabilityKey)) status = "fail";
    else if (status === "pass") status = "warn";
  }
  return { status, declared, inferred, differences };
}

function isStructuredHarnessManifest(file: string): boolean {
  const basename = file.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase();
  return basename === "harness.yaml" || basename === "harness.yml";
}

function hasBehavioralCapabilityMatch(content: string, rule: StaticRule): boolean {
  for (const clause of content.split(/(?:\r?\n|[.!?;]\s+)/)) {
    const flags = rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`;
    const pattern = new RegExp(rule.pattern.source, flags);
    for (const match of clause.matchAll(pattern)) {
      const before = clause.slice(0, match.index ?? 0);
      if (isNonBehavioralCapabilityContext(before)) continue;
      if (!hasRequiredBehavioralAction(rule.capability!, clause)) continue;
      return true;
    }
  }
  return false;
}

function isNonBehavioralCapabilityContext(before: string): boolean {
  const normalized = before.replace(/[`*_>#-]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  const resetAt = Math.max(normalized.lastIndexOf(","), normalized.lastIndexOf(":"), normalized.lastIndexOf("—"));
  let scoped = normalized.slice(resetAt + 1).trim();
  const transition = [...scoped.matchAll(/\b(?:but|however|then)\b/gi)].at(-1);
  if (transition?.index !== undefined) scoped = scoped.slice(transition.index + transition[0].length).trim();
  if (/\b(?:do not|don't|never)\s+(?:hesitate|delay|fail|forget)\s+to\b/i.test(scoped)
    || /\bwithout\s+(?:waiting|delay)\b/i.test(scoped)) {
    return false;
  }
  if (/\b(?:do not|don't|never|must not|should not|cannot|can't|without|no|avoid(?:s|ed|ing)?|prevent(?:s|ed|ing)?|prohibit(?:s|ed|ing)?|block(?:s|ed|ing)?|forbid(?:s|den|ding)?)\b[^.!?;]*$/i.test(scoped)) {
    return true;
  }
  return /\b(?:review|audit|assess|analy[sz]e|check|verify|identify|flag|report|describe|document|discuss|explain|recommend|draft|simulate|test)\s+(?:(?:whether|if|how)\b|(?:the\s+)?(?:risk|possibility|capability|requirement|policy|handling|behavior|attempt|mention|usage)\b)[^.!?;]*$/i.test(scoped)
    || /\b(?:risk|possibility|capability|requirement|policy)\s+(?:of|for|to)\b[^.!?;]*$/i.test(scoped);
}

function hasRequiredBehavioralAction(capability: CapabilityKey, clause: string): boolean {
  if (capability === "credentials") {
    return /\b(?:use|read|load|access|retrieve|obtain|get|inject|pass|store|save|write|export|send|upload|rotate)\s+(?:the\s+|an?\s+)?(?:api[ _-]?key|access token|auth token|credential|credentials|private key|environment variable|env var)\b/i.test(clause)
      || /\bread\s+(?:from\s+)?(?:~\/|\/(?:Users|home)\/|[A-Za-z]:\\Users\\)[^\s]*\.(?:ssh|aws|gnupg|kube)\b/i.test(clause);
  }
  if (capability === "network") {
    return /\b(?:curl|wget)\b|\bfetch\s*\(|\b(?:perform|run|use)\s+(?:an?\s+)?web search\b/i.test(clause)
      || /\b(?:use|fetch|download|upload|post|request|call|query|open|visit|navigate|send)\b[^\n]{0,100}(?:https?:\/\/|\b(?:api|endpoint|website|web page)\b)/i.test(clause);
  }
  if (capability === "moneyMovement") {
    return /\b(?:issue|process|execute|make|send|initiate|perform|approve|capture|settle|reverse|trigger)\s+(?:an?\s+|the\s+)?(?:payment|refund|withdrawal|transfer|debit|credit)\b/i.test(clause)
      || /\b(?:pay|charge|refund|withdraw|transfer|debit|credit)\s+(?:(?:the|a|an)\s+)?(?:customer|user|account|card|wallet|ledger|transaction|payment|money|funds|\$|USD\b|EUR\b)/i.test(clause);
  }
  return true;
}

const capabilityKeys: CapabilityKey[] = ["network", "shell", "filesystem", "browser", "credentials", "externalSend", "moneyMovement", "userData"];
const criticalUndeclared = new Set<CapabilityKey>(["credentials", "externalSend", "moneyMovement"]);

function declaredAllows(declared: ManagedPermissions, capability: CapabilityKey): boolean {
  if (capability === "network") return declared.network !== "false";
  if (capability === "shell") return declared.shell;
  if (capability === "filesystem") return declared.filesystem === "workspace-write" || declared.filesystem === "unrestricted";
  if (capability === "browser") return declared.browser;
  if (capability === "credentials") return declared.credentials !== "false";
  if (capability === "externalSend") return declared.externalSend;
  if (capability === "moneyMovement") return declared.moneyMovement;
  return declared.userData;
}

function declaredValue(declared: ManagedPermissions, capability: CapabilityKey): string {
  const value = capability === "network" ? declared.network
    : capability === "filesystem" ? declared.filesystem
    : capability === "credentials" ? declared.credentials
    : declared[capability];
  return String(value);
}

function uniqueEvidence(items: Array<{ file: string; rule: string }>): Array<{ file: string; rule: string }> {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.file}\0${item.rule}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function listTextFiles(root: string): string[] {
  const files: string[] = [];
  collectTextFiles(root, root, files);
  return files;
}

function collectTextFiles(root: string, dir: string, files: string[]) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === ".harnesshub" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTextFiles(root, full, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    if (statSync(full).size > MAX_SCAN_BYTES) continue;
    files.push(path.relative(root, full));
  }
}

function externalUrlFindings(file: string, text: string, allowedHosts: Set<string>): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const match of text.matchAll(/https?:\/\/[a-z0-9.-]+(?::\d+)?[^\s)"']*/gi)) {
    try {
      const url = new URL(match[0]);
      if (!allowedHosts.has(url.hostname)) {
        findings.push({
          rule: "external-url",
          file,
          excerpt: cleanExcerpt(match[0]),
          severity: "warn"
        });
      }
    } catch {
      continue;
    }
  }
  return findings;
}

function cleanExcerpt(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, 160);
}
