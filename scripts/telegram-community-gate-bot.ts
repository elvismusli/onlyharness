import { fileURLToPath } from "node:url";

type TelegramUpdate = {
  update_id: number;
  message?: {
    chat?: { id?: number | string };
    text?: string;
  };
};

type VerifyCodeResponse = {
  ok?: boolean;
  allowed?: boolean;
  owner?: string;
  repo?: string;
  version?: string;
  status?: string;
  error?: string;
};

type BotConfig = {
  telegramToken: string;
  orgToken: string;
  apiBase: string;
  channelId?: string;
  staticInviteLink?: string;
  dryRun: boolean;
  pollTimeoutSeconds: number;
};

const telegramApiBase = "https://api.telegram.org";

export function parseGateCode(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("ohc_")) return trimmed;
  const match = trimmed.match(/^\/(?:start|check)(?:@\w+)?(?:\s+(.+))?$/);
  return match?.[1]?.trim();
}

export async function verifyCommunityCode(input: { apiBase: string; orgToken: string; code: string }): Promise<VerifyCodeResponse> {
  const response = await fetch(`${input.apiBase.replace(/\/$/, "")}/community/verify-code`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.orgToken}`
    },
    body: JSON.stringify({ code: input.code })
  });
  const body = await response.json().catch(() => ({})) as VerifyCodeResponse;
  if (!response.ok) return { ok: false, error: body.error ?? `Verification failed: HTTP ${response.status}` };
  return body;
}

async function main() {
  const config = readConfig();
  console.log(`OnlyHarness Telegram gate bot polling ${config.apiBase}`);
  let offset = 0;
  while (true) {
    const updates = await telegramRequest<TelegramUpdate[]>(config.telegramToken, "getUpdates", {
      offset,
      timeout: config.pollTimeoutSeconds,
      allowed_updates: ["message"]
    });
    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1);
      await handleUpdate(config, update);
    }
  }
}

async function handleUpdate(config: BotConfig, update: TelegramUpdate) {
  const chatId = update.message?.chat?.id;
  if (chatId === undefined) return;
  const code = parseGateCode(update.message?.text);
  if (!code) {
    await sendMessage(config.telegramToken, chatId, "Send /start <OnlyHarness code> to verify access.");
    return;
  }
  const decision = await verifyCommunityCode({ apiBase: config.apiBase, orgToken: config.orgToken, code });
  if (!decision.ok || !decision.allowed) {
    await sendMessage(config.telegramToken, chatId, decision.error ?? "Access is not active for this code.");
    return;
  }
  const label = `${decision.owner}/${decision.repo}@${decision.version}`;
  if (config.dryRun) {
    await sendMessage(config.telegramToken, chatId, `Access verified for ${label}.`);
    return;
  }
  const inviteLink = config.staticInviteLink ?? await createOneUseInviteLink(config);
  await sendMessage(config.telegramToken, chatId, `Access verified for ${label}:\n${inviteLink}`);
}

async function createOneUseInviteLink(config: BotConfig): Promise<string> {
  if (!config.channelId) throw new Error("TELEGRAM_CHANNEL_ID is required when TELEGRAM_INVITE_LINK is not set");
  const result = await telegramRequest<{ invite_link?: string }>(config.telegramToken, "createChatInviteLink", {
    chat_id: config.channelId,
    member_limit: 1,
    expire_date: Math.floor(Date.now() / 1000) + 600,
    name: "OnlyHarness verified access"
  });
  if (!result.invite_link) throw new Error("Telegram did not return an invite_link");
  return result.invite_link;
}

async function sendMessage(token: string, chatId: string | number, text: string) {
  await telegramRequest(token, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  });
}

async function telegramRequest<T = unknown>(token: string, method: string, body: unknown): Promise<T> {
  const response = await fetch(`${telegramApiBase}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; result?: T; description?: string };
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.description ?? `Telegram ${method} failed: HTTP ${response.status}`);
  }
  return payload.result as T;
}

function readConfig(): BotConfig {
  const telegramToken = requiredEnv("TELEGRAM_BOT_TOKEN");
  const orgToken = requiredEnv("HH_ORG_TOKEN");
  const apiBase = process.env.HH_API_BASE ?? "https://superskill.sh/api";
  const dryRun = process.env.TELEGRAM_BOT_DRY_RUN === "true";
  const staticInviteLink = process.env.TELEGRAM_INVITE_LINK?.trim();
  const channelId = process.env.TELEGRAM_CHANNEL_ID?.trim();
  if (!dryRun && !staticInviteLink && !channelId) {
    throw new Error("Set TELEGRAM_CHANNEL_ID, TELEGRAM_INVITE_LINK, or TELEGRAM_BOT_DRY_RUN=true");
  }
  const pollTimeoutSeconds = Number(process.env.TELEGRAM_POLL_TIMEOUT_SECONDS ?? 25);
  return {
    telegramToken,
    orgToken,
    apiBase,
    channelId,
    staticInviteLink,
    dryRun,
    pollTimeoutSeconds: Number.isFinite(pollTimeoutSeconds) && pollTimeoutSeconds > 0 ? Math.floor(pollTimeoutSeconds) : 25
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
