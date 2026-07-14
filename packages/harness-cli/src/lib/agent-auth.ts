import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import open from "open";
import { SuperSkillCliError } from "./superskill-types.js";

export type AgentAuthClient = "cli" | "codex" | "claude-code";
export type AgentAuthScope = "superskill:managed" | "resources:publish" | "workspaces:read" | "workspaces:write";

export const AGENT_AUTH_SCOPES = [
  "superskill:managed",
  "resources:publish",
  "workspaces:read",
  "workspaces:write"
] as const satisfies readonly AgentAuthScope[];

type StoredCredential = {
  version: 1;
  registry: string;
  client: AgentAuthClient;
  refreshToken: string;
  scopes: AgentAuthScope[];
  sessionExpiresAt: number;
};

type AccessCredential = {
  token: string;
  scopes: AgentAuthScope[];
  expiresAt: number;
  sessionExpiresAt: number;
  refreshFingerprint: string;
};

type PendingAuthorization = {
  requestId: string;
  deviceProof: string;
  browserUrl: string;
  client: AgentAuthClient;
  scopes: AgentAuthScope[];
  intervalSeconds: number;
  expiresAt: number;
  browserOpened: boolean;
};

type AgentStartResponse = {
  request_id: string;
  device_proof: string;
  browser_url: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

type AgentTokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  session_expires_in: number;
  scope: string;
};

export type AgentAuthStatus = {
  status: "authorized" | "signed_out" | "session_only";
  code: "AUTH_AUTHORIZED" | "AUTH_SIGNED_OUT" | "AUTH_SESSION_ONLY";
  client: AgentAuthClient;
  scopes: AgentAuthScope[];
  expiresAt?: string;
  sessionExpiresAt?: string;
  persistence: "keychain" | "memory" | "none";
};

export type AgentAuthStartResult = {
  status: "pending";
  code: "AUTH_PENDING";
  client: AgentAuthClient;
  scopes: AgentAuthScope[];
  browserOpened: boolean;
  expiresIn: number;
  retryAfter: number;
  manualUrl?: string;
};

export type AgentAuthWaitResult = {
  status: "authorized" | "pending" | "denied" | "expired";
  code: "AUTH_AUTHORIZED" | "AUTH_PENDING" | "AUTH_DENIED" | "AUTH_EXPIRED";
  client: AgentAuthClient;
  scopes: AgentAuthScope[];
  persistence: "keychain" | "memory" | "none";
  retryAfter?: number;
  sessionExpiresAt?: string;
};

export type AgentAuthLogoutResult = {
  status: "signed_out";
  code: "AUTH_SIGNED_OUT";
  client: AgentAuthClient;
  revoked: boolean;
};

export type AgentAuthIo = {
  fetchImpl: typeof fetch;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  openBrowser: (url: string) => Promise<boolean>;
  keychain: CredentialStore;
  refreshLock: RefreshLock;
};

export interface CredentialStore {
  load(account: string): Promise<StoredCredential | undefined>;
  save(account: string, value: StoredCredential): Promise<"keychain" | "memory">;
  remove(account: string): Promise<void>;
  mode(): Promise<"keychain" | "memory">;
}

export interface RefreshLock {
  run<T>(account: string, operation: () => Promise<T>): Promise<T>;
}

const REQUEST_TIMEOUT_MS = 10_000;
const ACCESS_CLOCK_SKEW_MS = 15_000;
const REFRESH_LOCK_TIMEOUT_MS = 15_000;
const REFRESH_LOCK_STALE_MS = 60_000;
const REFRESH_LOCK_RETRY_MS = 50;
const memoryCredentials = new Map<string, StoredCredential>();

type RefreshLockOwner = {
  version: 1;
  ownerId: string;
  pid: number;
  acquiredAt: number;
};

export class CrossProcessRefreshLock implements RefreshLock {
  private readonly root: string;
  private readonly timeoutMs: number;
  private readonly staleMs: number;
  private readonly retryMs: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: {
    root?: string;
    timeoutMs?: number;
    staleMs?: number;
    retryMs?: number;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {}) {
    this.root = options.root ?? join(homedir(), ".cache", "superskill", "auth-locks");
    this.timeoutMs = options.timeoutMs ?? REFRESH_LOCK_TIMEOUT_MS;
    this.staleMs = options.staleMs ?? REFRESH_LOCK_STALE_MS;
    this.retryMs = options.retryMs ?? REFRESH_LOCK_RETRY_MS;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async run<T>(account: string, operation: () => Promise<T>): Promise<T> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const lockPath = join(this.root, `${createHash("sha256").update(account).digest("hex")}.lock`);
    const deadline = this.now() + this.timeoutMs;
    while (true) {
      const owner: RefreshLockOwner = { version: 1, ownerId: randomUUID(), pid: process.pid, acquiredAt: this.now() };
      if (await this.tryAcquire(lockPath, owner)) {
        try {
          return await operation();
        } finally {
          await this.release(lockPath, owner);
        }
      }
      if (await this.removeAbandoned(lockPath)) continue;
      if (this.now() >= deadline) {
        throw new SuperSkillCliError(
          "Another SuperSkill process is refreshing this account session.",
          1,
          "AUTH_REFRESH_BUSY",
          "Wait for the other process to finish, then retry the protected action without signing in again."
        );
      }
      await this.sleep(Math.min(this.retryMs, Math.max(1, deadline - this.now())));
    }
  }

  private async tryAcquire(lockPath: string, owner: RefreshLockOwner): Promise<boolean> {
    try {
      await mkdir(lockPath, { mode: 0o700 });
    } catch (error) {
      if (fileErrorCode(error) === "EEXIST") return false;
      throw new SuperSkillCliError("SuperSkill could not secure the session refresh lock.", 1, "AUTH_REFRESH_LOCK_FAILED", "Check local filesystem permissions and retry.");
    }
    try {
      await writeFile(join(lockPath, "owner.json"), JSON.stringify(owner), { encoding: "utf8", flag: "wx", mode: 0o600 });
      const confirmed = await this.readOwner(lockPath);
      if (confirmed?.ownerId !== owner.ownerId) throw new Error("refresh lock ownership changed");
      return true;
    } catch {
      await this.release(lockPath, owner);
      return false;
    }
  }

  private async removeAbandoned(lockPath: string): Promise<boolean> {
    const owner = await this.readOwner(lockPath);
    if (owner && processIsAlive(owner.pid)) return false;
    if (!owner) {
      try {
        const details = await stat(lockPath);
        if (this.now() - details.mtimeMs < this.staleMs) return false;
      } catch (error) {
        return fileErrorCode(error) === "ENOENT";
      }
    }
    const abandoned = `${lockPath}.abandoned-${randomUUID()}`;
    try {
      await rename(lockPath, abandoned);
    } catch (error) {
      return fileErrorCode(error) === "ENOENT";
    }
    await rm(abandoned, { recursive: true, force: true });
    return true;
  }

  private async release(lockPath: string, owner: RefreshLockOwner): Promise<void> {
    const current = await this.readOwner(lockPath);
    if (current?.ownerId !== owner.ownerId) return;
    await rm(lockPath, { recursive: true, force: true });
  }

  private async readOwner(lockPath: string): Promise<RefreshLockOwner | undefined> {
    try {
      const parsed = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8")) as Partial<RefreshLockOwner>;
      if (parsed.version !== 1 || typeof parsed.ownerId !== "string" || !Number.isInteger(parsed.pid) || !Number.isFinite(parsed.acquiredAt)) return undefined;
      return parsed as RefreshLockOwner;
    } catch {
      return undefined;
    }
  }
}

export class SecureCredentialStore implements CredentialStore {
  private keyringAvailable: boolean | undefined;
  private readonly entryFactory?: (service: string, account: string) => KeyringEntry;

  constructor(options: { entryFactory?: (service: string, account: string) => KeyringEntry } = {}) {
    this.entryFactory = options.entryFactory;
  }

  async load(account: string): Promise<StoredCredential | undefined> {
    const entry = await this.entry(account);
    if (entry) {
      try {
        const encoded = entry.getPassword();
        if (!encoded) return memoryCredentials.get(account);
        return parseStoredCredential(encoded);
      } catch (error) {
        if (isMissingKeychainEntry(error)) return memoryCredentials.get(account);
        this.keyringAvailable = false;
      }
    }
    return memoryCredentials.get(account);
  }

  async save(account: string, value: StoredCredential): Promise<"keychain" | "memory"> {
    const entry = await this.entry(account);
    if (entry) {
      try {
        entry.setPassword(JSON.stringify(value));
        memoryCredentials.delete(account);
        return "keychain";
      } catch {
        this.keyringAvailable = false;
      }
    }
    memoryCredentials.set(account, value);
    return "memory";
  }

  async remove(account: string): Promise<void> {
    memoryCredentials.delete(account);
    const entry = await this.entry(account);
    if (!entry) return;
    try { entry.deletePassword(); } catch { /* already absent or keychain unavailable */ }
  }

  async mode(): Promise<"keychain" | "memory"> {
    return await this.entry("probe") ? "keychain" : "memory";
  }

  private async entry(account: string): Promise<KeyringEntry | undefined> {
    if (process.env.NODE_ENV !== "production" && process.env.HH_SUPERSKILL_AUTH_DISABLE_KEYCHAIN === "1") {
      this.keyringAvailable = false;
      return undefined;
    }
    if (this.keyringAvailable === false) return undefined;
    if (this.entryFactory) {
      try {
        const entry = this.entryFactory("superskill.sh", account);
        this.keyringAvailable = true;
        return entry;
      } catch {
        this.keyringAvailable = false;
        return undefined;
      }
    }
    try {
      // Keep the native addon external to the bundled CLI. The exact package is a
      // runtime dependency and may be unavailable on an unsupported platform.
      const moduleName: string = "@napi-rs/keyring";
      const keyring = await import(moduleName) as { Entry: new (service: string, account: string) => KeyringEntry };
      this.keyringAvailable = true;
      return new keyring.Entry("superskill.sh", account);
    } catch {
      this.keyringAvailable = false;
      return undefined;
    }
  }
}

type KeyringEntry = {
  getPassword(): string | null;
  setPassword(value: string): void;
  deletePassword(): void;
};

function isMissingKeychainEntry(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; code?: unknown; message?: unknown };
  const identity = `${typeof value.name === "string" ? value.name : ""} ${typeof value.code === "string" ? value.code : ""}`;
  if (/\b(?:NoEntry|ERR_KEYRING_NO_ENTRY)\b/i.test(identity)) return true;
  const message = typeof value.message === "string" ? value.message : "";
  return /(?:no matching entry|credential (?:was )?not found|password (?:was )?not found|item (?:was )?not found)\b/i.test(message);
}

export class AgentAuthManager {
  private readonly io: AgentAuthIo;
  private readonly access = new Map<string, AccessCredential>();
  private readonly pending = new Map<AgentAuthClient, PendingAuthorization>();

  constructor(io: Partial<AgentAuthIo> = {}) {
    this.io = {
      fetchImpl: io.fetchImpl ?? fetch,
      now: io.now ?? Date.now,
      sleep: io.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
      openBrowser: io.openBrowser ?? openBrowser,
      keychain: io.keychain ?? new SecureCredentialStore(),
      refreshLock: io.refreshLock ?? new CrossProcessRefreshLock()
    };
  }

  async start(input: {
    registry: string;
    client: AgentAuthClient;
    scopes: readonly string[];
    openBrowser?: boolean;
  }): Promise<AgentAuthStartResult> {
    const registry = cleanAgentRegistry(input.registry);
    const scopes = normalizeScopes(input.scopes);
    const existing = this.pending.get(input.client);
    if (existing && existing.expiresAt > this.io.now() && sameScopes(existing.scopes, scopes)) {
      return this.startResult(existing, input.openBrowser === false);
    }
    const response = await this.post(registry, "/auth/agent/start", { client: input.client, scopes });
    const body = await responseJson(response);
    if (response.status !== 201 || !validStart(body, registry)) {
      throw authResponseError("Could not start SuperSkill authorization", response.status, body);
    }
    const pending: PendingAuthorization = {
      requestId: body.request_id,
      deviceProof: body.device_proof,
      browserUrl: body.browser_url,
      client: input.client,
      scopes,
      intervalSeconds: body.interval,
      expiresAt: this.io.now() + body.expires_in * 1_000,
      browserOpened: false
    };
    if (input.openBrowser !== false) pending.browserOpened = await this.io.openBrowser(pending.browserUrl);
    this.pending.set(input.client, pending);
    return this.startResult(pending, input.openBrowser === false);
  }

  async wait(input: {
    registry: string;
    client: AgentAuthClient;
    maxWaitMs?: number;
  }): Promise<AgentAuthWaitResult> {
    const registry = cleanAgentRegistry(input.registry);
    const pending = this.pending.get(input.client);
    if (!pending) return this.statusToWait(await this.status({ registry: registry.toString(), client: input.client }));
    // A trusted `hh auth login --no-browser` may have completed in another
    // process after this broker failed to open the browser. Reload the shared
    // credential store before polling this process's older request. Only a
    // session covering the exact pending scopes can satisfy that request.
    const externallyAuthorized = await this.status(
      { registry: registry.toString(), client: input.client },
      { reloadCredential: true }
    );
    if (externallyAuthorized.status !== "signed_out" && includesScopes(externallyAuthorized.scopes, pending.scopes)) {
      this.pending.delete(input.client);
      return this.statusToWait(externallyAuthorized);
    }
    const maxWaitMs = boundedMaxWait(input.maxWaitMs);
    const deadline = Math.min(pending.expiresAt, this.io.now() + maxWaitMs);
    while (this.io.now() < deadline) {
      const response = await this.post(registry, "/auth/agent/token", {
        request_id: pending.requestId,
        device_proof: pending.deviceProof
      });
      const body = await responseJson(response);
      if (response.status === 200) {
        if (!validToken(body)) throw new SuperSkillCliError("SuperSkill returned an invalid agent token response.", 1, "AUTH_RESPONSE_INVALID", "Retry browser authorization.");
        const persistence = await this.acceptTokens(registry, pending.client, body);
        this.pending.delete(input.client);
        return {
          status: persistence === "keychain" ? "authorized" : "authorized",
          code: "AUTH_AUTHORIZED",
          client: input.client,
          scopes: parseScope(body.scope),
          persistence,
          sessionExpiresAt: new Date(this.io.now() + body.session_expires_in * 1_000).toISOString()
        };
      }
      const code = responseCode(body);
      if (response.status === 202 && code === "AUTHORIZATION_PENDING") {
        const retryAfter = retrySeconds(body, pending.intervalSeconds);
        if (this.io.now() + retryAfter * 1_000 >= deadline) {
          return { status: "pending", code: "AUTH_PENDING", client: input.client, scopes: pending.scopes, persistence: "none", retryAfter };
        }
        await this.io.sleep(retryAfter * 1_000);
        continue;
      }
      if (response.status === 403 && code === "AGENT_AUTH_DENIED") {
        this.pending.delete(input.client);
        return { status: "denied", code: "AUTH_DENIED", client: input.client, scopes: pending.scopes, persistence: "none" };
      }
      if (response.status === 410) {
        this.pending.delete(input.client);
        return { status: "expired", code: "AUTH_EXPIRED", client: input.client, scopes: pending.scopes, persistence: "none" };
      }
      throw authResponseError("SuperSkill authorization failed", response.status, body);
    }
    if (pending.expiresAt <= this.io.now()) {
      this.pending.delete(input.client);
      return { status: "expired", code: "AUTH_EXPIRED", client: input.client, scopes: pending.scopes, persistence: "none" };
    }
    return { status: "pending", code: "AUTH_PENDING", client: input.client, scopes: pending.scopes, persistence: "none", retryAfter: pending.intervalSeconds };
  }

  async status(
    input: { registry: string; client: AgentAuthClient },
    options: { reloadCredential?: boolean } = {}
  ): Promise<AgentAuthStatus> {
    const registry = cleanAgentRegistry(input.registry);
    const account = credentialAccount(registry, input.client);
    const cached = this.access.get(account);
    if (!options.reloadCredential && cached && cached.expiresAt - ACCESS_CLOCK_SKEW_MS > this.io.now()) {
      return authStatus(input.client, cached, await this.io.keychain.mode());
    }
    return await this.io.refreshLock.run(account, async () => {
      // Another process may have rotated the refresh credential while this process
      // waited for the lock. Always re-read it after ownership is confirmed.
      const stored = await this.io.keychain.load(account);
      if (!stored || stored.sessionExpiresAt <= this.io.now()) {
        if (stored) await this.io.keychain.remove(account);
        return { status: "signed_out", code: "AUTH_SIGNED_OUT", client: input.client, scopes: [], persistence: "none" };
      }
      if (
        options.reloadCredential
        && cached
        && cached.expiresAt - ACCESS_CLOCK_SKEW_MS > this.io.now()
        && cached.refreshFingerprint === credentialFingerprint(stored.refreshToken)
      ) {
        return authStatus(input.client, cached, await this.io.keychain.mode());
      }
      try {
        const refreshed = await this.refresh(registry, stored);
        const persistence = await this.io.keychain.save(account, refreshed.stored);
        this.access.set(account, refreshed.access);
        return authStatus(input.client, refreshed.access, persistence);
      } catch (error) {
        if (error instanceof SuperSkillCliError && ["AGENT_AUTH_INVALID", "AGENT_REFRESH_INVALID", "AGENT_REFRESH_REUSED", "AGENT_AUTH_REVOKED"].includes(error.reasonCode)) {
          await this.io.keychain.remove(account);
          this.access.delete(account);
          return { status: "signed_out", code: "AUTH_SIGNED_OUT", client: input.client, scopes: [], persistence: "none" };
        }
        throw error;
      }
    });
  }

  async accessToken(input: { registry: string; client: AgentAuthClient; scopes: readonly string[] }): Promise<string> {
    const registry = cleanAgentRegistry(input.registry);
    const required = normalizeScopes(input.scopes);
    const account = credentialAccount(registry, input.client);
    const cached = this.access.get(account);
    if (cached && cached.expiresAt - ACCESS_CLOCK_SKEW_MS > this.io.now() && includesScopes(cached.scopes, required)) return cached.token;
    const status = await this.status(
      { registry: registry.toString(), client: input.client },
      { reloadCredential: Boolean(cached) }
    );
    const refreshed = this.access.get(account);
    if (status.status !== "signed_out" && refreshed && includesScopes(refreshed.scopes, required)) return refreshed.token;
    if (status.status !== "signed_out") {
      throw new SuperSkillCliError("SuperSkill authorization needs additional permission.", 2, "AUTH_SCOPE_REQUIRED", "Run auth_start with the exact required scopes, then auth_wait and retry the original tool once.");
    }
    throw new SuperSkillCliError("SuperSkill account authorization is required.", 2, "SUPERSKILL_AUTH_REQUIRED", "Call auth_start, then auth_wait, and retry the original tool once after AUTH_AUTHORIZED.");
  }

  async logout(input: { registry: string; client: AgentAuthClient }): Promise<AgentAuthLogoutResult> {
    const registry = cleanAgentRegistry(input.registry);
    const account = credentialAccount(registry, input.client);
    const stored = await this.io.keychain.load(account);
    const access = this.access.get(account);
    let revoked = false;
    if (stored || access) {
      const response = await this.post(registry, "/auth/agent/revoke", stored ? { refresh_token: stored.refreshToken } : {}, access?.token);
      const body = await responseJson(response);
      if (!response.ok || !body || typeof body !== "object" || (body as { revoked?: unknown }).revoked !== true) {
        throw authResponseError("SuperSkill logout failed", response.status, body);
      }
      revoked = true;
    }
    await this.io.keychain.remove(account);
    this.access.delete(account);
    this.pending.delete(input.client);
    return { status: "signed_out", code: "AUTH_SIGNED_OUT", client: input.client, revoked };
  }

  private startResult(pending: PendingAuthorization, manual: boolean): AgentAuthStartResult {
    return {
      status: "pending",
      code: "AUTH_PENDING",
      client: pending.client,
      scopes: pending.scopes,
      browserOpened: pending.browserOpened,
      expiresIn: Math.max(1, Math.ceil((pending.expiresAt - this.io.now()) / 1_000)),
      retryAfter: pending.intervalSeconds,
      ...(manual ? { manualUrl: pending.browserUrl } : {})
    };
  }

  private statusToWait(status: AgentAuthStatus): AgentAuthWaitResult {
    return status.status === "signed_out"
      ? { status: "expired", code: "AUTH_EXPIRED", client: status.client, scopes: [], persistence: "none" }
      : { status: "authorized", code: "AUTH_AUTHORIZED", client: status.client, scopes: status.scopes, persistence: status.persistence, sessionExpiresAt: status.sessionExpiresAt };
  }

  private async acceptTokens(registry: URL, client: AgentAuthClient, body: AgentTokenResponse): Promise<"keychain" | "memory"> {
    const now = this.io.now();
    const scopes = parseScope(body.scope);
    const access: AccessCredential = {
      token: body.access_token,
      scopes,
      expiresAt: now + body.expires_in * 1_000,
      sessionExpiresAt: now + body.session_expires_in * 1_000,
      refreshFingerprint: credentialFingerprint(body.refresh_token)
    };
    const stored: StoredCredential = {
      version: 1,
      registry: registry.toString(),
      client,
      refreshToken: body.refresh_token,
      scopes,
      sessionExpiresAt: access.sessionExpiresAt
    };
    const account = credentialAccount(registry, client);
    return await this.io.refreshLock.run(account, async () => {
      // Exchange/step-up can race a refresh in another process. Reconcile only
      // after taking the same account lock: a broader durable credential must
      // never be replaced by a narrower exchange response, while a cumulative
      // step-up response must win over the old narrower credential.
      const current = await this.io.keychain.load(account);
      const keepCurrent = current !== undefined
        && current.sessionExpiresAt > now
        && current.registry === stored.registry
        && current.client === stored.client
        && !includesScopes(stored.scopes, current.scopes);
      const persistence = keepCurrent
        ? await this.io.keychain.mode()
        : await this.io.keychain.save(account, stored);
      this.access.set(account, access);
      return persistence;
    });
  }

  private async refresh(registry: URL, stored: StoredCredential): Promise<{ access: AccessCredential; stored: StoredCredential }> {
    const response = await this.post(registry, "/auth/agent/refresh", { refresh_token: stored.refreshToken });
    const body = await responseJson(response);
    if (!response.ok) throw authResponseError("SuperSkill session refresh failed", response.status, body);
    if (!validToken(body)) throw new SuperSkillCliError("SuperSkill returned an invalid refresh response.", 1, "AUTH_RESPONSE_INVALID", "Sign in again.");
    const now = this.io.now();
    const scopes = parseScope(body.scope);
    const sessionExpiresAt = Math.min(stored.sessionExpiresAt, now + body.session_expires_in * 1_000);
    return {
      access: {
        token: body.access_token,
        scopes,
        expiresAt: now + body.expires_in * 1_000,
        sessionExpiresAt,
        refreshFingerprint: credentialFingerprint(body.refresh_token)
      },
      stored: { ...stored, refreshToken: body.refresh_token, scopes, sessionExpiresAt }
    };
  }

  private async post(registry: URL, route: string, body: Record<string, unknown>, token?: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    timer.unref?.();
    try {
      return await this.io.fetchImpl(agentEndpoint(registry, route), {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
        redirect: "error",
        signal: controller.signal
      });
    } catch {
      throw new SuperSkillCliError("SuperSkill authorization service is unreachable.", 1, "AUTH_SERVICE_UNREACHABLE", "Check network access and retry without changing the original operation.");
    } finally {
      clearTimeout(timer);
    }
  }
}

export const agentAuth = new AgentAuthManager();

function cleanAgentRegistry(value: string): URL {
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname.replace(/\/$/, "") || "/";
    const canonical = parsed.protocol === "https:"
      && (parsed.hostname === "superskill.sh" || parsed.hostname === "onlyharness.com")
      && !parsed.port
      && (pathname === "/api" || pathname === "/");
    const loopback = process.env.NODE_ENV !== "production"
      && process.env.HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY === "1"
      && parsed.protocol === "http:"
      && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]")
      && Boolean(parsed.port)
      && (pathname === "/api" || pathname === "/");
    if ((!canonical && !loopback) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("unsafe");
    parsed.pathname = pathname === "/" ? "" : pathname;
    return parsed;
  } catch {
    throw new SuperSkillCliError("Agent authorization requires HTTPS (loopback HTTP is test-only).", 3, "REGISTRY_ORIGIN_UNTRUSTED", "Use https://superskill.sh/api.");
  }
}

function agentEndpoint(registry: URL, route: string): string {
  return `${registry.origin}${registry.pathname.replace(/\/$/, "")}${route}`;
}

function credentialAccount(registry: URL, client: AgentAuthClient): string {
  return `${client}:${createHash("sha256").update(registry.toString()).digest("hex").slice(0, 24)}`;
}

function credentialFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeScopes(values: readonly string[]): AgentAuthScope[] {
  const allowed = new Set<string>(AGENT_AUTH_SCOPES);
  const scopes = [...new Set(values)].sort();
  if (!scopes.length || scopes.some((scope) => !allowed.has(scope))) {
    throw new SuperSkillCliError("Unsupported or empty SuperSkill authorization scope.", 3, "AUTH_SCOPE_INVALID", "Request only the scopes declared by the selected tool.");
  }
  return scopes as AgentAuthScope[];
}

function parseScope(value: string): AgentAuthScope[] {
  return normalizeScopes(value.split(/\s+/).filter(Boolean));
}

function validStart(value: unknown, registry: URL): value is AgentStartResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Partial<AgentStartResponse>;
  if (
    typeof body.request_id !== "string" || !/^ohrq_[A-Za-z0-9_-]{20,160}$/.test(body.request_id) ||
    typeof body.device_proof !== "string" || !/^ohdp_[A-Za-z0-9_-]{32,180}$/.test(body.device_proof) ||
    typeof body.browser_url !== "string" || body.browser_url !== body.verification_uri ||
    !Number.isInteger(body.expires_in) || body.expires_in! < 120 || body.expires_in! > 15 * 60 ||
    !Number.isInteger(body.interval) || body.interval! < 1 || body.interval! > 10
  ) return false;
  try {
    const browser = new URL(body.browser_url);
    const expectedHost = registry.hostname === "onlyharness.com" ? "superskill.sh" : registry.hostname;
    const loopback = registry.protocol === "http:" && browser.protocol === "http:" && browser.hostname === registry.hostname;
    const [fragmentPath, fragmentQuery = ""] = browser.hash.slice(1).split("?", 2);
    const fragment = new URLSearchParams(fragmentQuery);
    return (browser.protocol === "https:" || loopback)
      && browser.hostname === expectedHost
      && browser.pathname === "/"
      && browser.search === ""
      && fragmentPath === "/superskill/connect"
      && fragment.get("request") === body.request_id
      && /^ohbp_[A-Za-z0-9_-]{32,180}$/.test(fragment.get("proof") ?? "")
      && [...fragment.keys()].every((key) => key === "request" || key === "proof");
  } catch {
    return false;
  }
}

function validToken(value: unknown): value is AgentTokenResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Partial<AgentTokenResponse>;
  if (
    typeof body.access_token !== "string" || !/^ohat_[A-Za-z0-9_-]{32,180}$/.test(body.access_token) ||
    typeof body.refresh_token !== "string" || !/^ohrt_[A-Za-z0-9_-]{32,180}$/.test(body.refresh_token) ||
    body.token_type !== "Bearer" ||
    !Number.isInteger(body.expires_in) || body.expires_in! < 30 || body.expires_in! > 15 * 60 ||
    !Number.isInteger(body.session_expires_in) || body.session_expires_in! < 60 || body.session_expires_in! > 31 * 24 * 60 * 60 ||
    typeof body.scope !== "string"
  ) return false;
  try { parseScope(body.scope); return true; } catch { return false; }
}

function parseStoredCredential(value: string): StoredCredential | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<StoredCredential>;
    if (parsed.version !== 1 || typeof parsed.registry !== "string" || !["cli", "codex", "claude-code"].includes(parsed.client ?? "")) return undefined;
    if (typeof parsed.refreshToken !== "string" || !/^ohrt_[A-Za-z0-9_-]{32,180}$/.test(parsed.refreshToken)) return undefined;
    if (!Array.isArray(parsed.scopes) || !Number.isFinite(parsed.sessionExpiresAt)) return undefined;
    return { ...parsed, scopes: normalizeScopes(parsed.scopes) } as StoredCredential;
  } catch {
    return undefined;
  }
}

function authStatus(client: AgentAuthClient, access: AccessCredential, persistence: "keychain" | "memory"): AgentAuthStatus {
  return {
    status: persistence === "memory" ? "session_only" : "authorized",
    code: persistence === "memory" ? "AUTH_SESSION_ONLY" : "AUTH_AUTHORIZED",
    client,
    scopes: access.scopes,
    expiresAt: new Date(access.expiresAt).toISOString(),
    sessionExpiresAt: new Date(access.sessionExpiresAt).toISOString(),
    persistence
  };
}

function includesScopes(have: AgentAuthScope[], required: AgentAuthScope[]): boolean {
  return required.every((scope) => have.includes(scope));
}

function sameScopes(left: AgentAuthScope[], right: AgentAuthScope[]): boolean {
  return left.length === right.length && includesScopes(left, right);
}

function boundedMaxWait(value: number | undefined): number {
  if (value === undefined) return 45_000;
  if (!Number.isInteger(value) || value < 1_000 || value > 45_000) {
    throw new SuperSkillCliError("Auth wait must be between 1 and 45 seconds.", 3, "AUTH_WAIT_INVALID", "Use auth_wait with maxWaitSeconds between 1 and 45.");
  }
  return value;
}

function retrySeconds(value: unknown, fallback: number): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const retry = (value as { retry_after?: unknown }).retry_after;
  return Number.isInteger(retry) && typeof retry === "number" && retry >= 1 && retry <= 30 ? retry : fallback;
}

function responseCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z0-9_]{2,80}$/.test(code) ? code : undefined;
}

function authResponseError(prefix: string, status: number, body: unknown): SuperSkillCliError {
  const code = responseCode(body) ?? (status === 401 ? "AGENT_AUTH_INVALID" : status === 403 ? "AGENT_AUTH_DENIED" : "AUTH_REQUEST_FAILED");
  const message = body && typeof body === "object" && !Array.isArray(body) && typeof (body as { error?: unknown }).error === "string"
    ? (body as { error: string }).error.slice(0, 200)
    : `${prefix} (HTTP ${status}).`;
  return new SuperSkillCliError(message, status === 401 || status === 403 || status === 410 ? 2 : 1, code, "Retry browser authorization without exposing credentials.");
}

async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json() as unknown; } catch { return undefined; }
}

async function openBrowser(url: string): Promise<boolean> {
  if (process.env.NODE_ENV !== "production" && process.env.HH_SUPERSKILL_AUTH_TEST_BROWSER_OPENED === "1") return true;
  if (process.env.NODE_ENV !== "production" && process.env.HH_SUPERSKILL_AUTH_TEST_BROWSER_OPENED === "0") return false;
  try {
    await open(url, { wait: false });
    return true;
  } catch {
    return false;
  }
}

function fileErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return fileErrorCode(error) === "EPERM";
  }
}
