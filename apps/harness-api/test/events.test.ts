import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordManagedEvent, sanitizeEvent } from "../src/events.ts";

test("sanitizeEvent accepts eval and gate verification events without arbitrary metadata", () => {
  const event = sanitizeEvent({
    kind: "eval",
    owner: "@acme",
    repo: "deep-market-researcher",
    version: "0.1.0",
    subject: "user:local-dev",
    target: "passed",
    client: "hh",
    path: "/tmp/must-not-store"
  } as Parameters<typeof sanitizeEvent>[0] & { path: string });

  assert.deepEqual(event, {
    kind: "eval",
    owner: "@acme",
    repo: "deep-market-researcher",
    version: "0.1.0",
    subject: "user:local-dev",
    target: "passed",
    client: "hh"
  });
});

test("sanitizeEvent accepts suggested, accepted and applied CLI events without local paths", () => {
  const suggested = sanitizeEvent({
    kind: "suggested",
    owner: "harnesses",
    repo: "deep-market-researcher",
    version: "0.2.0",
    target: "inspect",
    client: "hh",
    prompt: "must-not-store"
  } as Parameters<typeof sanitizeEvent>[0] & { prompt: string });
  const accepted = sanitizeEvent({
    kind: "accepted",
    owner: "harnesses",
    repo: "deep-market-researcher",
    version: "0.2.0",
    target: "apply",
    client: "hh",
    prompt: "must-not-store"
  } as Parameters<typeof sanitizeEvent>[0] & { prompt: string });
  const applied = sanitizeEvent({
    kind: "applied",
    owner: "harnesses",
    repo: "deep-market-researcher",
    version: "0.2.0",
    target: "scoped-install",
    client: "hh",
    path: "/tmp/must-not-store"
  } as Parameters<typeof sanitizeEvent>[0] & { path: string });

  assert.deepEqual(suggested, {
    kind: "suggested",
    owner: "harnesses",
    repo: "deep-market-researcher",
    version: "0.2.0",
    subject: "anonymous",
    target: "inspect",
    client: "hh"
  });
  assert.deepEqual(accepted, {
    kind: "accepted",
    owner: "harnesses",
    repo: "deep-market-researcher",
    version: "0.2.0",
    subject: "anonymous",
    target: "apply",
    client: "hh"
  });
  assert.deepEqual(applied, {
    kind: "applied",
    owner: "harnesses",
    repo: "deep-market-researcher",
    version: "0.2.0",
    subject: "anonymous",
    target: "scoped-install",
    client: "hh"
  });
});

test("sanitizeEvent accepts escrow transition events without receipt bodies", () => {
  const event = sanitizeEvent({
    kind: "escrow_captured",
    owner: "local",
    repo: "escrow-harness",
    version: "0.1.0",
    subject: "user:local-dev",
    target: "receipt:passed",
    client: "api",
    receipt: { signature: "must-not-store" }
  } as Parameters<typeof sanitizeEvent>[0] & { receipt: { signature: string } });

  assert.deepEqual(event, {
    kind: "escrow_captured",
    owner: "local",
    repo: "escrow-harness",
    version: "0.1.0",
    subject: "user:local-dev",
    target: "receipt:passed",
    client: "api"
  });
});

test("sanitizeEvent rejects unknown verification event kinds", () => {
  assert.equal(sanitizeEvent({ kind: "verify", owner: "harnesses", repo: "demo" }), undefined);
});

test("sanitizeEvent accepts only strict content-free managed lifecycle fields", () => {
  const event = sanitizeEvent({
    kind: "outcome_reported",
    eventId: "evt_abcdef12",
    recommendationId: "rec_abcdef12",
    activationId: "act_abcdef12",
    owner: "harnesses",
    repo: "deep-market-researcher",
    version: "0.2.0",
    subject: "pilot:abcdef12",
    target: "codex",
    client: "superskill-codex",
    mode: "temporary",
    evidence: "agent_reported",
    outcome: "success",
    reasonCode: "COMPLETED",
    task: "must-not-store",
    path: "/must-not-store",
    token: "must-not-store"
  } as Parameters<typeof sanitizeEvent>[0] & { task: string; path: string; token: string });
  assert.deepEqual(event, {
    kind: "outcome_reported",
    owner: "harnesses",
    repo: "deep-market-researcher",
    version: "0.2.0",
    subject: "pilot:abcdef12",
    target: "codex",
    client: "superskill-codex",
    eventId: "evt_abcdef12",
    recommendationId: "rec_abcdef12",
    activationId: "act_abcdef12",
    mode: "temporary",
    evidence: "agent_reported",
    outcome: "success",
    reasonCode: "COMPLETED"
  });
  assert.equal(sanitizeEvent({ kind: "activation_ready", eventId: "bad", client: "superskill-codex" }), undefined);
  assert.equal(sanitizeEvent({ kind: "activation_ready", eventId: "evt_abcdef12", client: "browser" }), undefined);
});

test("managed event sanitizer rejects malformed optional correlation fields", () => {
  const base = { kind: "activation_ready", eventId: "evt_abcdef12", client: "superskill-codex" };
  assert.equal(sanitizeEvent({ ...base, recommendationId: "wrong_abcdef12" }), undefined);
  assert.equal(sanitizeEvent({ ...base, activationId: "act bad" }), undefined);
  assert.equal(sanitizeEvent({ ...base, reasonCode: "lowercase" }), undefined);
  assert.equal(sanitizeEvent({ ...base, recommendationId: "" }), undefined);
  assert.equal(sanitizeEvent({ ...base, mode: "" }), undefined);
});

test("managed local event writer is idempotent by event id", async () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "superskill-events-")), "events.jsonl");
  const input = {
    kind: "activation_ready",
    eventId: "evt_abcdef12",
    activationId: "act_abcdef12",
    subject: "pilot:abcdef12",
    client: "superskill-codex"
  };
  assert.deepEqual(await recordManagedEvent(input, { localPath: file }), { recorded: true, duplicate: false });
  assert.deepEqual(await recordManagedEvent(input, { localPath: file }), { recorded: false, duplicate: true });
  assert.equal(readFileSync(file, "utf8").trim().split("\n").length, 1);
});

test("managed local event writer rejects event id replay with a different subject or payload", async () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "superskill-events-conflict-")), "events.jsonl");
  const input = {
    kind: "activation_ready",
    eventId: "evt_abcdef12",
    activationId: "act_abcdef12",
    subject: "user:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    client: "superskill-codex"
  };
  assert.deepEqual(await recordManagedEvent(input, { localPath: file }), { recorded: true, duplicate: false });
  assert.deepEqual(
    await recordManagedEvent({ ...input, subject: "user:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, { localPath: file }),
    { recorded: false, duplicate: false, conflict: true }
  );
  assert.deepEqual(
    await recordManagedEvent({ ...input, kind: "activation_loaded" }, { localPath: file }),
    { recorded: false, duplicate: false, conflict: true }
  );
  assert.equal(readFileSync(file, "utf8").trim().split("\n").length, 1);
});

test("managed telemetry off writes nothing", async () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "superskill-events-off-")), "events.jsonl");
  const result = await recordManagedEvent({ kind: "recommended", eventId: "evt_abcdef12", subject: "pilot:abcdef12", client: "hh" }, { localPath: file, telemetryEnabled: false });
  assert.deepEqual(result, { recorded: false, duplicate: false });
});
