#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

const required = [
  "SUPERSKILL_PROBE_API_URL",
  "SUPERSKILL_PROBE_CLIENT",
  "SUPERSKILL_PROBE_ROOT",
  "SUPERSKILL_PROBE_STATE_ROOT"
];
if (required.some((name) => !process.env[name])) failStartup("PROBE_ENV_MISSING");

const apiUrl = parseLocalUrl(process.env.SUPERSKILL_PROBE_API_URL);
const expectedRoot = await realpath(process.env.SUPERSKILL_PROBE_ROOT);
const stateRoot = await realpath(process.env.SUPERSKILL_PROBE_STATE_ROOT);
const expectedRootUri = directoryUri(expectedRoot);
const pending = new Map();
let nextRequestId = 1;

const tools = [
  {
    name: "recommend_probe",
    description: "Proxy one authenticated read-only recommendation request and return only its decision.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: { client: { enum: ["codex", "claude-code"] } },
      required: ["client"],
      additionalProperties: false
    }
  },
  {
    name: "root_probe",
    description: "Request MCP roots and validate an explicit local fallback when the client returns none.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: { explicitFallback: { type: "string", minLength: 1, maxLength: 256 } },
      required: ["explicitFallback"],
      additionalProperties: false
    }
  },
  {
    name: "denied_mutation",
    description: "Exercise the denied-mutation contract without writing files or durable state.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }
];

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message && typeof message === "object" && "id" in message && !("method" in message)) {
    const waiter = pending.get(String(message.id));
    if (waiter) {
      pending.delete(String(message.id));
      waiter(message);
    }
    return;
  }
  if (!message || typeof message.method !== "string" || !("id" in message)) return;
  void handleRequest(message).then(
    (result) => send({ jsonrpc: "2.0", id: message.id, result }),
    (error) => send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32603, message: safeErrorCode(error) }
    })
  );
});

async function handleRequest(message) {
  if (message.method === "initialize") {
    return {
      protocolVersion: typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "superskill-compatibility-probe", version: "1.0.0" }
    };
  }
  if (message.method === "ping") return {};
  if (message.method === "tools/list") return { tools };
  if (message.method === "tools/call") return callTool(message.params?.name, message.params?.arguments ?? {});
  throw new ProbeError("PROBE_METHOD_NOT_FOUND");
}

async function callTool(name, args) {
  if (name === "recommend_probe") {
    if (!args || !["codex", "claude-code"].includes(args.client)) return toolError("PROBE_INPUT_INVALID");
    const response = await fetch(new URL("recommendations", apiUrl), {
      method: "POST",
      headers: {
        ...(process.env.SUPERSKILL_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.SUPERSKILL_ACCESS_TOKEN}` } : {}),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        task: "compatibility probe request",
        context: {
          client: args.client,
          clientVersion: args.client === "codex" ? "0.144.3" : "2.1.112",
          os: process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : "unknown",
          arch: process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : "unknown",
          installedManagedRefs: []
        }
      })
    });
    const payload = await safeJson(response);
    const decision = response.ok && payload?.decision === "no_safe_match" ? "no_safe_match" : undefined;
    const result = decision
      ? { ok: true, code: "PROBE_NO_SAFE_MATCH", decision }
      : { ok: false, code: safeRemoteCode(payload, response.status) };
    return result.ok ? toolResult(result) : toolError(result.code);
  }
  if (name === "root_probe") {
    if (!args || typeof args.explicitFallback !== "string") return toolError("PROBE_INPUT_INVALID");
    const rootsResponse = await requestClient("roots/list", {});
    const roots = Array.isArray(rootsResponse?.result?.roots) ? rootsResponse.result.roots : [];
    let mode;
    let canonicalMatch;
    if (roots.length > 0) {
      mode = "roots_list";
      canonicalMatch = roots.length === 1 && roots[0]?.uri === expectedRootUri;
    } else {
      mode = "explicit_fallback";
      canonicalMatch = (await resolveFallback(args.explicitFallback)) === expectedRoot;
    }
    const result = canonicalMatch
      ? { ok: true, code: "PROBE_ROOT_OK", mode, canonicalMatch: true }
      : { ok: false, code: "PROBE_ROOT_MISMATCH", mode, canonicalMatch: false };
    return result.ok ? toolResult(result) : toolError(result.code);
  }
  if (name === "denied_mutation") {
    const workspaceBefore = await snapshot(expectedRoot);
    const stateBefore = await snapshot(stateRoot);
    const workspaceAfter = await snapshot(expectedRoot);
    const stateAfter = await snapshot(stateRoot);
    const workspaceDiffCount = workspaceBefore === workspaceAfter ? 0 : 1;
    const stateDiffCount = stateBefore === stateAfter ? 0 : 1;
    const result = {
      ok: false,
      code: "MUTATION_DENIED",
      wroteState: false,
      workspaceDiffCount,
      stateDiffCount
    };
    return toolError(result.code, result);
  }
  return toolError("PROBE_TOOL_NOT_FOUND");
}

async function requestClient(method, params) {
  const id = `probe-${nextRequestId++}`;
  const response = new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      resolve({ error: { code: "PROBE_ROOTS_UNAVAILABLE" } });
    }, 2_000);
    pending.set(id, (message) => {
      clearTimeout(timeout);
      resolve(message);
    });
  });
  send({ jsonrpc: "2.0", id, method, params });
  return response;
}

async function resolveFallback(value) {
  const unresolved = path.isAbsolute(value) ? value : path.resolve(expectedRoot, value);
  let resolved;
  try {
    resolved = await realpath(unresolved);
  } catch {
    throw new ProbeError("PROBE_ROOT_INVALID");
  }
  const relative = path.relative(expectedRoot, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ProbeError("PROBE_ROOT_OUTSIDE_WORKSPACE");
  }
  return resolved;
}

async function snapshot(root) {
  const entries = [];
  await visit(root, "", entries);
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

async function visit(root, relative, entries) {
  const target = relative ? path.join(root, relative) : root;
  const stat = await lstat(target);
  if (stat.isSymbolicLink()) {
    entries.push(`l:${relative}:${await readlink(target)}`);
    return;
  }
  if (stat.isDirectory()) {
    entries.push(`d:${relative}`);
    for (const name of (await readdir(target)).sort()) await visit(root, path.join(relative, name), entries);
    return;
  }
  if (stat.isFile()) {
    entries.push(`f:${relative}:${stat.mode & 0o777}:${createHash("sha256").update(await readFile(target)).digest("hex")}`);
    return;
  }
  entries.push(`o:${relative}:${stat.mode}`);
}

function toolResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function toolError(code, detail = {}) {
  const value = { ok: false, code, ...detail };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function safeRemoteCode(value, status) {
  return value && typeof value.code === "string" && /^[A-Z0-9_]{3,64}$/.test(value.code)
    ? value.code
    : status === 401 ? "SUPERSKILL_AUTH_INVALID" : "PROBE_RECOMMEND_FAILED";
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function directoryUri(value) {
  return pathToFileURL(value).href;
}

function parseLocalUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    failStartup("PROBE_URL_INVALID");
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    failStartup("PROBE_LOOPBACK_REQUIRED");
  }
  return url;
}

function safeErrorCode(error) {
  return error instanceof ProbeError ? error.code : "PROBE_INTERNAL_ERROR";
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function failStartup(code) {
  process.stderr.write(`${code}\n`);
  process.exit(78);
}

class ProbeError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
