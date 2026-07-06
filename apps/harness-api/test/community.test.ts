import test from "node:test";
import assert from "node:assert/strict";
import { createCommunityInviteCode, verifyCommunityInviteCode } from "../src/community.ts";

const secret = "community-secret-for-tests-32-bytes";
const nowMs = Date.parse("2026-07-06T00:00:00Z");

test("community invite codes round-trip signed payloads", () => {
  const created = createCommunityInviteCode({
    subject: { type: "user", id: "user-1" },
    owner: "local",
    repo: "paid-harness",
    version: "0.1.0",
    ttlSeconds: 120,
    secret,
    nowMs
  });

  assert.equal(created.ok, true);
  const verified = verifyCommunityInviteCode({ code: created.code, secret, nowMs: nowMs + 10_000 });
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.payload.subject, { type: "user", id: "user-1" });
  assert.equal(verified.payload.owner, "local");
  assert.equal(verified.payload.repo, "paid-harness");
  assert.equal(verified.payload.version, "0.1.0");
});

test("community invite verification rejects tampered signatures and expired codes", () => {
  const created = createCommunityInviteCode({
    subject: { type: "wallet", id: "0xabc" },
    owner: "harnesses",
    repo: "deep-market-researcher",
    version: "0.1.0",
    ttlSeconds: 60,
    secret,
    nowMs
  });
  assert.equal(created.ok, true);

  const tampered = tamperLastChar(created.code);
  assert.deepEqual(verifyCommunityInviteCode({ code: tampered, secret, nowMs: nowMs + 1_000 }), {
    ok: false,
    status: 400,
    error: "Invalid community code"
  });

  assert.deepEqual(verifyCommunityInviteCode({ code: created.code, secret, nowMs: nowMs + 61_000 }), {
    ok: false,
    status: 410,
    error: "Community code expired"
  });
});

function tamperLastChar(value: string): string {
  const replacement = value.endsWith("x") ? "y" : "x";
  return `${value.slice(0, -1)}${replacement}`;
}

test("community invite creation requires a strong secret", () => {
  assert.deepEqual(createCommunityInviteCode({
    subject: { type: "user", id: "user-1" },
    owner: "local",
    repo: "paid-harness",
    version: "0.1.0",
    secret: "short",
    nowMs
  }), {
    ok: false,
    error: "COMMUNITY_INVITE_SECRET must be at least 24 characters"
  });
});
