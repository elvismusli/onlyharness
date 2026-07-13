import { createWriteStream, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { readJsonFile, type ResourceCatalog, type SeedResource } from "./resource-catalog-shared.js";

const root = path.resolve(import.meta.dirname, "..");
const catalogPath = path.join(root, "data/resources/verified-2026-07.json");
const archiveRoot = process.env.RESOURCE_ARCHIVE_DIR
  ? path.resolve(process.env.RESOURCE_ARCHIVE_DIR)
  : path.join(root, "data/resources/archives");
const maxBytes = Number(process.env.RESOURCE_ARCHIVE_MAX_BYTES ?? 100_000_000);

type ArchiveStatus = {
  id: string;
  status: "ready" | "failed" | "skipped";
  storageKey?: string;
  sha256?: string;
  bytes?: number;
  url?: string;
  error?: string;
};

async function main() {
  const only = argValue("--only");
  const limit = numberArg("--limit");
  const readyMirrorsOnly = process.argv.includes("--ready-mirrors-only");
  const missingOnly = process.argv.includes("--missing-only");
  const catalog = readJsonFile<ResourceCatalog>(catalogPath);
  let candidates = catalog.resources
    .filter((resource) => isArchiveCandidate(resource))
    .filter((resource) => !readyMirrorsOnly || resource.mirror?.status === "ready")
    .filter((resource) => !only || resource.id === only || resource.upstreamId === only);
  if (missingOnly) candidates = candidates.filter((resource) => !safeStat(archivePath(resource.id))?.size);
  candidates = candidates.slice(0, limit ?? undefined);
  mkdirSync(archiveRoot, { recursive: true });

  const results: ArchiveStatus[] = [];
  for (const resource of candidates) {
    const status = await syncArchive(resource);
    results.push(status);
    console.log(`${status.status.toUpperCase()} ${status.id}${status.bytes ? ` ${status.bytes} bytes` : ""}${status.error ? ` (${status.error})` : ""}`);
  }
  const archiveFiles = archiveInventory();
  writeFileSync(path.join(archiveRoot, "archives.json"), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    maxBytes,
    archiveCount: archiveFiles.length,
    archiveBytes: archiveFiles.reduce((sum, file) => sum + file.bytes, 0),
    archives: archiveFiles,
    results
  }, null, 2)}\n`);
}

async function syncArchive(resource: SeedResource): Promise<ArchiveStatus> {
  const output = path.join(archiveRoot, `${archiveKey(resource.id)}.tar.gz`);
  try {
    const existing = safeStat(output);
    if (existing?.size) return { id: resource.id, status: "ready", storageKey: path.basename(output), bytes: existing.size, sha256: fileSha256(output) };

    const refs = unique([
      "HEAD",
      resource.mirror?.defaultBranch ? `refs/heads/${resource.mirror.defaultBranch}` : undefined,
      "refs/heads/main",
      "refs/heads/master"
    ].filter(Boolean) as string[]);
    const errors: string[] = [];
    for (const ref of refs) {
      const url = `https://codeload.github.com/${encodeURIComponent(resource.upstreamOwner)}/${encodeURIComponent(resource.upstreamRepo)}/tar.gz/${encodeGitHubRef(ref)}`;
      const result = await download(url, output);
      if (result.ok) return { id: resource.id, status: "ready", storageKey: path.basename(output), bytes: result.bytes, sha256: fileSha256(output), url };
      errors.push(`${ref}: ${result.error}`);
    }
    return { id: resource.id, status: "failed", error: errors.join("; ") };
  } catch (error) {
    return { id: resource.id, status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

async function download(url: string, output: string): Promise<{ ok: true; bytes: number } | { ok: false; error: string }> {
  const response = await fetch(url, {
    headers: {
      accept: "application/gzip",
      "user-agent": "onlyharness-resource-archive-sync"
    }
  });
  if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) return { ok: false, error: `archive too large: ${contentLength}` };
  const tmp = `${output}.tmp`;
  const result = await writeLimited(response, tmp);
  if (!result.ok) return result;
  if (result.bytes < 32) {
    safeUnlink(tmp);
    return { ok: false, error: "archive too small" };
  }
  renameSync(tmp, output);
  return { ok: true, bytes: result.bytes };
}

async function writeLimited(response: Response, tmp: string): Promise<{ ok: true; bytes: number } | { ok: false; error: string }> {
  const body = response.body as unknown as AsyncIterable<Uint8Array> | null;
  if (!body) return { ok: false, error: "empty response body" };
  const out = createWriteStream(tmp);
  let bytes = 0;
  try {
    for await (const chunk of body) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        out.destroy();
        safeUnlink(tmp);
        return { ok: false, error: `archive too large: ${bytes}` };
      }
      if (!out.write(chunk)) await once(out, "drain");
    }
    out.end();
    await once(out, "finish");
    return { ok: true, bytes };
  } catch (error) {
    out.destroy();
    safeUnlink(tmp);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function archivePath(id: string): string {
  return path.join(archiveRoot, `${archiveKey(id)}.tar.gz`);
}

function isArchiveCandidate(resource: SeedResource): boolean {
  return resource.sourcePlatform === "github"
    && resource.canonicalUrl.startsWith("https://github.com/")
    && Boolean(resource.upstreamOwner)
    && Boolean(resource.upstreamRepo);
}

function encodeGitHubRef(ref: string): string {
  return ref.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function archiveKey(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}

function archiveInventory(): Array<{ id: string; storageKey: string; bytes: number; sha256: string }> {
  return readdirSync(archiveRoot)
    .filter((file) => file.endsWith(".tar.gz"))
    .map((file) => {
      const id = Buffer.from(file.replace(/\.tar\.gz$/, ""), "base64url").toString("utf8");
      const filePath = path.join(archiveRoot, file);
      return { id, storageKey: file, bytes: statSync(filePath).size, sha256: fileSha256(filePath) };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function fileSha256(filePath: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(filePath)).digest("hex")}`;
}

function safeStat(filePath: string): { size: number } | undefined {
  try {
    return statSync(filePath);
  } catch {
    return undefined;
  }
}

function safeUnlink(filePath: string) {
  try {
    unlinkSync(filePath);
  } catch {
    // Best effort cleanup for interrupted/oversized downloads.
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberArg(name: string): number | undefined {
  const raw = argValue(name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number`);
  return parsed;
}

const isMain = process.argv[1] ? import.meta.url === new URL(process.argv[1], "file:").href : false;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
