import assert from "node:assert/strict";
import test from "node:test";

import { DeviceAuthCliError, loginWithDeviceFlow } from "../src/commands/auth.js";

const deviceCode = `ohdc_${"a".repeat(43)}`;
const accessToken = `ohdt_${"b".repeat(120)}.${"c".repeat(43)}`;

test("auth login --shell keeps secrets out of URLs and stderr and emits one ephemeral export", async () => {
  const requests: Array<{ url: string; body?: string }> = [];
  const responses = [
    jsonResponse(201, {
      device_code: deviceCode,
      user_code: "ABCD-2345",
      verification_uri: "https://superskill.sh/#/superskill/account",
      expires_in: 600,
      interval: 3
    }),
    jsonResponse(202, { error: "Waiting", code: "AUTHORIZATION_PENDING", retry_after: 3 }),
    jsonResponse(200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 1_799,
      scope: "superskill:managed"
    })
  ];
  let stdout = "";
  let stderr = "";
  const sleeps: number[] = [];
  const result = await loginWithDeviceFlow({
    registryUrl: "https://superskill.sh/api",
    shell: true,
    client: "codex",
    io: {
      stdout: (value) => { stdout += value; },
      stderr: (value) => { stderr += value; },
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      now: () => Date.parse("2026-07-14T00:00:00.000Z"),
      fetchImpl: async (input, init) => {
        requests.push({ url: input.toString(), body: typeof init?.body === "string" ? init.body : undefined });
        const response = responses.shift();
        if (!response) throw new Error("unexpected fetch");
        return response;
      }
    }
  });

  assert.deepEqual(result, { expiresIn: 1_799 });
  assert.equal(stdout, `export HH_TOKEN='${accessToken}'\n`);
  assert.match(stderr, /https:\/\/superskill\.sh\/#\/superskill\/account/);
  assert.match(stderr, /ABCD-2345/);
  assert.doesNotMatch(stderr, /ohdc_/);
  assert.ok(!stderr.includes(accessToken));
  assert.deepEqual(sleeps, [3_000]);
  assert.deepEqual(requests.map((request) => request.url), [
    "https://superskill.sh/api/auth/device/start",
    "https://superskill.sh/api/auth/device/token",
    "https://superskill.sh/api/auth/device/token"
  ]);
  assert.ok(!requests.some((request) => request.url.includes(deviceCode)));
  assert.equal(JSON.parse(requests[0].body ?? "{}").client, "codex");
  assert.equal(JSON.parse(requests[1].body ?? "{}").device_code, deviceCode);
});

test("auth login refuses to mint a token unless the caller explicitly requests shell output", async () => {
  let fetches = 0;
  await assert.rejects(
    loginWithDeviceFlow({
      registryUrl: "https://superskill.sh/api",
      shell: false,
      client: "cli",
      io: { fetchImpl: async () => { fetches += 1; return jsonResponse(500, {}); } }
    }),
    (error: unknown) => error instanceof DeviceAuthCliError && error.exitCode === 2 && error.message.includes("eval")
  );
  assert.equal(fetches, 0);
});

test("auth login fails closed for insecure registries and verification URLs", async () => {
  await assert.rejects(
    loginWithDeviceFlow({ registryUrl: "http://example.com/api", shell: true, client: "cli" }),
    /requires an HTTPS registry/
  );

  let stdout = "";
  await assert.rejects(
    loginWithDeviceFlow({
      registryUrl: "http://127.0.0.1:8787",
      shell: true,
      client: "cli",
      io: {
        stdout: (value) => { stdout += value; },
        fetchImpl: async () => jsonResponse(201, {
          device_code: deviceCode,
          user_code: "ABCD-2345",
          verification_uri: `https://superskill.sh/#/superskill/account?code=${deviceCode}`,
          expires_in: 600,
          interval: 3
        })
      }
    }),
    /unsafe verification URL/
  );
  assert.equal(stdout, "");
});

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
