import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digestSchema, revocationTombstoneSchema, type RevocationTombstone } from "@harnesshub/capability-schema/browser";

export type RevokeInput = {
  path: string;
  digest: string;
  capabilityId: string;
  ref: string;
  version: string;
  reason: string;
  actor: string;
  replacement?: RevocationTombstone["replacement"];
  apply: boolean;
  now?: Date;
};

export function revokeDigest(input: RevokeInput): { appended: boolean; tombstone: RevocationTombstone } {
  if (!digestSchema.safeParse(input.digest).success) throw new Error("Invalid sha256 digest");
  const reasonCode = input.reason.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  const eventId = `rev_${createHash("sha256").update(`${input.digest}\0${reasonCode}\0${input.actor}`).digest("hex").slice(0, 24)}`;
  const tombstone = revocationTombstoneSchema.parse({
    schemaVersion: "superskill.revoke.v1",
    eventId,
    artifactDigest: input.digest,
    aliases: [{ capabilityId: input.capabilityId, ref: input.ref, version: input.version }],
    reasonCode,
    actorLabel: input.actor,
    revokedAt: (input.now ?? new Date()).toISOString(),
    ...(input.replacement ? { replacement: input.replacement } : {})
  });
  const existing = readTombstones(input.path);
  for (const row of existing) {
    if (row.eventId === eventId && row.artifactDigest !== input.digest) throw new Error(`Revocation event ${eventId} conflicts with another digest`);
    if (row.artifactDigest === input.digest && row.aliases.some((alias) => alias.capabilityId === input.capabilityId && alias.ref === input.ref && alias.version === input.version)) {
      return { appended: false, tombstone: row };
    }
  }
  if (!input.apply) return { appended: false, tombstone };

  const lockPath = `${input.path}.lock`;
  let lock: number | undefined;
  try {
    lock = acquireRevokeLock(lockPath);
    const afterLock = readTombstones(input.path);
    if (afterLock.some((row) => row.artifactDigest === input.digest && row.aliases.some((alias) => alias.capabilityId === input.capabilityId && alias.ref === input.ref && alias.version === input.version))) {
      return { appended: false, tombstone };
    }
    const file = openSync(input.path, "a", 0o600);
    try {
      writeSync(file, `${JSON.stringify(tombstone)}\n`);
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    const directory = openSync(path.dirname(input.path), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
    readTombstones(input.path);
    return { appended: true, tombstone };
  } finally {
    if (lock !== undefined) {
      closeSync(lock);
      if (existsSync(lockPath)) unlinkSync(lockPath);
    }
  }
}

function acquireRevokeLock(lockPath: string): number {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      Atomics.wait(sleeper, 0, 0, 10);
    }
  }
  throw new Error(`Revoke store is busy: ${lockPath}`);
}

function readTombstones(file: string): RevocationTombstone[] {
  if (!existsSync(file)) return [];
  const result: RevocationTombstone[] = [];
  const eventDigests = new Map<string, string>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = revocationTombstoneSchema.parse(JSON.parse(line));
    const existing = eventDigests.get(row.eventId);
    if (existing && existing !== row.artifactDigest) throw new Error(`Revocation event ${row.eventId} conflicts with another digest`);
    eventDigests.set(row.eventId, row.artifactDigest);
    result.push(row);
  }
  return result;
}

function parseArgs(argv: string[]): RevokeInput {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const digest = value("--digest");
  const capabilityId = value("--capability");
  const ref = value("--ref");
  const version = value("--version");
  const reason = value("--reason");
  const actor = value("--actor");
  if (!digest || !capabilityId || !ref || !version || !reason || !actor) throw new Error("Required: --digest --capability --ref --version --reason --actor");
  const apply = argv.includes("--apply");
  if (apply === argv.includes("--dry-run")) throw new Error("Choose exactly one of --dry-run or --apply");
  const replacementRaw = value("--replacement");
  const replacementMatch = replacementRaw?.match(/^([^@]+)@([^#]+)#(sha256:[a-f0-9]{64})$/);
  if (replacementRaw && !replacementMatch) throw new Error("Replacement must be ref@version#sha256:digest");
  return {
    path: path.resolve(process.env.SUPERSKILL_REVOCATIONS_PATH ?? "data/superskill/revocations.jsonl"),
    digest,
    capabilityId,
    ref,
    version,
    reason,
    actor,
    ...(replacementMatch ? { replacement: { ref: replacementMatch[1], version: replacementMatch[2], artifactDigest: replacementMatch[3] } } : {}),
    apply
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = revokeDigest(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify({ mode: process.argv.includes("--apply") ? "apply" : "dry-run", ...result }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
