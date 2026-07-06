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

test("sanitizeEvent rejects unknown verification event kinds", () => {
  assert.equal(sanitizeEvent({ kind: "verify", owner: "harnesses", repo: "demo" }), undefined);
});
