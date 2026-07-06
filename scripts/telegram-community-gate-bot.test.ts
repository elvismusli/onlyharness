import test from "node:test";
import assert from "node:assert/strict";
import { parseGateCode, verifyCommunityCode } from "./telegram-community-gate-bot.ts";

test("parseGateCode accepts start/check commands and raw codes", () => {
  assert.equal(parseGateCode("/start ohc_payload.signature"), "ohc_payload.signature");
  assert.equal(parseGateCode("/check@OnlyHarnessBot ohc_payload.signature"), "ohc_payload.signature");
  assert.equal(parseGateCode("ohc_payload.signature"), "ohc_payload.signature");
  assert.equal(parseGateCode("/start"), undefined);
});

test("verifyCommunityCode posts to the API with an org token", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    assert.equal(url, "http://127.0.0.1:8799/community/verify-code");
    assert.equal(init?.method, "POST");
    assert.deepEqual(init?.headers, {
      "Content-Type": "application/json",
      Authorization: "Bearer org-token"
    });
    assert.equal(init?.body, JSON.stringify({ code: "ohc_payload.signature" }));
    return new Response(JSON.stringify({ ok: true, allowed: true, owner: "local", repo: "paid", version: "0.1.0" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;
  try {
    const result = await verifyCommunityCode({
      apiBase: "http://127.0.0.1:8799/",
      orgToken: "org-token",
      code: "ohc_payload.signature"
    });
    assert.deepEqual(result, { ok: true, allowed: true, owner: "local", repo: "paid", version: "0.1.0" });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
