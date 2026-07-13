import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as registry from "../apps/harness-api/src/registry.js";
import { canonicalArtifactDigest } from "@harnesshub/capability-schema/node";
import {
  buildPrivateReviewFixtureFiles,
  assertNoSymlinkDescent,
  assertPrivateReviewPacketBinding,
  canonicalPublicPacketDigest,
  executeCleanupStateMachine,
  inspectReviewFixtureUpdate,
  loadPrivateReviewFixtureForSmoke,
  parseReviewFixtureArgs,
  runReviewFixturePreparation
} from "./prepare-superskill-review-fixture.js";

const root = path.resolve(import.meta.dirname, "..");
const id = "data-quality-sentinel";
const from = "0.2.1";
const to = "0.2.2";
const packetPath = path.join(root, "data/superskill/review-packets", `${id}-${to}.json`);
const privateSnapshotPath = path.join(root, ".onlyharness/private-review-fixtures", id, `${to}.json`);

test("review fixture CLI is dry-run by default and has no approval flag", () => {
  assert.deepEqual(parseReviewFixtureArgs(["--id", id, "--from", from, "--to", to]), {
    id,
    from,
    to,
    write: false,
    cleanup: false
  });
  assert.equal(parseReviewFixtureArgs(["--id", id, "--from", from, "--to", to, "--write"]).write, true);
  assert.throws(() => parseReviewFixtureArgs(["--id", id, "--from", from, "--to", to, "--approve"]), /Unknown/);
  assert.throws(() => parseReviewFixtureArgs(["--id", "../escape", "--from", from, "--to", to]), /canonical/);
  assert.throws(() => parseReviewFixtureArgs(["--id", id, "--from", to, "--to", from]), /greater than/);
  assert.throws(() => parseReviewFixtureArgs(["--id", id, "--from", from, "--to", to, "--cleanup"]), /confirm-digest/);
  assert.throws(() => parseReviewFixtureArgs(["--id", id, "--from", from, "--to", to, "--cleanup", "--confirm-digest", `sha256:${"a".repeat(64)}`]), /cleanup-reason/);
  assert.throws(() => parseReviewFixtureArgs(["--id", id, "--from", from, "--to", to, "--write", "--cleanup", "--confirm-digest", `sha256:${"a".repeat(64)}`, "--cleanup-reason", "abandoned"]), /mutually exclusive/);
  assert.deepEqual(parseReviewFixtureArgs([
    "--id", id,
    "--from", from,
    "--to", to,
    "--cleanup",
    "--confirm-digest", `sha256:${"a".repeat(64)}`,
    "--cleanup-reason", "abandoned"
  ]), {
    id,
    from,
    to,
    write: false,
    cleanup: true,
    confirmDigest: `sha256:${"a".repeat(64)}`,
    cleanupReason: "abandoned"
  });
});

test("path validation rejects a symlink at every descent boundary", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "superskill-private-path-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "superskill-private-outside-"));
  mkdirSync(path.join(workspace, "safe"));
  symlinkSync(outside, path.join(workspace, "safe", "linked"));
  assert.throws(
    () => assertNoSymlinkDescent(workspace, path.join(workspace, "safe", "linked", "fixture.json")),
    /contains a symlink/
  );
  assert.equal(existsSync(path.join(outside, "fixture.json")), false);
  rmSync(workspace, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test("dry-run does not create a missing private fixture or mutate local state", () => {
  const missingVersion = "0.9.9";
  const missing = path.join(root, ".onlyharness/private-review-fixtures", id, `${missingVersion}.json`);
  assert.equal(existsSync(missing), false);
  const stateRoot = path.join(root, ".onlyharness");
  const stateExisted = existsSync(stateRoot);
  const beforeMtime = stateExisted ? statSync(stateRoot).mtimeMs : undefined;
  const result = runReviewFixturePreparation({ id, from, to: missingVersion, write: false, cleanup: false });
  assert.equal(result.state, "not_cut");
  assert.equal(existsSync(missing), false);
  assert.equal(existsSync(stateRoot), stateExisted);
  if (stateExisted) assert.equal(statSync(stateRoot).mtimeMs, beforeMtime);
});

test("data-quality review fixture is one deterministic low-risk artifact-only challenge update", () => {
  const previous = registry.readArchiveSnapshot("harnesses", id, from);
  assert.ok(previous);
  const files = buildPrivateReviewFixtureFiles({
    id,
    from,
    to,
    previousFiles: previous.files,
    challenge: `OHSC_${"A".repeat(43)}`
  });
  const artifactDigest = canonicalArtifactDigest({ files, totalFileCount: files.length, archiveTruncated: false });
  const first = inspectReviewFixtureUpdate({
    resource: { id },
    from,
    to,
    previousFiles: previous.files,
    currentFiles: files,
    artifactDigest
  });
  const second = inspectReviewFixtureUpdate({
    resource: { id },
    from,
    to,
    previousFiles: previous.files,
    currentFiles: files,
    artifactDigest
  });
  assert.deepEqual(first, second);
  assert.equal(first.fileCount, previous.totalFileCount + 1);
  assert.match(first.artifactDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.challengeCommitment, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(first.artifactDigest, previous.artifactDigest);
  assert.notEqual(first.scanner.verdict, "fail");
  assert.notEqual(first.capabilityDiff.status, "fail");
  assert.deepEqual(first.permissions, {
    network: "false",
    networkAllowlist: [],
    filesystem: "readonly",
    shell: false,
    browser: false,
    credentials: "false",
    externalSend: false,
    moneyMovement: false,
    userData: false,
    humanApprovalRequired: ["external_send", "money_movement"]
  });
});

test("public packet digest sorts object keys recursively and preserves array order", () => {
  const first = { z: 1, nested: { b: true, a: ["one", "two"] } };
  const reorderedKeys = { nested: { a: ["one", "two"], b: true }, z: 1 };
  const reorderedArray = { nested: { a: ["two", "one"], b: true }, z: 1 };
  assert.equal(canonicalPublicPacketDigest(first), canonicalPublicPacketDigest(reorderedKeys));
  assert.notEqual(canonicalPublicPacketDigest(first), canonicalPublicPacketDigest(reorderedArray));
});

test("checked-in review packet binds the exact candidate but never publishes challenge or approval", () => {
  const packetText = readFileSync(packetPath, "utf8");
  const packet = JSON.parse(packetText) as Record<string, any>;
  assert.equal(packet.schemaVersion, "superskill.review-packet.v1");
  assert.equal(packet.visibility, "private_candidate");
  assert.equal(packet.state, "private_candidate_pending_human_signoff");
  assert.equal(packet.promotionAuthorized, false);
  assert.equal(packet.approvalCreated, false);
  assert.equal(packet.publicCatalogUnchanged, true);
  assert.deepEqual(packet.authorship, {
    immutable: true,
    author: { actorId: "github-id:149376360", label: "elvismusli" },
    releaseCutter: { actorId: "github-id:149376360", label: "elvismusli" },
    identityScheme: "github_numeric_actor_v1"
  });
  assert.deepEqual(packet.promotionGate, {
    identityScheme: "github_numeric_actor_v1",
    reviewerActorMustDifferFromAuthor: true,
    reviewerActorMustDifferFromReleaseCutter: true,
    blockedUntilNamedHumanSignoff: true
  });
  assert.equal(packet.release.id, id);
  assert.equal(packet.release.version, to);
  assert.equal(packet.release.delivery, "private_review_only");
  assert.equal(packet.privateFixture.status, "pending_human_review");
  assert.match(packet.privateFixture.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(packet.privateFixture.cleanupPolicy, "explicit_digest_confirmed_delete");
  assert.equal(packet.challenge.valueIncluded, false);
  assert.equal(packet.challenge.artifactPath, "runbooks/review-challenge.md");
  assert.match(packet.challenge.commitment, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(packet.requiredClientEvidence.map((row: Record<string, unknown>) => ({
    client: row.client,
    verdict: row.verdict,
    evidenceType: row.evidenceType
  })), [
    { client: "claude-code", verdict: "pass", evidenceType: "bootstrap_transport_only" },
    { client: "codex", verdict: "pass", evidenceType: "bootstrap_transport_only" }
  ]);
  assert.equal(packet.requiredHumanReview.minimumCases, 3);
  assert.equal(packet.requiredHumanReview.reviewerActorMustDifferFromReleaseAuthor, true);
  assert.equal(packet.requiredHumanReview.reviewerIdentityScheme, "github_numeric_actor_v1");
  assert.equal("forbiddenReviewerLabels" in packet.requiredHumanReview, false);
  assert.doesNotMatch(packetText, /OHSC_[A-Za-z0-9_-]{43}/);
  assert.equal(existsSync(path.join(root, "data/harness-versions/harnesses", id, `${to}.json`)), false);

  for (const directory of [
    path.join(root, "plugins/superskill"),
    path.join(root, "docs"),
    path.join(root, "data/superskill/review-packets")
  ]) {
    for (const file of readTreeFiles(directory)) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /OHSC_[A-Za-z0-9_-]{43}/, `Challenge leaked into ${path.relative(root, file)}`);
    }
  }
});

test("local private fixture matches the public-safe commitment when present", { skip: !existsSync(privateSnapshotPath) }, () => {
  const previous = registry.readArchiveSnapshot("harnesses", id, from);
  assert.ok(previous);
  const privateSnapshot = JSON.parse(readFileSync(privateSnapshotPath, "utf8")) as {
    schemaVersion: "superskill.private-review-fixture.v3";
    createdAt: string;
    expiresAt: string;
    visibility: "private_candidate";
    status: "pending_human_review";
    authorship: {
      author: { actorId: string; label: string };
      releaseCutter: { actorId: string; label: string };
    };
    cleanupPolicy: { strategy: "explicit_digest_confirmed_delete"; allowedReasons: Array<"review_complete" | "expired" | "abandoned"> };
    owner: "harnesses";
    repo: string;
    version: string;
    files: Array<{ path: string; content: string; truncated?: boolean }>;
    totalFileCount: number;
    archiveTruncated: false;
    artifactDigest: string;
  };
  assert.equal(statSync(privateSnapshotPath).mode & 0o777, 0o600);
  const inspection = inspectReviewFixtureUpdate({
    resource: { id },
    from,
    to,
    previousFiles: previous.files,
    currentFiles: privateSnapshot.files,
    artifactDigest: privateSnapshot.artifactDigest
  });
  const packet = JSON.parse(readFileSync(packetPath, "utf8")) as Record<string, any>;
  assert.equal(inspection.artifactDigest, packet.release.artifactDigest);
  assert.equal(inspection.challengeCommitment, packet.challenge.commitment);
  const bindingInput = {
    id,
    ref: `harnesses/${id}`,
    version: to,
    snapshot: privateSnapshot,
    inspection,
    packet
  };
  assert.doesNotThrow(() => assertPrivateReviewPacketBinding(bindingInput));
  assert.throws(() => assertPrivateReviewPacketBinding({
    ...bindingInput,
    packet: deepCloneWith(packet, (copy) => { copy.staticEvidence.scanner.status = "pass"; })
  }), /packet binding/);
  assert.throws(() => assertPrivateReviewPacketBinding({
    ...bindingInput,
    packet: deepCloneWith(packet, (copy) => { copy.staticEvidence.capabilityDiff.status = "pass"; })
  }), /packet binding/);
  assert.throws(() => assertPrivateReviewPacketBinding({
    ...bindingInput,
    packet: deepCloneWith(packet, (copy) => { copy.staticEvidence.policy.permissions.shell = true; })
  }), /packet binding/);
  assert.throws(() => loadPrivateReviewFixtureForSmoke({
    id,
    from,
    to,
    expectedDigest: privateSnapshot.artifactDigest,
    now: new Date("2126-01-01T00:00:00.000Z")
  }), /expired/);
});

test("dry-run of an existing private fixture is byte and metadata stable", { skip: !existsSync(privateSnapshotPath) }, () => {
  const packetBefore = readFileSync(packetPath);
  const privateBefore = readFileSync(privateSnapshotPath);
  const privateStatBefore = statSync(privateSnapshotPath);
  const result = runReviewFixturePreparation({ id, from, to, write: false, cleanup: false });
  assert.equal(result.write, false);
  assert.deepEqual(readFileSync(packetPath), packetBefore);
  assert.deepEqual(readFileSync(privateSnapshotPath), privateBefore);
  const privateStatAfter = statSync(privateSnapshotPath);
  assert.equal(privateStatAfter.mode, privateStatBefore.mode);
  assert.equal(privateStatAfter.mtimeMs, privateStatBefore.mtimeMs);
});

test("cleanup journal retries safely after every crash boundary without retaining the challenge", () => {
  const sourcePacket = JSON.parse(readFileSync(packetPath, "utf8")) as Record<string, any>;
  const stages = ["journal_written", "private_deleted", "packet_cleaned"] as const;
  for (const stage of stages) {
    const directory = mkdtempSync(path.join(os.tmpdir(), `superskill-cleanup-${stage}-`));
    const privateFile = path.join(directory, "fixture.json");
    const isolatedPacket = path.join(directory, "packet.json");
    writeFileSync(privateFile, "private fixture placeholder\n", { mode: 0o600 });
    writeFileSync(isolatedPacket, `${JSON.stringify(sourcePacket, null, 2)}\n`, { mode: 0o644 });
    const input = {
      id,
      version: to,
      artifactDigest: sourcePacket.release.artifactDigest,
      challengeCommitment: sourcePacket.challenge.commitment,
      authorship: {
        author: sourcePacket.authorship.author,
        releaseCutter: sourcePacket.authorship.releaseCutter
      },
      cleanupReason: "abandoned" as const,
      privateFile,
      packetPath: isolatedPacket,
      now: new Date("2026-07-14T00:00:00.000Z")
    };
    assert.throws(() => executeCleanupStateMachine({ ...input, faultAfter: stage }), new RegExp(stage));
    const journalFile = `${privateFile}.cleanup-journal.json`;
    assert.equal(existsSync(journalFile), true);
    assert.equal(statSync(journalFile).mode & 0o777, 0o600);
    const journalText = readFileSync(journalFile, "utf8");
    assert.doesNotMatch(journalText, /OHSC_[A-Za-z0-9_-]{43}/);
    assert.equal(JSON.parse(journalText).originalPacketDigest, canonicalPublicPacketDigest(sourcePacket));
    assert.equal(existsSync(privateFile), stage === "journal_written");
    const packetAfterFault = JSON.parse(readFileSync(isolatedPacket, "utf8")) as Record<string, any>;
    assert.equal(packetAfterFault.state, stage === "packet_cleaned"
      ? "private_candidate_artifact_cleaned"
      : "private_candidate_pending_human_signoff");

    if (stage === "private_deleted") {
      const tamperedPacket = deepCloneWith(packetAfterFault, (copy) => {
        copy.staticEvidence.policy.permissions.shell = true;
      });
      writeFileSync(isolatedPacket, `${JSON.stringify(tamperedPacket, null, 2)}\n`);
      assert.throws(() => executeCleanupStateMachine(input), /journal does not match|original public packet digest/);
      assert.equal(existsSync(privateFile), false);
      assert.equal(existsSync(journalFile), true);
      writeFileSync(isolatedPacket, `${JSON.stringify(sourcePacket, null, 2)}\n`);
    }

    const recovered = executeCleanupStateMachine(input);
    assert.equal(recovered.status, "cleaned");
    assert.equal(recovered.resumed, true);
    assert.equal(existsSync(privateFile), false);
    assert.equal(existsSync(journalFile), false);
    const cleanedPacket = JSON.parse(readFileSync(isolatedPacket, "utf8")) as Record<string, any>;
    assert.equal(cleanedPacket.state, "private_candidate_artifact_cleaned");
    assert.equal(cleanedPacket.privateFixture.cleanupReason, "abandoned");
    assert.equal(cleanedPacket.privateFixture.originalPacketDigest, canonicalPublicPacketDigest(sourcePacket));
    assert.equal(cleanedPacket.promotionAuthorized, false);
    assert.doesNotMatch(readFileSync(isolatedPacket, "utf8"), /OHSC_[A-Za-z0-9_-]{43}/);

    const idempotent = executeCleanupStateMachine(input);
    assert.equal(idempotent.status, "cleaned");
    assert.equal(idempotent.resumed, true);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cleanup journal tampering fails closed before private deletion", () => {
  const sourcePacket = JSON.parse(readFileSync(packetPath, "utf8")) as Record<string, any>;
  const directory = mkdtempSync(path.join(os.tmpdir(), "superskill-cleanup-tamper-"));
  const privateFile = path.join(directory, "fixture.json");
  const isolatedPacket = path.join(directory, "packet.json");
  writeFileSync(privateFile, "private fixture placeholder\n", { mode: 0o600 });
  writeFileSync(isolatedPacket, `${JSON.stringify(sourcePacket, null, 2)}\n`, { mode: 0o644 });
  const input = {
    id,
    version: to,
    artifactDigest: sourcePacket.release.artifactDigest,
    challengeCommitment: sourcePacket.challenge.commitment,
    authorship: {
      author: sourcePacket.authorship.author,
      releaseCutter: sourcePacket.authorship.releaseCutter
    },
    cleanupReason: "abandoned" as const,
    privateFile,
    packetPath: isolatedPacket,
    now: new Date("2026-07-14T00:00:00.000Z")
  };
  assert.throws(() => executeCleanupStateMachine({ ...input, faultAfter: "journal_written" }), /journal_written/);
  const journalFile = `${privateFile}.cleanup-journal.json`;
  const journal = JSON.parse(readFileSync(journalFile, "utf8")) as Record<string, any>;
  journal.artifactDigest = `sha256:${"b".repeat(64)}`;
  writeFileSync(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
  assert.throws(() => executeCleanupStateMachine(input), /journal does not match/);
  assert.equal(existsSync(privateFile), true);
  assert.equal(JSON.parse(readFileSync(isolatedPacket, "utf8")).state, "private_candidate_pending_human_signoff");
  rmSync(directory, { recursive: true, force: true });
});

test("current catalog remains candidate-only after review fixture preparation", () => {
  const curated = JSON.parse(readFileSync(path.join(root, "data/superskill/curated.json"), "utf8")) as {
    resources: Array<{ id: string; version: string; status: string; reviewFile?: string }>;
  };
  const index = JSON.parse(readFileSync(path.join(root, "data/superskill/index.json"), "utf8")) as {
    capabilities: Array<{ id: string; release: { version: string }; trust: { status: string } }>;
  };
  const curatedFixture = curated.resources.find((resource) => resource.id === id);
  const indexedFixture = index.capabilities.find((capability) => capability.id === id);
  assert.deepEqual(curatedFixture && {
    version: curatedFixture.version,
    status: curatedFixture.status,
    reviewFile: curatedFixture.reviewFile
  }, { version: from, status: "candidate", reviewFile: undefined });
  assert.deepEqual(indexedFixture && {
    version: indexedFixture.release.version,
    status: indexedFixture.trust.status
  }, { version: from, status: "candidate" });
  assert.equal(curated.resources.filter((resource) => resource.status === "approved").length, 0);
  assert.equal(index.capabilities.filter((capability) => capability.trust.status === "approved").length, 0);
  const history = JSON.parse(readFileSync(path.join(root, "data/superskill/history.json"), "utf8")) as {
    capabilities: Array<{ id: string; release: { version: string } }>;
  };
  assert.equal(history.capabilities.some((capability) => capability.id === id && capability.release.version === to), false);
});

function readTreeFiles(directory: string): string[] {
  const result: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) result.push(full);
    }
  };
  visit(directory);
  return result;
}

function deepCloneWith<T>(value: T, mutate: (copy: any) => void): T {
  const copy = JSON.parse(JSON.stringify(value)) as T;
  mutate(copy);
  return copy;
}
