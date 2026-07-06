import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeEvent } from "../src/events.ts";

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
