import type { Command } from "commander";

const REQUEST_TIMEOUT_MS = 10_000;
const DEVICE_TOKEN_MAX_TTL_SECONDS = 30 * 60;

type DeviceStart = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

type DeviceToken = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: "superskill:managed";
};

type AuthIo = {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
  fetchImpl: typeof fetch;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
};

export class DeviceAuthCliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 2) {
    super(message);
    this.name = "DeviceAuthCliError";
    this.exitCode = exitCode;
  }
}

export function registerAuthCommands(program: Command, getRegistryUrl: () => string): void {
  const auth = program.command("auth").description("authorize the local CLI with a confirmed SuperSkill account");
  auth.command("login")
    .description("authorize this terminal through a one-time browser code")
    .option("--shell", "print one export command for eval; never write the token to disk", false)
    .option("--client <client>", "cli|codex|claude-code", "cli")
    .action(async (options: { shell?: boolean; client?: string }) => {
      await loginWithDeviceFlow({
        registryUrl: getRegistryUrl(),
        shell: Boolean(options.shell),
        client: cleanClient(options.client)
      });
    });
}

export async function loginWithDeviceFlow(input: {
  registryUrl: string;
  shell: boolean;
  client: "cli" | "codex" | "claude-code";
  io?: Partial<AuthIo>;
}): Promise<{ expiresIn: number }> {
  if (!input.shell) {
    throw new DeviceAuthCliError('Device login cannot change its parent shell. Run: eval "$(hh auth login --shell)"');
  }
  const registryUrl = secureRegistryUrl(input.registryUrl);
  const io: AuthIo = {
    stdout: input.io?.stdout ?? ((value) => process.stdout.write(value)),
    stderr: input.io?.stderr ?? ((value) => process.stderr.write(value)),
    fetchImpl: input.io?.fetchImpl ?? fetch,
    sleep: input.io?.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    now: input.io?.now ?? Date.now
  };
  const startUrl = endpoint(registryUrl, "/auth/device/start");
  const startResponse = await postJson(io.fetchImpl, startUrl, { client: input.client });
  const startBody = await safeJson(startResponse);
  if (startResponse.status !== 201 || !validDeviceStart(startBody)) {
    throw responseError("Could not start SuperSkill device authorization", startResponse.status, startBody);
  }
  if (!safeVerificationUrl(startBody.verification_uri, startBody.device_code, startBody.user_code)) {
    throw new DeviceAuthCliError("SuperSkill returned an unsafe verification URL", 1);
  }

  io.stderr([
    "Approve this terminal with your confirmed SuperSkill account:",
    `  URL:  ${startBody.verification_uri}`,
    `  Code: ${startBody.user_code}`,
    `The code expires in ${Math.ceil(startBody.expires_in / 60)} minutes. The access token will be printed only as a shell export.`,
    ""
  ].join("\n"));

  const deadline = io.now() + startBody.expires_in * 1_000;
  let waitSeconds = startBody.interval;
  while (io.now() < deadline) {
    const response = await postJson(io.fetchImpl, endpoint(registryUrl, "/auth/device/token"), { device_code: startBody.device_code });
    const body = await safeJson(response);
    if (response.status === 200) {
      if (!validDeviceToken(body)) throw new DeviceAuthCliError("SuperSkill returned an invalid device token response", 1);
      io.stdout(`export HH_TOKEN='${body.access_token}'\n`);
      io.stderr(`Authorized for up to ${Math.ceil(body.expires_in / 60)} minutes. The token was not written to disk.\n`);
      return { expiresIn: body.expires_in };
    }
    const code = errorCode(body);
    if (response.status === 202 && code === "AUTHORIZATION_PENDING") {
      waitSeconds = retrySeconds(body, waitSeconds);
      await io.sleep(waitSeconds * 1_000);
      continue;
    }
    if (response.status === 429 && (code === "DEVICE_AUTH_SLOW_DOWN" || code === "DEVICE_AUTH_RATE_LIMITED")) {
      waitSeconds = retrySeconds(body, Math.min(10, waitSeconds + 1));
      await io.sleep(waitSeconds * 1_000);
      continue;
    }
    throw responseError("SuperSkill device authorization failed", response.status, body);
  }
  throw new DeviceAuthCliError("SuperSkill device authorization expired. Start a new login.", 2);
}

function cleanClient(value: string | undefined): "cli" | "codex" | "claude-code" {
  if (value === "cli" || value === "codex" || value === "claude-code") return value;
  throw new DeviceAuthCliError("Unsupported auth client. Use cli, codex, or claude-code.", 3);
}

function secureRegistryUrl(value: string): URL {
  try {
    const parsed = new URL(value);
    const loopback = parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]");
    if ((parsed.protocol !== "https:" && !loopback) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("unsafe");
    return parsed;
  } catch {
    throw new DeviceAuthCliError("Device authorization requires an HTTPS registry (HTTP is allowed only for loopback tests).", 3);
  }
}

function endpoint(registryUrl: URL, route: string): URL {
  const basePath = registryUrl.pathname.replace(/\/$/, "");
  return new URL(`${basePath}${route}`, registryUrl.origin);
}

async function postJson(fetchImpl: typeof fetch, url: URL, body: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();
  try {
    return await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: controller.signal
    });
  } catch {
    throw new DeviceAuthCliError("SuperSkill device authorization service is unreachable", 1);
  } finally {
    clearTimeout(timer);
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return undefined;
  }
}

function validDeviceStart(value: unknown): value is DeviceStart {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Partial<DeviceStart>;
  return typeof body.device_code === "string"
    && /^ohdc_[A-Za-z0-9_-]{43}$/.test(body.device_code)
    && typeof body.user_code === "string"
    && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(body.user_code)
    && typeof body.verification_uri === "string"
    && Number.isInteger(body.expires_in)
    && body.expires_in! >= 120
    && body.expires_in! <= 15 * 60
    && Number.isInteger(body.interval)
    && body.interval! >= 1
    && body.interval! <= 10;
}

function validDeviceToken(value: unknown): value is DeviceToken {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Partial<DeviceToken>;
  return typeof body.access_token === "string"
    && /^ohdt_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(body.access_token)
    && body.access_token.length <= 2_048
    && body.token_type === "Bearer"
    && body.scope === "superskill:managed"
    && Number.isInteger(body.expires_in)
    && body.expires_in! >= 1
    && body.expires_in! <= DEVICE_TOKEN_MAX_TTL_SECONDS;
}

function safeVerificationUrl(value: string, deviceCode: string, userCode: string): boolean {
  try {
    const parsed = new URL(value);
    const loopback = parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]");
    if ((parsed.protocol !== "https:" && !loopback) || parsed.username || parsed.password || parsed.search) return false;
    return !value.includes(deviceCode) && !value.includes(userCode) && !value.includes(userCode.replace("-", ""));
  } catch {
    return false;
  }
}

function responseError(prefix: string, status: number, body: unknown): DeviceAuthCliError {
  const code = errorCode(body);
  const suffix = code ? ` (${code})` : ` (HTTP ${status})`;
  return new DeviceAuthCliError(`${prefix}${suffix}.`, status === 401 || status === 403 || status === 410 ? 2 : 1);
}

function errorCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z0-9_]{2,80}$/.test(code) ? code : undefined;
}

function retrySeconds(value: unknown, fallback: number): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const retry = (value as { retry_after?: unknown }).retry_after;
  return Number.isInteger(retry) && typeof retry === "number" && retry >= 1 && retry <= 30 ? retry : fallback;
}
