import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { SecurityReport as ManifestSecurityReport } from "@harnesshub/schema";

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
  scanner: "static-v1";
};

const TEXT_EXTENSIONS = new Set([".md", ".txt", ".yaml", ".yml", ".json", ".js", ".ts", ".mjs", ".cjs", ".sh", ".py"]);
const MAX_SCAN_BYTES = 256 * 1024;
const DEFAULT_ALLOWED_HOSTS = new Set(["onlyharness.com", "www.onlyharness.com", "github.com", "raw.githubusercontent.com"]);

const RULES: Array<{ id: string; severity: "warn" | "fail"; pattern: RegExp }> = [
  { id: "pipe-to-shell", severity: "fail", pattern: /(curl|wget)[^\n]{0,120}\|\s*(ba)?sh/i },
  { id: "base64-exec", severity: "fail", pattern: /base64\s+(-d|--decode)[^\n]{0,80}\|\s*(ba)?sh|eval\(atob/i },
  { id: "secret-exfiltration", severity: "fail", pattern: /\$\{?[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\}?[^\n]{0,120}(curl|wget|fetch|http)/i },
  { id: "prompt-override", severity: "fail", pattern: /ignore (all )?(previous|prior|above) instructions|disregard (the )?system prompt/i },
  { id: "hidden-from-user", severity: "warn", pattern: /do not (tell|show|inform|reveal)[^\n]{0,40}(user|human)/i }
];

export function scanHarnessDir(
  root: string,
  options: { networkAllowlist?: string[]; manifestSecurity?: ManifestSecurityReport } = {}
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
  for (const file of listTextFiles(root)) {
    const full = path.join(root, file);
    const text = readFileSync(full, "utf8");
    for (const rule of RULES) {
      const match = text.match(rule.pattern);
      if (match) findings.push({ rule: rule.id, file, excerpt: cleanExcerpt(match[0]), severity: rule.severity });
    }
    for (const finding of externalUrlFindings(file, text, allowedHosts)) findings.push(finding);
  }

  return {
    verdict: findings.some((finding) => finding.severity === "fail") ? "fail" : findings.length ? "warn" : "pass",
    findings,
    scannedAt: new Date().toISOString(),
    scanner: "static-v1"
  };
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
