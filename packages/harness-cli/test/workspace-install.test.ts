import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { installWorkspaceSetup } from "../src/lib/workspace-install.js";

test("workspace setup installs hosted packages atomically and replays without credentials on disk", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "superskill-workspace-install-"));
  const previousFlag = process.env.HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY;
  process.env.HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY = "1";
  const archive = tarGz([
    { name: "SKILL.md", content: Buffer.from("---\nname: team-skill\ndescription: Team skill.\n---\n\n# Team skill\n") },
    { name: "scripts/run.sh", content: Buffer.from("#!/bin/sh\necho ok\n") }
  ]);
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/setup-bundle?target=codex")) return response(200, {
      workspace: { slug: "acme", name: "Acme" },
      bundle: {
        version: "bundle-1",
        target: "codex",
        resources: [{ id: "@acme/team-skill", name: "team-skill", resourceType: "skill", source: "workspace", hostedArchive: true }],
        configs: [{ path: "instructions/AGENTS.md", content: "Use @acme/team-skill.\n" }]
      },
      next: "Open the installed workspace instructions."
    });
    if (url.endsWith("/workspaces/acme/resources/team-skill/archive")) return new Response(archive, { status: 200, headers: { "content-type": "application/gzip" } });
    throw new Error(`unexpected ${url}`);
  };
  try {
    const first = await installWorkspaceSetup({
      registry: "http://127.0.0.1:8787/api",
      workspace: "acme",
      target: "codex",
      token: "secret-agent-access-token",
      projectRoot: root,
      fetchImpl
    });
    assert.equal(first.code, "WORKSPACE_INSTALLED");
    assert.equal(first.output, ".harnesshub/workspaces/acme");
    assert.match(readFileSync(path.join(root, first.output, "resources/team-skill/SKILL.md"), "utf8"), /Team skill/);
    assert.match(readFileSync(path.join(root, first.output, "instructions/AGENTS.md"), "utf8"), /@acme\/team-skill/);
    assert.equal(readFileSync(path.join(root, first.output, ".harnesshub/setup.json"), "utf8").includes("secret-agent-access-token"), false);

    const repeated = await installWorkspaceSetup({
      registry: "http://127.0.0.1:8787/api",
      workspace: "acme",
      target: "codex",
      token: "secret-agent-access-token",
      projectRoot: root,
      fetchImpl
    });
    assert.equal(repeated.code, "WORKSPACE_UNCHANGED");
  } finally {
    if (previousFlag === undefined) delete process.env.HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY;
    else process.env.HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY = previousFlag;
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace setup rejects a symlinked managed root before writing outside the project", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "superskill-workspace-symlink-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "superskill-workspace-outside-"));
  const previousFlag = process.env.HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY;
  process.env.HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY = "1";
  symlinkSync(outside, path.join(root, ".harnesshub"), "dir");
  try {
    await assert.rejects(() => installWorkspaceSetup({
      registry: "http://127.0.0.1:8787/api",
      workspace: "acme",
      target: "codex",
      token: "secret-agent-access-token",
      projectRoot: root,
      fetchImpl: async () => response(200, {
        workspace: { slug: "acme" },
        bundle: { version: "bundle-1", target: "codex", resources: [], configs: [] }
      })
    }), /symlink/i);
    assert.equal(existsSync(path.join(outside, "workspaces")), false);
  } finally {
    if (previousFlag === undefined) delete process.env.HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY;
    else process.env.HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY = previousFlag;
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

function response(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function tarGz(files: Array<{ name: string; content: Buffer }>): Buffer {
  const blocks: Buffer[] = [];
  for (const file of files) {
    const header = Buffer.alloc(512);
    header.write(file.name, 0, 100, "utf8");
    writeOctal(header, 0o644, 100, 8);
    writeOctal(header, 0, 108, 8);
    writeOctal(header, 0, 116, 8);
    writeOctal(header, file.content.length, 124, 12);
    writeOctal(header, 0, 136, 12);
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    writeOctal(header, [...header].reduce((sum, byte) => sum + byte, 0), 148, 8);
    blocks.push(header, file.content, Buffer.alloc((512 - (file.content.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function writeOctal(target: Buffer, value: number, offset: number, length: number): void {
  const text = value.toString(8).padStart(length - 1, "0");
  target.write(text, offset, length - 1, "ascii");
  target[offset + length - 1] = 0;
}
