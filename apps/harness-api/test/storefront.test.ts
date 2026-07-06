import test from "node:test";
import assert from "node:assert/strict";
import { cleanReferralCode, normalizeHandle } from "../src/storefront.ts";

test("normalizeHandle accepts public-safe creator handles", () => {
  assert.equal(normalizeHandle("@Smoke-Creator"), "smoke-creator");
  assert.equal(normalizeHandle("founder42"), "founder42");
});

test("normalizeHandle rejects ambiguous or unsafe handles", () => {
  assert.equal(normalizeHandle("ab"), undefined);
  assert.equal(normalizeHandle("creator_1"), undefined);
  assert.equal(normalizeHandle("creator-"), undefined);
  assert.equal(normalizeHandle("creator@example.com"), undefined);
});

test("cleanReferralCode allows only compact attribution codes", () => {
  assert.equal(cleanReferralCode(" ref_creator-1 "), "ref_creator-1");
  assert.equal(cleanReferralCode("bad code"), undefined);
  assert.equal(cleanReferralCode("../secret"), undefined);
});
