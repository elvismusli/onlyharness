import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import type { ActivationPlan, ActivationRecord, ManagedEvent } from "./superskill-types.js";
import { SuperSkillCliError } from "./superskill-types.js";

export type ProjectState = { projectRoot: string; stateRoot: string };

export function resolveProjectState(projectDir?: string): ProjectState {
  const explicit = projectDir ? path.resolve(projectDir) : undefined;
  let root = explicit;
  if (!root) {
    try {
      root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      root = process.cwd();
    }
  }
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new SuperSkillCliError(`Project directory does not exist: ${root}`, 3, "PROJECT_ROOT_INVALID", "Pass an existing directory with --project-dir.");
  }
  const projectRoot = realpathSync(root);
  const override = process.env.ONLYHARNESS_STATE_DIR;
  const requestedStateRoot = override ? path.resolve(override) : path.join(projectRoot, ".onlyharness");
  if (!override && path.relative(projectRoot, requestedStateRoot).startsWith("..")) {
    throw new SuperSkillCliError("State directory resolves outside the project.", 3, "PROJECT_ROOT_INVALID", "Use a project-local .onlyharness directory.");
  }
  let stateRoot: string;
  if (override) {
    stateRoot = canonicalizeExplicitStateRoot(requestedStateRoot);
  } else {
    assertSafePathUnder(projectRoot, requestedStateRoot, "state root");
    if (!existsSync(requestedStateRoot)) mkdirSync(requestedStateRoot, { recursive: false, mode: 0o700 });
    assertSafePathUnder(projectRoot, requestedStateRoot, "state root");
    stateRoot = requestedStateRoot;
  }
  assertCanonicalDirectory(stateRoot, "state root");
  for (const dir of ["activations", "activation-plans", "removals", "cache", "cache/sha256", "staging", "locks"]) {
    const target = path.join(stateRoot, dir);
    assertSafePathUnder(stateRoot, target, "state directory");
    if (!existsSync(target)) mkdirSync(target, { recursive: false, mode: 0o700 });
    assertSafePathUnder(stateRoot, target, "state directory");
    assertCanonicalDirectory(target, "state directory");
  }
  if (!override) ensureLocalGitExclude(projectRoot);
  return { projectRoot, stateRoot };
}

export function ensureLocalGitExclude(projectRoot: string): void {
  let excludeFile: string;
  try {
    const raw = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    excludeFile = path.isAbsolute(raw) ? raw : path.resolve(projectRoot, raw);
  } catch {
    return;
  }
  mkdirSync(path.dirname(excludeFile), { recursive: true });
  const current = existsSync(excludeFile) ? readFileSync(excludeFile, "utf8") : "";
  if (current.split(/\r?\n/).includes(".onlyharness/")) return;
  writeFileSync(excludeFile, `${current}${current && !current.endsWith("\n") ? "\n" : ""}.onlyharness/\n`);
}

export function activationFile(state: ProjectState, activationId: string): string {
  return path.join(state.stateRoot, "activations", `${activationId}.json`);
}

export function readActivation(state: ProjectState, activationId: string): ActivationRecord {
  const file = activationFile(state, activationId);
  assertSafeStatePath(state, file);
  if (!existsSync(file)) {
    throw new SuperSkillCliError(`Activation not found: ${activationId}.`, 4, "ACTIVATION_NOT_FOUND", "Run hh activation doctor --json to inspect local managed state.");
  }
  try {
    const record = JSON.parse(readFileSync(file, "utf8")) as ActivationRecord;
    if (record.schemaVersion !== "superskill.activation.v1" || record.activationId !== activationId || record.projectRoot !== state.projectRoot) throw new Error("record mismatch");
    return record;
  } catch {
    throw new SuperSkillCliError(`Activation state is corrupt: ${activationId}.`, 3, "ACTIVATION_STATE_CORRUPT", "Do not delete managed files; inspect .onlyharness/activations manually.");
  }
}

export function listActivations(state: ProjectState): ActivationRecord[] {
  const root = path.join(state.stateRoot, "activations");
  assertSafeStatePath(state, root);
  return readdirSync(root).filter((name) => name.endsWith(".json")).sort().flatMap((name) => {
    try {
      const record = JSON.parse(readFileSync(path.join(root, name), "utf8")) as ActivationRecord;
      return record.schemaVersion === "superskill.activation.v1" && record.projectRoot === state.projectRoot ? [record] : [];
    } catch {
      return [];
    }
  });
}

export function findActivationByRequest(state: ProjectState, requestId: string): ActivationRecord | undefined {
  return listActivations(state).find((record) => record.activationRequestId === requestId);
}

export function writeActivation(state: ProjectState, record: ActivationRecord): void {
  record.updatedAt = new Date().toISOString();
  atomicJson(activationFile(state, record.activationId), record, state.stateRoot);
}

export function writeActivationPlan(state: ProjectState, activationId: string, plan: ActivationPlan): void {
  atomicJson(path.join(state.stateRoot, "activation-plans", `${activationId}.json`), { schemaVersion: "superskill.activation-plan.v1", activationId, plan }, state.stateRoot);
}

export function readActivationPlan(state: ProjectState, activationId: string): ActivationPlan {
  assertSafeStatePath(state, path.join(state.stateRoot, "activation-plans", `${activationId}.json`));
  try {
    const payload = JSON.parse(readFileSync(path.join(state.stateRoot, "activation-plans", `${activationId}.json`), "utf8")) as { schemaVersion?: string; activationId?: string; plan?: ActivationPlan };
    if (payload.schemaVersion !== "superskill.activation-plan.v1" || payload.activationId !== activationId || !payload.plan) throw new Error("invalid plan");
    return payload.plan;
  } catch {
    throw new SuperSkillCliError("Activation plan is missing or corrupt.", 3, "ACTIVATION_STATE_CORRUPT", "Do not load arbitrary cache files; retry the same activation request or inspect local state.");
  }
}

export function writeRemovalIntent(state: ProjectState, input: { markerPath: string; activationId: string }): void {
  atomicJson(removalIntentFile(state, input.markerPath), { schemaVersion: "superskill.removal-intent.v1", ...input, startedAt: new Date().toISOString() }, state.stateRoot);
}

export function readRemovalIntent(state: ProjectState, markerPath: string): { markerPath: string; activationId: string } | undefined {
  const file = removalIntentFile(state, markerPath);
  assertSafeStatePath(state, file);
  if (!existsSync(file)) return undefined;
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as { schemaVersion?: string; markerPath?: string; activationId?: string };
    return value.schemaVersion === "superskill.removal-intent.v1" && value.markerPath === markerPath && typeof value.activationId === "string" ? { markerPath, activationId: value.activationId } : undefined;
  } catch {
    return undefined;
  }
}

export function clearRemovalIntent(state: ProjectState, markerPath: string): void {
  const file = removalIntentFile(state, markerPath);
  assertSafeStatePath(state, file);
  rmSync(file, { force: true });
}

function removalIntentFile(state: ProjectState, markerPath: string): string {
  const key = createHash("sha256").update(markerPath).digest("hex");
  return path.join(state.stateRoot, "removals", `${key}.json`);
}

export async function withProjectLock<T>(state: ProjectState, name: string, work: () => Promise<T>): Promise<T> {
  const lock = path.join(state.stateRoot, "locks", `${name}.lock`);
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      assertSafeStatePath(state, lock);
      mkdirSync(lock);
      assertSafeStatePath(state, lock);
      try {
        return await work();
      } finally {
        rmSync(lock, { recursive: true, force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (attempt === 149) throw new SuperSkillCliError("Another managed operation is still running.", 1, "ACTIVATION_BUSY", "Retry the same activation request ID.");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new SuperSkillCliError("Could not acquire activation lock.", 1, "ACTIVATION_BUSY", "Retry the same activation request ID.");
}

export function atomicJson(file: string, value: unknown, boundary?: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  if (boundary) assertSafePathUnder(boundary, file, "managed state file");
  const temp = `${file}.tmp-${process.pid}-${randomBytes(5).toString("hex")}`;
  if (boundary) assertSafePathUnder(boundary, temp, "managed state temp file");
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (boundary) {
    assertSafePathUnder(boundary, file, "managed state file");
    assertSafePathUnder(boundary, temp, "managed state temp file");
  }
  renameSync(temp, file);
  if (boundary) assertSafePathUnder(boundary, file, "managed state file");
  try {
    const dir = openSync(path.dirname(file), "r");
    fsyncSync(dir);
    closeSync(dir);
  } catch {
    // Directory fsync is unavailable on some supported filesystems.
  }
}

export function queueEvent(state: ProjectState, event: ManagedEvent): void {
  const file = path.join(state.stateRoot, "events-pending.jsonl");
  assertSafeStatePath(state, file);
  const current = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean) : [];
  const deduped = current.filter((line) => {
    try { return (JSON.parse(line) as { eventId?: string }).eventId !== event.eventId; } catch { return false; }
  });
  deduped.push(JSON.stringify(event));
  writeFileSync(file, `${deduped.slice(-200).join("\n")}\n`, { mode: 0o600 });
  assertSafeStatePath(state, file);
}

export function pendingEvents(state: ProjectState): ManagedEvent[] {
  const file = path.join(state.stateRoot, "events-pending.jsonl");
  assertSafeStatePath(state, file);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as ManagedEvent]; } catch { return []; }
  });
}

export function replacePendingEvents(state: ProjectState, events: ManagedEvent[]): void {
  const file = path.join(state.stateRoot, "events-pending.jsonl");
  assertSafeStatePath(state, file);
  writeFileSync(file, events.length ? `${events.map((event) => JSON.stringify(event)).join("\n")}\n` : "", { mode: 0o600 });
  assertSafeStatePath(state, file);
}

export function assertSafeStatePath(state: ProjectState, target: string): void {
  assertCanonicalDirectory(state.stateRoot, "state root");
  assertSafePathUnder(state.stateRoot, target, "managed state path");
}

export function assertSafePathUnder(boundary: string, target: string, label = "managed path"): void {
  const resolvedBoundary = path.resolve(boundary);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedBoundary, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw unsafeManagedPath(`${label} escapes its root`);
  let cursor = resolvedBoundary;
  if (existsSync(cursor)) assertNotSymlink(cursor, label);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!existsSync(cursor)) continue;
    assertNotSymlink(cursor, label);
    const real = realpathSync(cursor);
    const realRelative = path.relative(resolvedBoundary, real);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) throw unsafeManagedPath(`${label} resolves outside its root`);
  }
}

function canonicalizeExplicitStateRoot(requested: string): string {
  if (existsSync(requested)) {
    assertNotSymlink(requested, "state root");
    if (!lstatSync(requested).isDirectory()) throw unsafeManagedPath("state root is not a directory");
    return realpathSync(requested);
  }
  const missing: string[] = [];
  let ancestor = requested;
  while (!existsSync(ancestor)) {
    missing.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw unsafeManagedPath("state root has no existing ancestor");
    ancestor = parent;
  }
  assertNotSymlink(ancestor, "state root ancestor");
  const canonical = path.join(realpathSync(ancestor), ...missing);
  mkdirSync(canonical, { recursive: true, mode: 0o700 });
  assertCanonicalDirectory(canonical, "state root");
  return canonical;
}

function assertCanonicalDirectory(directory: string, label: string): void {
  if (!existsSync(directory)) throw unsafeManagedPath(`${label} is missing`);
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafeManagedPath(`${label} is not a regular directory`);
  if (realpathSync(directory) !== path.resolve(directory)) throw unsafeManagedPath(`${label} is not canonical`);
}

function assertNotSymlink(value: string, label: string): void {
  if (lstatSync(value).isSymbolicLink()) throw unsafeManagedPath(`${label} contains a symlink component`);
}

function unsafeManagedPath(message: string): SuperSkillCliError {
  return new SuperSkillCliError(message, 3, "MANAGED_FILE_CHANGED", "No managed files were changed. Replace the symlink with a real directory and retry.");
}
