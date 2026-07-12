import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { InventorySummary } from "./superskill-client.js";
import type { ManagedPinnedMarker, SuperSkillClient } from "./superskill-types.js";
import { CAPABILITY_ID_RE, SUPERSKILL_RUNTIME, SuperSkillCliError } from "./superskill-types.js";

export type ClientDoctorResult = {
  client: SuperSkillClient;
  plugin: "available" | "not_detected";
  managedSkills: number;
  unmanagedSkills: number;
  duplicates: string[];
  legacyCodexHarnesses: string[];
  runtime: { node: string; npm: "available" | "missing"; exactCli: "resolvable" | "unverified" };
  status: "healthy" | "attention";
  next: string[];
};

export type ClientAdapter = {
  id: SuperSkillClient;
  pinnedRoot(projectRoot: string): string;
  markerPath(projectRoot: string, capabilityId: string): string;
  pluginDoctor(projectRoot: string): ClientDoctorResult;
};

export function clientAdapter(client: SuperSkillClient): ClientAdapter {
  const skillRoot = client === "claude-code" ? ".claude/skills" : ".agents/skills";
  return {
    id: client,
    pinnedRoot: (projectRoot) => path.join(projectRoot, skillRoot),
    markerPath: (projectRoot, capabilityId) => path.join(projectRoot, skillRoot, `superskill-${safeCapabilitySlug(capabilityId)}`, ".superskill-managed.json"),
    pluginDoctor: (projectRoot) => doctorClient(client, projectRoot)
  };
}

export function safeCapabilitySlug(value: string): string {
  if (!CAPABILITY_ID_RE.test(value)) {
    throw new SuperSkillCliError("Capability ID is not a safe managed slug.", 3, "CAPABILITY_NOT_FOUND", "Request a fresh managed capability by ID.");
  }
  return value;
}

export function scanInventory(client: SuperSkillClient, projectRoot: string): InventorySummary & {
  duplicates: string[];
  legacyCodexHarnesses: string[];
} {
  const roots = client === "claude-code"
    ? [path.join(projectRoot, ".claude", "skills")]
    : [...codexProjectSkillRoots(projectRoot), path.join(os.homedir(), ".agents", "skills")];
  const skills: Array<{ name: string; managed?: ManagedPinnedMarker; bytes: number }> = [];
  const seenRoots = new Set<string>();
  for (const root of roots) {
    const resolved = path.resolve(root);
    if (seenRoots.has(resolved) || !existsSync(resolved) || !statSync(resolved).isDirectory()) continue;
    seenRoots.add(resolved);
    for (const entry of readdirSync(resolved, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const dir = path.join(resolved, entry.name);
      const skillFile = path.join(dir, "SKILL.md");
      if (!existsSync(skillFile) || lstatSync(skillFile).isSymbolicLink() || !statSync(skillFile).isFile()) continue;
      let marker: ManagedPinnedMarker | undefined;
      try { marker = readPinnedMarker(path.join(dir, ".superskill-managed.json"), false); } catch { marker = undefined; }
      skills.push({ name: entry.name, managed: marker, bytes: directoryMarkdownBytes(dir) });
    }
  }
  const names = new Map<string, number>();
  for (const skill of skills) names.set(skill.name, (names.get(skill.name) ?? 0) + 1);
  const duplicates = [...names.entries()].filter(([, count]) => count > 1).map(([name]) => name).sort();
  const managed = skills.flatMap((skill) => skill.managed ? [skill.managed] : []);
  const legacyRoot = path.join(projectRoot, ".codex", "harnesses");
  const legacyCodexHarnesses = client === "codex" && existsSync(legacyRoot)
    ? readdirSync(legacyRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(path.join(legacyRoot, entry.name, "AGENTS.md"))).map((entry) => entry.name).sort()
    : [];
  return {
    managedSkills: managed.length,
    unmanagedSkills: skills.length - managed.length,
    approxTokens: Math.round(skills.reduce((sum, skill) => sum + skill.bytes, 0) / 4),
    conflicts: duplicates.length,
    permissionsKnown: skills.every((skill) => Boolean(skill.managed)),
    installedManagedRefs: managed.slice(0, 20).map((marker) => ({ ref: marker.ref, version: marker.version, artifactDigest: marker.artifactDigest })),
    duplicates,
    legacyCodexHarnesses
  };
}

function codexProjectSkillRoots(projectRoot: string): string[] {
  const root = path.resolve(projectRoot);
  const cwd = path.resolve(process.cwd());
  const inside = cwd === root || (!path.relative(root, cwd).startsWith("..") && !path.isAbsolute(path.relative(root, cwd)));
  if (!inside) return [path.join(root, ".agents", "skills")];
  const result: string[] = [];
  let cursor = cwd;
  while (true) {
    result.push(path.join(cursor, ".agents", "skills"));
    if (cursor === root) break;
    cursor = path.dirname(cursor);
  }
  return result;
}

export function readPinnedMarker(file: string, required = true): ManagedPinnedMarker | undefined {
  if (!existsSync(file)) {
    if (!required) return undefined;
    throw new SuperSkillCliError(`Managed marker not found: ${file}`, 4, "ACTIVATION_NOT_FOUND", "Pass the project-relative .superskill-managed.json path.");
  }
  if (lstatSync(file).isSymbolicLink() || !statSync(file).isFile()) {
    throw new SuperSkillCliError("Managed marker is not a regular file.", 3, "MANAGED_FILE_CHANGED", "Do not remove files automatically; inspect the path manually.");
  }
  try {
    const marker = JSON.parse(readFileSync(file, "utf8")) as ManagedPinnedMarker;
    if (marker.schemaVersion !== "superskill.pinned.v1" || !CAPABILITY_ID_RE.test(marker.capabilityId) || marker.activationContractVersion !== SUPERSKILL_RUNTIME.activationContractVersion) throw new Error("invalid marker");
    return marker;
  } catch {
    throw new SuperSkillCliError("Managed marker is invalid or corrupt.", 3, "MANAGED_FILE_CHANGED", "No files were changed; inspect the managed directory manually.");
  }
}

function doctorClient(client: SuperSkillClient, projectRoot: string): ClientDoctorResult {
  const inventory = scanInventory(client, projectRoot);
  const executable = client === "claude-code" ? "claude" : "codex";
  const pluginList = spawnSync(executable, ["plugin", "list"], { encoding: "utf8", timeout: 4_000 });
  const npm = spawnSync("npm", ["--version"], { encoding: "utf8", timeout: 4_000 });
  let exactCli: "resolvable" | "unverified" = "unverified";
  if (npm.status === 0 && process.env.HH_SUPERSKILL_DOCTOR_SKIP_NPM_VIEW !== "1") {
    const exact = spawnSync("npm", ["view", `${SUPERSKILL_RUNTIME.cliPackage}@${SUPERSKILL_RUNTIME.cliVersion}`, "version", "--json"], { encoding: "utf8", timeout: 8_000 });
    if (exact.status === 0 && exact.stdout.includes(SUPERSKILL_RUNTIME.cliVersion)) exactCli = "resolvable";
  }
  const next: string[] = [];
  if (pluginList.status !== 0) next.push(`Install or refresh the SuperSkill plugin for ${client}.`);
  if (inventory.duplicates.length) next.push(`Resolve duplicate skill names: ${inventory.duplicates.join(", ")}.`);
  if (inventory.legacyCodexHarnesses.length) next.push("Legacy .codex/harnesses adapters are unmanaged; create a fresh activation and pin into .agents/skills.");
  if (npm.status !== 0) next.push("Install Node.js/npm; managed activation requires the version-pinned onlyharness CLI.");
  if (exactCli !== "resolvable") next.push(`Could not verify ${SUPERSKILL_RUNTIME.cliPackage}@${SUPERSKILL_RUNTIME.cliVersion}; do not report pinned skills as healthy yet.`);
  return {
    client,
    plugin: pluginList.status === 0 ? "available" : "not_detected",
    managedSkills: inventory.managedSkills,
    unmanagedSkills: inventory.unmanagedSkills,
    duplicates: inventory.duplicates,
    legacyCodexHarnesses: inventory.legacyCodexHarnesses,
    runtime: { node: process.version, npm: npm.status === 0 ? "available" : "missing", exactCli },
    status: next.length ? "attention" : "healthy",
    next
  };
}

function directoryMarkdownBytes(root: string): number {
  let bytes = 0;
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && /\.(?:md|txt)$/i.test(entry.name)) bytes += statSync(file).size;
    }
  };
  try { visit(root); } catch { return bytes; }
  return bytes;
}
