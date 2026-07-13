import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  bootstrapManifestDigest,
  canonicalInstallUrl,
  clientAdapterContractDigest,
  fetchBootstrapManifest,
  installUniversalSkill,
  resolveInstallClients,
  universalSkillArtifactDigest,
  validateBootstrapManifest,
  verifyOfficialPackageIntegrity,
  type BootstrapCapability,
  type SuperSkillBootstrapManifest
} from "../src/lib/superskill-bootstrap.js";
import { SUPERSKILL_RUNTIME, SuperSkillCliError } from "../src/lib/superskill-types.js";

const capability: BootstrapCapability = {
  id: "market-research",
  version: "0.2.0",
  artifactDigest: `sha256:${"a".repeat(64)}`
};

test("client auto-detection is deterministic and refuses ambiguous or absent clients", () => {
  assert.deepEqual(resolveInstallClients({ env: {}, probe: (client) => client === "codex" }), ["codex"]);
  assert.deepEqual(resolveInstallClients({ env: {}, probe: (client) => client === "claude-code" }), ["claude-code"]);
  assert.deepEqual(resolveInstallClients({ env: { CODEX_THREAD_ID: "thread" }, probe: () => true }), ["codex"]);
  assert.deepEqual(resolveInstallClients({ env: { CLAUDECODE: "1" }, probe: () => true }), ["claude-code"]);
  assert.throws(() => resolveInstallClients({ env: {}, probe: () => true }), hasReason("CLIENT_AMBIGUOUS"));
  assert.throws(() => resolveInstallClients({ env: {}, probe: () => false }), hasReason("CLIENT_NOT_DETECTED"));
  assert.deepEqual(resolveInstallClients({ all: true, env: {}, probe: () => false }), ["claude-code", "codex"]);
  assert.deepEqual(resolveInstallClients({ all: true, env: { SUPERSKILL_CLIENT: "codex", CLAUDECODE: "1" }, probe: () => false }), ["claude-code", "codex"]);
  assert.throws(() => resolveInstallClients({ auto: true, target: "codex", env: {} }), hasReason("CLIENT_SELECTION_CONFLICT"));
  assert.throws(() => resolveInstallClients({ auto: true, all: true, env: {} }), hasReason("CLIENT_SELECTION_CONFLICT"));
  assert.throws(() => resolveInstallClients({ target: "codex", all: true, env: {} }), hasReason("CLIENT_SELECTION_CONFLICT"));
});

for (const client of ["codex", "claude-code"] as const) {
  test(`universal install is project-local, exact and idempotent for ${client}`, () => {
    const project = mkdtempSync(path.join(os.tmpdir(), `superskill-bootstrap-${client}-`));
    try {
      const manifest = validManifest(capability);
      const first = installUniversalSkill({ verifiedBootstrap: verified(manifest), clients: [client], projectDir: project });
      const target = client === "codex" ? ".agents/skills/superskill" : ".claude/skills/superskill";
      assert.deepEqual(first.targets, [target]);
      assert.deepEqual(first.mcpConfigs, [client === "codex" ? ".codex/config.toml" : ".mcp.json"]);
      assert.equal(first.activationPerformed, false);
      assert.equal(first.explicitActivationConsentRequired, true);
      assert.match(readFileSync(path.join(project, target, "SKILL.md"), "utf8"), /separate explicit activation consent/);
      const handoff = JSON.parse(readFileSync(path.join(project, ".onlyharness/superskill-handoff.json"), "utf8"));
      assert.deepEqual(handoff.capability, capability);
      assert.equal(handoff.status, "pending_explicit_activation_consent");
      const before = statSync(path.join(project, target, "SKILL.md")).mtimeMs;
      const repeated = installUniversalSkill({ verifiedBootstrap: verified(manifest), clients: [client], projectDir: project });
      assert.equal(repeated.status, "unchanged");
      assert.equal(statSync(path.join(project, target, "SKILL.md")).mtimeMs, before);
      assert.equal(JSON.stringify(repeated).includes(project), false, "structured output must not expose the repository path");
      assert.equal(JSON.stringify(repeated).includes("HH_TOKEN"), false, "structured output must not expose credential transport names");
      assert.equal(exists(path.join(project, client === "codex" ? ".claude" : ".agents")), false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
}

test("explicit --all plan installs both adapters and dry-run writes nothing", () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-bootstrap-all-"));
  try {
    const manifest = validManifest(null);
    const planned = installUniversalSkill({ verifiedBootstrap: verified(manifest), clients: ["claude-code", "codex"], projectDir: project, dryRun: true });
    assert.equal(planned.status, "planned");
    assert.equal(exists(path.join(project, ".agents")), false);
    assert.equal(exists(path.join(project, ".claude")), false);
    assert.equal(exists(path.join(project, ".onlyharness")), false);
    const installed = installUniversalSkill({ verifiedBootstrap: verified(manifest), clients: ["claude-code", "codex"], projectDir: project });
    assert.equal(installed.status, "installed");
    assert.equal(exists(path.join(project, ".agents/skills/superskill/SKILL.md")), true);
    assert.equal(exists(path.join(project, ".claude/skills/superskill/SKILL.md")), true);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("installer preserves unrelated MCP config, rejects collisions before writes and rolls both clients back byte-exact", () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-bootstrap-configs-"));
  try {
    mkdirSync(path.join(project, ".codex"), { recursive: true });
    const claudeOriginal = `${JSON.stringify({ mcpServers: { existing: { command: "safe-tool", args: ["serve"] } }, unrelated: true }, null, 2)}\n`;
    const codexOriginal = 'model = "gpt-5"\n\n[mcp_servers.existing]\ncommand = "safe-tool"\n';
    writeFileSync(path.join(project, ".mcp.json"), claudeOriginal);
    writeFileSync(path.join(project, ".codex/config.toml"), codexOriginal);
    const installed = installUniversalSkill({ verifiedBootstrap: verified(validManifest(null)), clients: ["claude-code", "codex"], projectDir: project });
    const claude = JSON.parse(readFileSync(path.join(project, ".mcp.json"), "utf8"));
    assert.equal(claude.unrelated, true);
    assert.deepEqual(claude.mcpServers.existing, { command: "safe-tool", args: ["serve"] });
    assert.deepEqual(claude.mcpServers.superskill_local, { command: "npx", args: ["--yes", "onlyharness@0.2.14", "mcp", "superskill"] });
    const codex = readFileSync(path.join(project, ".codex/config.toml"), "utf8");
    assert.match(codex, /model = "gpt-5"/);
    assert.match(codex, /\[mcp_servers\.existing\]/);
    assert.match(codex, /\[mcp_servers\.superskill_local\]/);
    assert.equal(codex.includes("fixture-secret"), false);
    assert.deepEqual(installed.mcpConfigs.sort(), [".codex/config.toml", ".mcp.json"]);

    const conflict = mkdtempSync(path.join(os.tmpdir(), "superskill-bootstrap-conflict-"));
    try {
      writeFileSync(path.join(conflict, ".mcp.json"), JSON.stringify({ mcpServers: { superskill_local: { command: "attacker" } } }));
      assert.throws(
        () => installUniversalSkill({ verifiedBootstrap: verified(validManifest(null)), clients: ["claude-code", "codex"], projectDir: conflict }),
        hasReason("TARGET_COLLISION")
      );
      assert.equal(exists(path.join(conflict, ".agents")), false);
      assert.equal(exists(path.join(conflict, ".claude")), false);
    } finally {
      rmSync(conflict, { recursive: true, force: true });
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
  }

  const rollback = mkdtempSync(path.join(os.tmpdir(), "superskill-bootstrap-config-rollback-"));
  try {
    mkdirSync(path.join(rollback, ".codex"), { recursive: true });
    const claudeOriginal = '{"unrelated":"claude-byte-exact"}\n';
    const codexOriginal = 'model = "codex-byte-exact"\n';
    writeFileSync(path.join(rollback, ".mcp.json"), claudeOriginal);
    writeFileSync(path.join(rollback, ".codex/config.toml"), codexOriginal);
    assert.throws(() => installUniversalSkill({
      verifiedBootstrap: verified(validManifest(capability)),
      clients: ["claude-code", "codex"],
      projectDir: rollback,
      onBoundary: (boundary) => { if (boundary === "after-handoff-link-before-fsync") throw new Error("fault"); }
    }), hasReason("INSTALL_FAILED"));
    assert.equal(readFileSync(path.join(rollback, ".mcp.json"), "utf8"), claudeOriginal);
    assert.equal(readFileSync(path.join(rollback, ".codex/config.toml"), "utf8"), codexOriginal);
    assert.equal(exists(path.join(rollback, ".agents")), false);
    assert.equal(exists(path.join(rollback, ".claude")), false);
  } finally {
    rmSync(rollback, { recursive: true, force: true });
  }
});

test("bad manifest digest and offline bootstrap fail before any state write", async () => {
  const good = validManifest(capability);
  const bad = { ...good, manifestDigest: `sha256:${"0".repeat(64)}` };
  assert.throws(() => validateBootstrapManifest(bad, new URL(good.canonicalUrl)), hasReason("BOOTSTRAP_INTEGRITY_FAILED"));
  const wrongArtifactBody = { ...good, universalSkill: { ...good.universalSkill, artifactDigest: `sha256:${"f".repeat(64)}` } };
  const { manifestDigest: _discarded, ...unsignedWrongArtifact } = wrongArtifactBody;
  const wrongArtifact = { ...wrongArtifactBody, manifestDigest: bootstrapManifestDigest(unsignedWrongArtifact) };
  assert.throws(() => validateBootstrapManifest(wrongArtifact, new URL(good.canonicalUrl)), hasReason("BOOTSTRAP_INTEGRITY_FAILED"));
  await assert.rejects(
    () => fetchBootstrapManifest(good.canonicalUrl, { fetchImpl: async () => { throw new Error("offline /Users/private/repo"); } }),
    (error: unknown) => error instanceof SuperSkillCliError && error.reasonCode === "BOOTSTRAP_UNAVAILABLE" && !error.message.includes("/Users/private/repo")
  );
});

test("bootstrap and official npm redirects fail closed, and npm integrity must match exactly", async () => {
  const manifest = validManifest(capability);
  const bootstrapRedirect = responseAt("https://attacker.invalid/bootstrap", manifest, 200, true);
  await assert.rejects(
    () => fetchBootstrapManifest(manifest.canonicalUrl, { fetchImpl: async () => bootstrapRedirect }),
    hasReason("BOOTSTRAP_INTEGRITY_FAILED")
  );
  const metadataUrl = `https://registry.npmjs.org/onlyharness/${SUPERSKILL_RUNTIME.cliVersion}`;
  const mismatch = responseAt(metadataUrl, { dist: { integrity: "sha512-ZGlmZmVyZW50" } });
  await assert.rejects(
    () => verifyOfficialPackageIntegrity(manifest, { fetchImpl: async () => mismatch }),
    hasReason("BOOTSTRAP_INTEGRITY_FAILED")
  );
  const redirected = responseAt("https://registry.example.invalid/package", { dist: { integrity: manifest.installer.integrity } }, 200, true);
  await assert.rejects(
    () => verifyOfficialPackageIntegrity(manifest, { fetchImpl: async () => redirected }),
    hasReason("BOOTSTRAP_INTEGRITY_FAILED")
  );
  const exact = responseAt(metadataUrl, { dist: { integrity: manifest.installer.integrity } });
  const verifiedResult = await verifyOfficialPackageIntegrity(manifest, { fetchImpl: async () => exact });
  assert.equal(verifiedResult.officialIntegrity, manifest.installer.integrity);
  assert.equal(verifiedResult.verified, true);
});

test("all target and handoff preflights complete before any write", () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-bootstrap-preflight-"));
  try {
    mkdirSync(path.join(project, ".agents/skills/superskill"), { recursive: true });
    mkdirSync(path.join(project, ".agents/skills/superskill/conflict"));
    assert.throws(
      () => installUniversalSkill({ verifiedBootstrap: verified(validManifest(capability)), clients: ["claude-code", "codex"], projectDir: project }),
      hasReason("TARGET_COLLISION")
    );
    assert.equal(exists(path.join(project, ".claude")), false, "first target must not be written before second target preflight");
    assert.equal(exists(path.join(project, ".onlyharness")), false, "handoff must not be written after a failed target preflight");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

for (const boundary of ["after-target-rename-before-fsync", "after-handoff-link-before-fsync"] as const) {
  test(`rollback removes every renamed artifact when ${boundary} fails`, () => {
    const project = mkdtempSync(path.join(os.tmpdir(), "superskill-bootstrap-rollback-"));
    try {
      assert.throws(
        () => installUniversalSkill({
          verifiedBootstrap: verified(validManifest(capability)),
          clients: ["codex"],
          projectDir: project,
          onBoundary: (current) => { if (current === boundary) throw new Error(`raw ${project}/secret`); }
        }),
        (error: unknown) => error instanceof SuperSkillCliError && error.reasonCode === "INSTALL_FAILED" && !error.message.includes(project)
      );
      assert.equal(exists(path.join(project, ".agents")), false);
      assert.equal(exists(path.join(project, ".onlyharness")), false);
      assert.equal(exists(path.join(project, ".superskill-install.lock")), false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
}

test("concurrent installer collides on the exclusive project lock without corrupting the winner", () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-bootstrap-lock-"));
  const bootstrap = verified(validManifest(null));
  let nestedError: unknown;
  try {
    const result = installUniversalSkill({
      verifiedBootstrap: bootstrap,
      clients: ["codex"],
      projectDir: project,
      onBoundary: (boundary) => {
        if (boundary !== "after-lock") return;
        try { installUniversalSkill({ verifiedBootstrap: bootstrap, clients: ["codex"], projectDir: project }); }
        catch (error) { nestedError = error; }
      }
    });
    assert.equal(result.status, "installed");
    assert.ok(nestedError instanceof SuperSkillCliError);
    assert.equal(nestedError.reasonCode, "INSTALL_BUSY");
    assert.equal(exists(path.join(project, ".agents/skills/superskill/SKILL.md")), true);
    assert.equal(exists(path.join(project, ".superskill-install.lock")), false);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("symlinked native root is rejected without touching its target", () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-bootstrap-symlink-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "superskill-bootstrap-outside-"));
  try {
    mkdirSync(path.join(project, ".agents"));
    symlinkSync(outside, path.join(project, ".agents/skills"), "dir");
    assert.throws(
      () => installUniversalSkill({ verifiedBootstrap: verified(validManifest(capability)), clients: ["codex"], projectDir: project }),
      hasReason("TARGET_COLLISION")
    );
    assert.deepEqual(readDirectory(outside), []);
    assert.equal(exists(path.join(project, ".onlyharness")), false);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

function validManifest(input: BootstrapCapability | null): SuperSkillBootstrapManifest {
  const body = {
    schemaVersion: "superskill.bootstrap.v1" as const,
    canonicalUrl: canonicalInstallUrl(input ?? undefined),
    installer: { package: "onlyharness" as const, version: SUPERSKILL_RUNTIME.cliVersion, integrity: "sha512-YWJj", releaseStatus: "published" as const },
    universalSkill: { name: "superskill" as const, version: "0.2.0", artifactDigest: universalSkillArtifactDigest() },
    clientAdapters: {
      codex: { path: ".codex/config.toml", contractDigest: clientAdapterContractDigest("codex") },
      "claude-code": { path: ".mcp.json", contractDigest: clientAdapterContractDigest("claude-code") }
    },
    capability: input,
    activation: { performed: false as const, explicitConsentRequired: true as const }
  };
  const manifest = { ...body, manifestDigest: bootstrapManifestDigest(body) };
  return validateBootstrapManifest(manifest, new URL(manifest.canonicalUrl));
}

function hasReason(reasonCode: string) {
  return (error: unknown) => error instanceof SuperSkillCliError && error.reasonCode === reasonCode;
}

function verified(manifest: SuperSkillBootstrapManifest) {
  return { manifest, officialIntegrity: manifest.installer.integrity, verified: true as const };
}

function responseAt(url: string, body: unknown, status = 200, redirected = false): Response {
  const response = new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  Object.defineProperty(response, "url", { value: url });
  Object.defineProperty(response, "redirected", { value: redirected });
  return response;
}

function exists(file: string): boolean {
  try { statSync(file); return true; } catch { return false; }
}

function readDirectory(directory: string): string[] {
  return readdirSync(directory);
}
