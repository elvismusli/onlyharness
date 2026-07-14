import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AgentAuthManager,
  CrossProcessRefreshLock,
  SecureCredentialStore,
  type CredentialStore
} from "../src/lib/agent-auth.js";
import { SuperSkillCliError } from "../src/lib/superskill-types.js";

const requestId = `ohrq_${"r".repeat(43)}`;
const deviceProof = `ohdp_${"d".repeat(43)}`;
const browserProof = `ohbp_${"b".repeat(43)}`;
const accessToken = `ohat_${"a".repeat(43)}`;
const refreshToken = `ohrt_${"f".repeat(43)}`;

test("agent browser auth matches the API contract and never returns proofs or tokens", async () => {
  const previousFlag = process.env.HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY;
  process.env.HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY = "1";
  let now = 1_000_000;
  let opened = "";
  let tokenPolls = 0;
  const store = new MemoryStore();
  const manager = new AgentAuthManager({
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
    openBrowser: async (url) => { opened = url; return true; },
    keychain: store,
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/agent/start")) {
        assert.deepEqual(JSON.parse(String(init?.body)), { client: "codex", scopes: ["superskill:managed"] });
        const browserUrl = `http://127.0.0.1:8787/#/superskill/connect?request=${requestId}&proof=${browserProof}`;
        return json(201, {
          request_id: requestId,
          device_proof: deviceProof,
          browser_url: browserUrl,
          verification_uri: browserUrl,
          expires_in: 600,
          interval: 1
        });
      }
      if (url.endsWith("/auth/agent/token")) {
        assert.deepEqual(JSON.parse(String(init?.body)), { request_id: requestId, device_proof: deviceProof });
        tokenPolls += 1;
        if (tokenPolls === 1) return json(202, { error: "Pending", code: "AUTHORIZATION_PENDING", retry_after: 1 });
        return json(200, {
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: "Bearer",
          expires_in: 600,
          session_expires_in: 30 * 24 * 60 * 60,
          scope: "superskill:managed"
        });
      }
      throw new Error(`unexpected ${url}`);
    }
  });

  try {
    const started = await manager.start({ registry: "http://127.0.0.1:8787/api", client: "codex", scopes: ["superskill:managed"] });
    assert.equal(started.code, "AUTH_PENDING");
    assert.equal(started.browserOpened, true);
    assert.match(opened, /#\/superskill\/connect\?/);
    assert.match(opened, /proof=ohbp_/);
    assertNoSecrets(started);

    const completed = await manager.wait({ registry: "http://127.0.0.1:8787/api", client: "codex", maxWaitMs: 5_000 });
    assert.equal(completed.code, "AUTH_AUTHORIZED");
    assert.equal(completed.persistence, "memory");
    assertNoSecrets(completed);
    assert.equal(await manager.accessToken({ registry: "http://127.0.0.1:8787/api", client: "codex", scopes: ["superskill:managed"] }), accessToken);
    assert.equal(store.lastSaved?.refreshToken, refreshToken, "refresh token is handed only to the credential store");
  } finally {
    if (previousFlag === undefined) delete process.env.HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY;
    else process.env.HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY = previousFlag;
  }
});

test("agent auth rejects arbitrary HTTPS registries before any request", async () => {
  let called = false;
  const manager = new AgentAuthManager({
    fetchImpl: async () => { called = true; throw new Error("must not run"); },
    keychain: new MemoryStore()
  });
  await assert.rejects(
    () => manager.start({ registry: "https://attacker.invalid/api", client: "codex", scopes: ["superskill:managed"] }),
    (error: unknown) => error instanceof SuperSkillCliError && error.reasonCode === "REGISTRY_ORIGIN_UNTRUSTED"
  );
  assert.equal(called, false);
});

test("interactive agent broker never falls back to HH_TOKEN environment credentials", async () => {
  const previousToken = process.env.HH_TOKEN;
  const previousLegacy = process.env.HH_SUPERSKILL_TOKEN;
  process.env.HH_TOKEN = "environment-account-token";
  process.env.HH_SUPERSKILL_TOKEN = "environment-legacy-token";
  const manager = new AgentAuthManager({ keychain: new MemoryStore() });
  try {
    await assert.rejects(
      () => manager.accessToken({ registry: "https://superskill.sh/api", client: "codex", scopes: ["resources:publish"] }),
      (error: unknown) => error instanceof SuperSkillCliError && error.reasonCode === "SUPERSKILL_AUTH_REQUIRED"
    );
  } finally {
    if (previousToken === undefined) delete process.env.HH_TOKEN; else process.env.HH_TOKEN = previousToken;
    if (previousLegacy === undefined) delete process.env.HH_SUPERSKILL_TOKEN; else process.env.HH_SUPERSKILL_TOKEN = previousLegacy;
  }
});

test("an empty OS keychain remains available for the first durable agent login", async () => {
  const entries = new Map<string, string>();
  const store = new SecureCredentialStore({
    entryFactory: (_service, account) => ({
      getPassword() {
        if (!entries.has(account)) throw Object.assign(new Error("No matching entry found in secure storage"), { name: "NoEntry" });
        return entries.get(account) ?? null;
      },
      setPassword(value) { entries.set(account, value); },
      deletePassword() { return entries.delete(account); }
    })
  });
  const account = "https://superskill.sh/api|https://superskill.sh/api|codex";
  assert.equal(await store.load(account), undefined);
  assert.equal(await store.mode(), "keychain", "a missing credential must not disable the keychain backend");
  const credential = {
    version: 1 as const,
    registry: "https://superskill.sh/api",
    client: "codex" as const,
    refreshToken,
    scopes: ["resources:publish" as const],
    sessionExpiresAt: Date.now() + 60_000
  };
  assert.equal(await store.save(account, credential), "keychain");
  assert.deepEqual(await store.load(account), credential);
});

test("revoked refresh credentials are removed and status returns signed_out", async () => {
  const store = new MemoryStore();
  await store.save("ignored", {
    version: 1,
    registry: "https://superskill.sh/api",
    client: "codex",
    refreshToken,
    scopes: ["resources:publish"],
    sessionExpiresAt: Date.now() + 60_000
  });
  const manager = new AgentAuthManager({
    keychain: store,
    fetchImpl: async () => json(401, { error: "Invalid or expired refresh token", code: "AGENT_REFRESH_INVALID" })
  });
  const status = await manager.status({ registry: "https://superskill.sh/api", client: "codex" });
  assert.equal(status.status, "signed_out");
  assert.equal(store.removed, true);
});

test("logout fails closed and retains the keychain credential when remote revocation is unavailable", async () => {
  const store = new MemoryStore();
  await store.save("ignored", {
    version: 1,
    registry: "https://superskill.sh/api",
    client: "codex",
    refreshToken,
    scopes: ["resources:publish"],
    sessionExpiresAt: Date.now() + 60_000
  });
  store.removed = false;
  const manager = new AgentAuthManager({
    keychain: store,
    fetchImpl: async () => { throw new Error("offline"); }
  });
  await assert.rejects(
    () => manager.logout({ registry: "https://superskill.sh/api", client: "codex" }),
    (error: unknown) => error instanceof SuperSkillCliError && error.reasonCode === "AUTH_SERVICE_UNREACHABLE"
  );
  assert.equal(store.removed, false, "local credential must remain available for a later revoke retry");
  assert.ok(await store.load("ignored"));
});

test("step-up exchange cannot be narrowed by a concurrent refresh", async () => {
  const root = await mkdtemp(join(tmpdir(), "superskill-exchange-refresh-race-"));
  const store = new MemoryStore();
  const narrowRotatedOnce = `ohrt_${"3".repeat(43)}`;
  const narrowRotatedTwice = `ohrt_${"4".repeat(43)}`;
  const stepUpRefresh = `ohrt_${"5".repeat(43)}`;
  let validRefresh = refreshToken;
  let refreshCalls = 0;
  let tokenRequestStarted!: () => void;
  let returnTokenResponse!: () => void;
  let competingRefreshStarted!: () => void;
  let releaseCompetingRefresh!: () => void;
  const tokenRequest = new Promise<void>((resolve) => { tokenRequestStarted = resolve; });
  const tokenResponseGate = new Promise<void>((resolve) => { returnTokenResponse = resolve; });
  const competingRefresh = new Promise<void>((resolve) => { competingRefreshStarted = resolve; });
  const competingRefreshGate = new Promise<void>((resolve) => { releaseCompetingRefresh = resolve; });
  await store.save("ignored", {
    version: 1,
    registry: "https://superskill.sh/api",
    client: "codex",
    refreshToken,
    scopes: ["workspaces:write"],
    sessionExpiresAt: Date.now() + 60_000
  });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/agent/start")) {
      const browserUrl = `https://superskill.sh/#/superskill/connect?request=${requestId}&proof=${browserProof}`;
      return json(201, {
        request_id: requestId,
        device_proof: deviceProof,
        browser_url: browserUrl,
        verification_uri: browserUrl,
        expires_in: 600,
        interval: 1
      });
    }
    if (url.endsWith("/auth/agent/token")) {
      tokenRequestStarted();
      await tokenResponseGate;
      return json(200, {
        access_token: `ohat_${"5".repeat(43)}`,
        refresh_token: stepUpRefresh,
        token_type: "Bearer",
        expires_in: 600,
        session_expires_in: 60,
        scope: "resources:publish workspaces:write"
      });
    }
    if (url.endsWith("/auth/agent/refresh")) {
      const supplied = (JSON.parse(String(init?.body)) as { refresh_token: string }).refresh_token;
      assert.equal(supplied, validRefresh, "each refresh must use the latest credential loaded under the lock");
      refreshCalls += 1;
      if (refreshCalls === 2) {
        competingRefreshStarted();
        await competingRefreshGate;
      }
      validRefresh = refreshCalls === 1 ? narrowRotatedOnce : narrowRotatedTwice;
      return json(200, {
        access_token: `ohat_${(refreshCalls === 1 ? "3" : "4").repeat(43)}`,
        refresh_token: validRefresh,
        token_type: "Bearer",
        expires_in: 600,
        session_expires_in: 60,
        scope: "workspaces:write"
      });
    }
    throw new Error(`unexpected ${url}`);
  };
  const exchangeManager = new AgentAuthManager({
    keychain: store,
    fetchImpl,
    openBrowser: async () => true,
    refreshLock: new CrossProcessRefreshLock({ root, retryMs: 2 })
  });
  const refreshManager = new AgentAuthManager({
    keychain: store,
    fetchImpl,
    refreshLock: new CrossProcessRefreshLock({ root, retryMs: 2 })
  });
  try {
    await exchangeManager.start({
      registry: "https://superskill.sh/api",
      client: "codex",
      scopes: ["resources:publish", "workspaces:write"]
    });
    const exchange = exchangeManager.wait({ registry: "https://superskill.sh/api", client: "codex", maxWaitMs: 2_000 });
    await tokenRequest;
    const competing = refreshManager.status({ registry: "https://superskill.sh/api", client: "codex" });
    await competingRefresh;
    returnTokenResponse();
    await new Promise((resolve) => setTimeout(resolve, 10));
    releaseCompetingRefresh();
    const [authorized, refreshed] = await Promise.all([exchange, competing]);
    assert.equal(authorized.status, "authorized");
    assert.equal(refreshed.status, "session_only");
    assert.deepEqual(store.lastSaved?.scopes, ["resources:publish", "workspaces:write"]);
    assert.equal(store.lastSaved?.refreshToken, stepUpRefresh, "the cumulative step-up credential wins after the narrow refresh releases the lock");
  } finally {
    releaseCompetingRefresh?.();
    returnTokenResponse?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("broker wait discovers a no-browser login completed by another manager", async () => {
  const root = await mkdtemp(join(tmpdir(), "superskill-external-login-"));
  const store = new MemoryStore();
  const externalRequest = `ohrq_${"e".repeat(43)}`;
  const externalDeviceProof = `ohdp_${"e".repeat(43)}`;
  const externalBrowserProof = `ohbp_${"e".repeat(43)}`;
  const externalRefresh = `ohrt_${"e".repeat(43)}`;
  const brokerRefresh = `ohrt_${"g".repeat(43)}`;
  let starts = 0;
  let oldRequestPolls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/agent/start")) {
      starts += 1;
      const id = starts === 1 ? requestId : externalRequest;
      const device = starts === 1 ? deviceProof : externalDeviceProof;
      const browser = starts === 1 ? browserProof : externalBrowserProof;
      const browserUrl = `https://superskill.sh/#/superskill/connect?request=${id}&proof=${browser}`;
      return json(201, { request_id: id, device_proof: device, browser_url: browserUrl, verification_uri: browserUrl, expires_in: 600, interval: 1 });
    }
    if (url.endsWith("/auth/agent/token")) {
      const body = JSON.parse(String(init?.body)) as { request_id: string };
      if (body.request_id === requestId) {
        oldRequestPolls += 1;
        return json(202, { error: "Pending", code: "AUTHORIZATION_PENDING", retry_after: 1 });
      }
      return json(200, {
        access_token: `ohat_${"e".repeat(43)}`,
        refresh_token: externalRefresh,
        token_type: "Bearer",
        expires_in: 600,
        session_expires_in: 60,
        scope: "resources:publish"
      });
    }
    if (url.endsWith("/auth/agent/refresh")) {
      assert.deepEqual(JSON.parse(String(init?.body)), { refresh_token: externalRefresh });
      return json(200, {
        access_token: `ohat_${"g".repeat(43)}`,
        refresh_token: brokerRefresh,
        token_type: "Bearer",
        expires_in: 600,
        session_expires_in: 60,
        scope: "resources:publish"
      });
    }
    throw new Error(`unexpected ${url}`);
  };
  const broker = new AgentAuthManager({
    keychain: store,
    fetchImpl,
    openBrowser: async () => false,
    refreshLock: new CrossProcessRefreshLock({ root, retryMs: 2 })
  });
  const externalCli = new AgentAuthManager({
    keychain: store,
    fetchImpl,
    refreshLock: new CrossProcessRefreshLock({ root, retryMs: 2 })
  });
  try {
    const unavailable = await broker.start({ registry: "https://superskill.sh/api", client: "codex", scopes: ["resources:publish"] });
    assert.equal(unavailable.browserOpened, false);
    await externalCli.start({ registry: "https://superskill.sh/api", client: "codex", scopes: ["resources:publish"], openBrowser: false });
    const externalAuthorized = await externalCli.wait({ registry: "https://superskill.sh/api", client: "codex", maxWaitMs: 2_000 });
    assert.equal(externalAuthorized.status, "authorized");

    const resumed = await broker.wait({ registry: "https://superskill.sh/api", client: "codex", maxWaitMs: 2_000 });
    assert.equal(resumed.status, "authorized");
    assert.deepEqual(resumed.scopes, ["resources:publish"]);
    assert.equal(oldRequestPolls, 0, "the broker must prefer the durable external login over its older pending request");
    assertNoSecrets(resumed);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent managers serialize refresh rotation and re-read the keychain after acquiring the lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "superskill-refresh-lock-"));
  const store = new MemoryStore();
  const rotatedOnce = `ohrt_${"1".repeat(43)}`;
  const rotatedTwice = `ohrt_${"2".repeat(43)}`;
  let validRefresh = refreshToken;
  let refreshReuse = 0;
  let inspectedLiveLock = false;
  const seenRefreshes: string[] = [];
  await store.save("ignored", {
    version: 1,
    registry: "https://superskill.sh/api",
    client: "codex",
    refreshToken,
    scopes: ["resources:publish"],
    sessionExpiresAt: Date.now() + 60_000
  });
  const fetchImpl: typeof fetch = async (_input, init) => {
    const supplied = (JSON.parse(String(init?.body)) as { refresh_token: string }).refresh_token;
    seenRefreshes.push(supplied);
    if (!inspectedLiveLock) {
      const [lockDirectory] = (await readdir(root)).filter((entry) => entry.endsWith(".lock"));
      assert.ok(lockDirectory, "refresh request runs only while the filesystem lock is held");
      const metadata = await readFile(join(root, lockDirectory, "owner.json"), "utf8");
      for (const secret of [refreshToken, accessToken, supplied]) assert.equal(metadata.includes(secret), false, "lock metadata must not contain credentials");
      inspectedLiveLock = true;
    }
    if (supplied !== validRefresh) {
      refreshReuse += 1;
      return json(401, { error: "Refresh reuse", code: "AGENT_REFRESH_REUSED" });
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    validRefresh = supplied === refreshToken ? rotatedOnce : rotatedTwice;
    return json(200, {
      access_token: `ohat_${(supplied === refreshToken ? "1" : "2").repeat(43)}`,
      refresh_token: validRefresh,
      token_type: "Bearer",
      expires_in: 600,
      session_expires_in: 60,
      scope: "resources:publish"
    });
  };
  const managerOne = new AgentAuthManager({
    keychain: store,
    fetchImpl,
    refreshLock: new CrossProcessRefreshLock({ root, retryMs: 2 })
  });
  const managerTwo = new AgentAuthManager({
    keychain: store,
    fetchImpl,
    refreshLock: new CrossProcessRefreshLock({ root, retryMs: 2 })
  });

  try {
    const statuses = await Promise.all([
      managerOne.status({ registry: "https://superskill.sh/api", client: "codex" }),
      managerTwo.status({ registry: "https://superskill.sh/api", client: "codex" })
    ]);
    assert.deepEqual(statuses.map((status) => status.status), ["session_only", "session_only"]);
    assert.deepEqual(seenRefreshes, [refreshToken, rotatedOnce], "the waiter must reload the rotated credential under the lock");
    assert.equal(refreshReuse, 0, "parallel managers must not reuse and revoke a refresh family");
    assert.equal(store.lastSaved?.refreshToken, rotatedTwice);
    const lockArtifacts = await readdir(root, { recursive: true });
    assert.equal(lockArtifacts.some((entry) => entry.endsWith(".lock")), false, "successful refresh releases the lock");
    for (const entry of lockArtifacts) {
      const fullPath = join(root, entry);
      try {
        const contents = await readFile(fullPath, "utf8");
        assert.equal(contents.includes(refreshToken), false, "lock metadata must never contain credentials");
      } catch { /* directories and removed lock entries have no readable content */ }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refresh lock removes only stale ownerless locks and times out on a live owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "superskill-refresh-lock-state-"));
  const account = "codex:test-account";
  const lockPath = join(root, `${createHash("sha256").update(account).digest("hex")}.lock`);
  try {
    await mkdir(lockPath, { mode: 0o700 });
    const staleTime = new Date(Date.now() - 120_000);
    await utimes(lockPath, staleTime, staleTime);
    const recovered = await new CrossProcessRefreshLock({ root, staleMs: 100, timeoutMs: 100, retryMs: 2 }).run(account, async () => "recovered");
    assert.equal(recovered, "recovered");

    await mkdir(lockPath, { mode: 0o700 });
    await writeFile(join(lockPath, "owner.json"), JSON.stringify({ version: 1, ownerId: "live-owner", pid: process.pid, acquiredAt: Date.now() }), { mode: 0o600 });
    let executed = false;
    await assert.rejects(
      () => new CrossProcessRefreshLock({ root, staleMs: 1, timeoutMs: 20, retryMs: 2 }).run(account, async () => { executed = true; }),
      (error: unknown) => error instanceof SuperSkillCliError && error.reasonCode === "AUTH_REFRESH_BUSY"
    );
    assert.equal(executed, false, "a live lock is never stolen even after the stale threshold");
    assert.ok(await readFile(join(lockPath, "owner.json"), "utf8"), "timeout must leave the live owner's lock intact");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

class MemoryStore implements CredentialStore {
  lastSaved: any;
  removed = false;
  private value: any;
  async load(): Promise<any> { return this.value; }
  async save(_account: string, value: any): Promise<"memory"> { this.value = value; this.lastSaved = value; return "memory"; }
  async remove(): Promise<void> { this.value = undefined; this.removed = true; }
  async mode(): Promise<"memory"> { return "memory"; }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function assertNoSecrets(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of ["proof=", "ohdp_", "ohbp_", "ohat_", "ohrt_", "HH_TOKEN", "HH_SUPERSKILL_TOKEN"]) {
    assert.equal(serialized.includes(secret), false, `structured output leaked ${secret}`);
  }
}
